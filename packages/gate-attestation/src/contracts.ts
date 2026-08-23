import { z } from "zod";
import { Item2GateIdV1Schema, type Item2GateIdV1 } from "@openbot/gate-evidence/internal";

export const GATE_ATTESTATION_MAX_LIFETIME_MS_V1 = 24 * 60 * 60 * 1_000;

export const CanonicalGateIdV1Schema = Item2GateIdV1Schema;
export type CanonicalGateIdV1 = Item2GateIdV1;

export const CANONICAL_GATE_IDS_V1 = Object.freeze([...CanonicalGateIdV1Schema.options]);

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const TimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const KeyIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,95}$/u);
const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u);

export const GATE_PERMISSION_BY_ID_V1 = Object.freeze({
    first_connector: "connector_adoption",
    d1_guarded_create: "control_store_adoption",
    gateway_reservation: "gateway_reservation_adoption",
    metorial_provisioning: "metorial_provisioning_adoption",
    metorial_cleanup: "metorial_cleanup_adoption",
    openrouter_route: "model_route_adoption",
    runtime_wire_protocol: "runtime_protocol_adoption",
    sandbox_execution: "sandbox_profile_adoption",
    d1_better_auth: "identity_store_adoption",
    jurisdiction: "jurisdiction_adoption",
} as const satisfies Record<CanonicalGateIdV1, string>);

export type GatePermissionByIdV1 = typeof GATE_PERMISSION_BY_ID_V1;
export type GatePermissionV1<G extends CanonicalGateIdV1 = CanonicalGateIdV1> = GatePermissionByIdV1[G];

type SandboxAdoptionClaimsV1 = Readonly<{
    permission: "sandbox_profile_adoption";
    admitted_data_classes: readonly ("public" | "synthetic" | "organization")[];
    network_policy: "public_internet_blocked_unverified_dns";
    repeat_destroy_safe: true;
    profile_configuration_digest: string;
}>;

type ConnectorAdoptionClaimsV1 = Readonly<{
    permission: "connector_adoption";
    connector_configuration_digest: string;
    identity_digest_algorithm: "hmac-sha256-v1";
    deployment_identity_hmac_digest: string;
    provider_identity_hmac_digest: string;
    provider_version_identity_hmac_digest: string;
    tool_identity_hmac_digest: string;
    reviewed_tool_key: string;
    input_schema_digest: string;
    output_schema_digest: string;
    descriptor_digest: string;
    resource_rule: Readonly<{
        kind: "global_public_read_only" | "connector_specific";
        rule_digest: string;
    }>;
    admitted_data_classes: readonly ("public" | "synthetic" | "organization")[];
    operator_supplied_provider_auth_config_present: boolean;
}>;

export type GateClaimsV1<G extends CanonicalGateIdV1 = CanonicalGateIdV1> = G extends "sandbox_execution"
    ? SandboxAdoptionClaimsV1
    : G extends "first_connector"
      ? ConnectorAdoptionClaimsV1
      : Readonly<{ permission: GatePermissionV1<G> }>;

const commonEnvelopeFields = {
    schema_version: z.literal(1),
    signature_algorithm: z.literal("ecdsa-p256-sha256-ieee-p1363"),
    untrusted_report_digest: DigestSchema,
    probe_definition_digest: DigestSchema,
    collector_build_digest: DigestSchema,
    configuration_digest: DigestSchema,
    installation_digest: DigestSchema,
    environment_digest: DigestSchema,
    deployment_digest: DigestSchema,
    required_check_set_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    operator_review_digest: DigestSchema.optional(),
    attested_at: TimestampSchema,
    valid_until: TimestampSchema,
    signer_key_id: KeyIdSchema,
    signature: Base64UrlSchema.refine(value => value.length === 86, "P-256 signatures must contain 64 bytes"),
} as const;

