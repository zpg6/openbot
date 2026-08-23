import {
    BotRevisionV1Schema,
    CodeExecutionProfileV1Schema,
    ComputeGrantV1Schema,
    OrganizationComputePolicyV1Schema,
    computeAuthorityChainMatchesV1,
    type BotRevisionV1,
    type CodeExecutionProfileV1,
    type ComputeGrantV1,
    type OrganizationComputePolicyV1,
} from "@openbot/contracts/internal";
import {
    canonicalGateAttestationEnvelopeBytesV1,
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    digestGateAttestationV1,
    type CanonicalJsonValueV1,
} from "./canonical.js";
import {
    GateAttestationExpectedContextV1Schema,
    GateAttestationBootstrapContextV1Schema,
    GateAttestationTrustRegistryV1Schema,
    type CanonicalGateIdV1,
    type GateAttestationExpectedContextV1,
    type GateAttestationBootstrapContextV1,
    type GateAttestationTrustKeyV1,
    type GateAttestationVerificationDenialV1,
    type GateClaimsV1,
} from "./contracts.js";

declare const gateAttestationVerifierBrandV1: unique symbol;
declare const verifiedGateDecisionBrandV1: unique symbol;

export type GateAttestationVerifierV1 = Readonly<{ [gateAttestationVerifierBrandV1]: true }>;

export type VerifiedGateAttestationDecisionV1<G extends CanonicalGateIdV1 = CanonicalGateIdV1> = Readonly<{
    gate_id: G;
    decision: "passed" | "denied";
    claims: GateClaimsV1<G> | Readonly<{ permission: "none" }>;
    attestation_digest: string;
    configuration_digest: string;
    installation_digest: string;
    environment_digest: string;
    deployment_digest: string;
    valid_until: number;
    signer_key_id: string;
    [verifiedGateDecisionBrandV1]: true;
}>;

type TrustedKeyV1 = Readonly<{ record: Readonly<GateAttestationTrustKeyV1>; publicKey: CryptoKey }>;
type VerifierStateV1 = Readonly<{
    keys: ReadonlyMap<string, TrustedKeyV1>;
    context: Readonly<GateAttestationBootstrapContextV1>;
    registryGeneration: number;
    readCurrentRegistryGeneration: () => number | Promise<number>;
    nowMs: () => number;
}>;

const verifierStates = new WeakMap<object, VerifierStateV1>();
const decisionStates = new WeakMap<object, VerifierStateV1>();
const P256_CURVE_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_CURVE_ORDER = P256_CURVE_ORDER / 2n;

const decodeBase64Url = (value: string): Uint8Array | null => {
    try {
        const paddingLength = (4 - (value.length % 4)) % 4;
        const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat(paddingLength);
        const decoded = globalThis.atob(base64);
        const output = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) output[index] = decoded.charCodeAt(index);
        const canonical = globalThis
            .btoa(String.fromCharCode(...output))
            .replace(/=/gu, "")
            .replace(/\+/gu, "-")
            .replace(/\//gu, "_");
        return canonical === value ? output : null;
    } catch {
        return null;
    }
};

const p256Scalar = (bytes: Uint8Array): bigint => {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
};

const p256SignatureIsCanonical = (signature: Uint8Array): boolean => {
    if (signature.byteLength !== 64) return false;
    const r = p256Scalar(signature.subarray(0, 32));
    const s = p256Scalar(signature.subarray(32, 64));
    return r > 0n && r < P256_CURVE_ORDER && s > 0n && s <= P256_HALF_CURVE_ORDER;
};

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const importTrustKey = async (record: GateAttestationTrustKeyV1): Promise<CryptoKey | null> => {
    const bytes = decodeBase64Url(record.public_key_spki_base64url);
    if (bytes === null) return null;
    try {
        return await globalThis.crypto.subtle.importKey(
            "spki",
            arrayBuffer(bytes),
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"]
        );
    } catch {
        return null;
    }
};

