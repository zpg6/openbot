import { describe, expect, it } from "vitest";
import {
    DEFAULT_CODE_EXECUTION_LIMITS_V1,
    DEFAULT_RUNTIME_LIMITS_V1,
    type BotRevisionV1,
    type CodeExecutionProfileV1,
    type ComputeGrantV1,
    type OrganizationComputePolicyV1,
} from "@openbot/contracts/internal";
import { bootstrapGateAttestationVerifierV1 } from "./bootstrap.js";
import {
    CANONICAL_GATE_IDS_V1,
    GATE_ATTESTATION_MAX_LIFETIME_MS_V1,
    GateAttestationEnvelopeV1Schema,
    type GateAttestationExpectedContextV1,
    type GateAttestationTrustRegistryV1,
} from "./contracts.js";
import { digestSandboxConfigurationV1, sandboxExecutionAuthorityIsValidV1, verifyGateAttestationV1 } from "./verify.js";

const digest = (character: string): string => character.repeat(64);
const configurationDigest = "ddf929a6fdc5b4f314056d3b26a3b84d61b24e15b83f9aac0e03860d6314613b";
const signature = "bxwhNC8k6q7Oz1fO1_qxkWozPE5NxBHwhkUd8E1_0eBypEl2VhGUSSGflyZMKCZXkaRv_jBatHot6_xj1j9r1A";
const highSSignature = "bxwhNC8k6q7Oz1fO1_qxkWozPE5NxBHwhkUd8E1_0eCNW7aIqe5rt95gaNmz19moK0KKr3a86grFzc5fJiO5fQ";
const publicKey =
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9rDORn9Gp5Zq8ECDQY4Zzi0bHnwYFQ8Mj9nFyY7MxXtob4-jn9A6Ur0j8_vqZ-UP7EPZ5py-ttODeZ_f3bkguQ";
const expectedAttestationDigest = "bf8954aa4be6b3831e7a651fd2111c14bfa51d423ee354df5871da2c5e29b7f7";

const envelope = {
    schema_version: 1 as const,
    signature_algorithm: "ecdsa-p256-sha256-ieee-p1363" as const,
    gate_id: "sandbox_execution" as const,
    untrusted_report_digest: digest("1"),
    probe_definition_digest: digest("2"),
    collector_build_digest: digest("3"),
    configuration_digest: configurationDigest,
    installation_digest: digest("5"),
    environment_digest: digest("6"),
    deployment_digest: digest("7"),
    required_check_set_version: 1,
    decision: "passed" as const,
    claims: {
        permission: "sandbox_profile_adoption" as const,
        admitted_data_classes: ["public", "synthetic", "organization"] as const,
        network_policy: "public_internet_blocked_unverified_dns" as const,
        repeat_destroy_safe: true as const,
        profile_configuration_digest: configurationDigest,
    },
    attested_at: 1_000,
    valid_until: 5_000,
    signer_key_id: "operator-gate-1",
    signature,
};

const expected: GateAttestationExpectedContextV1 & { gate_id: "sandbox_execution" } = {
    gate_id: envelope.gate_id,
    untrusted_report_digest: envelope.untrusted_report_digest,
    probe_definition_digest: envelope.probe_definition_digest,
    collector_build_digest: envelope.collector_build_digest,
    configuration_digest: envelope.configuration_digest,
    required_check_set_version: envelope.required_check_set_version,
};

const trustKey: GateAttestationTrustRegistryV1["keys"][number] = {
    key_id: envelope.signer_key_id,
    purpose: "gate_attestation",
    algorithm: envelope.signature_algorithm,
    public_key_spki_base64url: publicKey,
    not_before: 0,
    not_after: 10_000,
    revoked_at: null,
};

const registry = (key = trustKey): GateAttestationTrustRegistryV1 => ({
    schema_version: 1,
    generation: 1,
    keys: [key],
});