const envelopeForGate = <G extends CanonicalGateIdV1>(gateId: G) =>
    z
        .object({
            ...commonEnvelopeFields,
            gate_id: z.literal(gateId),
            decision: z.enum(["passed", "denied"]),
            claims: z.union([
                gateId === "sandbox_execution"
                    ? z
                          .object({
                              permission: z.literal("sandbox_profile_adoption"),
                              admitted_data_classes: z
                                  .array(z.enum(["public", "synthetic", "organization"]))
                                  .min(1)
                                  .max(3)
                                  .refine(values => new Set(values).size === values.length, {
                                      message: "Admitted data classes must be unique",
                                  }),
                              network_policy: z.literal("public_internet_blocked_unverified_dns"),
                              repeat_destroy_safe: z.literal(true),
                              profile_configuration_digest: DigestSchema,
                          })
                          .strict()
                    : gateId === "first_connector"
                      ? z
                            .object({
                                permission: z.literal("connector_adoption"),
                                connector_configuration_digest: DigestSchema,
                                identity_digest_algorithm: z.literal("hmac-sha256-v1"),
                                deployment_identity_hmac_digest: DigestSchema,
                                provider_identity_hmac_digest: DigestSchema,
                                provider_version_identity_hmac_digest: DigestSchema,
                                tool_identity_hmac_digest: DigestSchema,
                                reviewed_tool_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u),
                                input_schema_digest: DigestSchema,
                                output_schema_digest: DigestSchema,
                                descriptor_digest: DigestSchema,
                                resource_rule: z.discriminatedUnion("kind", [
                                    z
                                        .object({
                                            kind: z.literal("global_public_read_only"),
                                            rule_digest: DigestSchema,
                                        })
                                        .strict(),
                                    z
                                        .object({
                                            kind: z.literal("connector_specific"),
                                            rule_digest: DigestSchema,
                                        })
                                        .strict(),
                                ]),
                                admitted_data_classes: z
                                    .array(z.enum(["public", "synthetic", "organization"]))
                                    .min(1)
                                    .max(3)
                                    .refine(values => new Set(values).size === values.length, {
                                        message: "Connector data classes must be unique",
                                    }),
                                operator_supplied_provider_auth_config_present: z.boolean(),
                            })
                            .strict()
                      : z.object({ permission: z.literal(GATE_PERMISSION_BY_ID_V1[gateId]) }).strict(),
                z.object({ permission: z.literal("none") }).strict(),
            ]),
        })
        .strict()
        .superRefine((envelope, context) => {
            const expectedPermission = GATE_PERMISSION_BY_ID_V1[gateId];
            if (
                (envelope.decision === "passed" && envelope.claims.permission !== expectedPermission) ||
                (envelope.decision === "denied" && envelope.claims.permission !== "none")
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["claims", "permission"],
                    message: "Claims do not match the attested decision",
                });
            }
            if (
                gateId === "first_connector" &&
                envelope.decision === "passed" &&
                "connector_configuration_digest" in envelope.claims
            ) {
                if (envelope.claims.connector_configuration_digest !== envelope.configuration_digest) {
                    context.addIssue({
                        code: "custom",
                        path: ["claims", "connector_configuration_digest"],
                        message: "Connector claims must bind the attested configuration",
                    });
                }
                if (
                    envelope.claims.resource_rule.kind === "global_public_read_only" &&
                    (envelope.claims.operator_supplied_provider_auth_config_present ||
                        envelope.claims.admitted_data_classes.some(dataClass => dataClass === "organization"))
                ) {
                    context.addIssue({
                        code: "custom",
                        path: ["claims", "resource_rule"],
                        message:
                            "Global-public connectors must be credential-free and admit only public or synthetic data",
                    });
                }
            }
            if (
                gateId === "sandbox_execution" &&
                envelope.decision === "passed" &&
                "profile_configuration_digest" in envelope.claims &&
                envelope.claims.profile_configuration_digest !== envelope.configuration_digest
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["claims", "profile_configuration_digest"],
                    message: "Sandbox claims must bind the attested configuration",
                });
            }
            if (
                envelope.valid_until <= envelope.attested_at ||
                envelope.valid_until - envelope.attested_at > GATE_ATTESTATION_MAX_LIFETIME_MS_V1
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["valid_until"],
                    message: "Attestation lifetime must be positive and at most 24 hours",
                });
            }
            if (
                (gateId === "d1_guarded_create" || gateId === "gateway_reservation") &&
                envelope.decision === "passed" &&
                envelope.operator_review_digest === undefined
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["operator_review_digest"],
                    message: "Passed D1 attestations must bind the operator review record",
                });
            }
        });