export const bootstrapGateAttestationVerifierV1 = async (
    trustRegistryInput: unknown,
    options: {
        context: unknown;
        read_current_registry_generation: () => number | Promise<number>;
        now_ms?: () => number;
    }
): Promise<
    { success: true; verifier: GateAttestationVerifierV1 } | { success: false; code: "invalid_trust_registry" }
> => {
    let parsed: ReturnType<typeof GateAttestationTrustRegistryV1Schema.safeParse>;
    let parsedContext: ReturnType<typeof GateAttestationBootstrapContextV1Schema.safeParse>;
    try {
        parsed = GateAttestationTrustRegistryV1Schema.safeParse(trustRegistryInput);
        parsedContext = GateAttestationBootstrapContextV1Schema.safeParse(options.context);
    } catch {
        return { success: false, code: "invalid_trust_registry" };
    }
    if (
        !parsed.success ||
        !parsedContext.success ||
        typeof options.read_current_registry_generation !== "function" ||
        (options.now_ms !== undefined && typeof options.now_ms !== "function")
    ) {
        return { success: false, code: "invalid_trust_registry" };
    }
    const keys = new Map<string, TrustedKeyV1>();
    for (const key of parsed.data.keys) {
        const publicKey = await importTrustKey(key);
        if (publicKey === null) return { success: false, code: "invalid_trust_registry" };
        const record = Object.freeze({ ...key });
        keys.set(record.key_id, Object.freeze({ record, publicKey }));
    }
    const state = Object.freeze({
        keys: new Map(keys) as ReadonlyMap<string, TrustedKeyV1>,
        context: Object.freeze({ ...parsedContext.data }),
        registryGeneration: parsed.data.generation,
        readCurrentRegistryGeneration: options.read_current_registry_generation,
        nowMs: options.now_ms ?? Date.now,
    });
    const verifier = Object.freeze({}) as GateAttestationVerifierV1;
    verifierStates.set(verifier, state);
    return { success: true, verifier };
};

const registryGenerationIsCurrent = async (state: VerifierStateV1): Promise<"current" | "changed" | "unavailable"> => {
    try {
        const generation = await state.readCurrentRegistryGeneration();
        if (!Number.isSafeInteger(generation) || generation <= 0) return "unavailable";
        return generation === state.registryGeneration ? "current" : "changed";
    } catch {
        return "unavailable";
    }
};