const bootstrapContext = {
    installation_digest: envelope.installation_digest,
    environment_digest: envelope.environment_digest,
    deployment_digest: envelope.deployment_digest,
};

const bootstrap = async (trustRegistry: unknown = registry(), asOfMs = 2_000, context: unknown = bootstrapContext) => {
    const result = await bootstrapGateAttestationVerifierV1(trustRegistry, {
        context,
        read_current_registry_generation: () => 1,
        now_ms: () => asOfMs,
    });
    if (!result.success) throw new Error(result.code);
    return result.verifier;
};

const verify = async (
    input: unknown = envelope,
    overrides: Partial<{
        as_of_ms: number;
        expected: GateAttestationExpectedContextV1 & { gate_id: "sandbox_execution" };
        verifier: Awaited<ReturnType<typeof bootstrap>>;
    }> = {}
) => {
    const verifier = overrides.verifier ?? (await bootstrap(registry(), overrides.as_of_ms ?? 2_000));
    return verifyGateAttestationV1(verifier, input, { expected: overrides.expected ?? expected });
};

describe("gate attestation registry", () => {
    it("uses the canonical Item 2 gate IDs in registry order", () => {
        expect(new Set(CANONICAL_GATE_IDS_V1)).toEqual(
            new Set([
                "first_connector",
                "d1_guarded_create",
                "gateway_reservation",
                "metorial_provisioning",
                "metorial_cleanup",
                "openrouter_route",
                "runtime_wire_protocol",
                "sandbox_execution",
                "d1_better_auth",
                "jurisdiction",
            ])
        );
    });

    it("permits only the typed claim for a passed gate and no permission for a denial", () => {
        expect(GateAttestationEnvelopeV1Schema.safeParse(envelope).success).toBe(true);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({ ...envelope, claims: { permission: "connector_adoption" } })
                .success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...envelope,
                decision: "denied",
                claims: envelope.claims,
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...envelope,
                claims: { ...envelope.claims, arbitrary: true },
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...envelope,
                claims: { ...envelope.claims, profile_configuration_digest: digest("0") },
            }).success
        ).toBe(false);
    });

    it("caps an attestation at 24 hours", () => {
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...envelope,
                valid_until: envelope.attested_at + GATE_ATTESTATION_MAX_LIFETIME_MS_V1 + 1,
            }).success
        ).toBe(false);
    });

    it("strictly binds global-public and connector-specific adoption claims", () => {
        const connectorClaims = {
            permission: "connector_adoption" as const,
            connector_configuration_digest: envelope.configuration_digest,
            identity_digest_algorithm: "hmac-sha256-v1" as const,
            deployment_identity_hmac_digest: digest("1"),
            provider_identity_hmac_digest: digest("2"),
            provider_version_identity_hmac_digest: digest("3"),
            tool_identity_hmac_digest: digest("4"),
            reviewed_tool_key: "metorial.search",
            input_schema_digest: digest("5"),
            output_schema_digest: digest("6"),
            descriptor_digest: digest("7"),
            resource_rule: { kind: "global_public_read_only" as const, rule_digest: digest("8") },
            admitted_data_classes: ["public", "synthetic"] as const,
            operator_supplied_provider_auth_config_present: false as const,
        };
        const connectorEnvelope = { ...envelope, gate_id: "first_connector" as const, claims: connectorClaims };
        expect(GateAttestationEnvelopeV1Schema.safeParse(connectorEnvelope).success).toBe(true);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...connectorEnvelope,
                claims: { ...connectorClaims, connector_configuration_digest: digest("0") },
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...connectorEnvelope,
                claims: { ...connectorClaims, identity_digest_algorithm: "sha256" },
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...connectorEnvelope,
                claims: { ...connectorClaims, operator_supplied_provider_auth_config_present: true },
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...connectorEnvelope,
                claims: { ...connectorClaims, admitted_data_classes: ["organization"] },
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...connectorEnvelope,
                claims: { ...connectorClaims, raw_provider_id: "provider-secret-identity" },
            }).success
        ).toBe(false);
        expect(
            GateAttestationEnvelopeV1Schema.safeParse({
                ...connectorEnvelope,
                claims: {
                    ...connectorClaims,
                    resource_rule: { kind: "connector_specific", rule_digest: digest("8") },
                    admitted_data_classes: ["organization"],
                    operator_supplied_provider_auth_config_present: true,
                },
            }).success
        ).toBe(true);
    });
});

