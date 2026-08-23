import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
    bootstrapGateAttestationVerifierV1,
    digestCanonicalJsonV1,
    digestGateAttestationV1,
    GateAttestationEnvelopeV1Schema,
    verifyGateAttestationV1,
    type GateAttestationEnvelopeV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import {
    attestReviewedD1ProbeV1,
    inspectD1GateAttestationOperatorBundleIntegrityV1,
    normalizeP256SignatureV1,
    signCanonicalGateAttestationEnvelopeV1,
} from "./sign.js";
import { D1GateAttestationOperatorBundleV1Schema } from "./contracts.js";

const hex = (character: string): string => character.repeat(64);

const encodeBase64Url = (bytes: Uint8Array): string =>
    globalThis
        .btoa(String.fromCharCode(...bytes))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");

const exportKeyPair = async () => {
    const pair = (await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
    ])) as CryptoKeyPair;
    return {
        privateKey: encodeBase64Url(new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey))),
        publicKey: encodeBase64Url(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey))),
    };
};

const unsignedEnvelope = (): Omit<GateAttestationEnvelopeV1, "signature"> => ({
    schema_version: 1,
    signature_algorithm: "ecdsa-p256-sha256-ieee-p1363",
    gate_id: "d1_guarded_create",
    untrusted_report_digest: hex("1"),
    probe_definition_digest: hex("2"),
    collector_build_digest: hex("3"),
    configuration_digest: hex("4"),
    installation_digest: hex("5"),
    environment_digest: hex("6"),
    deployment_digest: hex("7"),
    required_check_set_version: 1,
    operator_review_digest: hex("8"),
    decision: "passed",
    claims: { permission: "control_store_adoption" },
    attested_at: 1_000,
    valid_until: 2_000,
    signer_key_id: "operator-gate-1",
});

describe("offline gate signer", () => {
    it("has no package export that application or Worker code can import", async () => {
        const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
            private?: boolean;
            exports?: unknown;
        };
        expect(manifest.private).toBe(true);
        expect(manifest).not.toHaveProperty("exports");
    });

    it("emits a canonical low-S signature that the runtime verifier accepts", async () => {
        const keys = await exportKeyPair();
        const signed = await signCanonicalGateAttestationEnvelopeV1({
            envelope: unsignedEnvelope(),
            privateKeyBase64Url: keys.privateKey,
        });
        expect(signed.success).toBe(true);
        if (!signed.success) return;

        const verifier = await bootstrapGateAttestationVerifierV1(
            {
                schema_version: 1,
                generation: 7,
                keys: [
                    {
                        key_id: "operator-gate-1",
                        purpose: "gate_attestation",
                        algorithm: "ecdsa-p256-sha256-ieee-p1363",
                        public_key_spki_base64url: keys.publicKey,
                        not_before: 0,
                        not_after: 3_000,
                        revoked_at: null,
                    },
                ],
            },
            {
                context: {
                    installation_digest: hex("5"),
                    environment_digest: hex("6"),
                    deployment_digest: hex("7"),
                },
                read_current_registry_generation: () => 7,
                now_ms: () => 1_000,
            }
        );
        expect(verifier.success).toBe(true);
        if (!verifier.success) return;
        const verified = await verifyGateAttestationV1(verifier.verifier, signed.envelope, {
            expected: {
                gate_id: "d1_guarded_create",
                untrusted_report_digest: hex("1"),
                probe_definition_digest: hex("2"),
                collector_build_digest: hex("3"),
                configuration_digest: hex("4"),
                required_check_set_version: 1,
            },
        });
        expect(verified.success).toBe(true);
        expect(await digestGateAttestationV1(signed.envelope)).toMatchObject({ success: true });

        const signature = Uint8Array.from(
            globalThis.atob(signed.envelope.signature.replace(/-/gu, "+").replace(/_/gu, "/") + "=="),
            character => character.charCodeAt(0)
        );
        expect(normalizeP256SignatureV1(signature)).toEqual(signature);
    });

    it("rejects malformed private keys and invalid scalar signatures", async () => {
        expect(
            await signCanonicalGateAttestationEnvelopeV1({
                envelope: unsignedEnvelope(),
                privateKeyBase64Url: "not_canonical_",
            })
        ).toEqual({ success: false, code: "private_key_invalid" });
        expect(normalizeP256SignatureV1(new Uint8Array(64))).toBeNull();
        expect(normalizeP256SignatureV1(new Uint8Array(63))).toBeNull();
    });

    it("never reaches signing for an unadjudicated or hostile report", async () => {
        expect(await attestReviewedD1ProbeV1({}, {})).toEqual({
            success: false,
            code: "invalid_signing_request",
        });
        const hostile = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("hostile input");
                },
            }
        );
        expect(await attestReviewedD1ProbeV1(hostile, {})).toEqual({
            success: false,
            code: "invalid_signing_request",
        });
    });

    it("rejects an operator bundle that substitutes its gate, report, decision, review time, or reviewer", async () => {
        const reviewRecord = {
            reviewer_id: "reviewer-1",
            reviewed_at: 1_000,
            decision: "approved" as const,
            assessment: "eligible_for_operator_review" as const,
            report_digest: hex("1"),
            expectations_digest: hex("8"),
        };
        const reviewDigest = await digestCanonicalJsonV1(
            "openbot.d1-gate-attestation-review.v1",
            reviewRecord as CanonicalJsonValueV1
        );
        expect(reviewDigest).not.toBeNull();
        if (reviewDigest === null) return;
        const attestation = {
            ...unsignedEnvelope(),
            operator_review_digest: reviewDigest,
            signature: "A".repeat(86),
        };
        const parsedAttestation = GateAttestationEnvelopeV1Schema.safeParse(attestation);
        expect(parsedAttestation.success).toBe(true);
        if (!parsedAttestation.success) return;
        const attestationDigest = await digestGateAttestationV1(parsedAttestation.data);
        expect(attestationDigest.success).toBe(true);
        if (!attestationDigest.success) return;
        const base = {
            schema_version: 1,
            kind: "d1_gate_attestation_operator_bundle",
            gate_id: "d1_guarded_create",
            trust_registry_generation: 1,
            review: { ...reviewRecord, review_record_digest: reviewDigest },
            attestation: parsedAttestation.data,
            attestation_digest: attestationDigest.digest,
        };
        expect(D1GateAttestationOperatorBundleV1Schema.safeParse(base).success).toBe(true);
        expect(await inspectD1GateAttestationOperatorBundleIntegrityV1(base)).toMatchObject({ success: true });
        for (const mutation of [
            { gate_id: "gateway_reservation" },
            { review: { ...base.review, report_digest: hex("b") } },
            { review: { ...base.review, reviewed_at: 999 } },
            { review: { ...base.review, reviewer_id: "reviewer-2" } },
            { attestation: { ...base.attestation, decision: "denied", claims: { permission: "none" } } },
        ]) {
            expect(await inspectD1GateAttestationOperatorBundleIntegrityV1({ ...base, ...mutation })).toMatchObject({
                success: false,
            });
        }
    });
});
