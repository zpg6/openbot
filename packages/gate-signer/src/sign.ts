import {
    GATE_ATTESTATION_MAX_LIFETIME_MS_V1,
    GateAttestationEnvelopeV1Schema,
    bootstrapGateAttestationVerifierV1,
    canonicalGateAttestationEnvelopeBytesV1,
    digestCanonicalJsonV1,
    digestGateAttestationV1,
    verifyGateAttestationV1,
    type CanonicalJsonValueV1,
    type GateAttestationEnvelopeV1,
} from "@openbot/gate-attestation/internal";
import {
    assessD1ProbeReportForOperatorReviewV1,
    parseUntrustedItem2ProbeReportV1,
} from "@openbot/gate-evidence/internal";

import {
    D1GateAttestationOperatorBundleV1Schema,
    D1GateAttestationSigningRequestV1Schema,
    GateSigningPrivateKeyV1Schema,
    type D1GateAttestationOperatorBundleV1,
    type D1GateAttestationSigningDenialV1,
} from "./contracts.js";

const P256_CURVE_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_CURVE_ORDER = P256_CURVE_ORDER / 2n;
const EMPTY_SIGNATURE = "A".repeat(86);

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const encodeBase64Url = (bytes: Uint8Array): string =>
    globalThis
        .btoa(String.fromCharCode(...bytes))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");

const decodeBase64Url = (value: string): Uint8Array | null => {
    try {
        const paddingLength = (4 - (value.length % 4)) % 4;
        const binary = globalThis.atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat(paddingLength));
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return encodeBase64Url(bytes) === value ? bytes : null;
    } catch {
        return null;
    }
};

const scalar = (bytes: Uint8Array): bigint => {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
};

const writeScalar = (value: bigint): Uint8Array => {
    const bytes = new Uint8Array(32);
    let remaining = value;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
};

export const normalizeP256SignatureV1 = (input: unknown): Uint8Array | null => {
    if (!(input instanceof Uint8Array) || input.byteLength !== 64) return null;
    const r = scalar(input.subarray(0, 32));
    const rawS = scalar(input.subarray(32, 64));
    if (r <= 0n || r >= P256_CURVE_ORDER || rawS <= 0n || rawS >= P256_CURVE_ORDER) return null;
    const s = rawS > P256_HALF_CURVE_ORDER ? P256_CURVE_ORDER - rawS : rawS;
    const output = new Uint8Array(64);
    output.set(writeScalar(r), 0);
    output.set(writeScalar(s), 32);
    return output;
};

type SignResult =
    | { success: true; bundle: D1GateAttestationOperatorBundleV1 }
    | { success: false; code: D1GateAttestationSigningDenialV1 };

export const inspectD1GateAttestationOperatorBundleIntegrityV1 = async (
    input: unknown
): Promise<
    | { success: true; bundle: D1GateAttestationOperatorBundleV1 }
    | { success: false; code: "invalid_operator_bundle" | "digest_unavailable" }
> => {
    let parsed: ReturnType<typeof D1GateAttestationOperatorBundleV1Schema.safeParse>;
    try {
        parsed = D1GateAttestationOperatorBundleV1Schema.safeParse(input);
    } catch {
        return { success: false, code: "invalid_operator_bundle" };
    }
    if (!parsed.success) return { success: false, code: "invalid_operator_bundle" };
    const { review_record_digest: _reviewRecordDigest, ...reviewRecord } = parsed.data.review;
    const reviewDigest = await digestCanonicalJsonV1(
        "openbot.d1-gate-attestation-review.v1",
        reviewRecord as CanonicalJsonValueV1
    );
    const attestationDigest = await digestGateAttestationV1(parsed.data.attestation);
    if (reviewDigest === null || !attestationDigest.success) {
        return { success: false, code: "digest_unavailable" };
    }
    if (
        reviewDigest !== parsed.data.review.review_record_digest ||
        reviewDigest !== parsed.data.attestation.operator_review_digest ||
        attestationDigest.digest !== parsed.data.attestation_digest
    ) {
        return { success: false, code: "invalid_operator_bundle" };
    }
    return { success: true, bundle: parsed.data };
};