describe("P-256 gate attestation verification", () => {
    it("verifies the fixed Web Crypto vector and returns an opaque member", async () => {
        const result = await verify();
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.verified.attestation_digest).toBe(expectedAttestationDigest);
        expect(Object.isFrozen(result.verified)).toBe(true);
        expect(Object.isFrozen(result.verified.claims)).toBe(true);
        if ("admitted_data_classes" in result.verified.claims) {
            const admittedDataClasses = result.verified.claims.admitted_data_classes;
            expect(Object.isFrozen(admittedDataClasses)).toBe(true);
            expect(() =>
                (admittedDataClasses as ("public" | "synthetic" | "organization")[]).push("organization")
            ).toThrow(TypeError);
        }
    });

    it("deeply freezes verified first-connector claims", async () => {
        const connectorConfigurationDigest = digest("a");
        const connectorEnvelope = {
            ...envelope,
            gate_id: "first_connector" as const,
            configuration_digest: connectorConfigurationDigest,
            signer_key_id: "connector-gate-1",
            signature: "u60I1AOkXQjfUDyg30bcoqwH_Rsf2EhMbyJrub2zz0VMMUFHFkIyI-9QJa1ofZsK3J4MzHqBahYt9tNhG5_tpg",
            claims: {
                permission: "connector_adoption" as const,
                connector_configuration_digest: connectorConfigurationDigest,
                identity_digest_algorithm: "hmac-sha256-v1" as const,
                deployment_identity_hmac_digest: digest("1"),
                provider_identity_hmac_digest: digest("2"),
                provider_version_identity_hmac_digest: digest("3"),
                tool_identity_hmac_digest: digest("4"),
                reviewed_tool_key: "metorial.search",
                input_schema_digest: digest("5"),
                output_schema_digest: digest("6"),
                descriptor_digest: digest("7"),
                resource_rule: { kind: "global_public_read_only" as const, rule_digest: digest("8") },
                admitted_data_classes: ["public", "synthetic"] as ("public" | "synthetic" | "organization")[],
                operator_supplied_provider_auth_config_present: false,
            },
        };
        const bootstrapped = await bootstrapGateAttestationVerifierV1(
            {
                schema_version: 1,
                generation: 1,
                keys: [
                    {
                        key_id: connectorEnvelope.signer_key_id,
                        purpose: "gate_attestation",
                        algorithm: connectorEnvelope.signature_algorithm,
                        public_key_spki_base64url:
                            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEph1LjPJjwDjhbdb6UDi9qE49ZTiH6G4lVORIqITURCD_s_XiGDJNf8_9X48sgELnytQ7PaDCKDU0IZzPBmv4uQ",
                        not_before: 0,
                        not_after: 10_000,
                        revoked_at: null,
                    },
                ],
            },
            {
                context: bootstrapContext,
                read_current_registry_generation: () => 1,
                now_ms: () => 2_000,
            }
        );
        if (!bootstrapped.success) throw new Error(bootstrapped.code);
        const result = await verifyGateAttestationV1(bootstrapped.verifier, connectorEnvelope, {
            expected: {
                gate_id: connectorEnvelope.gate_id,
                untrusted_report_digest: connectorEnvelope.untrusted_report_digest,
                probe_definition_digest: connectorEnvelope.probe_definition_digest,
                collector_build_digest: connectorEnvelope.collector_build_digest,
                configuration_digest: connectorEnvelope.configuration_digest,
                required_check_set_version: connectorEnvelope.required_check_set_version,
            },
        });
        if (!result.success) throw new Error(result.code);
        expect(result.verified.attestation_digest).toBe(
            "596905f33e34d079f087fbc0fca88a72948446059a83d18edfb720e92d916e4f"
        );
        if (!("resource_rule" in result.verified.claims)) throw new Error("missing connector claims");
        const verifiedClaims = result.verified.claims;
        const originalRuleDigest = verifiedClaims.resource_rule.rule_digest;
        expect(Object.isFrozen(verifiedClaims)).toBe(true);
        expect(Object.isFrozen(verifiedClaims.resource_rule)).toBe(true);
        expect(Object.isFrozen(verifiedClaims.admitted_data_classes)).toBe(true);
        expect(() => {
            (verifiedClaims.resource_rule as { rule_digest: string }).rule_digest = digest("0");
        }).toThrow(TypeError);
        expect(() => {
            (verifiedClaims.admitted_data_classes as string[]).push("organization");
        }).toThrow(TypeError);
        connectorEnvelope.claims.resource_rule.rule_digest = digest("0");
        connectorEnvelope.claims.admitted_data_classes.push("organization");
        expect(verifiedClaims.resource_rule.rule_digest).toBe(originalRuleDigest);
        expect(verifiedClaims.admitted_data_classes).toEqual(["public", "synthetic"]);
    });

    it("denies a changed signature or expected context", async () => {
        expect(await verify({ ...envelope, signature: `k${signature.slice(1)}` })).toEqual({
            success: false,
            code: "signature_invalid",
        });
        expect(
            await verify(envelope, {
                verifier: await bootstrap(registry(), 2_000, { ...bootstrapContext, deployment_digest: digest("8") }),
            })
        ).toEqual({ success: false, code: "context_mismatch" });
    });

    it("rejects noncanonical base64url and the high-S signature twin", async () => {
        expect(await verify({ ...envelope, signature: `${signature.slice(0, -1)}B` })).toEqual({
            success: false,
            code: "invalid_attestation",
        });
        expect(await verify({ ...envelope, signature: highSSignature })).toEqual({
            success: false,
            code: "invalid_attestation",
        });
        expect(
            await bootstrapGateAttestationVerifierV1(
                registry({
                    ...trustKey,
                    public_key_spki_base64url: `${publicKey.slice(0, -1)}B`,
                }),
                { context: bootstrapContext, read_current_registry_generation: () => 1 }
            )
        ).toEqual({ success: false, code: "invalid_trust_registry" });
    });

    it("denies unknown, mis-scoped, premature, expired, and revoked signers", async () => {
        expect(
            await verify(envelope, { verifier: await bootstrap({ schema_version: 1, generation: 1, keys: [] }) })
        ).toEqual({
            success: false,
            code: "unknown_signer",
        });
        expect(
            await verify(envelope, {
                verifier: await bootstrap(registry({ ...trustKey, purpose: "manifest_signing" })),
            })
        ).toEqual({ success: false, code: "wrong_signer_purpose" });
        expect(
            await verify(envelope, { verifier: await bootstrap(registry({ ...trustKey, not_before: 1_001 })) })
        ).toEqual({
            success: false,
            code: "signer_not_yet_valid",
        });
        expect(
            await verify(envelope, { verifier: await bootstrap(registry({ ...trustKey, not_after: 4_999 })) })
        ).toEqual({
            success: false,
            code: "signer_expired",
        });
        expect(
            await verify(envelope, { verifier: await bootstrap(registry({ ...trustKey, revoked_at: 3_000 })) })
        ).toEqual({
            success: false,
            code: "signer_revoked",
        });
    });

    it("denies attestations outside their time window", async () => {
        expect(await verify(envelope, { as_of_ms: 999 })).toEqual({
            success: false,
            code: "attestation_not_yet_valid",
        });
        expect(await verify(envelope, { as_of_ms: 5_000 })).toEqual({
            success: false,
            code: "attestation_expired",
        });
    });

    it("returns typed denials for malformed and hostile input", async () => {
        const cyclic: Record<string, unknown> = {};
        cyclic["self"] = cyclic;
        expect(await verify(cyclic)).toEqual({ success: false, code: "invalid_attestation" });

        const getter = Object.defineProperty({}, "gate_id", {
            enumerable: true,
            get: () => {
                throw new Error("getter ran");
            },
        });
        expect(await verify(getter)).toEqual({ success: false, code: "invalid_attestation" });

        const proxy = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("hostile proxy");
                },
            }
        );
        expect(await verify(proxy)).toEqual({ success: false, code: "invalid_attestation" });
    });

    it("uses only the bootstrapped registry and rejects copied verifier objects", async () => {
        const callerRegistry = registry();
        const callerContext = { ...bootstrapContext };
        const verifier = await bootstrap(callerRegistry, 2_000, callerContext);
        callerRegistry.keys.splice(0, callerRegistry.keys.length);
        callerContext.deployment_digest = digest("0");
        expect((await verify(envelope, { verifier })).success).toBe(true);

        const copiedVerifier = { ...verifier } as typeof verifier;
        expect(await verifyGateAttestationV1(copiedVerifier, envelope, { expected })).toEqual({
            success: false,
            code: "invalid_verifier",
        });
    });

    it("denies when the shared generation reader fails or returns a non-integer", async () => {
        for (const reader of [
            () => Number.NaN,
            () => 1.5,
            () => {
                throw new Error("generation store unavailable");
            },
        ]) {
            const result = await bootstrapGateAttestationVerifierV1(registry(), {
                context: bootstrapContext,
                read_current_registry_generation: reader,
                now_ms: () => 2_000,
            });
            if (!result.success) throw new Error(result.code);
            expect(await verifyGateAttestationV1(result.verifier, envelope, { expected })).toEqual({
                success: false,
                code: "registry_generation_unavailable",
            });
        }
    });

    it("rejects malformed registries and public keys", async () => {
        expect(
            await bootstrapGateAttestationVerifierV1(
                { schema_version: 1, generation: 1, keys: [trustKey, trustKey] },
                { context: bootstrapContext, read_current_registry_generation: () => 1 }
            )
        ).toEqual({
            success: false,
            code: "invalid_trust_registry",
        });
        expect(
            await bootstrapGateAttestationVerifierV1(
                registry({ ...trustKey, public_key_spki_base64url: "A".repeat(100) }),
                { context: bootstrapContext, read_current_registry_generation: () => 1 }
            )
        ).toEqual({ success: false, code: "invalid_trust_registry" });
    });
});