const currentTime = (state: VerifierStateV1): number | null => {
    try {
        const value = state.nowMs();
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch {
        return null;
    }
};

const sameContext = (envelope: GateAttestationExpectedContextV1, expected: GateAttestationExpectedContextV1): boolean =>
    envelope.gate_id === expected.gate_id &&
    envelope.untrusted_report_digest === expected.untrusted_report_digest &&
    envelope.probe_definition_digest === expected.probe_definition_digest &&
    envelope.collector_build_digest === expected.collector_build_digest &&
    envelope.configuration_digest === expected.configuration_digest &&
    envelope.required_check_set_version === expected.required_check_set_version;

export const verifyGateAttestationV1 = async <G extends CanonicalGateIdV1>(
    verifier: GateAttestationVerifierV1,
    input: unknown,
    options: { expected: GateAttestationExpectedContextV1 & { gate_id: G } }
): Promise<
    | { success: true; verified: VerifiedGateAttestationDecisionV1<G> }
    | { success: false; code: GateAttestationVerificationDenialV1 }
> => {
    const state = verifierStates.get(verifier);
    if (state === undefined) return { success: false, code: "invalid_verifier" };
    const generationStatus = await registryGenerationIsCurrent(state);
    if (generationStatus === "changed") return { success: false, code: "registry_generation_changed" };
    if (generationStatus === "unavailable") return { success: false, code: "registry_generation_unavailable" };
    const asOfMs = currentTime(state);
    if (asOfMs === null) return { success: false, code: "invalid_verification_context" };
    let expected: ReturnType<typeof GateAttestationExpectedContextV1Schema.safeParse>;
    try {
        expected = GateAttestationExpectedContextV1Schema.safeParse(options.expected);
    } catch {
        return { success: false, code: "invalid_verification_context" };
    }
    if (!expected.success) return { success: false, code: "invalid_verification_context" };

    const canonical = canonicalGateAttestationEnvelopeBytesV1(input);
    if (!canonical.success) return canonical;
    const { envelope } = canonical;
    if (
        !sameContext(envelope, expected.data) ||
        envelope.installation_digest !== state.context.installation_digest ||
        envelope.environment_digest !== state.context.environment_digest ||
        envelope.deployment_digest !== state.context.deployment_digest
    ) {
        return { success: false, code: "context_mismatch" };
    }
    if (envelope.attested_at > asOfMs) return { success: false, code: "attestation_not_yet_valid" };
    if (envelope.valid_until <= asOfMs) {
        return { success: false, code: "attestation_expired" };
    }

    const key = state.keys.get(envelope.signer_key_id);
    if (key === undefined) return { success: false, code: "unknown_signer" };
    if (key.record.purpose !== "gate_attestation") return { success: false, code: "wrong_signer_purpose" };
    if (key.record.not_before > envelope.attested_at || key.record.not_before > asOfMs) {
        return { success: false, code: "signer_not_yet_valid" };
    }
    if (key.record.not_after <= envelope.attested_at || key.record.not_after < envelope.valid_until) {
        return { success: false, code: "signer_expired" };
    }
    if (
        key.record.revoked_at !== null &&
        (key.record.revoked_at <= asOfMs || key.record.revoked_at < envelope.valid_until)
    ) {
        return { success: false, code: "signer_revoked" };
    }

    const signatureBytes = decodeBase64Url(envelope.signature);
    if (signatureBytes === null || !p256SignatureIsCanonical(signatureBytes)) {
        return { success: false, code: "invalid_attestation" };
    }
    try {
        const valid = await globalThis.crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            key.publicKey,
            arrayBuffer(signatureBytes),
            arrayBuffer(canonical.bytes)
        );
        if (!valid) return { success: false, code: "signature_invalid" };
    } catch {
        return { success: false, code: "signature_invalid" };
    }

    const digest = await digestGateAttestationV1(envelope);
    if (!digest.success) return digest;
    const frozenClaims = Object.freeze(
        "resource_rule" in envelope.claims
            ? {
                  ...envelope.claims,
                  resource_rule: Object.freeze({ ...envelope.claims.resource_rule }),
                  admitted_data_classes: Object.freeze([...envelope.claims.admitted_data_classes]),
              }
            : "admitted_data_classes" in envelope.claims
              ? {
                    ...envelope.claims,
                    admitted_data_classes: Object.freeze([...envelope.claims.admitted_data_classes]),
                }
              : { ...envelope.claims }
    );
    const verified = Object.freeze({
        gate_id: envelope.gate_id,
        decision: envelope.decision,
        claims: frozenClaims,
        attestation_digest: digest.digest,
        configuration_digest: envelope.configuration_digest,
        installation_digest: envelope.installation_digest,
        environment_digest: envelope.environment_digest,
        deployment_digest: envelope.deployment_digest,
        valid_until: envelope.valid_until,
        signer_key_id: envelope.signer_key_id,
    }) as VerifiedGateAttestationDecisionV1<G>;
    decisionStates.set(verified, state);
    return { success: true, verified };
};

const parseAuthorityRecords = (
    botInput: unknown,
    profileInput: unknown,
    policyInput: unknown,
    grantInput: unknown
): {
    bot: BotRevisionV1;
    profile: CodeExecutionProfileV1;
    policy: OrganizationComputePolicyV1;
    grant: ComputeGrantV1;
} | null => {
    try {
        const bot = BotRevisionV1Schema.safeParse(botInput);
        const profile = CodeExecutionProfileV1Schema.safeParse(profileInput);
        const policy = OrganizationComputePolicyV1Schema.safeParse(policyInput);
        const grant = ComputeGrantV1Schema.safeParse(grantInput);
        return bot.success && profile.success && policy.success && grant.success
            ? { bot: bot.data, profile: profile.data, policy: policy.data, grant: grant.data }
            : null;
    } catch {
        return null;
    }
};