export const signCanonicalGateAttestationEnvelopeV1 = async (input: {
    envelope: Omit<GateAttestationEnvelopeV1, "signature">;
    privateKeyBase64Url: string;
}): Promise<
    { success: true; envelope: GateAttestationEnvelopeV1 } | { success: false; code: D1GateAttestationSigningDenialV1 }
> => {
    const pkcs8 = decodeBase64Url(input.privateKeyBase64Url);
    if (pkcs8 === null) return { success: false, code: "private_key_invalid" };
    let privateKey: CryptoKey;
    try {
        privateKey = await globalThis.crypto.subtle.importKey(
            "pkcs8",
            arrayBuffer(pkcs8),
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"]
        );
    } catch {
        return { success: false, code: "private_key_invalid" };
    }
    const placeholder = GateAttestationEnvelopeV1Schema.safeParse({ ...input.envelope, signature: EMPTY_SIGNATURE });
    if (!placeholder.success) return { success: false, code: "invalid_signing_request" };
    const canonical = canonicalGateAttestationEnvelopeBytesV1(placeholder.data);
    if (!canonical.success) return { success: false, code: "invalid_signing_request" };
    try {
        const raw = new Uint8Array(
            await globalThis.crypto.subtle.sign(
                { name: "ECDSA", hash: "SHA-256" },
                privateKey,
                arrayBuffer(canonical.bytes)
            )
        );
        const normalized = normalizeP256SignatureV1(raw);
        if (normalized === null) return { success: false, code: "signature_unavailable" };
        const envelope = GateAttestationEnvelopeV1Schema.safeParse({
            ...input.envelope,
            signature: encodeBase64Url(normalized),
        });
        return envelope.success
            ? { success: true, envelope: envelope.data }
            : { success: false, code: "signature_unavailable" };
    } catch {
        return { success: false, code: "signature_unavailable" };
    }
};