describe("Sandbox authority", () => {
    const ids = {
        account: "01890f3e-7b42-7cc1-98c3-4f760f7c9132",
        bot: "01890f3e-7b42-7cc1-98c3-4f760f7c9133",
        revision: "01890f3e-7b42-7cc1-98c3-4f760f7c9134",
        policy: "01890f3e-7b42-7cc1-98c3-4f760f7c9136",
        connector: "01890f3e-7b42-7cc1-98c3-4f760f7c9137",
        computePolicy: "01890f3e-7b42-7cc1-98c3-4f760f7c9142",
        computeGrant: "01890f3e-7b42-7cc1-98c3-4f760f7c9143",
    } as const;

    const chain = (attestationDigest: string) => {
        const profile = {
            schema_version: 1,
            profile_key: "sandbox-javascript-v1",
            profile_revision: 1,
            profile_digest: digest("9"),
            configuration_digest: envelope.configuration_digest,
            display_name: "Isolated code execution",
            runner_protocol_version: 1,
            runner_protocol_digest: digest("b"),
            runner_version: "1.0.0",
            runner_digest: digest("c"),
            node_version: "22.19.0",
            sandbox_sdk_version: "0.13.0-next.738.2",
            sandbox_sdk_package_digest: digest("d"),
            image_digest: digest("e"),
            instance_type: "lite",
            adoption_status: "enabled",
            lifecycle: "active",
            languages: ["javascript"],
            admitted_data_classes: ["public", "synthetic", "organization"],
            network_policy: "public_internet_blocked_unverified_dns",
            adoption_attestation_reference: {
                schema_version: 1,
                gate_id: "sandbox_execution",
                attestation_digest: attestationDigest,
                configuration_digest: envelope.configuration_digest,
                valid_until: envelope.valid_until,
            },
            filesystem_policy: "ephemeral_per_run",
            package_installation: false,
            interactive_terminal: false,
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
        } as unknown as CodeExecutionProfileV1;
        const policy = {
            schema_version: 1,
            organization_compute_policy_id: ids.computePolicy,
            account_id: ids.account,
            revision_number: 1,
            lifecycle: "active",
            dependency_revocation_fence: 0,
            profile_key: profile.profile_key,
            profile_revision: profile.profile_revision,
            profile_digest: profile.profile_digest,
            admitted_data_classes: [...profile.admitted_data_classes],
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
            created_at: 1,
            policy_digest: digest("a"),
        } as unknown as OrganizationComputePolicyV1;
        const grant = {
            schema_version: 1,
            compute_grant_id: ids.computeGrant,
            account_id: ids.account,
            bot_revision_id: ids.revision,
            organization_compute_policy_id: policy.organization_compute_policy_id,
            compute_policy_revision: policy.revision_number,
            compute_policy_digest: policy.policy_digest,
            admitted_data_classes: [...policy.admitted_data_classes],
            lifecycle: "active",
            revocation_fence: 0,
            purpose: "Calculate the requested summary",
            expires_at: 4_000,
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
            created_at: 1,
            grant_digest: digest("f"),
        } as unknown as ComputeGrantV1;
        const bot = {
            schema_version: 1,
            bot_revision_id: ids.revision,
            bot_id: ids.bot,
            account_id: ids.account,
            revision_number: 1,
            job_content_id: "01890f3e-7b42-7cc1-98c3-4f760f7c9144",
            job_plaintext_digest: digest("1"),
            job_data_class: "organization",
            standing_instructions_content_id: "01890f3e-7b42-7cc1-98c3-4f760f7c9145",
            standing_instructions_plaintext_digest: digest("2"),
            standing_instructions_data_class: "organization",
            prompt_template_version: 1,
            organization_tool_policy_ids: [ids.policy],
            skill_revision_ids: [],
            connector_release_id: ids.connector,
            model_route: {
                openrouter_model_id: "example/model",
                provider_slug: "example",
                allow_fallbacks: false,
                require_parameters: true,
                data_collection: "deny",
                zdr: true,
                parallel_tool_calls_parameter: "omitted_unsupported",
                max_tool_calls_per_turn: 1,
            },
            compute_selection: {
                organization_compute_policy_id: policy.organization_compute_policy_id,
                compute_policy_revision: policy.revision_number,
                compute_policy_digest: policy.policy_digest,
                compute_policy_admitted_data_classes: [...policy.admitted_data_classes],
                compute_policy_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                profile: structuredClone(profile),
            },
            limits: { ...DEFAULT_RUNTIME_LIMITS_V1, max_code_executions: 1 },
            outbound_data_rule: {
                data_classes: ["public"],
                destinations: ["metorial", "connector_provider"],
                allowed_argument_fields: [],
                tool_result_may_reach_model: false,
            },
            manifest_extensions: { schema_version: 1, extensions: [] },
            created_at: 1,
            revision_digest: digest("3"),
        } as unknown as BotRevisionV1;
        return { bot, profile, policy, grant };
    };

    it("requires full parsed records, the computed configuration, and exact embedded profile", async () => {
        const verifier = await bootstrap();
        const result = await verify(envelope, { verifier });
        if (!result.success) throw new Error(result.code);
        const records = chain(result.verified.attestation_digest);
        const expectedChain = { account_id: ids.account, bot_revision_id: ids.revision };
        expect(await digestSandboxConfigurationV1(records.profile)).toBe(configurationDigest);
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                records.bot,
                records.profile,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(true);

        let sharedRegistryGeneration = 1;
        const fencedBootstrap = await bootstrapGateAttestationVerifierV1(registry(), {
            context: bootstrapContext,
            read_current_registry_generation: () => sharedRegistryGeneration,
            now_ms: () => 2_000,
        });
        if (!fencedBootstrap.success) throw new Error(fencedBootstrap.code);
        const fencedResult = await verifyGateAttestationV1(fencedBootstrap.verifier, envelope, { expected });
        if (!fencedResult.success) throw new Error(fencedResult.code);
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                fencedBootstrap.verifier,
                records.bot,
                records.profile,
                records.policy,
                records.grant,
                fencedResult.verified,
                expectedChain
            )
        ).toBe(true);
        sharedRegistryGeneration = 2;
        expect(await verifyGateAttestationV1(fencedBootstrap.verifier, envelope, { expected })).toEqual({
            success: false,
            code: "registry_generation_changed",
        });
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                fencedBootstrap.verifier,
                records.bot,
                records.profile,
                records.policy,
                records.grant,
                fencedResult.verified,
                expectedChain
            )
        ).toBe(false);

        for (const contextField of ["installation_digest", "environment_digest", "deployment_digest"] as const) {
            const otherVerifier = await bootstrap(registry(), 2_000, {
                ...bootstrapContext,
                [contextField]: digest("0"),
            });
            expect(await verify(envelope, { verifier: otherVerifier })).toEqual({
                success: false,
                code: "context_mismatch",
            });
            expect(
                await sandboxExecutionAuthorityIsValidV1(
                    otherVerifier,
                    records.bot,
                    records.profile,
                    records.policy,
                    records.grant,
                    result.verified,
                    expectedChain
                )
            ).toBe(false);
        }

        const replacementVerifier = await bootstrap();
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                replacementVerifier,
                records.bot,
                records.profile,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);
        const revokedVerifier = await bootstrap(registry({ ...trustKey, revoked_at: 2_000 }));
        expect(await verify(envelope, { verifier: revokedVerifier })).toEqual({
            success: false,
            code: "signer_revoked",
        });
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                revokedVerifier,
                records.bot,
                records.profile,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);

        const wrongReference = chain(digest("0"));
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                wrongReference.bot,
                wrongReference.profile,
                wrongReference.policy,
                wrongReference.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                records.bot,
                records.profile,
                records.policy,
                records.grant,
                { ...result.verified },
                expectedChain
            )
        ).toBe(false);
        const hostileProfile = new Proxy(records.profile, {
            get: () => {
                throw new Error("hostile profile");
            },
        });
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                records.bot,
                hostileProfile,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);

        const missingRunnerDigest = structuredClone(records.profile) as Record<string, unknown>;
        delete missingRunnerDigest["runner_digest"];
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                records.bot,
                missingRunnerDigest,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);

        const mutatedProfile = { ...records.profile, node_version: "22.20.0" };
        const mutatedBot = structuredClone(records.bot);
        if (mutatedBot.compute_selection === null) throw new Error("missing compute selection");
        (mutatedBot.compute_selection.profile as { node_version: string }).node_version = "22.20.0";
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                mutatedBot,
                mutatedProfile,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);

        const differentStandaloneProfile = { ...records.profile, display_name: "Different display" };
        expect(
            await sandboxExecutionAuthorityIsValidV1(
                verifier,
                records.bot,
                differentStandaloneProfile,
                records.policy,
                records.grant,
                result.verified,
                expectedChain
            )
        ).toBe(false);
    });
});