export const GateAttestationEnvelopeV1Schema = z.discriminatedUnion("gate_id", [
    envelopeForGate("first_connector"),
    envelopeForGate("d1_guarded_create"),
    envelopeForGate("gateway_reservation"),
    envelopeForGate("metorial_provisioning"),
    envelopeForGate("metorial_cleanup"),
    envelopeForGate("openrouter_route"),
    envelopeForGate("runtime_wire_protocol"),
    envelopeForGate("sandbox_execution"),
    envelopeForGate("d1_better_auth"),
    envelopeForGate("jurisdiction"),
]);
export type GateAttestationEnvelopeV1 = z.infer<typeof GateAttestationEnvelopeV1Schema>;

export const GateAttestationTrustKeyV1Schema = z
    .object({
        key_id: KeyIdSchema,
        purpose: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
        algorithm: z.literal("ecdsa-p256-sha256-ieee-p1363"),
        public_key_spki_base64url: Base64UrlSchema.min(80).max(256),
        not_before: TimestampSchema,
        not_after: TimestampSchema,
        revoked_at: TimestampSchema.nullable(),
    })
    .strict()
    .refine(key => key.not_after > key.not_before, {
        path: ["not_after"],
        message: "Trust key validity must be positive",
    });
export type GateAttestationTrustKeyV1 = z.infer<typeof GateAttestationTrustKeyV1Schema>;

export const GateAttestationTrustRegistryV1Schema = z
    .object({
        schema_version: z.literal(1),
        generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        keys: z.array(GateAttestationTrustKeyV1Schema).max(64),
    })
    .strict()
    .refine(registry => new Set(registry.keys.map(key => key.key_id)).size === registry.keys.length, {
        path: ["keys"],
        message: "Trust key IDs must be unique",
    });
export type GateAttestationTrustRegistryV1 = z.infer<typeof GateAttestationTrustRegistryV1Schema>;

export const GateAttestationExpectedContextV1Schema = z
    .object({
        gate_id: CanonicalGateIdV1Schema,
        untrusted_report_digest: DigestSchema,
        probe_definition_digest: DigestSchema,
        collector_build_digest: DigestSchema,
        configuration_digest: DigestSchema,
        required_check_set_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict();
export type GateAttestationExpectedContextV1 = z.infer<typeof GateAttestationExpectedContextV1Schema>;

export const GateAttestationBootstrapContextV1Schema = z
    .object({
        installation_digest: DigestSchema,
        environment_digest: DigestSchema,
        deployment_digest: DigestSchema,
    })
    .strict();
export type GateAttestationBootstrapContextV1 = z.infer<typeof GateAttestationBootstrapContextV1Schema>;

export type GateAttestationVerificationDenialV1 =
    | "invalid_verifier"
    | "registry_generation_changed"
    | "registry_generation_unavailable"
    | "invalid_attestation"
    | "invalid_verification_context"
    | "invalid_trust_registry"
    | "unknown_signer"
    | "wrong_signer_purpose"
    | "signer_not_yet_valid"
    | "signer_expired"
    | "signer_revoked"
    | "attestation_not_yet_valid"
    | "attestation_expired"
    | "context_mismatch"
    | "key_import_failed"
    | "signature_invalid"
    | "digest_unavailable";