export const attestReviewedD1ProbeV1 = async (input: unknown, privateKeyInput: unknown): Promise<SignResult> => {
    let request: ReturnType<typeof D1GateAttestationSigningRequestV1Schema.safeParse>;
    let privateKey: ReturnType<typeof GateSigningPrivateKeyV1Schema.safeParse>;
    try {
        request = D1GateAttestationSigningRequestV1Schema.safeParse(input);
        privateKey = GateSigningPrivateKeyV1Schema.safeParse(privateKeyInput);
    } catch {
        return { success: false, code: "invalid_signing_request" };
    }
    if (!request.success || !privateKey.success) return { success: false, code: "invalid_signing_request" };
    const value = request.data;
    const assessment = await assessD1ProbeReportForOperatorReviewV1(value.report, value.expectations);
    if (!assessment.success) return { success: false, code: "report_not_eligible" };
    const report = parseUntrustedItem2ProbeReportV1(value.report, { as_of_ms: value.expectations.as_of_ms });
    if (
        !report.success ||
        (report.report.kind !== "d1_guarded_create" && report.report.kind !== "gateway_reservation")
    ) {
        return { success: false, code: "report_not_eligible" };
    }
    if (
        value.review.reviewed_report_digest !== assessment.report_digest ||
        value.review.reviewed_at !== value.expectations.as_of_ms ||
        value.attestation.attested_at !== value.review.reviewed_at
    ) {
        return { success: false, code: "review_mismatch" };
    }
    if (
        value.attestation.valid_until <= value.attestation.attested_at ||
        value.attestation.valid_until - value.attestation.attested_at > GATE_ATTESTATION_MAX_LIFETIME_MS_V1 ||
        value.attestation.valid_until > report.report.valid_until
    ) {
        return { success: false, code: "invalid_attestation_window" };
    }
    const signer = value.trust_registry.keys.find(key => key.key_id === value.attestation.signer_key_id);
    if (signer === undefined) return { success: false, code: "unknown_signer" };
    if (
        signer.purpose !== "gate_attestation" ||
        signer.algorithm !== "ecdsa-p256-sha256-ieee-p1363" ||
        signer.not_before > value.attestation.attested_at ||
        signer.not_after < value.attestation.valid_until ||
        (signer.revoked_at !== null && signer.revoked_at < value.attestation.valid_until)
    ) {
        return { success: false, code: "signer_not_usable" };
    }

    const expectationsDigest = await digestCanonicalJsonV1(
        "openbot.d1-gate-attestation-expectations.v1",
        value.expectations as CanonicalJsonValueV1
    );
    if (expectationsDigest === null) return { success: false, code: "digest_unavailable" };
    const reviewRecord = {
        reviewer_id: value.review.reviewer_id,
        reviewed_at: value.review.reviewed_at,
        decision: "approved" as const,
        assessment: assessment.assessment,
        report_digest: assessment.report_digest,
        expectations_digest: expectationsDigest,
    };
    const reviewRecordDigest = await digestCanonicalJsonV1(
        "openbot.d1-gate-attestation-review.v1",
        reviewRecord as CanonicalJsonValueV1
    );
    if (reviewRecordDigest === null) return { success: false, code: "digest_unavailable" };

    const envelopeWithoutSignature = {
        schema_version: 1 as const,
        signature_algorithm: "ecdsa-p256-sha256-ieee-p1363" as const,
        gate_id: assessment.gate_id,
        untrusted_report_digest: assessment.report_digest,
        probe_definition_digest: value.expectations.expected_probe_definition_digest,
        collector_build_digest: value.expectations.expected_collector_build_digest,
        configuration_digest: value.expectations.expected_configuration_digest,
        installation_digest: value.expectations.expected_installation_digest,
        environment_digest: value.expectations.expected_environment_digest,
        deployment_digest: value.expectations.expected_deployment_digest,
        required_check_set_version: value.expectations.required_check_set_version,
        operator_review_digest: reviewRecordDigest,
        decision: "passed" as const,
        claims: {
            permission:
                assessment.gate_id === "d1_guarded_create"
                    ? ("control_store_adoption" as const)
                    : ("gateway_reservation_adoption" as const),
        },
        attested_at: value.attestation.attested_at,
        valid_until: value.attestation.valid_until,
        signer_key_id: value.attestation.signer_key_id,
    };
    const signed = await signCanonicalGateAttestationEnvelopeV1({
        envelope: envelopeWithoutSignature as Omit<GateAttestationEnvelopeV1, "signature">,
        privateKeyBase64Url: privateKey.data.private_key_pkcs8_base64url,
    });
    if (!signed.success) return signed;

    const verifier = await bootstrapGateAttestationVerifierV1(value.trust_registry, {
        context: {
            installation_digest: value.expectations.expected_installation_digest,
            environment_digest: value.expectations.expected_environment_digest,
            deployment_digest: value.expectations.expected_deployment_digest,
        },
        read_current_registry_generation: () => value.trust_registry.generation,
        now_ms: () => value.attestation.attested_at,
    });
    if (!verifier.success) return { success: false, code: "private_key_mismatch" };
    const verified = await verifyGateAttestationV1(verifier.verifier, signed.envelope, {
        expected: {
            gate_id: assessment.gate_id,
            untrusted_report_digest: assessment.report_digest,
            probe_definition_digest: value.expectations.expected_probe_definition_digest,
            collector_build_digest: value.expectations.expected_collector_build_digest,
            configuration_digest: value.expectations.expected_configuration_digest,
            required_check_set_version: value.expectations.required_check_set_version,
        },
    });
    if (!verified.success) {
        return {
            success: false,
            code: verified.code === "signature_invalid" ? "private_key_mismatch" : "internal_verification_failed",
        };
    }
    const attestationDigest = await digestGateAttestationV1(signed.envelope);
    if (!attestationDigest.success) {
        return { success: false, code: "digest_unavailable" };
    }
    const bundle = await inspectD1GateAttestationOperatorBundleIntegrityV1({
        schema_version: 1,
        kind: "d1_gate_attestation_operator_bundle",
        gate_id: assessment.gate_id,
        trust_registry_generation: value.trust_registry.generation,
        review: { ...reviewRecord, review_record_digest: reviewRecordDigest },
        attestation: signed.envelope,
        attestation_digest: attestationDigest.digest,
    });
    return bundle.success
        ? { success: true, bundle: bundle.bundle }
        : { success: false, code: "internal_verification_failed" };
};