const sandboxConfigurationProjection = (profile: CodeExecutionProfileV1): CanonicalJsonValueV1 => ({
    schema_version: 1,
    profile_key: profile.profile_key,
    profile_revision: profile.profile_revision,
    runner_protocol_version: profile.runner_protocol_version,
    runner_protocol_digest: profile.runner_protocol_digest,
    runner_version: profile.runner_version,
    runner_digest: profile.runner_digest,
    node_version: profile.node_version,
    sandbox_sdk_version: profile.sandbox_sdk_version,
    sandbox_sdk_package_digest: profile.sandbox_sdk_package_digest,
    image_digest: profile.image_digest,
    instance_type: profile.instance_type,
    languages: [...profile.languages],
    admitted_data_classes: [...profile.admitted_data_classes],
    network_policy: profile.network_policy,
    filesystem_policy: profile.filesystem_policy,
    package_installation: profile.package_installation,
    interactive_terminal: profile.interactive_terminal,
    limits: { ...profile.limits },
});

export const digestSandboxConfigurationV1 = async (profileInput: unknown): Promise<string | null> => {
    try {
        const profile = CodeExecutionProfileV1Schema.safeParse(profileInput);
        if (!profile.success) return null;
        return digestCanonicalJsonV1("openbot.sandbox-configuration.v1", sandboxConfigurationProjection(profile.data));
    } catch {
        return null;
    }
};

export const sandboxExecutionAuthorityIsValidV1 = async (
    verifier: GateAttestationVerifierV1,
    botInput: unknown,
    profileInput: unknown,
    policyInput: unknown,
    grantInput: unknown,
    decision: VerifiedGateAttestationDecisionV1,
    currentContext: {
        account_id: string;
        bot_revision_id: string;
    }
): Promise<boolean> => {
    try {
        const state = verifierStates.get(verifier);
        if (state === undefined || decisionStates.get(decision) !== state) return false;
        if ((await registryGenerationIsCurrent(state)) !== "current") return false;
        const asOfMs = currentTime(state);
        if (asOfMs === null) return false;
        const records = parseAuthorityRecords(botInput, profileInput, policyInput, grantInput);
        if (records === null || records.bot.compute_selection === null) return false;
        const { bot, profile, policy, grant } = records;
        if (
            decision.gate_id !== "sandbox_execution" ||
            decision.decision !== "passed" ||
            decision.valid_until <= asOfMs ||
            decision.installation_digest !== state.context.installation_digest ||
            decision.environment_digest !== state.context.environment_digest ||
            decision.deployment_digest !== state.context.deployment_digest ||
            decision.claims.permission !== "sandbox_profile_adoption" ||
            !("admitted_data_classes" in decision.claims)
        ) {
            return false;
        }
        const reference = profile.adoption_attestation_reference;
        const computedConfigurationDigest = await digestCanonicalJsonV1(
            "openbot.sandbox-configuration.v1",
            sandboxConfigurationProjection(profile)
        );
        if (
            reference === null ||
            computedConfigurationDigest === null ||
            computedConfigurationDigest !== profile.configuration_digest ||
            computedConfigurationDigest !== decision.configuration_digest ||
            computedConfigurationDigest !== decision.claims.profile_configuration_digest ||
            reference.attestation_digest !== decision.attestation_digest ||
            reference.configuration_digest !== computedConfigurationDigest ||
            reference.valid_until !== decision.valid_until ||
            canonicalizeJsonV1(records.bot.compute_selection.profile as CanonicalJsonValueV1) !==
                canonicalizeJsonV1(profile as CanonicalJsonValueV1)
        ) {
            return false;
        }
        const admittedClasses = new Set(decision.claims.admitted_data_classes);
        return (
            decision.claims.network_policy === profile.network_policy &&
            decision.claims.repeat_destroy_safe &&
            profile.admitted_data_classes.every(dataClass => admittedClasses.has(dataClass)) &&
            computeAuthorityChainMatchesV1(bot, profile, policy, grant, {
                account_id: currentContext.account_id,
                bot_revision_id: currentContext.bot_revision_id,
                as_of_ms: asOfMs,
                sandbox_adoption_attestation_digest: decision.attestation_digest,
            })
        );
    } catch {
        return false;
    }
};
