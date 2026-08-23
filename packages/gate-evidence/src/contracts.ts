import { z } from "zod";

export const ITEM2_MAX_REPORT_TTL_MS_V1 = 24 * 60 * 60 * 1_000;

export const Item2DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const TimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const Item2GateIdV1Schema = z.enum([
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
]);
export type Item2GateIdV1 = z.infer<typeof Item2GateIdV1Schema>;

export const UntrustedProbeOutcomeV1Schema = z.enum([
    "passed",
    "failed",
    "inconclusive",
    "not_run",
    "candidate",
    "documentation_only",
]);

export const UntrustedRedactedTranscriptCommitmentV1Schema = z
    .object({
        commitment_algorithm: z.literal("hmac-sha256-v1"),
        commitment_key_id_digest: Item2DigestV1Schema,
        reference_commitment: Item2DigestV1Schema,
        gate_id: Item2GateIdV1Schema,
        check_id: z.string().regex(/^[a-z][a-z0-9_]{0,95}$/u),
        configuration_digest: Item2DigestV1Schema,
        installation_digest: Item2DigestV1Schema,
        environment_digest: Item2DigestV1Schema,
        probe_run_digest: Item2DigestV1Schema,
        observed_at: TimestampSchema,
        request_commitment: Item2DigestV1Schema,
        response_commitment: Item2DigestV1Schema,
        observation_commitment: Item2DigestV1Schema,
        redacted_fields: z
            .array(
                z.enum([
                    "authorization",
                    "bearer_capability",
                    "cookie",
                    "oauth_state",
                    "provider_auth_reference",
                    "request_body",
                    "response_body",
                    "secret",
                ])
            )
            .min(1)
            .max(8)
            .refine(values => new Set(values).size === values.length, "Redacted fields must be unique"),
    })
    .strict();

const checkResult = <T extends z.ZodType<string>>(checkId: T, maximumTranscriptCommitments = 8) =>
    z
        .object({
            check_id: checkId,
            outcome: UntrustedProbeOutcomeV1Schema,
            transcript_commitments: z
                .array(UntrustedRedactedTranscriptCommitmentV1Schema)
                .max(maximumTranscriptCommitments),
        })
        .strict()
        .superRefine((result, context) => {
            if (result.outcome === "passed" && result.transcript_commitments.length === 0) {
                context.addIssue({
                    code: "custom",
                    path: ["transcript_commitments"],
                    message: "A recorded pass requires a transcript commitment",
                });
            }
        });

const commonFields = {
    schema_version: z.literal(1),
    report_digest: Item2DigestV1Schema,
    configuration_digest: Item2DigestV1Schema,
    installation_digest: Item2DigestV1Schema,
    environment_digest: Item2DigestV1Schema,
    probe_definition_digest: Item2DigestV1Schema,
    collector_build_digest: Item2DigestV1Schema,
    probe_run_digest: Item2DigestV1Schema,
    commitment_key_id_digest: Item2DigestV1Schema,
    redaction_version: z.literal(1),
    observed_at: TimestampSchema,
    completed_at: TimestampSchema,
    valid_until: TimestampSchema,
} as const;

const refineReport = <
    T extends {
        kind: Item2GateIdV1;
        configuration_digest: string;
        installation_digest: string;
        environment_digest: string;
        probe_run_digest: string;
        commitment_key_id_digest: string;
        observed_at: number;
        completed_at: number;
        valid_until: number;
        checks: Array<{
            check_id: string;
            transcript_commitments: Array<z.infer<typeof UntrustedRedactedTranscriptCommitmentV1Schema>>;
        }>;
    },
>(
    report: T,
    context: z.RefinementCtx
): void => {
    if (!(report.observed_at <= report.completed_at && report.completed_at < report.valid_until)) {
        context.addIssue({ code: "custom", path: ["completed_at"], message: "Probe timestamps are invalid" });
    }
    if (report.valid_until - report.completed_at > ITEM2_MAX_REPORT_TTL_MS_V1) {
        context.addIssue({ code: "custom", path: ["valid_until"], message: "Probe report TTL exceeds 24 hours" });
    }
    const references = new Set<string>();
    for (const [checkIndex, check] of report.checks.entries()) {
        for (const [referenceIndex, commitment] of check.transcript_commitments.entries()) {
            const path = ["checks", checkIndex, "transcript_commitments", referenceIndex];
            if (
                commitment.gate_id !== report.kind ||
                commitment.check_id !== check.check_id ||
                commitment.configuration_digest !== report.configuration_digest ||
                commitment.installation_digest !== report.installation_digest ||
                commitment.environment_digest !== report.environment_digest ||
                commitment.probe_run_digest !== report.probe_run_digest ||
                commitment.commitment_key_id_digest !== report.commitment_key_id_digest
            ) {
                context.addIssue({ code: "custom", path, message: "Transcript commitment is bound to another probe" });
            }
            if (commitment.observed_at < report.observed_at || commitment.observed_at > report.completed_at) {
                context.addIssue({
                    code: "custom",
                    path,
                    message: "Transcript observation is outside the probe window",
                });
            }
            if (references.has(commitment.reference_commitment)) {
                context.addIssue({ code: "custom", path, message: "Transcript commitment is reused" });
            }
            references.add(commitment.reference_commitment);
        }
    }
};

const reportSchema = <
    T extends Item2GateIdV1,
    U extends readonly [string, ...string[]],
    V extends Record<string, z.ZodType> = Record<string, never>,
>(
    kind: T,
    checkIds: U,
    extraFields: V = {} as V,
    maximumTranscriptCommitments = 8
) => {
    const checkId = z.enum(checkIds);
    return z
        .object({
            ...commonFields,
            ...extraFields,
            kind: z.literal(kind),
            checks: z
                .array(checkResult(checkId, maximumTranscriptCommitments))
                .length(checkIds.length)
                .refine(
                    checks => new Set(checks.map(check => check.check_id)).size === checks.length,
                    "Probe checks must be unique"
                ),
        })
        .strict()
        .superRefine((report, context) => {
            refineReport(report as unknown as Parameters<typeof refineReport>[0], context);
        });
};

export const CONNECTOR_COMMON_CHECK_IDS_V1 = [
    "provider_version_readback",
    "oauth_scope_or_synthetic_account_review",
    "exact_tool_list_and_schema_capture",
    "two_sequential_calls_with_reconnect",
    "second_client_after_cleanup",
    "result_size_and_classification",
] as const;
const ConnectorCheckIdV1Schema = z.enum([
    ...CONNECTOR_COMMON_CHECK_IDS_V1,
    "positive_resource_scope",
    "sibling_resource_denial",
    "global_public_target_validation",
    "operator_auth_config_absence_readback",
]);

const ConnectorToolReportV1Schema = z
    .object({
        tool_key_digest: Item2DigestV1Schema,
        input_schema_digest: Item2DigestV1Schema,
        output_schema_digest: Item2DigestV1Schema,
        descriptor_digest: Item2DigestV1Schema,
        vendor_effect_tags: z
            .object({
                read_only: z.literal(true),
                destructive: z.literal(false),
            })
            .strict(),
        reviewed_effect: z.literal("read_only"),
        resource_rule: z.discriminatedUnion("kind", [
            z
                .object({
                    kind: z.literal("connector_specific"),
                    mapping_key_digest: Item2DigestV1Schema,
                    mapping_version: z.number().int().positive(),
                    scope_digest: Item2DigestV1Schema,
                })
                .strict(),
            z.object({ kind: z.literal("global_public_read_only") }).strict(),
            z.object({ kind: z.literal("unsupported") }).strict(),
        ]),
        incidental_effects: z
            .array(z.enum(["provider_access_log", "provider_access_timestamp", "provider_quota"]))
            .max(3)
            .refine(values => new Set(values).size === values.length, "Incidental effects must be unique"),
        maximum_observed_result_bytes: z
            .number()
            .int()
            .nonnegative()
            .max(1024 * 1024),
        enforced_result_max_bytes: z
            .number()
            .int()
            .positive()
            .max(128 * 1024),
    })
    .strict();

export const UntrustedConnectorProbeReportV1Schema = z
    .object({
        ...commonFields,
        kind: z.literal("first_connector"),
        identity_digest_algorithm: z.literal("hmac-sha256-v1"),
        metorial_api_version: z.literal("2026-01-01-magnetar"),
        sdk_version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
        generated_client_version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
        package_integrity_digest: Item2DigestV1Schema,
        deployment_status: z.literal("active"),
        effective_filter_digest: Item2DigestV1Schema,
        deployment_digest: Item2DigestV1Schema,
        provider_digest: Item2DigestV1Schema,
        provider_version_digest: Item2DigestV1Schema,
        provider_spec_digest: Item2DigestV1Schema,
        auth_setup: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("oauth"), scope_digests: z.array(Item2DigestV1Schema).min(1).max(32) }).strict(),
            z.object({ kind: z.literal("synthetic_account"), account_rule_digest: Item2DigestV1Schema }).strict(),
            z.object({ kind: z.literal("none") }).strict(),
        ]),
        tools: z.array(ConnectorToolReportV1Schema).min(1).max(4),
        checks: z
            .array(checkResult(ConnectorCheckIdV1Schema))
            .min(CONNECTOR_COMMON_CHECK_IDS_V1.length)
            .max(ConnectorCheckIdV1Schema.options.length)
            .refine(
                checks => new Set(checks.map(check => check.check_id)).size === checks.length,
                "Probe checks must be unique"
            ),
    })
    .strict()
    .superRefine((report, context) => {
        refineReport(report, context);
        const resourceRuleKinds = new Set(report.tools.map(tool => tool.resource_rule.kind));
        if (resourceRuleKinds.size !== 1) {
            context.addIssue({
                code: "custom",
                path: ["tools"],
                message: "One connector report cannot mix resource-rule families",
            });
        }
        if (resourceRuleKinds.has("global_public_read_only") && report.auth_setup.kind !== "none") {
            context.addIssue({
                code: "custom",
                path: ["auth_setup"],
                message: "Global public read-only tools must not use provider credentials",
            });
        }
        const expected = new Set<string>(CONNECTOR_COMMON_CHECK_IDS_V1);
        if (report.tools.some(tool => tool.resource_rule.kind === "connector_specific")) {
            expected.add("positive_resource_scope");
            expected.add("sibling_resource_denial");
        }
        if (report.tools.some(tool => tool.resource_rule.kind === "global_public_read_only")) {
            expected.add("global_public_target_validation");
            expected.add("operator_auth_config_absence_readback");
        }
        const actual = new Set(report.checks.map(check => check.check_id));
        if (actual.size !== expected.size || [...actual].some(check => !expected.has(check))) {
            context.addIssue({ code: "custom", path: ["checks"], message: "Checks do not match resource rules" });
        }
    });

const cloudflareIdentityCommitment = <T extends "cloudflare_account_id" | "cloudflare_zone_id">(identityType: T) =>
    z
        .object({
            commitment_algorithm: z.literal("hmac-sha256-v1"),
            identity_type: z.literal(identityType),
            commitment_domain: z.literal(`openbot.identity.${identityType}.v1`),
            commitment_key_id_digest: Item2DigestV1Schema,
            identity_commitment: Item2DigestV1Schema,
            synthetic: z.literal(false),
        })
        .strict();

const CloudflareWorkerDeploymentCommitmentV1Schema = z
    .object({
        script_commitment: Item2DigestV1Schema,
        version_commitment: Item2DigestV1Schema,
        deployment_id_commitment: Item2DigestV1Schema,
    })
    .strict();

const D1DeploymentIdentityCommitmentSpecV1Schema = z
    .object({
        commitment_algorithm: z.literal("hmac-sha256-v1"),
        commitment_key_id_digest: Item2DigestV1Schema,
        role_in_preimage: z.literal(false),
        domains: z
            .object({
                account_id: z.literal("openbot.identity.cloudflare_account_id.v1"),
                zone_id: z.literal("openbot.identity.cloudflare_zone_id.v1"),
                database_id: z.literal("openbot.identity.cloudflare_d1_database_id.v1"),
                worker_script_id: z.literal("openbot.identity.cloudflare_worker_script_id.v1"),
                worker_version_id: z.literal("openbot.identity.cloudflare_worker_version_id.v1"),
                worker_deployment_id: z.literal("openbot.identity.cloudflare_worker_deployment_id.v1"),
                route_id: z.literal("openbot.identity.cloudflare_worker_route_id.v1"),
                route_pattern: z.literal("openbot.identity.cloudflare_worker_route_pattern.v1"),
                access_application_id: z.literal("openbot.identity.cloudflare_access_application_id.v1"),
                access_policy_id: z.literal("openbot.identity.cloudflare_access_policy_id.v1"),
                access_service_token_id: z.literal("openbot.identity.cloudflare_access_service_token_id.v1"),
            })
            .strict(),
    })
    .strict();

const D1_GENERATED_NAME_RESOURCE_KINDS_V1 = [
    "database",
    "writer_a_script",
    "writer_b_script",
    "sink_script",
    "writer_a_route",
    "writer_b_route",
    "readback_route",
    "access_application",
    "access_policy",
    "access_service_token",
] as const;
const D1GeneratedNameCommitmentV1Schema = z
    .object({
        resource_kind: z.enum(D1_GENERATED_NAME_RESOURCE_KINDS_V1),
        generated_name_commitment: Item2DigestV1Schema,
        lowercase_random_suffix_commitment: Item2DigestV1Schema,
    })
    .strict();

export const D1DeploymentCommitmentV1Schema = z
    .object({
        platform: z.literal("cloudflare_d1_deployed"),
        identity_commitment_spec: D1DeploymentIdentityCommitmentSpecV1Schema,
        account_identity: cloudflareIdentityCommitment("cloudflare_account_id"),
        zone_identity: cloudflareIdentityCommitment("cloudflare_zone_id"),
        wrangler_version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
        database_id_commitment: Item2DigestV1Schema,
        writer_a_database_id_commitment: Item2DigestV1Schema,
        writer_b_database_id_commitment: Item2DigestV1Schema,
        sink_database_id_commitment: Item2DigestV1Schema,
        compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        read_replication_enabled: z.literal(true),
        read_replication_setting_digest: Item2DigestV1Schema,
        writer_a_script_commitment: Item2DigestV1Schema,
        writer_a_version_commitment: Item2DigestV1Schema,
        writer_b_script_commitment: Item2DigestV1Schema,
        writer_b_version_commitment: Item2DigestV1Schema,
        sink_script_commitment: Item2DigestV1Schema,
        sink_version_commitment: Item2DigestV1Schema,
        worker_deployments: z
            .object({
                writer_a: CloudflareWorkerDeploymentCommitmentV1Schema,
                writer_b: CloudflareWorkerDeploymentCommitmentV1Schema,
                sink_readback: CloudflareWorkerDeploymentCommitmentV1Schema,
            })
            .strict(),
        routes: z
            .object({
                writer_a: z
                    .object({
                        route_id_commitment: Item2DigestV1Schema,
                        exact_pattern_commitment: Item2DigestV1Schema,
                        target_script_commitment: Item2DigestV1Schema,
                    })
                    .strict(),
                writer_b: z
                    .object({
                        route_id_commitment: Item2DigestV1Schema,
                        exact_pattern_commitment: Item2DigestV1Schema,
                        target_script_commitment: Item2DigestV1Schema,
                    })
                    .strict(),
                readback: z
                    .object({
                        route_id_commitment: Item2DigestV1Schema,
                        exact_pattern_commitment: Item2DigestV1Schema,
                        target_script_commitment: Item2DigestV1Schema,
                        allowed_method: z.literal("GET"),
                        allowed_endpoint_contract_digest: Item2DigestV1Schema,
                    })
                    .strict(),
                workers_dev: z.literal(false),
                preview_urls: z.literal(false),
            })
            .strict(),
        access: z
            .object({
                application_commitment: Item2DigestV1Schema,
                policy_commitment: Item2DigestV1Schema,
                service_token_commitment: Item2DigestV1Schema,
            })
            .strict(),
        generated_names: z
            .object({
                safe_prefix_commitment: Item2DigestV1Schema,
                operator_database_deny_list_digest: Item2DigestV1Schema,
                resources: z
                    .array(D1GeneratedNameCommitmentV1Schema)
                    .length(D1_GENERATED_NAME_RESOURCE_KINDS_V1.length)
                    .refine(
                        resources =>
                            new Set(resources.map(resource => resource.resource_kind)).size ===
                            D1_GENERATED_NAME_RESOURCE_KINDS_V1.length,
                        "Every generated resource name must be committed exactly once"
                    ),
            })
            .strict(),
        sink_service_binding: z
            .object({
                writer_a_binding_config_digest: Item2DigestV1Schema,
                writer_b_binding_config_digest: Item2DigestV1Schema,
                writer_a_target_script_commitment: Item2DigestV1Schema,
                writer_b_target_script_commitment: Item2DigestV1Schema,
                binding_name_commitment: Item2DigestV1Schema,
                sink_active_version_count: z.literal(1),
                sink_active_version_traffic_percent: z.literal(100),
            })
            .strict(),
    })
    .strict()
    .superRefine((deployment, context) => {
        if (
            deployment.writer_a_database_id_commitment !== deployment.database_id_commitment ||
            deployment.writer_b_database_id_commitment !== deployment.database_id_commitment ||
            deployment.sink_database_id_commitment !== deployment.database_id_commitment
        ) {
            context.addIssue({
                code: "custom",
                path: ["database_id_commitment"],
                message: "Every D1 probe Worker must bind the same disposable database",
            });
        }
        const scriptCommitments = [
            deployment.writer_a_script_commitment,
            deployment.writer_b_script_commitment,
            deployment.sink_script_commitment,
        ];
        if (new Set(scriptCommitments).size !== scriptCommitments.length) {
            context.addIssue({
                code: "custom",
                path: ["writer_b_script_commitment"],
                message: "D1 probe Workers must use distinct script identities",
            });
        }
        const versionCommitments = [
            deployment.writer_a_version_commitment,
            deployment.writer_b_version_commitment,
            deployment.sink_version_commitment,
        ];
        if (new Set(versionCommitments).size !== versionCommitments.length) {
            context.addIssue({
                code: "custom",
                path: ["writer_b_version_commitment"],
                message: "D1 probe Workers must use distinct deployment versions",
            });
        }
        const workerDeployments = [
            deployment.worker_deployments.writer_a,
            deployment.worker_deployments.writer_b,
            deployment.worker_deployments.sink_readback,
        ];
        if (
            workerDeployments[0]?.script_commitment !== deployment.writer_a_script_commitment ||
            workerDeployments[0]?.version_commitment !== deployment.writer_a_version_commitment ||
            workerDeployments[1]?.script_commitment !== deployment.writer_b_script_commitment ||
            workerDeployments[1]?.version_commitment !== deployment.writer_b_version_commitment ||
            workerDeployments[2]?.script_commitment !== deployment.sink_script_commitment ||
            workerDeployments[2]?.version_commitment !== deployment.sink_version_commitment
        ) {
            context.addIssue({
                code: "custom",
                path: ["worker_deployments"],
                message: "Worker deployment metadata does not match the committed script and version identities",
            });
        }
        if (new Set(workerDeployments.map(worker => worker.deployment_id_commitment)).size !== 3) {
            context.addIssue({
                code: "custom",
                path: ["worker_deployments"],
                message: "Worker deployment ID commitments must be pairwise distinct",
            });
        }
        const routeCommitments = [
            deployment.routes.writer_a.route_id_commitment,
            deployment.routes.writer_b.route_id_commitment,
            deployment.routes.readback.route_id_commitment,
        ];
        const routePatternCommitments = [
            deployment.routes.writer_a.exact_pattern_commitment,
            deployment.routes.writer_b.exact_pattern_commitment,
            deployment.routes.readback.exact_pattern_commitment,
        ];
        if (
            new Set(routeCommitments).size !== 3 ||
            new Set(routePatternCommitments).size !== 3 ||
            deployment.routes.writer_a.target_script_commitment !== deployment.writer_a_script_commitment ||
            deployment.routes.writer_b.target_script_commitment !== deployment.writer_b_script_commitment ||
            deployment.routes.readback.target_script_commitment !== deployment.sink_script_commitment
        ) {
            context.addIssue({
                code: "custom",
                path: ["routes"],
                message: "Writer and readback routes and exact patterns must be pairwise distinct",
            });
        }
        if (
            new Set(deployment.generated_names.resources.map(resource => resource.generated_name_commitment)).size !==
            deployment.generated_names.resources.length
        ) {
            context.addIssue({
                code: "custom",
                path: ["generated_names", "resources"],
                message: "Generated resource name commitments must be pairwise distinct",
            });
        }
        if (
            deployment.sink_service_binding.writer_a_binding_config_digest ===
                deployment.sink_service_binding.writer_b_binding_config_digest ||
            deployment.sink_service_binding.writer_a_target_script_commitment !== deployment.sink_script_commitment ||
            deployment.sink_service_binding.writer_b_target_script_commitment !== deployment.sink_script_commitment
        ) {
            context.addIssue({
                code: "custom",
                path: ["sink_service_binding"],
                message: "Writer service bindings must target the recorded private sink deployment",
            });
        }
    });

const BoundedProbeCountV1Schema = z.number().int().nonnegative().max(64);
const d1MetadataSchema = <
    TChanges extends z.ZodType<number>,
    TRowsWritten extends z.ZodType<number>,
    TChangedDb extends z.ZodType<boolean>,
    TPrimary extends z.ZodType<boolean>,
>(
    changes: TChanges,
    rowsWritten: TRowsWritten,
    changedDb: TChangedDb,
    servedByPrimary: TPrimary
) =>
    z
        .object({
            success: z.literal(true),
            changes,
            rows_read: BoundedProbeCountV1Schema,
            rows_written: rowsWritten,
            changed_db: changedDb,
            served_by_primary: servedByPrimary,
            served_by: z.string().min(1).max(128),
            served_by_region: z.string().min(1).max(64),
            duration: z.number().nonnegative().max(60_000),
            timings: z.object({ sql_duration_ms: z.number().nonnegative().max(60_000) }).strict(),
            total_attempts: z.number().int().positive().max(16),
            last_row_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
            size_after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            returning_row_count: BoundedProbeCountV1Schema,
            returning_identity_commitments: z.array(Item2DigestV1Schema).max(64),
        })
        .strict()
        .superRefine((metadata, context) => {
            if (metadata.returning_row_count !== metadata.returning_identity_commitments.length) {
                context.addIssue({
                    code: "custom",
                    path: ["returning_identity_commitments"],
                    message: "RETURNING row count does not match the committed row identities",
                });
            }
        });
const D1ResultMetadataV1Schema = d1MetadataSchema(
    BoundedProbeCountV1Schema,
    BoundedProbeCountV1Schema,
    z.boolean(),
    z.literal(true)
);
const D1ReadMetadataV1Schema = d1MetadataSchema(z.literal(0), z.literal(0), z.literal(false), z.literal(true));
const D1BookmarkReadMetadataV1Schema = d1MetadataSchema(z.literal(0), z.literal(0), z.literal(false), z.boolean());

const D1BookmarkCausalReadbackV1Schema = z
    .object({
        source_bookmark_commitment: Item2DigestV1Schema,
        read_commitment: Item2DigestV1Schema,
        session_constraint: z.literal("bookmark"),
        writer_request_id_commitment: Item2DigestV1Schema,
        writer_receipt_identity_commitment: Item2DigestV1Schema,
        writer_receipt_count: z.literal(1),
        metadata: D1BookmarkReadMetadataV1Schema,
    })
    .strict();

const D1SetupObservationV1Schema = z
    .object({
        read_replication: z
            .object({
                configured: z.literal("enabled"),
                readback: z.literal("enabled"),
                readback_commitment: Item2DigestV1Schema,
                first_primary_metadata: D1ReadMetadataV1Schema,
            })
            .strict(),
        foreign_keys: z
            .object({
                pragma_readback: z.literal(1),
                readback_commitment: Item2DigestV1Schema,
                first_primary_metadata: D1ReadMetadataV1Schema,
            })
            .strict(),
        rollback_canary: z
            .object({
                operation: z.literal("foreign_key_tripwire_batch"),
                result: z.literal("recognized_constraint_rejection"),
                error_commitment: Item2DigestV1Schema,
                guarded_rows_after: z.literal(0),
                readback_commitment: Item2DigestV1Schema,
                first_primary_metadata: D1ReadMetadataV1Schema,
            })
            .strict(),
        sink_runtime: z
            .object({
                public_sink_ingress_denied: z.literal(true),
                public_sink_ingress_denial_observation_commitment: Item2DigestV1Schema,
                access_protected_readback_get_allowed: z.literal(true),
                readback_get_observation_commitment: Item2DigestV1Schema,
                private_rpc_awaited: z.literal(true),
                private_rpc_observation_commitment: Item2DigestV1Schema,
                access_context_forwarded: z.literal(false),
                writer_a_binding_config_digest: Item2DigestV1Schema,
                writer_b_binding_config_digest: Item2DigestV1Schema,
                runtime_version_commitment: Item2DigestV1Schema,
                sink_receipt_identity_commitment: Item2DigestV1Schema,
                sink_receipt_count: z.literal(1),
            })
            .strict(),
    })
    .strict();

const D1BatchOperationV1Schema = z.enum([
    "guarded_create",
    "grant_revoke",
    "gateway_reserve",
    "capacity_claim",
    "destroy_observation",
    "capacity_release",
    "audit_append",
]);
const D1StatementKindV1Schema = z.enum([
    "consume_confirmation",
    "clear_confirmation_slot",
    "insert_run",
    "insert_run_assertion",
    "revoke_authority",
    "discard_confirmation",
    "request_run_cancellation",
    "insert_cancellation_outbox",
    "decrement_gateway_budget",
    "insert_gateway_reservation",
    "insert_gateway_guard",
    "increment_capacity",
    "insert_capacity_claim",
    "insert_capacity_guard",
    "insert_destroy_observation",
    "insert_destroy_observation_guard",
    "mark_capacity_claim_released",
    "decrement_capacity",
    "insert_capacity_release_guard",
    "insert_audit_event",
    "advance_audit_head",
    "insert_audit_guard",
]);
const D1_BATCH_STATEMENTS_V1 = {
    guarded_create: ["consume_confirmation", "clear_confirmation_slot", "insert_run", "insert_run_assertion"],
    grant_revoke: [
        "revoke_authority",
        "discard_confirmation",
        "clear_confirmation_slot",
        "request_run_cancellation",
        "insert_cancellation_outbox",
    ],
    gateway_reserve: ["decrement_gateway_budget", "insert_gateway_reservation", "insert_gateway_guard"],
    capacity_claim: ["increment_capacity", "insert_capacity_claim", "insert_capacity_guard"],
    destroy_observation: ["insert_destroy_observation", "insert_destroy_observation_guard"],
    capacity_release: ["mark_capacity_claim_released", "decrement_capacity", "insert_capacity_release_guard"],
    audit_append: ["insert_audit_event", "advance_audit_head", "insert_audit_guard"],
} as const;
const D1CommittedStatementResultV1Schema = z
    .object({
        statement_index: z.number().int().nonnegative().max(15),
        statement_kind: D1StatementKindV1Schema,
        expected_returning_row_count: BoundedProbeCountV1Schema,
        metadata: D1ResultMetadataV1Schema,
    })
    .strict()
    .superRefine((result, context) => {
        if (result.metadata.returning_row_count !== result.expected_returning_row_count) {
            context.addIssue({
                code: "custom",
                path: ["metadata", "returning_row_count"],
                message: "Statement RETURNING cardinality does not match the batch definition",
            });
        }
    });
const CapacityClaimBindingV1Schema = z
    .object({
        installation_id_commitment: Item2DigestV1Schema,
        run_id_commitment: Item2DigestV1Schema,
        run_attempt_fence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        claim_id_commitment: Item2DigestV1Schema,
        sandbox_id_commitment: Item2DigestV1Schema,
    })
    .strict();

const CapacityTargetBindingV1Schema = CapacityClaimBindingV1Schema.extend({
    destroy_observation_id_commitment: Item2DigestV1Schema,
    destroy_receipt_commitment: Item2DigestV1Schema,
}).strict();

const D1TrialWriterCommonV1Schema = z.object({
    writer_role: z.enum(["writer_a", "writer_b"]),
    child_process_id_commitment: Item2DigestV1Schema,
    go_receipt_commitment: Item2DigestV1Schema,
    network_request_count: z.literal(1),
    worker_readiness_row_count: z.literal(1),
    request_id_commitment: Item2DigestV1Schema,
    request_content_commitment: Item2DigestV1Schema,
    script_commitment: Item2DigestV1Schema,
    version_commitment: Item2DigestV1Schema,
    application_retry_count: z.literal(0),
    batch_operation: D1BatchOperationV1Schema,
    capacity_claim_binding: CapacityClaimBindingV1Schema.nullable(),
    capacity_release_binding: CapacityTargetBindingV1Schema.nullable(),
    audit_binding: z
        .object({
            attempt_id_commitment: Item2DigestV1Schema,
            expected_sequence: BoundedProbeCountV1Schema,
            previous_head_hash_commitment: Item2DigestV1Schema,
            event_hash_commitment: Item2DigestV1Schema,
        })
        .strict()
        .nullable(),
});
const D1ObservedWriterFieldsV1 = {
    response_commitment: Item2DigestV1Schema,
    bookmark_commitment: Item2DigestV1Schema,
    writer_receipt_identity_commitment: Item2DigestV1Schema,
    bookmark_causal_readback: D1BookmarkCausalReadbackV1Schema,
} as const;
const D1TrialWriterResultV1Schema = z
    .discriminatedUnion("outcome", [
        D1TrialWriterCommonV1Schema.extend({
            ...D1ObservedWriterFieldsV1,
            outcome: z.literal("committed"),
            statement_results: z.array(D1CommittedStatementResultV1Schema).min(2).max(5),
        }).strict(),
        D1TrialWriterCommonV1Schema.extend({
            outcome: z.literal("recognized_guard_denial"),
            bookmark_observed: z.literal(false),
            writer_receipt_observed: z.literal(false),
            guard_kind: z.enum(["foreign_key_tripwire", "unique_reservation", "audit_head_trigger"]),
            error_commitment: Item2DigestV1Schema,
            no_partial_write_readback: z
                .object({
                    read_commitment: Item2DigestV1Schema,
                    session_constraint: z.literal("first-primary"),
                    fresh_session: z.literal(true),
                    guarded_row_count: z.literal(0),
                    metadata: D1ReadMetadataV1Schema,
                })
                .strict(),
        }).strict(),
        D1TrialWriterCommonV1Schema.extend({
            outcome: z.literal("transport_outcome_unknown"),
            fault_kind: z.enum(["crash_after_reservation", "sink_response_lost"]),
            transport_response_observed: z.literal(false),
            state_inferred_only_from_fresh_first_primary_readback: z.literal(true),
        }).strict(),
    ])
    .superRefine((result, context) => {
        if (
            result.outcome === "committed" &&
            (result.bookmark_causal_readback.source_bookmark_commitment !== result.bookmark_commitment ||
                result.bookmark_causal_readback.writer_request_id_commitment !== result.request_id_commitment ||
                result.bookmark_causal_readback.writer_receipt_identity_commitment !==
                    result.writer_receipt_identity_commitment)
        ) {
            context.addIssue({
                code: "custom",
                path: ["bookmark_causal_readback", "source_bookmark_commitment"],
                message: "Bookmark-causal readback must prove this writer request and receipt",
            });
        }
        if ((result.batch_operation === "audit_append") !== (result.audit_binding !== null)) {
            context.addIssue({
                code: "custom",
                path: ["audit_binding"],
                message: "Only audit appends may carry an audit head binding",
            });
        }
        if (
            (result.batch_operation === "capacity_claim") !== (result.capacity_claim_binding !== null) ||
            (result.batch_operation === "destroy_observation" || result.batch_operation === "capacity_release") !==
                (result.capacity_release_binding !== null) ||
            (result.capacity_claim_binding !== null && result.capacity_release_binding !== null)
        ) {
            context.addIssue({
                code: "custom",
                path: ["capacity_claim_binding"],
                message: "Capacity claim, destroy, and release operations require their exact typed binding",
            });
        }
        if (result.outcome === "transport_outcome_unknown") return;
        if (result.outcome === "recognized_guard_denial") {
            const expectedGuard =
                result.batch_operation === "audit_append"
                    ? "audit_head_trigger"
                    : result.batch_operation === "gateway_reserve"
                      ? "unique_reservation"
                      : "foreign_key_tripwire";
            if (result.guard_kind !== expectedGuard) {
                context.addIssue({
                    code: "custom",
                    path: ["guard_kind"],
                    message: "Guard denial kind does not match the attempted batch",
                });
            }
            return;
        }
        const expectedStatements = D1_BATCH_STATEMENTS_V1[result.batch_operation];
        if (
            result.statement_results.length !== expectedStatements.length ||
            result.statement_results.some(
                (statement, index) =>
                    statement.statement_index !== index || statement.statement_kind !== expectedStatements[index]
            )
        ) {
            context.addIssue({
                code: "custom",
                path: ["statement_results"],
                message: "Committed D1 batch results do not match the exact operation definition",
            });
        }
        if (
            result.batch_operation !== "grant_revoke" &&
            result.statement_results.some(statement => statement.expected_returning_row_count !== 1)
        ) {
            context.addIssue({
                code: "custom",
                path: ["statement_results"],
                message: "Batch operation requires one exact RETURNING row per committed statement",
            });
        }
    });

const D1DecisiveSnapshotV1Schema = z.discriminatedUnion("kind", [
    z
        .object({
            kind: z.literal("guarded_history"),
            authority_state: z.enum(["active", "revoked", "missing", "inconclusive"]),
            confirmation_state: z.enum(["consumed", "discarded", "inconclusive", "invalid"]),
            live_confirmation_slot: z.enum(["clear", "present", "inconclusive", "invalid"]),
            run_rows: BoundedProbeCountV1Schema,
            assertion_rows: BoundedProbeCountV1Schema,
            cancellation_requested_rows: BoundedProbeCountV1Schema,
            cancellation_outbox_rows: BoundedProbeCountV1Schema,
        })
        .strict(),
    z
        .object({
            kind: z.literal("gateway"),
            call_kind: z.enum(["model", "provider_tool", "code"]),
            scenario: z.enum(["normal", "changed_digest", "reserve_then_crash", "dispatch_response_lost"]),
            spent_reservations: BoundedProbeCountV1Schema,
            sink_receipts: BoundedProbeCountV1Schema,
            sink_receipt_identity_commitments: z.array(Item2DigestV1Schema).max(1),
            winning_dispatches: BoundedProbeCountV1Schema,
            losing_dispatches: BoundedProbeCountV1Schema,
            result: z.enum(["committed", "guarded_denial", "outcome_unknown"]),
        })
        .strict(),
    z
        .object({
            kind: z.literal("capacity"),
            reserved: BoundedProbeCountV1Schema,
            active_claims: BoundedProbeCountV1Schema,
            released_claims: BoundedProbeCountV1Schema,
            destroy_observations: BoundedProbeCountV1Schema,
            fifth_claim_committed: z.boolean(),
        })
        .strict(),
    z
        .object({
            kind: z.literal("audit"),
            head_sequence: BoundedProbeCountV1Schema,
            event_rows: BoundedProbeCountV1Schema,
            head_hash_commitment: Item2DigestV1Schema,
            chain_verified: z.boolean(),
            head_event_split_observed: z.boolean(),
        })
        .strict(),
]);

const D1DecisiveReadV1Schema = z
    .object({
        read_commitment: Item2DigestV1Schema,
        session_constraint: z.literal("first-primary"),
        fresh_session: z.literal(true),
        bookmark_source: z.literal("none"),
        metadata: D1ReadMetadataV1Schema,
        snapshot: D1DecisiveSnapshotV1Schema,
    })
    .strict();

const D1RecordedOperationCommonV1Schema = z.object({
    operation_id_commitment: Item2DigestV1Schema,
    writer_role: z.enum(["writer_a", "writer_b"]),
    request_id_commitment: Item2DigestV1Schema,
    request_content_commitment: Item2DigestV1Schema,
    observation_commitment: Item2DigestV1Schema,
    fresh_first_primary_readback: D1DecisiveReadV1Schema,
});
const D1CommittedOperationFieldsV1 = {
    operation_result_metadata: D1ResultMetadataV1Schema,
    bookmark_commitment: Item2DigestV1Schema,
    writer_receipt_identity_commitment: Item2DigestV1Schema,
    bookmark_causal_readback: D1BookmarkCausalReadbackV1Schema,
} as const;
const D1DeniedOperationFieldsV1 = {
    bookmark_observed: z.literal(false),
    writer_receipt_observed: z.literal(false),
    guard_kind: z.enum(["foreign_key_tripwire", "unique_reservation", "audit_head_trigger"]),
    error_commitment: Item2DigestV1Schema,
    no_partial_state_change: z.literal(true),
} as const;

const CapacityOperationShapeV1 = {
    operation: z.enum([
        "release_before_destroy",
        "record_exact_destroy",
        "release_wrong_installation",
        "release_wrong_run",
        "release_wrong_fence",
        "release_wrong_claim",
        "release_wrong_sandbox",
        "release_wrong_receipt",
        "release_exact_destroy",
        "release_replay",
        "fifth_claim_after_release",
    ]),
    target: CapacityTargetBindingV1Schema,
} as const;
const CapacityOperationV1Schema = z
    .discriminatedUnion("outcome", [
        D1RecordedOperationCommonV1Schema.extend({
            ...CapacityOperationShapeV1,
            ...D1CommittedOperationFieldsV1,
            outcome: z.literal("committed"),
        }).strict(),
        D1RecordedOperationCommonV1Schema.extend({
            ...CapacityOperationShapeV1,
            ...D1DeniedOperationFieldsV1,
            outcome: z.literal("guarded_denial"),
        }).strict(),
    ])
    .superRefine((operation, context) => {
        if (operation.outcome === "guarded_denial" && operation.guard_kind !== "foreign_key_tripwire") {
            context.addIssue({
                code: "custom",
                path: ["guard_kind"],
                message: "Capacity denial must come from its foreign-key guard",
            });
        }
    });

const AuditOperationShapeV1 = {
    operation: z.enum(["follow_up_append", "stale_sequence", "gap_sequence", "wrong_previous_hash"]),
    attempt_id_commitment: Item2DigestV1Schema,
    expected_sequence: BoundedProbeCountV1Schema,
    previous_head_hash_commitment: Item2DigestV1Schema,
    event_hash_commitment: Item2DigestV1Schema,
} as const;
const AuditOperationV1Schema = z
    .discriminatedUnion("outcome", [
        D1RecordedOperationCommonV1Schema.extend({
            ...AuditOperationShapeV1,
            ...D1CommittedOperationFieldsV1,
            outcome: z.literal("committed"),
        }).strict(),
        D1RecordedOperationCommonV1Schema.extend({
            ...AuditOperationShapeV1,
            ...D1DeniedOperationFieldsV1,
            outcome: z.literal("guarded_denial"),
        }).strict(),
    ])
    .superRefine((operation, context) => {
        if (operation.outcome === "guarded_denial" && operation.guard_kind !== "audit_head_trigger") {
            context.addIssue({
                code: "custom",
                path: ["guard_kind"],
                message: "Audit denial must come from the audit-head trigger",
            });
        }
    });

const GatewayCallBindingV1Schema = z
    .object({
        writer_role: z.enum(["writer_a", "writer_b"]),
        request_variant: z.enum(["exact", "duplicate", "substituted"]),
        request_id_commitment: Item2DigestV1Schema,
        request_content_commitment: Item2DigestV1Schema,
        call_kind: z.enum(["model", "provider_tool", "code"]),
        logical_call_id_commitment: Item2DigestV1Schema,
        attempt_id_commitment: Item2DigestV1Schema,
        sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        request_digest: Item2DigestV1Schema,
        reservation_key_commitment: Item2DigestV1Schema,
    })
    .strict();

const d1TrialExecutionsSchema = <T extends readonly [string, ...string[]]>(trialIds: T) =>
    z
        .array(
            z
                .object({
                    trial_id: z.enum(trialIds),
                    separate_operator_processes: z.literal(true),
                    cross_network_requests: z.literal(true),
                    request_set_commitment: Item2DigestV1Schema,
                    observation_commitment: Item2DigestV1Schema,
                    gateway_request_bindings: z.array(GatewayCallBindingV1Schema).length(2).nullable(),
                    barrier: z
                        .object({
                            driver_child_process_count: z.number().int().min(2).max(5),
                            ready_ipc_signal_count: z.number().int().min(2).max(5),
                            go_signal_count: z.number().int().min(2).max(5),
                            worker_readiness_row_count: z.number().int().min(2).max(5),
                            child_process_id_commitments: z.array(Item2DigestV1Schema).min(2).max(5),
                            readiness_child_process_id_commitments: z.array(Item2DigestV1Schema).min(2).max(5),
                            go_receipt_commitments: z.array(Item2DigestV1Schema).min(2).max(5),
                        })
                        .strict(),
                    writer_results: z
                        .array(D1TrialWriterResultV1Schema)
                        .min(2)
                        .max(5)
                        .refine(
                            values => new Set(values.map(value => value.writer_role)).size === 2,
                            "Every contention trial must use both deployed writer roles"
                        ),
                    decisive_reads: z.array(D1DecisiveReadV1Schema).length(1),
                })
                .strict()
                .superRefine((trial, context) => {
                    const expectedChildren = trial.trial_id === "sandbox_capacity_contention" ? 5 : 2;
                    if (
                        trial.barrier.driver_child_process_count !== expectedChildren ||
                        trial.barrier.ready_ipc_signal_count !== expectedChildren ||
                        trial.barrier.go_signal_count !== expectedChildren ||
                        trial.barrier.worker_readiness_row_count !== expectedChildren ||
                        trial.barrier.child_process_id_commitments.length !== expectedChildren ||
                        trial.barrier.readiness_child_process_id_commitments.length !== expectedChildren ||
                        trial.barrier.go_receipt_commitments.length !== expectedChildren ||
                        trial.writer_results.length !== expectedChildren
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["barrier"],
                            message: `Trial barrier must record ${expectedChildren} ready child processes`,
                        });
                    }
                    if (
                        new Set(trial.writer_results.map(result => result.request_id_commitment)).size !==
                            expectedChildren ||
                        new Set(trial.writer_results.map(result => result.request_content_commitment)).size !==
                            expectedChildren ||
                        new Set(trial.writer_results.map(result => result.child_process_id_commitment)).size !==
                            expectedChildren ||
                        new Set(trial.writer_results.map(result => result.go_receipt_commitment)).size !==
                            expectedChildren ||
                        JSON.stringify([...trial.barrier.child_process_id_commitments].sort()) !==
                            JSON.stringify(
                                trial.writer_results.map(result => result.child_process_id_commitment).sort()
                            ) ||
                        JSON.stringify([...trial.barrier.readiness_child_process_id_commitments].sort()) !==
                            JSON.stringify(
                                trial.writer_results.map(result => result.child_process_id_commitment).sort()
                            ) ||
                        JSON.stringify([...trial.barrier.go_receipt_commitments].sort()) !==
                            JSON.stringify(trial.writer_results.map(result => result.go_receipt_commitment).sort())
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["writer_results"],
                            message:
                                "Trial child, GO receipt, request ID, and request content commitments must be exact",
                        });
                    }
                    for (const field of ["response_commitment", "bookmark_commitment"] as const) {
                        const values = trial.writer_results.flatMap(result =>
                            result.outcome !== "committed"
                                ? []
                                : [
                                      field === "response_commitment"
                                          ? result.response_commitment
                                          : result.bookmark_commitment,
                                  ]
                        );
                        if (new Set(values).size !== values.length) {
                            context.addIssue({
                                code: "custom",
                                path: ["writer_results"],
                                message: `Trial child ${field} values must be unique`,
                            });
                        }
                    }
                    const decisiveRead = trial.decisive_reads[0];
                    if (
                        decisiveRead !== undefined &&
                        trial.writer_results.some(
                            result =>
                                result.outcome === "committed" &&
                                result.bookmark_causal_readback.read_commitment === decisiveRead.read_commitment
                        )
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["decisive_reads", 0, "read_commitment"],
                            message: "Fresh decisive read must differ from every bookmark-causal read",
                        });
                    }
                    const operations = trial.writer_results.map(result => result.batch_operation);
                    let operationsMatch = false;
                    if (
                        trial.trial_id === "create_first" ||
                        trial.trial_id === "revoke_first" ||
                        trial.trial_id === "equal_release_race" ||
                        trial.trial_id === "equal_release_race_roles_swapped"
                    ) {
                        operationsMatch =
                            operations.length === 2 &&
                            new Set(operations).size === 2 &&
                            operations.includes("guarded_create") &&
                            operations.includes("grant_revoke");
                        if (
                            operationsMatch &&
                            (trial.trial_id === "equal_release_race" ||
                                trial.trial_id === "equal_release_race_roles_swapped")
                        ) {
                            const createWriter = trial.writer_results.find(
                                result => result.batch_operation === "guarded_create"
                            )?.writer_role;
                            const revokeWriter = trial.writer_results.find(
                                result => result.batch_operation === "grant_revoke"
                            )?.writer_role;
                            operationsMatch =
                                createWriter === (trial.trial_id === "equal_release_race" ? "writer_a" : "writer_b") &&
                                revokeWriter === (trial.trial_id === "equal_release_race" ? "writer_b" : "writer_a");
                        }
                    } else if (trial.trial_id === "sandbox_capacity_contention") {
                        operationsMatch = operations.every(operation => operation === "capacity_claim");
                    } else if (trial.trial_id === "destroy_observed_capacity_release") {
                        operationsMatch =
                            new Set(operations).size === 2 &&
                            operations.includes("destroy_observation") &&
                            operations.includes("capacity_release");
                    } else if (trial.trial_id === "audit_head_contention") {
                        operationsMatch = operations.every(operation => operation === "audit_append");
                    } else {
                        operationsMatch = operations.every(operation => operation === "gateway_reserve");
                    }
                    if (trial.trial_id === "audit_head_contention") {
                        const bindings = trial.writer_results.map(result => result.audit_binding);
                        if (
                            bindings.some(binding => binding === null) ||
                            new Set(bindings.map(binding => binding?.expected_sequence)).size !== 1 ||
                            new Set(bindings.map(binding => binding?.previous_head_hash_commitment)).size !== 1 ||
                            new Set(bindings.map(binding => binding?.event_hash_commitment)).size !== expectedChildren
                        ) {
                            context.addIssue({
                                code: "custom",
                                path: ["writer_results"],
                                message: "Audit contenders must share one head and propose distinct event hashes",
                            });
                        }
                    }
                    if (!operationsMatch) {
                        context.addIssue({
                            code: "custom",
                            path: ["writer_results"],
                            message: "Trial writer operations do not match the trial definition",
                        });
                    }
                    const isGatewayTrial = operations.every(operation => operation === "gateway_reserve");
                    if (
                        (isGatewayTrial && trial.gateway_request_bindings === null) ||
                        (!isGatewayTrial && trial.gateway_request_bindings !== null)
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["gateway_request_bindings"],
                            message: "Only gateway trials may carry exact gateway request bindings",
                        });
                    }
                    const committed = trial.writer_results.filter(result => result.outcome === "committed").length;
                    const denied = trial.writer_results.filter(
                        result => result.outcome === "recognized_guard_denial"
                    ).length;
                    const transportUnknown = trial.writer_results.filter(
                        result => result.outcome === "transport_outcome_unknown"
                    ).length;
                    if (
                        (trial.trial_id === "sandbox_capacity_contention" && !(committed === 4 && denied === 1)) ||
                        (trial.trial_id === "audit_head_contention" && !(committed === 1 && denied === 1)) ||
                        (trial.trial_id === "destroy_observed_capacity_release" &&
                            !(
                                committed === 2 &&
                                trial.writer_results.find(result => result.batch_operation === "destroy_observation")
                                    ?.outcome === "committed" &&
                                trial.writer_results.find(result => result.batch_operation === "capacity_release")
                                    ?.outcome === "committed"
                            )) ||
                        (trial.trial_id.endsWith("_normal") && !(committed === 1 && denied === 1)) ||
                        (trial.trial_id.endsWith("_changed_digest") && !(committed === 1 && denied === 1)) ||
                        (trial.trial_id.endsWith("_reserve_then_crash") && !(transportUnknown === 1 && denied === 1)) ||
                        (trial.trial_id.endsWith("_dispatch_response_lost") &&
                            !(transportUnknown === 1 && denied === 1))
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["writer_results"],
                            message: "Trial commit and guard-denial counts do not match the required history",
                        });
                    }
                    if (
                        trial.trial_id.endsWith("_reserve_then_crash") &&
                        trial.writer_results.some(
                            result =>
                                result.outcome === "transport_outcome_unknown" &&
                                result.fault_kind !== "crash_after_reservation"
                        )
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["writer_results"],
                            message: "Reserve-crash trial must record the reserve-crash transport fault",
                        });
                    }
                    if (
                        trial.trial_id.endsWith("_dispatch_response_lost") &&
                        trial.writer_results.some(
                            result =>
                                result.outcome === "transport_outcome_unknown" &&
                                result.fault_kind !== "sink_response_lost"
                        )
                    ) {
                        context.addIssue({
                            code: "custom",
                            path: ["writer_results"],
                            message: "Response-lost trial must record the sink-response-lost transport fault",
                        });
                    }
                })
        )
        .length(trialIds.length)
        .refine(
            values => new Set(values.map(value => value.trial_id)).size === trialIds.length,
            "D1 trial execution records must be complete and unique"
        );

export const D1_GUARDED_TRIAL_IDS_V1 = [
    "create_first",
    "revoke_first",
    "equal_release_race",
    "equal_release_race_roles_swapped",
    "sandbox_capacity_contention",
    "destroy_observed_capacity_release",
    "audit_head_contention",
] as const;
export const D1_GATEWAY_TRIAL_IDS_V1 = [
    "model_normal",
    "model_changed_digest",
    "model_reserve_then_crash",
    "model_dispatch_response_lost",
    "provider_tool_normal",
    "provider_tool_changed_digest",
    "provider_tool_reserve_then_crash",
    "provider_tool_dispatch_response_lost",
    "code_normal",
    "code_changed_digest",
    "code_reserve_then_crash",
    "code_dispatch_response_lost",
] as const;
const D1_CLEANUP_RESOURCE_KINDS_V1 = [
    "database",
    "writer_a_script",
    "writer_b_script",
    "sink_script",
    "writer_a_deployment",
    "writer_b_deployment",
    "sink_deployment",
    "writer_a_route",
    "writer_b_route",
    "readback_route",
    "access_application",
    "access_policy",
    "access_service_token",
] as const;
const D1_FINAL_CURRENT_STATE_KEYS_V1 = [
    "create_first",
    "revoke_first",
    "equal_release_race",
    "equal_release_race_roles_swapped",
    "sandbox_capacity",
    "audit_head",
    ...D1_GATEWAY_TRIAL_IDS_V1,
] as const;
const D1FinalCurrentStateSnapshotV1Schema = z
    .object({
        case_key: z.enum(D1_FINAL_CURRENT_STATE_KEYS_V1),
        snapshot: D1DecisiveSnapshotV1Schema,
    })
    .strict();
const D1CleanupObservationV1Schema = z
    .object({
        status: z.literal("succeeded"),
        application_retry_count: z.literal(0),
        run_fence_closed: z.literal(true),
        cleanup_observation_commitment: Item2DigestV1Schema,
        operator_database_deny_list_digest: Item2DigestV1Schema,
        generated_name_guards: z
            .array(
                D1GeneratedNameCommitmentV1Schema.extend({
                    safe_prefix_commitment: Item2DigestV1Schema,
                    validation_outcome: z.literal("prefix_and_lowercase_random_suffix_match"),
                }).strict()
            )
            .length(D1_GENERATED_NAME_RESOURCE_KINDS_V1.length)
            .refine(
                guards =>
                    new Set(guards.map(guard => guard.resource_kind)).size ===
                    D1_GENERATED_NAME_RESOURCE_KINDS_V1.length,
                "Cleanup must validate every committed generated name"
            ),
        database_deny_list_check: z
            .object({
                candidate_database_id_commitment: Item2DigestV1Schema,
                operator_database_deny_list_digest: Item2DigestV1Schema,
                outcome: z.literal("not_listed"),
            })
            .strict(),
        all_routes_and_access_retained_until_final_readback: z.literal(true),
        in_flight_requests: z
            .object({
                started_request_id_commitments: z.array(Item2DigestV1Schema).min(1).max(64),
                settled_request_id_commitments: z.array(Item2DigestV1Schema).min(1).max(64),
                request_content_commitments: z.array(Item2DigestV1Schema).min(1).max(64),
                unknown_request_id_commitments: z.array(Item2DigestV1Schema).length(0),
            })
            .strict()
            .superRefine((requests, context) => {
                if (
                    new Set(requests.started_request_id_commitments).size !==
                        requests.started_request_id_commitments.length ||
                    new Set(requests.settled_request_id_commitments).size !==
                        requests.settled_request_id_commitments.length ||
                    new Set(requests.request_content_commitments).size !==
                        requests.request_content_commitments.length ||
                    requests.request_content_commitments.length !== requests.started_request_id_commitments.length ||
                    JSON.stringify([...requests.started_request_id_commitments].sort()) !==
                        JSON.stringify([...requests.settled_request_id_commitments].sort())
                ) {
                    context.addIssue({ code: "custom", message: "Every in-flight request must settle exactly once" });
                }
            }),
        final_first_primary_readback: z
            .object({
                read_commitment: Item2DigestV1Schema,
                request_id_commitment: Item2DigestV1Schema,
                request_content_commitment: Item2DigestV1Schema,
                session_constraint: z.literal("first-primary"),
                fresh_session: z.literal(true),
                metadata: D1ReadMetadataV1Schema,
                observation_set_commitment: Item2DigestV1Schema,
                current_state_snapshots: z
                    .array(D1FinalCurrentStateSnapshotV1Schema)
                    .min(6)
                    .max(12)
                    .refine(
                        snapshots => new Set(snapshots.map(snapshot => snapshot.case_key)).size === snapshots.length,
                        "Final current-state snapshot keys must be unique"
                    ),
            })
            .strict(),
        cleanup_transcript_commitment: UntrustedRedactedTranscriptCommitmentV1Schema,
        cleanup_transcript_response_projection: z
            .object({
                final_observation_set_digest: Item2DigestV1Schema,
                projection_hmac_commitment: Item2DigestV1Schema,
            })
            .strict(),
        service_token_revoked_after_final_readback: z.literal(true),
        routes_confirmed_absent_before_worker_deletion: z.literal(true),
        database_deleted_last: z.literal(true),
        worker_script_deletions: z
            .array(
                z
                    .object({
                        role: z.enum(["writer_a", "writer_b", "sink_readback"]),
                        script_commitment: Item2DigestV1Schema,
                        force: z.literal(false),
                        confirmed_absent: z.literal(true),
                    })
                    .strict()
            )
            .length(3)
            .refine(
                values => new Set(values.map(value => value.role)).size === 3,
                "Each Worker script must be deleted once without force"
            ),
        completed_steps: z.tuple([
            z.literal("close_run_fence"),
            z.literal("settle_in_flight_requests"),
            z.literal("capture_final_first_primary_readback"),
            z.literal("revoke_access_service_token"),
            z.literal("delete_all_exact_routes"),
            z.literal("confirm_routes_absent"),
            z.literal("delete_access_application_and_policy"),
            z.literal("delete_writer_scripts_without_force"),
            z.literal("delete_sink_script_without_force"),
            z.literal("delete_database_last"),
            z.literal("confirm_all_recorded_resources_absent"),
        ]),
        absence_checks: z
            .array(
                z
                    .object({
                        resource_kind: z.enum(D1_CLEANUP_RESOURCE_KINDS_V1),
                        resource_commitment: Item2DigestV1Schema,
                        create_response_id_commitment: Item2DigestV1Schema,
                        cleanup_target_id_commitment: Item2DigestV1Schema,
                        create_response_id_equals_cleanup_target: z.literal(true),
                        absent: z.literal(true),
                    })
                    .strict()
            )
            .length(D1_CLEANUP_RESOURCE_KINDS_V1.length)
            .refine(
                values =>
                    new Set(values.map(value => value.resource_kind)).size === D1_CLEANUP_RESOURCE_KINDS_V1.length,
                "Cleanup absence checks must cover each deployed resource exactly once"
            ),
    })
    .strict();
const GuardedHistoryObservationV1Schema = z
    .object({
        case: z.enum(["create_first", "revoke_first", "equal_release_race", "equal_release_race_roles_swapped"]),
        observation_commitment: Item2DigestV1Schema,
        observed_history: z.enum(["create_before_revoke", "revoke_before_create", "inconclusive", "invalid"]),
        authority_state: z.enum(["active", "revoked", "missing", "inconclusive"]),
        confirmation_state: z.enum(["consumed", "discarded", "inconclusive", "invalid"]),
        live_confirmation_slot: z.enum(["clear", "present", "inconclusive", "invalid"]),
        run_rows: BoundedProbeCountV1Schema,
        assertion_rows: BoundedProbeCountV1Schema,
        cancellation_requested_rows: BoundedProbeCountV1Schema,
        cancellation_outbox_rows: BoundedProbeCountV1Schema,
    })
    .strict();
const D1GuardedCreateObservationsV1Schema = z
    .object({
        trial_executions: d1TrialExecutionsSchema(D1_GUARDED_TRIAL_IDS_V1),
        histories: z
            .array(GuardedHistoryObservationV1Schema)
            .length(4)
            .refine(values => new Set(values.map(value => value.case)).size === 4, "History cases must be unique"),
        capacity: z
            .object({
                contention_observation_commitment: Item2DigestV1Schema,
                release_observation_commitment: Item2DigestV1Schema,
                contenders: BoundedProbeCountV1Schema,
                committed_claims: BoundedProbeCountV1Schema,
                denied_claims: BoundedProbeCountV1Schema,
                releases_before_destroy_observation: BoundedProbeCountV1Schema,
                releases_after_exact_destroy_observation: BoundedProbeCountV1Schema,
                exact_release_target: CapacityTargetBindingV1Schema,
                wrong_target_releases: z
                    .array(
                        z
                            .object({
                                target: z.enum([
                                    "installation_id",
                                    "run_id",
                                    "run_attempt_fence",
                                    "claim_id",
                                    "sandbox_id",
                                    "destroy_receipt",
                                ]),
                                attempts: z.literal(1),
                                state_changes: z.literal(0),
                            })
                            .strict()
                    )
                    .length(6)
                    .refine(
                        values => new Set(values.map(value => value.target)).size === 6,
                        "Every wrong capacity release target must be tested once"
                    ),
                release_replay_attempts: BoundedProbeCountV1Schema,
                release_replay_state_changes: BoundedProbeCountV1Schema,
                fifth_claim_after_release_commits: BoundedProbeCountV1Schema,
                reserved_after_fifth_claim: BoundedProbeCountV1Schema,
                operations: z
                    .array(CapacityOperationV1Schema)
                    .length(11)
                    .superRefine((operations, context) => {
                        if (new Set(operations.map(operation => operation.operation)).size !== 11) {
                            context.addIssue({ code: "custom", message: "Capacity operations must be complete" });
                        }
                        for (const [index, operation] of operations.entries()) {
                            const shouldCommit =
                                operation.operation === "record_exact_destroy" ||
                                operation.operation === "release_exact_destroy" ||
                                operation.operation === "fifth_claim_after_release";
                            if (operation.outcome !== (shouldCommit ? "committed" : "guarded_denial")) {
                                context.addIssue({
                                    code: "custom",
                                    path: [index, "outcome"],
                                    message: "Capacity operation outcome contradicts the required history",
                                });
                            }
                            if (
                                (operation.outcome === "committed" &&
                                    (operation.bookmark_causal_readback.source_bookmark_commitment !==
                                        operation.bookmark_commitment ||
                                        operation.bookmark_causal_readback.writer_request_id_commitment !==
                                            operation.request_id_commitment ||
                                        operation.bookmark_causal_readback.writer_receipt_identity_commitment !==
                                            operation.writer_receipt_identity_commitment ||
                                        operation.bookmark_causal_readback.read_commitment ===
                                            operation.fresh_first_primary_readback.read_commitment)) ||
                                operation.fresh_first_primary_readback.snapshot.kind !== "capacity"
                            ) {
                                context.addIssue({
                                    code: "custom",
                                    path: [index],
                                    message: "Capacity operation readbacks are not causally and decisively bound",
                                });
                            }
                        }
                    }),
            })
            .strict(),
        audit: z
            .object({
                observation_commitment: Item2DigestV1Schema,
                initial_head_hash_commitment: Item2DigestV1Schema,
                first_event_hash_commitment: Item2DigestV1Schema,
                final_head_hash_commitment: Item2DigestV1Schema,
                first_phase_attempt_id_commitments: z
                    .array(Item2DigestV1Schema)
                    .length(2)
                    .refine(values => new Set(values).size === 2, "Audit contenders must use distinct attempt IDs"),
                follow_up_attempt_id_commitment: Item2DigestV1Schema,
                same_head_contenders: BoundedProbeCountV1Schema,
                first_phase_commits: BoundedProbeCountV1Schema,
                first_phase_conflicts: BoundedProbeCountV1Schema,
                follow_up_commits: BoundedProbeCountV1Schema,
                final_event_rows: BoundedProbeCountV1Schema,
                final_head_sequence: BoundedProbeCountV1Schema,
                final_chain_verified: z.boolean(),
                stale_sequence_denied: z.boolean(),
                gap_sequence_denied: z.boolean(),
                wrong_previous_hash_denied: z.boolean(),
                head_event_split_observed: z.boolean(),
                operations: z
                    .array(AuditOperationV1Schema)
                    .length(4)
                    .superRefine((operations, context) => {
                        if (new Set(operations.map(operation => operation.operation)).size !== 4) {
                            context.addIssue({ code: "custom", message: "Audit operations must be complete" });
                        }
                        for (const [index, operation] of operations.entries()) {
                            const expectedOutcome =
                                operation.operation === "follow_up_append" ? "committed" : "guarded_denial";
                            if (
                                operation.outcome !== expectedOutcome ||
                                (operation.outcome === "committed" &&
                                    (operation.bookmark_causal_readback.source_bookmark_commitment !==
                                        operation.bookmark_commitment ||
                                        operation.bookmark_causal_readback.writer_request_id_commitment !==
                                            operation.request_id_commitment ||
                                        operation.bookmark_causal_readback.writer_receipt_identity_commitment !==
                                            operation.writer_receipt_identity_commitment ||
                                        operation.bookmark_causal_readback.read_commitment ===
                                            operation.fresh_first_primary_readback.read_commitment)) ||
                                operation.fresh_first_primary_readback.snapshot.kind !== "audit"
                            ) {
                                context.addIssue({
                                    code: "custom",
                                    path: [index],
                                    message: "Audit operation outcome or readback contradicts the required history",
                                });
                            }
                        }
                    }),
            })
            .strict()
            .superRefine((audit, context) => {
                const negativeAttemptIds = audit.operations
                    .filter(operation => operation.operation !== "follow_up_append")
                    .map(operation => operation.attempt_id_commitment);
                if (
                    audit.first_phase_attempt_id_commitments.includes(audit.follow_up_attempt_id_commitment) ||
                    new Set(negativeAttemptIds).size !== 3 ||
                    negativeAttemptIds.some(
                        attemptId =>
                            audit.first_phase_attempt_id_commitments.includes(attemptId) ||
                            attemptId === audit.follow_up_attempt_id_commitment
                    )
                ) {
                    context.addIssue({
                        code: "custom",
                        path: ["operations"],
                        message: "Audit follow-up and negative cases must use distinct new attempt IDs",
                    });
                }
            }),
    })
    .strict();

const exactCompetingGatewayBindings = (sameDigest: boolean) =>
    z
        .array(GatewayCallBindingV1Schema)
        .length(2)
        .superRefine((requests, context) => {
            const [first, second] = requests;
            if (first === undefined || second === undefined) return;
            if (first.writer_role === second.writer_role) {
                context.addIssue({ code: "custom", message: "Gateway contention must use both writer roles" });
            }
            for (const field of [
                "call_kind",
                "logical_call_id_commitment",
                "attempt_id_commitment",
                "sequence",
                "reservation_key_commitment",
            ] as const) {
                if (first[field] !== second[field]) {
                    context.addIssue({ code: "custom", path: [1, field], message: `Gateway ${field} must match` });
                }
            }
            if ((first.request_digest === second.request_digest) !== sameDigest) {
                context.addIssue({
                    code: "custom",
                    path: [1, "request_digest"],
                    message: sameDigest
                        ? "Duplicate requests must use one digest"
                        : "Changed-digest requests must differ",
                });
            }
            const expectedVariants = sameDigest ? ["duplicate", "exact"] : ["exact", "substituted"];
            if (
                JSON.stringify([...new Set(requests.map(request => request.request_variant))].sort()) !==
                JSON.stringify(expectedVariants)
            ) {
                context.addIssue({
                    code: "custom",
                    path: [1, "request_variant"],
                    message: "Gateway request variants do not match the contention scenario",
                });
            }
        });

const GatewaySinkRpcObservationV1Schema = z
    .object({
        binding_configuration_observation_commitment: Item2DigestV1Schema,
        rpc_observation_commitment: Item2DigestV1Schema,
        writer_role: z.enum(["writer_a", "writer_b"]).nullable(),
        writer_binding_commitment: Item2DigestV1Schema.nullable(),
        target_script_commitment: Item2DigestV1Schema,
        runtime_version_commitment: Item2DigestV1Schema.nullable(),
        rpc_outcome: z.enum(["awaited_response", "awaited_response_lost", "not_invoked_before_fault"]),
        access_context_forwarded: z.literal(false),
        sink_receipt_identity_commitments: z.array(Item2DigestV1Schema).max(1),
    })
    .strict()
    .superRefine((rpc, context) => {
        const notInvoked = rpc.rpc_outcome === "not_invoked_before_fault";
        if (
            notInvoked !== (rpc.writer_role === null) ||
            notInvoked !== (rpc.writer_binding_commitment === null) ||
            rpc.sink_receipt_identity_commitments.length !== (notInvoked ? 0 : 1)
        ) {
            context.addIssue({ code: "custom", message: "Sink RPC outcome contradicts its caller and receipt" });
        }
    });

const GatewayCallKindObservationV1Schema = z
    .object({
        call_kind: z.enum(["model", "provider_tool", "code"]),
        normal: z
            .object({
                request_set_commitment: Item2DigestV1Schema,
                observation_commitment: Item2DigestV1Schema,
                competing_requests: exactCompetingGatewayBindings(true),
                spent_reservations: BoundedProbeCountV1Schema,
                sink_receipts: BoundedProbeCountV1Schema,
                winning_dispatches: BoundedProbeCountV1Schema,
                losing_dispatches: BoundedProbeCountV1Schema,
                sink_rpc: GatewaySinkRpcObservationV1Schema,
            })
            .strict(),
        changed_digest: z
            .object({
                request_set_commitment: Item2DigestV1Schema,
                observation_commitment: Item2DigestV1Schema,
                competing_requests: exactCompetingGatewayBindings(false),
                substituted_request_dispatches: BoundedProbeCountV1Schema,
                sink_rpc: GatewaySinkRpcObservationV1Schema,
            })
            .strict(),
        reserve_then_crash: z
            .object({
                request_set_commitment: Item2DigestV1Schema,
                observation_commitment: Item2DigestV1Schema,
                competing_requests: exactCompetingGatewayBindings(true),
                spent_reservations: BoundedProbeCountV1Schema,
                sink_receipts: BoundedProbeCountV1Schema,
                result: z.enum(["outcome_unknown", "inconclusive", "invalid"]),
                retry_attempts: BoundedProbeCountV1Schema,
                sink_rpc: GatewaySinkRpcObservationV1Schema,
            })
            .strict(),
        dispatch_response_lost: z
            .object({
                request_set_commitment: Item2DigestV1Schema,
                observation_commitment: Item2DigestV1Schema,
                competing_requests: exactCompetingGatewayBindings(true),
                spent_reservations: BoundedProbeCountV1Schema,
                sink_receipts: BoundedProbeCountV1Schema,
                result: z.enum(["outcome_unknown", "inconclusive", "invalid"]),
                retry_attempts: BoundedProbeCountV1Schema,
                sink_rpc: GatewaySinkRpcObservationV1Schema,
            })
            .strict(),
    })
    .strict()
    .superRefine((observation, context) => {
        for (const [scenario, requests] of [
            ["normal", observation.normal.competing_requests],
            ["changed_digest", observation.changed_digest.competing_requests],
            ["reserve_then_crash", observation.reserve_then_crash.competing_requests],
            ["dispatch_response_lost", observation.dispatch_response_lost.competing_requests],
        ] as const) {
            if (requests.some(request => request.call_kind !== observation.call_kind)) {
                context.addIssue({
                    code: "custom",
                    path: [scenario, "competing_requests"],
                    message: "Gateway binding call kind does not match its observation",
                });
            }
        }
    });
const GatewayReservationObservationsV1Schema = z
    .object({
        trial_executions: d1TrialExecutionsSchema(D1_GATEWAY_TRIAL_IDS_V1),
        call_kinds: z
            .array(GatewayCallKindObservationV1Schema)
            .length(3)
            .refine(values => new Set(values.map(value => value.call_kind)).size === 3, "Call kinds must be unique"),
    })
    .strict();

type ProbeCheckObservationV1 = {
    check_id: string;
    outcome: z.infer<typeof UntrustedProbeOutcomeV1Schema>;
    transcript_commitments: ReadonlyArray<{ observation_commitment: string }>;
};

function checkPassed(checks: readonly ProbeCheckObservationV1[], checkId: string): boolean {
    return checks.find(check => check.check_id === checkId)?.outcome === "passed";
}

function guardedHistoryIs(
    history: z.infer<typeof GuardedHistoryObservationV1Schema>,
    expected: "create_before_revoke" | "revoke_before_create"
): boolean {
    if (history.observed_history !== expected || history.authority_state !== "revoked") return false;
    const confirmationState = expected === "create_before_revoke" ? "consumed" : "discarded";
    if (history.confirmation_state !== confirmationState || history.live_confirmation_slot !== "clear") return false;
    const count = expected === "create_before_revoke" ? 1 : 0;
    return (
        history.run_rows === count &&
        history.assertion_rows === count &&
        history.cancellation_requested_rows === count &&
        history.cancellation_outbox_rows === count
    );
}

function addPassedCheckIssue(context: z.RefinementCtx, checkId: string): void {
    context.addIssue({
        code: "custom",
        path: ["checks"],
        message: `Passed check ${checkId} contradicts its deployed observation`,
    });
}

function refinePassedTranscriptBindings(
    checks: readonly ProbeCheckObservationV1[],
    expectedByCheck: ReadonlyMap<string, readonly string[]>,
    context: z.RefinementCtx
): void {
    for (const check of checks) {
        if (check.outcome !== "passed") continue;
        const expected = [...(expectedByCheck.get(check.check_id) ?? [])].sort();
        const actual = check.transcript_commitments.map(commitment => commitment.observation_commitment).sort();
        if (
            expected.length === 0 ||
            new Set(actual).size !== actual.length ||
            JSON.stringify(actual) !== JSON.stringify(expected)
        ) {
            context.addIssue({
                code: "custom",
                path: ["checks"],
                message: `Passed check ${check.check_id} is not bound to its typed observations`,
            });
        }
    }
}

function refineD1TrialDeployment(
    report: {
        commitment_key_id_digest: string;
        kind: "d1_guarded_create" | "gateway_reservation";
        configuration_digest: string;
        installation_digest: string;
        environment_digest: string;
        probe_run_digest: string;
        observed_at: number;
        completed_at: number;
        final_observation_set_commitment: string;
        deployment: z.infer<typeof D1DeploymentCommitmentV1Schema>;
        setup: z.infer<typeof D1SetupObservationV1Schema>;
        cleanup: z.infer<typeof D1CleanupObservationV1Schema>;
        observations: {
            trial_executions: ReadonlyArray<{
                trial_id: string;
                writer_results: ReadonlyArray<z.infer<typeof D1TrialWriterResultV1Schema>>;
            }>;
        };
    },
    context: z.RefinementCtx
): void {
    if (
        report.deployment.identity_commitment_spec.commitment_key_id_digest !== report.commitment_key_id_digest ||
        report.deployment.account_identity.commitment_key_id_digest !== report.commitment_key_id_digest ||
        report.deployment.zone_identity.commitment_key_id_digest !== report.commitment_key_id_digest
    ) {
        context.addIssue({
            code: "custom",
            path: ["deployment", "account_identity", "commitment_key_id_digest"],
            message: "Cloudflare identity commitments must use the report commitment key",
        });
    }
    if (
        report.setup.sink_runtime.writer_a_binding_config_digest !==
            report.deployment.sink_service_binding.writer_a_binding_config_digest ||
        report.setup.sink_runtime.writer_b_binding_config_digest !==
            report.deployment.sink_service_binding.writer_b_binding_config_digest ||
        report.setup.sink_runtime.runtime_version_commitment !== report.deployment.sink_version_commitment
    ) {
        context.addIssue({
            code: "custom",
            path: ["setup", "sink_runtime"],
            message: "Runtime sink evidence does not match the deployed binding configuration and version",
        });
    }
    const cleanupTranscript = report.cleanup.cleanup_transcript_commitment;
    if (
        cleanupTranscript.gate_id !== report.kind ||
        cleanupTranscript.check_id !== "cleanup" ||
        cleanupTranscript.configuration_digest !== report.configuration_digest ||
        cleanupTranscript.installation_digest !== report.installation_digest ||
        cleanupTranscript.environment_digest !== report.environment_digest ||
        cleanupTranscript.probe_run_digest !== report.probe_run_digest ||
        cleanupTranscript.commitment_key_id_digest !== report.commitment_key_id_digest ||
        cleanupTranscript.observed_at < report.observed_at ||
        cleanupTranscript.observed_at > report.completed_at ||
        cleanupTranscript.request_commitment !==
            report.cleanup.final_first_primary_readback.request_content_commitment ||
        cleanupTranscript.response_commitment !==
            report.cleanup.cleanup_transcript_response_projection.projection_hmac_commitment ||
        report.cleanup.cleanup_transcript_response_projection.final_observation_set_digest !==
            report.final_observation_set_commitment ||
        cleanupTranscript.observation_commitment !== report.cleanup.cleanup_observation_commitment
    ) {
        context.addIssue({
            code: "custom",
            path: ["cleanup", "cleanup_transcript_commitment"],
            message: "Cleanup transcript is not bound to this probe and its final readback",
        });
    }
    for (const [trialIndex, trial] of report.observations.trial_executions.entries()) {
        for (const [writerIndex, writer] of trial.writer_results.entries()) {
            const prefix = writer.writer_role;
            if (
                writer.script_commitment !== report.deployment[`${prefix}_script_commitment`] ||
                writer.version_commitment !== report.deployment[`${prefix}_version_commitment`]
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", "trial_executions", trialIndex, "writer_results", writerIndex],
                    message: "Trial writer identity does not match the deployed writer",
                });
            }
        }
    }
    const expectedCleanupCommitments = new Map<string, string>([
        ["database", report.deployment.database_id_commitment],
        ["writer_a_script", report.deployment.writer_a_script_commitment],
        ["writer_b_script", report.deployment.writer_b_script_commitment],
        ["sink_script", report.deployment.sink_script_commitment],
        ["writer_a_deployment", report.deployment.worker_deployments.writer_a.deployment_id_commitment],
        ["writer_b_deployment", report.deployment.worker_deployments.writer_b.deployment_id_commitment],
        ["sink_deployment", report.deployment.worker_deployments.sink_readback.deployment_id_commitment],
        ["writer_a_route", report.deployment.routes.writer_a.route_id_commitment],
        ["writer_b_route", report.deployment.routes.writer_b.route_id_commitment],
        ["readback_route", report.deployment.routes.readback.route_id_commitment],
        ["access_application", report.deployment.access.application_commitment],
        ["access_policy", report.deployment.access.policy_commitment],
        ["access_service_token", report.deployment.access.service_token_commitment],
    ]);
    for (const [checkIndex, check] of report.cleanup.absence_checks.entries()) {
        const expectedCommitment = expectedCleanupCommitments.get(check.resource_kind);
        if (
            expectedCommitment !== check.resource_commitment ||
            expectedCommitment !== check.create_response_id_commitment ||
            expectedCommitment !== check.cleanup_target_id_commitment
        ) {
            context.addIssue({
                code: "custom",
                path: ["cleanup", "absence_checks", checkIndex, "resource_commitment"],
                message: "Cleanup checked a resource outside the recorded deployment",
            });
        }
    }
    const expectedScripts = new Map([
        ["writer_a", report.deployment.writer_a_script_commitment],
        ["writer_b", report.deployment.writer_b_script_commitment],
        ["sink_readback", report.deployment.sink_script_commitment],
    ]);
    if (
        report.cleanup.worker_script_deletions.some(
            deletion => expectedScripts.get(deletion.role) !== deletion.script_commitment
        )
    ) {
        context.addIssue({
            code: "custom",
            path: ["cleanup", "worker_script_deletions"],
            message: "Cleanup Worker script does not match the deployed script",
        });
    }
    const generatedNames = new Map(
        report.deployment.generated_names.resources.map(resource => [resource.resource_kind, resource])
    );
    if (
        report.cleanup.operator_database_deny_list_digest !==
            report.deployment.generated_names.operator_database_deny_list_digest ||
        report.cleanup.database_deny_list_check.operator_database_deny_list_digest !==
            report.deployment.generated_names.operator_database_deny_list_digest ||
        report.cleanup.database_deny_list_check.candidate_database_id_commitment !==
            report.deployment.database_id_commitment ||
        report.cleanup.generated_name_guards.some(guard => {
            const deployed = generatedNames.get(guard.resource_kind);
            return (
                deployed?.generated_name_commitment !== guard.generated_name_commitment ||
                deployed.lowercase_random_suffix_commitment !== guard.lowercase_random_suffix_commitment ||
                guard.safe_prefix_commitment !== report.deployment.generated_names.safe_prefix_commitment
            );
        })
    ) {
        context.addIssue({
            code: "custom",
            path: ["cleanup", "generated_name_guards"],
            message: "Cleanup name and deny-list guards do not match the trusted deployment",
        });
    }
}

function refineD1CleanupBindings(
    report: {
        final_observation_set_commitment: string;
        cleanup: z.infer<typeof D1CleanupObservationV1Schema>;
        observations: {
            trial_executions: ReadonlyArray<{
                trial_id: string;
                writer_results: ReadonlyArray<{
                    request_id_commitment: string;
                    request_content_commitment: string;
                }>;
                decisive_reads: ReadonlyArray<z.infer<typeof D1DecisiveReadV1Schema>>;
            }>;
            capacity?: { operations: ReadonlyArray<z.infer<typeof CapacityOperationV1Schema>> };
            audit?: { operations: ReadonlyArray<z.infer<typeof AuditOperationV1Schema>> };
        };
    },
    context: z.RefinementCtx
): void {
    const operations = [
        ...(report.observations.capacity?.operations ?? []),
        ...(report.observations.audit?.operations ?? []),
    ];
    const expectedRequestIds = [
        ...new Set([
            ...report.observations.trial_executions.flatMap(trial =>
                trial.writer_results.map(result => result.request_id_commitment)
            ),
            ...operations.map(operation => operation.request_id_commitment),
        ]),
    ].sort();
    const expectedRequestContents = [
        ...new Set([
            ...report.observations.trial_executions.flatMap(trial =>
                trial.writer_results.map(result => result.request_content_commitment)
            ),
            ...operations.map(operation => operation.request_content_commitment),
        ]),
    ].sort();
    if (
        JSON.stringify([...report.cleanup.in_flight_requests.started_request_id_commitments].sort()) !==
            JSON.stringify(expectedRequestIds) ||
        JSON.stringify([...report.cleanup.in_flight_requests.settled_request_id_commitments].sort()) !==
            JSON.stringify(expectedRequestIds) ||
        JSON.stringify([...report.cleanup.in_flight_requests.request_content_commitments].sort()) !==
            JSON.stringify(expectedRequestContents)
    ) {
        context.addIssue({
            code: "custom",
            path: ["cleanup", "in_flight_requests"],
            message: "Cleanup in-flight IDs do not equal the report's exact request set",
        });
    }
    const trialSnapshot = (trialId: string) =>
        report.observations.trial_executions.find(trial => trial.trial_id === trialId)?.decisive_reads[0]?.snapshot;
    const expectedSnapshots =
        report.observations.capacity === undefined || report.observations.audit === undefined
            ? report.observations.trial_executions.map(trial => ({
                  case_key: trial.trial_id,
                  snapshot: trial.decisive_reads[0]?.snapshot,
              }))
            : ["create_first", "revoke_first", "equal_release_race", "equal_release_race_roles_swapped"]
                  .map(caseKey => ({ case_key: caseKey, snapshot: trialSnapshot(caseKey) }))
                  .concat([
                      {
                          case_key: "sandbox_capacity",
                          snapshot: report.observations.capacity.operations.find(
                              operation => operation.operation === "fifth_claim_after_release"
                          )?.fresh_first_primary_readback.snapshot,
                      },
                      {
                          case_key: "audit_head",
                          snapshot: report.observations.audit.operations.find(
                              operation => operation.operation === "wrong_previous_hash"
                          )?.fresh_first_primary_readback.snapshot,
                      },
                  ]);
    if (
        report.cleanup.final_first_primary_readback.observation_set_commitment !==
            report.final_observation_set_commitment ||
        JSON.stringify(report.cleanup.final_first_primary_readback.current_state_snapshots) !==
            JSON.stringify(expectedSnapshots)
    ) {
        context.addIssue({
            code: "custom",
            path: ["cleanup", "final_first_primary_readback"],
            message: "Cleanup final readback is not bound to the report's exact snapshot set",
        });
    }
}

function refineD1GuardedCreateReport(
    report: {
        checks: readonly ProbeCheckObservationV1[];
        observations: z.infer<typeof D1GuardedCreateObservationsV1Schema>;
    },
    context: z.RefinementCtx
): void {
    const trialExecutions = new Map(
        report.observations.trial_executions.map(trial => [
            trial.trial_id,
            {
                observation_commitment: trial.observation_commitment,
                request_set_commitment: trial.request_set_commitment,
            },
        ])
    );
    const executionResults = new Map(
        report.observations.trial_executions.map(trial => [trial.trial_id, trial.writer_results])
    );
    const executionsById = new Map(report.observations.trial_executions.map(trial => [trial.trial_id, trial]));
    const histories = new Map(report.observations.histories.map(history => [history.case, history]));
    for (const history of report.observations.histories) {
        if (trialExecutions.get(history.case)?.observation_commitment !== history.observation_commitment) {
            context.addIssue({
                code: "custom",
                path: ["observations", "histories"],
                message: "Guarded history is not bound to its trial execution",
            });
        }
        const results = executionResults.get(history.case);
        const createResult = results?.find(result => result.batch_operation === "guarded_create");
        const revokeResult = results?.find(result => result.batch_operation === "grant_revoke");
        const outcomesMatch =
            history.observed_history === "create_before_revoke"
                ? createResult?.outcome === "committed" && revokeResult?.outcome === "committed"
                : history.observed_history === "revoke_before_create"
                  ? createResult?.outcome === "recognized_guard_denial" && revokeResult?.outcome === "committed"
                  : false;
        if (!outcomesMatch) {
            context.addIssue({
                code: "custom",
                path: ["observations", "histories"],
                message: "Guarded history does not match its committed and denied batches",
            });
        }
        const snapshot = executionsById.get(history.case)?.decisive_reads[0]?.snapshot;
        if (
            snapshot?.kind !== "guarded_history" ||
            snapshot.authority_state !== history.authority_state ||
            snapshot.confirmation_state !== history.confirmation_state ||
            snapshot.live_confirmation_slot !== history.live_confirmation_slot ||
            snapshot.run_rows !== history.run_rows ||
            snapshot.assertion_rows !== history.assertion_rows ||
            snapshot.cancellation_requested_rows !== history.cancellation_requested_rows ||
            snapshot.cancellation_outbox_rows !== history.cancellation_outbox_rows
        ) {
            context.addIssue({
                code: "custom",
                path: ["observations", "histories"],
                message: "Guarded summary does not match its decisive first-primary snapshot",
            });
        }
        if (revokeResult?.outcome === "committed") {
            const expectedRevokeCounts =
                history.observed_history === "create_before_revoke" ? [1, 0, 0, 1, 1] : [1, 1, 1, 0, 0];
            if (
                revokeResult.statement_results.some(
                    (statement, index) => statement.expected_returning_row_count !== expectedRevokeCounts[index]
                )
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", "trial_executions"],
                    message: "Grant revocation RETURNING cardinality does not match the observed legal history",
                });
            }
        }
    }
    if (
        trialExecutions.get("sandbox_capacity_contention")?.observation_commitment !==
            report.observations.capacity.contention_observation_commitment ||
        trialExecutions.get("destroy_observed_capacity_release")?.observation_commitment !==
            report.observations.capacity.release_observation_commitment ||
        trialExecutions.get("audit_head_contention")?.observation_commitment !==
            report.observations.audit.observation_commitment
    ) {
        context.addIssue({
            code: "custom",
            path: ["observations", "trial_executions"],
            message: "D1 summary observation is not bound to its trial execution",
        });
    }
    const createFirst = histories.get("create_first");
    if (
        checkPassed(report.checks, "create_linearizes_first") &&
        (createFirst === undefined || !guardedHistoryIs(createFirst, "create_before_revoke"))
    ) {
        addPassedCheckIssue(context, "create_linearizes_first");
    }
    const revokeFirst = histories.get("revoke_first");
    if (
        checkPassed(report.checks, "revoke_linearizes_first") &&
        (revokeFirst === undefined || !guardedHistoryIs(revokeFirst, "revoke_before_create"))
    ) {
        addPassedCheckIssue(context, "revoke_linearizes_first");
    }
    if (checkPassed(report.checks, "concurrent_history_is_legal")) {
        for (const raceCase of ["equal_release_race", "equal_release_race_roles_swapped"] as const) {
            const history = histories.get(raceCase);
            if (
                history === undefined ||
                (history.observed_history !== "create_before_revoke" &&
                    history.observed_history !== "revoke_before_create") ||
                !guardedHistoryIs(history, history.observed_history)
            ) {
                addPassedCheckIssue(context, "concurrent_history_is_legal");
                break;
            }
        }
    }
    const capacity = report.observations.capacity;
    const contentionSnapshot = executionsById.get("sandbox_capacity_contention")?.decisive_reads[0]?.snapshot;
    const releaseSnapshot = executionsById.get("destroy_observed_capacity_release")?.decisive_reads[0]?.snapshot;
    if (
        contentionSnapshot?.kind !== "capacity" ||
        contentionSnapshot.reserved !== 4 ||
        contentionSnapshot.active_claims !== 4 ||
        contentionSnapshot.released_claims !== 0 ||
        contentionSnapshot.destroy_observations !== 0 ||
        contentionSnapshot.fifth_claim_committed ||
        releaseSnapshot?.kind !== "capacity" ||
        releaseSnapshot.reserved !== capacity.reserved_after_fifth_claim ||
        releaseSnapshot.active_claims !== 4 ||
        releaseSnapshot.released_claims !== 1 ||
        releaseSnapshot.destroy_observations !== 1 ||
        !releaseSnapshot.fifth_claim_committed
    ) {
        context.addIssue({
            code: "custom",
            path: ["observations", "capacity"],
            message: "Capacity summary does not match its decisive first-primary snapshots",
        });
    }
    if (
        checkPassed(report.checks, "sandbox_capacity_contention") &&
        !(capacity.contenders === 5 && capacity.committed_claims === 4 && capacity.denied_claims === 1)
    ) {
        addPassedCheckIssue(context, "sandbox_capacity_contention");
    }
    if (
        checkPassed(report.checks, "destroy_observed_capacity_release") &&
        !(
            capacity.releases_before_destroy_observation === 0 &&
            capacity.releases_after_exact_destroy_observation === 1 &&
            capacity.wrong_target_releases.length === 6 &&
            capacity.wrong_target_releases.every(release => release.attempts === 1 && release.state_changes === 0) &&
            capacity.release_replay_attempts === 1 &&
            capacity.release_replay_state_changes === 0 &&
            capacity.fifth_claim_after_release_commits === 1 &&
            capacity.reserved_after_fifth_claim === 4
        )
    ) {
        addPassedCheckIssue(context, "destroy_observed_capacity_release");
    }
    const capacityOperations = new Map<string, (typeof capacity.operations)[number]>(
        capacity.operations.map(operation => [operation.operation, operation])
    );
    const exactClaimBinding = {
        installation_id_commitment: capacity.exact_release_target.installation_id_commitment,
        run_id_commitment: capacity.exact_release_target.run_id_commitment,
        run_attempt_fence: capacity.exact_release_target.run_attempt_fence,
        claim_id_commitment: capacity.exact_release_target.claim_id_commitment,
        sandbox_id_commitment: capacity.exact_release_target.sandbox_id_commitment,
    };
    const contentionTrial = executionsById.get("sandbox_capacity_contention");
    const releaseTrial = executionsById.get("destroy_observed_capacity_release");
    const destroyWriter = releaseTrial?.writer_results.find(result => result.batch_operation === "destroy_observation");
    const releaseWriter = releaseTrial?.writer_results.find(result => result.batch_operation === "capacity_release");
    const recordedDestroy = capacityOperations.get("record_exact_destroy");
    const recordedRelease = capacityOperations.get("release_exact_destroy");
    if (
        !contentionTrial?.writer_results.some(
            result =>
                result.outcome === "committed" &&
                JSON.stringify(result.capacity_claim_binding) === JSON.stringify(exactClaimBinding)
        ) ||
        JSON.stringify(destroyWriter?.capacity_release_binding) !== JSON.stringify(capacity.exact_release_target) ||
        JSON.stringify(releaseWriter?.capacity_release_binding) !== JSON.stringify(capacity.exact_release_target) ||
        destroyWriter?.request_id_commitment !== recordedDestroy?.request_id_commitment ||
        destroyWriter?.request_content_commitment !== recordedDestroy?.request_content_commitment ||
        destroyWriter?.writer_role !== recordedDestroy?.writer_role ||
        destroyWriter?.outcome !== "committed" ||
        recordedDestroy?.outcome !== "committed" ||
        destroyWriter.bookmark_commitment !== recordedDestroy.bookmark_commitment ||
        destroyWriter.writer_receipt_identity_commitment !== recordedDestroy.writer_receipt_identity_commitment ||
        releaseWriter?.request_id_commitment !== recordedRelease?.request_id_commitment ||
        releaseWriter?.request_content_commitment !== recordedRelease?.request_content_commitment ||
        releaseWriter?.writer_role !== recordedRelease?.writer_role ||
        releaseWriter?.outcome !== "committed" ||
        recordedRelease?.outcome !== "committed" ||
        releaseWriter.bookmark_commitment !== recordedRelease.bookmark_commitment ||
        releaseWriter.writer_receipt_identity_commitment !== recordedRelease.writer_receipt_identity_commitment
    ) {
        context.addIssue({
            code: "custom",
            path: ["observations", "capacity", "exact_release_target"],
            message: "Capacity release target must bind the committed claim, destroy, and release requests",
        });
    }
    const capacityTargetFields = [
        "installation_id_commitment",
        "run_id_commitment",
        "run_attempt_fence",
        "claim_id_commitment",
        "sandbox_id_commitment",
        "destroy_observation_id_commitment",
        "destroy_receipt_commitment",
    ] as const;
    const wrongCapacityTargetField = new Map<string, (typeof capacityTargetFields)[number]>([
        ["release_wrong_installation", "installation_id_commitment"],
        ["release_wrong_run", "run_id_commitment"],
        ["release_wrong_fence", "run_attempt_fence"],
        ["release_wrong_claim", "claim_id_commitment"],
        ["release_wrong_sandbox", "sandbox_id_commitment"],
        ["release_wrong_receipt", "destroy_receipt_commitment"],
    ]);
    for (const operation of capacity.operations) {
        const snapshot = operation.fresh_first_primary_readback.snapshot;
        if (snapshot.kind !== "capacity") continue;
        const beforeDestroy = operation.operation === "release_before_destroy";
        const afterRelease =
            operation.operation === "release_exact_destroy" || operation.operation === "release_replay";
        const afterReclaim = operation.operation === "fifth_claim_after_release";
        const expected = beforeDestroy
            ? [4, 4, 0, 0, false]
            : afterReclaim
              ? [4, 4, 1, 1, true]
              : afterRelease
                ? [3, 3, 1, 1, false]
                : [4, 4, 0, 1, false];
        if (
            snapshot.reserved !== expected[0] ||
            snapshot.active_claims !== expected[1] ||
            snapshot.released_claims !== expected[2] ||
            snapshot.destroy_observations !== expected[3] ||
            snapshot.fifth_claim_committed !== expected[4]
        ) {
            context.addIssue({
                code: "custom",
                path: ["observations", "capacity", "operations"],
                message: "Capacity operation snapshot contradicts its exact outcome",
            });
        }
        const substitutedFields = capacityTargetFields.filter(
            field => operation.target[field] !== capacity.exact_release_target[field]
        );
        const expectedSubstitution = wrongCapacityTargetField.get(operation.operation);
        if (
            (expectedSubstitution === undefined && substitutedFields.length !== 0) ||
            (expectedSubstitution !== undefined &&
                (substitutedFields.length !== 1 || substitutedFields[0] !== expectedSubstitution))
        ) {
            context.addIssue({
                code: "custom",
                path: ["observations", "capacity", "operations"],
                message: "Capacity operation must use the exact target or its one required substitution",
            });
        }
    }
    const wrongTargetOperation = new Map<string, string>([
        ["installation_id", "release_wrong_installation"],
        ["run_id", "release_wrong_run"],
        ["run_attempt_fence", "release_wrong_fence"],
        ["claim_id", "release_wrong_claim"],
        ["sandbox_id", "release_wrong_sandbox"],
        ["destroy_receipt", "release_wrong_receipt"],
    ]);
    if (
        capacity.wrong_target_releases.some(
            release =>
                capacityOperations.get(wrongTargetOperation.get(release.target) ?? "")?.outcome !== "guarded_denial"
        )
    ) {
        context.addIssue({
            code: "custom",
            path: ["observations", "capacity", "wrong_target_releases"],
            message: "Wrong-target release summary is not backed by its typed denial operation",
        });
    }
    const audit = report.observations.audit;
    const auditSnapshot = executionsById.get("audit_head_contention")?.decisive_reads[0]?.snapshot;
    if (
        auditSnapshot?.kind !== "audit" ||
        auditSnapshot.head_sequence !== 1 ||
        auditSnapshot.event_rows !== 1 ||
        !auditSnapshot.chain_verified ||
        auditSnapshot.head_event_split_observed
    ) {
        context.addIssue({
            code: "custom",
            path: ["observations", "audit"],
            message: "Audit contention summary does not match its decisive first-primary snapshot",
        });
    }
    if (
        checkPassed(report.checks, "audit_head_contention") &&
        !(
            audit.same_head_contenders === 2 &&
            audit.first_phase_commits === 1 &&
            audit.first_phase_conflicts === 1 &&
            audit.follow_up_commits === 1 &&
            audit.final_event_rows === 2 &&
            audit.final_head_sequence === 2 &&
            audit.final_chain_verified &&
            audit.stale_sequence_denied &&
            audit.gap_sequence_denied &&
            audit.wrong_previous_hash_denied &&
            !audit.head_event_split_observed
        )
    ) {
        addPassedCheckIssue(context, "audit_head_contention");
    }
    const auditOperations = new Map(audit.operations.map(operation => [operation.operation, operation]));
    const followUp = auditOperations.get("follow_up_append");
    const auditTrial = executionsById.get("audit_head_contention");
    const committedFirstPhase = auditTrial?.writer_results.find(result => result.outcome === "committed");
    const deniedFirstPhase = auditTrial?.writer_results.find(result => result.outcome === "recognized_guard_denial");
    const firstPhaseAttemptIds = auditTrial?.writer_results
        .flatMap(result => (result.audit_binding === null ? [] : [result.audit_binding.attempt_id_commitment]))
        .sort();
    if (
        followUp?.attempt_id_commitment !== audit.follow_up_attempt_id_commitment ||
        followUp?.writer_role !== deniedFirstPhase?.writer_role ||
        JSON.stringify(firstPhaseAttemptIds) !== JSON.stringify([...audit.first_phase_attempt_id_commitments].sort()) ||
        committedFirstPhase?.audit_binding?.previous_head_hash_commitment !== audit.initial_head_hash_commitment ||
        committedFirstPhase?.audit_binding?.event_hash_commitment !== audit.first_event_hash_commitment ||
        committedFirstPhase?.audit_binding?.expected_sequence !== 0 ||
        deniedFirstPhase?.audit_binding?.previous_head_hash_commitment !== audit.initial_head_hash_commitment ||
        deniedFirstPhase?.audit_binding?.expected_sequence !== 0 ||
        deniedFirstPhase.audit_binding.event_hash_commitment === audit.first_event_hash_commitment ||
        auditSnapshot?.kind !== "audit" ||
        auditSnapshot.head_hash_commitment !== audit.first_event_hash_commitment ||
        followUp?.expected_sequence !== 1 ||
        followUp.previous_head_hash_commitment !== audit.first_event_hash_commitment ||
        followUp.event_hash_commitment !== audit.final_head_hash_commitment ||
        auditOperations.get("stale_sequence")?.expected_sequence !== 1 ||
        auditOperations.get("stale_sequence")?.previous_head_hash_commitment !== audit.final_head_hash_commitment ||
        auditOperations.get("gap_sequence")?.expected_sequence !== 3 ||
        auditOperations.get("gap_sequence")?.previous_head_hash_commitment !== audit.final_head_hash_commitment ||
        auditOperations.get("wrong_previous_hash")?.expected_sequence !== 2 ||
        auditOperations.get("wrong_previous_hash")?.previous_head_hash_commitment ===
            audit.final_head_hash_commitment ||
        audit.operations.some(operation => {
            const snapshot = operation.fresh_first_primary_readback.snapshot;
            return (
                snapshot.kind !== "audit" ||
                snapshot.head_sequence !== 2 ||
                snapshot.event_rows !== 2 ||
                snapshot.head_hash_commitment !== audit.final_head_hash_commitment ||
                !snapshot.chain_verified ||
                snapshot.head_event_split_observed
            );
        })
    ) {
        context.addIssue({
            code: "custom",
            path: ["observations", "audit", "operations"],
            message: "Audit operation records do not match the final two-entry chain",
        });
    }
    refinePassedTranscriptBindings(
        report.checks,
        new Map([
            ["create_linearizes_first", [histories.get("create_first")!.observation_commitment]],
            ["revoke_linearizes_first", [histories.get("revoke_first")!.observation_commitment]],
            [
                "concurrent_history_is_legal",
                [
                    histories.get("equal_release_race")!.observation_commitment,
                    histories.get("equal_release_race_roles_swapped")!.observation_commitment,
                ],
            ],
            [
                "two_independent_writers",
                report.observations.trial_executions.map(trial => trial.observation_commitment),
            ],
            ["sandbox_capacity_contention", [capacity.contention_observation_commitment]],
            [
                "destroy_observed_capacity_release",
                [
                    capacity.release_observation_commitment,
                    ...capacity.operations.map(operation => operation.observation_commitment),
                ],
            ],
            [
                "audit_head_contention",
                [audit.observation_commitment, ...audit.operations.map(operation => operation.observation_commitment)],
            ],
        ]),
        context
    );
}

function gatewayNormalIsExact(observation: z.infer<typeof GatewayCallKindObservationV1Schema>): boolean {
    return (
        observation.normal.spent_reservations === 1 &&
        observation.normal.sink_receipts === 1 &&
        observation.normal.winning_dispatches === 1 &&
        observation.normal.losing_dispatches === 0
    );
}

function refineGatewayReservationReport(
    report: {
        checks: readonly ProbeCheckObservationV1[];
        deployment: z.infer<typeof D1DeploymentCommitmentV1Schema>;
        setup: z.infer<typeof D1SetupObservationV1Schema>;
        observations: z.infer<typeof GatewayReservationObservationsV1Schema>;
    },
    context: z.RefinementCtx
): void {
    const trialExecutions = new Map(report.observations.trial_executions.map(trial => [trial.trial_id, trial]));
    const observations = new Map(
        report.observations.call_kinds.map(observation => [observation.call_kind, observation])
    );
    for (const observation of report.observations.call_kinds) {
        for (const [scenario, scenarioObservation] of [
            ["normal", observation.normal],
            ["changed_digest", observation.changed_digest],
            ["reserve_then_crash", observation.reserve_then_crash],
            ["dispatch_response_lost", observation.dispatch_response_lost],
        ] as const) {
            const trial = trialExecutions.get(`${observation.call_kind}_${scenario}`);
            if (
                trial?.request_set_commitment !== scenarioObservation.request_set_commitment ||
                trial.observation_commitment !== scenarioObservation.observation_commitment ||
                JSON.stringify(trial.gateway_request_bindings) !==
                    JSON.stringify(scenarioObservation.competing_requests)
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", "call_kinds"],
                    message: "Gateway scenario is not bound to its trial requests and observation",
                });
            }
            if (
                trial === undefined ||
                scenarioObservation.competing_requests.some(binding => {
                    const writer = trial.writer_results.find(result => result.writer_role === binding.writer_role);
                    return (
                        writer?.request_id_commitment !== binding.request_id_commitment ||
                        writer.request_content_commitment !== binding.request_content_commitment
                    );
                })
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", "call_kinds"],
                    message: "Gateway request role and commitment do not match the writer result",
                });
            }
            if (scenario === "changed_digest" && trial !== undefined) {
                const exactBinding = scenarioObservation.competing_requests.find(
                    binding => binding.request_variant === "exact"
                );
                const substitutedBinding = scenarioObservation.competing_requests.find(
                    binding => binding.request_variant === "substituted"
                );
                const exactWriter = trial.writer_results.find(
                    result => result.writer_role === exactBinding?.writer_role
                );
                const substitutedWriter = trial.writer_results.find(
                    result => result.writer_role === substitutedBinding?.writer_role
                );
                if (exactWriter?.outcome !== "committed" || substitutedWriter?.outcome !== "recognized_guard_denial") {
                    context.addIssue({
                        code: "custom",
                        path: ["observations", "call_kinds"],
                        message: "Changed-digest contention must commit the exact request and deny the substitution",
                    });
                }
            }
            const snapshot = trial?.decisive_reads[0]?.snapshot;
            const expectedSnapshot =
                scenario === "normal"
                    ? ([1, 1, 1, 0, "committed"] as const)
                    : scenario === "changed_digest"
                      ? ([1, 1, 1, 0, "guarded_denial"] as const)
                      : scenario === "reserve_then_crash"
                        ? ([1, 0, 0, 0, "outcome_unknown"] as const)
                        : ([1, 1, 1, 0, "outcome_unknown"] as const);
            if (
                snapshot?.kind !== "gateway" ||
                snapshot.call_kind !== observation.call_kind ||
                snapshot.scenario !== scenario ||
                snapshot.spent_reservations !== expectedSnapshot[0] ||
                snapshot.sink_receipts !== expectedSnapshot[1] ||
                snapshot.winning_dispatches !== expectedSnapshot[2] ||
                snapshot.losing_dispatches !== expectedSnapshot[3] ||
                (scenario === "changed_digest" &&
                    snapshot.losing_dispatches !== scenarioObservation.substituted_request_dispatches) ||
                (scenario === "normal" &&
                    (snapshot.spent_reservations !== scenarioObservation.spent_reservations ||
                        snapshot.sink_receipts !== scenarioObservation.sink_receipts ||
                        snapshot.winning_dispatches !== scenarioObservation.winning_dispatches ||
                        snapshot.losing_dispatches !== scenarioObservation.losing_dispatches)) ||
                ((scenario === "reserve_then_crash" || scenario === "dispatch_response_lost") &&
                    (snapshot.spent_reservations !== scenarioObservation.spent_reservations ||
                        snapshot.sink_receipts !== scenarioObservation.sink_receipts ||
                        snapshot.result !== scenarioObservation.result)) ||
                snapshot.result !== expectedSnapshot[4]
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", "call_kinds"],
                    message: "Gateway summary does not match its decisive first-primary snapshot",
                });
            }
            const sinkRpc = scenarioObservation.sink_rpc;
            const dispatchingWriter =
                scenario === "reserve_then_crash"
                    ? undefined
                    : trial?.writer_results.find(result =>
                          scenario === "dispatch_response_lost"
                              ? result.outcome === "transport_outcome_unknown"
                              : result.outcome === "committed"
                      );
            const expectedBinding =
                dispatchingWriter?.writer_role === "writer_a"
                    ? report.deployment.sink_service_binding.writer_a_binding_config_digest
                    : dispatchingWriter?.writer_role === "writer_b"
                      ? report.deployment.sink_service_binding.writer_b_binding_config_digest
                      : null;
            const expectedRpcOutcome =
                scenario === "reserve_then_crash"
                    ? "not_invoked_before_fault"
                    : scenario === "dispatch_response_lost"
                      ? "awaited_response_lost"
                      : "awaited_response";
            if (
                sinkRpc.binding_configuration_observation_commitment !==
                    report.setup.sink_runtime.private_rpc_observation_commitment ||
                sinkRpc.target_script_commitment !== report.deployment.sink_script_commitment ||
                sinkRpc.rpc_outcome !== expectedRpcOutcome ||
                sinkRpc.writer_role !== (dispatchingWriter?.writer_role ?? null) ||
                sinkRpc.writer_binding_commitment !== expectedBinding ||
                sinkRpc.sink_receipt_identity_commitments.length !== expectedSnapshot[1] ||
                JSON.stringify(sinkRpc.sink_receipt_identity_commitments) !==
                    JSON.stringify(snapshot?.kind === "gateway" ? snapshot.sink_receipt_identity_commitments : []) ||
                sinkRpc.runtime_version_commitment !==
                    (scenario === "reserve_then_crash" ? null : report.deployment.sink_version_commitment)
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", "call_kinds", "sink_rpc"],
                    message: "Gateway sink RPC is not bound to the exact private service binding and receipt",
                });
            }
        }
    }
    for (const callKind of ["model", "provider_tool", "code"] as const) {
        const observation = observations.get(callKind);
        if (
            checkPassed(report.checks, `${callKind}_duplicate_sequence`) &&
            (observation === undefined || !gatewayNormalIsExact(observation))
        ) {
            addPassedCheckIssue(context, `${callKind}_duplicate_sequence`);
        }
    }
    if (
        checkPassed(report.checks, "one_outbound_request_per_kind") &&
        [...observations.values()].some(
            observation =>
                observation.normal.sink_receipts !== 1 ||
                observation.normal.winning_dispatches !== 1 ||
                observation.normal.losing_dispatches !== 0
        )
    ) {
        addPassedCheckIssue(context, "one_outbound_request_per_kind");
    }
    if (
        checkPassed(report.checks, "one_spent_reservation_per_kind") &&
        [...observations.values()].some(observation => observation.normal.spent_reservations !== 1)
    ) {
        addPassedCheckIssue(context, "one_spent_reservation_per_kind");
    }
    if (
        checkPassed(report.checks, "changed_digest_denied") &&
        [...observations.values()].some(observation => observation.changed_digest.substituted_request_dispatches !== 0)
    ) {
        addPassedCheckIssue(context, "changed_digest_denied");
    }
    if (
        checkPassed(report.checks, "reserve_then_crash_not_redispatched") &&
        [...observations.values()].some(
            observation =>
                observation.reserve_then_crash.spent_reservations !== 1 ||
                observation.reserve_then_crash.sink_receipts !== 0 ||
                observation.reserve_then_crash.result !== "outcome_unknown" ||
                observation.reserve_then_crash.retry_attempts !== 0
        )
    ) {
        addPassedCheckIssue(context, "reserve_then_crash_not_redispatched");
    }
    if (
        checkPassed(report.checks, "dispatch_response_lost_not_redispatched") &&
        [...observations.values()].some(
            observation =>
                observation.dispatch_response_lost.spent_reservations !== 1 ||
                observation.dispatch_response_lost.sink_receipts !== 1 ||
                observation.dispatch_response_lost.result !== "outcome_unknown" ||
                observation.dispatch_response_lost.retry_attempts !== 0
        )
    ) {
        addPassedCheckIssue(context, "dispatch_response_lost_not_redispatched");
    }
    const scenarioCommitments = (
        scenario: "changed_digest" | "dispatch_response_lost" | "normal" | "reserve_then_crash"
    ) => [
        report.setup.sink_runtime.private_rpc_observation_commitment,
        ...report.observations.call_kinds.flatMap(observation => [
            observation[scenario].observation_commitment,
            observation[scenario].sink_rpc.rpc_observation_commitment,
        ]),
    ];
    refinePassedTranscriptBindings(
        report.checks,
        new Map([
            [
                "model_duplicate_sequence",
                observations.get("model") === undefined
                    ? []
                    : [
                          observations.get("model")!.normal.observation_commitment,
                          observations.get("model")!.normal.sink_rpc.binding_configuration_observation_commitment,
                          observations.get("model")!.normal.sink_rpc.rpc_observation_commitment,
                      ],
            ],
            [
                "provider_tool_duplicate_sequence",
                observations.get("provider_tool") === undefined
                    ? []
                    : [
                          observations.get("provider_tool")!.normal.observation_commitment,
                          observations.get("provider_tool")!.normal.sink_rpc
                              .binding_configuration_observation_commitment,
                          observations.get("provider_tool")!.normal.sink_rpc.rpc_observation_commitment,
                      ],
            ],
            [
                "code_duplicate_sequence",
                observations.get("code") === undefined
                    ? []
                    : [
                          observations.get("code")!.normal.observation_commitment,
                          observations.get("code")!.normal.sink_rpc.binding_configuration_observation_commitment,
                          observations.get("code")!.normal.sink_rpc.rpc_observation_commitment,
                      ],
            ],
            ["one_outbound_request_per_kind", scenarioCommitments("normal")],
            ["one_spent_reservation_per_kind", scenarioCommitments("normal")],
            ["changed_digest_denied", scenarioCommitments("changed_digest")],
            ["reserve_then_crash_not_redispatched", scenarioCommitments("reserve_then_crash")],
            ["dispatch_response_lost_not_redispatched", scenarioCommitments("dispatch_response_lost")],
            [
                "two_independent_writers",
                [
                    ...report.observations.trial_executions.map(trial => trial.observation_commitment),
                    ...report.observations.call_kinds.flatMap(observation =>
                        [
                            observation.normal,
                            observation.changed_digest,
                            observation.reserve_then_crash,
                            observation.dispatch_response_lost,
                        ].map(scenario => scenario.sink_rpc.rpc_observation_commitment)
                    ),
                    report.setup.sink_runtime.private_rpc_observation_commitment,
                ],
            ],
        ]),
        context
    );
}

export const D1_GUARDED_CREATE_CHECK_IDS_V1 = [
    "revoke_linearizes_first",
    "create_linearizes_first",
    "concurrent_history_is_legal",
    "two_independent_writers",
    "sandbox_capacity_contention",
    "destroy_observed_capacity_release",
    "audit_head_contention",
] as const;
export const GATEWAY_RESERVATION_CHECK_IDS_V1 = [
    "model_duplicate_sequence",
    "provider_tool_duplicate_sequence",
    "code_duplicate_sequence",
    "one_outbound_request_per_kind",
    "one_spent_reservation_per_kind",
    "changed_digest_denied",
    "reserve_then_crash_not_redispatched",
    "dispatch_response_lost_not_redispatched",
    "two_independent_writers",
] as const;

export const UntrustedD1GuardedCreateProbeReportV1Schema = reportSchema(
    "d1_guarded_create",
    D1_GUARDED_CREATE_CHECK_IDS_V1,
    {
        collection_status: z.literal("complete"),
        check_set_version: z.literal(1),
        deployment_digest: Item2DigestV1Schema,
        final_observation_set_commitment: Item2DigestV1Schema,
        deployment: D1DeploymentCommitmentV1Schema,
        setup: D1SetupObservationV1Schema,
        cleanup: D1CleanupObservationV1Schema,
        observations: D1GuardedCreateObservationsV1Schema,
    },
    32
).superRefine((report, context) => {
    refineD1GuardedCreateReport(report as unknown as Parameters<typeof refineD1GuardedCreateReport>[0], context);
    refineD1TrialDeployment(report, context);
    refineD1CleanupBindings(report, context);
});
export const UntrustedGatewayReservationProbeReportV1Schema = reportSchema(
    "gateway_reservation",
    GATEWAY_RESERVATION_CHECK_IDS_V1,
    {
        collection_status: z.literal("complete"),
        check_set_version: z.literal(1),
        deployment_digest: Item2DigestV1Schema,
        final_observation_set_commitment: Item2DigestV1Schema,
        deployment: D1DeploymentCommitmentV1Schema,
        setup: D1SetupObservationV1Schema,
        cleanup: D1CleanupObservationV1Schema,
        observations: GatewayReservationObservationsV1Schema,
    },
    32
).superRefine((report, context) => {
    refineGatewayReservationReport(report as unknown as Parameters<typeof refineGatewayReservationReport>[0], context);
    refineD1TrialDeployment(report, context);
    refineD1CleanupBindings(report, context);
});
export const UntrustedMetorialProvisioningProbeReportV1Schema = reportSchema("metorial_provisioning", [
    "create_success",
    "ambiguous_create_reconciled",
    "repeat_does_not_duplicate",
] as const);
export const UntrustedMetorialCleanupProbeReportV1Schema = reportSchema("metorial_cleanup", [
    "openbot_gateway_denies_after_cleanup",
    "second_client_observation",
    "vendor_limit_recorded",
] as const);
export const UntrustedOpenRouterProbeReportV1Schema = reportSchema("openrouter_route", [
    "resolved_model",
    "resolved_provider",
    "routing_strategy_direct",
    "selected_endpoint",
    "attempt_count_equals_one",
    "every_sent_required_parameter_supported",
    "multiple_tool_calls_denied_before_tool_execution",
    "pipeline_has_no_compression_plugins_or_server_tools",
    "cache_hit_metadata_behavior",
    "generation_id",
    "zdr_enforced",
    "data_collection_denied",
    "usage",
    "cost",
    "fresh_price_snapshot",
    "run_owned_key_expiry",
    "run_owned_key_deletion",
    "budget_overshoot_behavior",
] as const);
export const UntrustedSandboxProbeReportV1Schema = reportSchema("sandbox_execution", [
    "package_image_match",
    "fixed_argv_launch",
    "enumerated_dns_sentinel_not_observed",
    "filesystem_limit",
    "process_limit",
    "startup_timeout",
    "execution_timeout_and_kill",
    "teardown_and_destroy",
    "repeat_destroy_safe",
    "sandbox_lifetime",
    "fresh_generation",
    "output_backpressure",
    "replacement_uncertainty",
    "placement",
    "installation_capacity",
    "private_route",
    "secret_sentinel",
    "mismatched_package_image_denial",
] as const);
export const UntrustedRuntimeWireProtocolProbeReportV1Schema = reportSchema("runtime_wire_protocol", [
    "private_byte_stream",
    "cancel",
    "replay_denial",
    "import_acknowledgement",
    "restart_to_outcome_unknown",
    "public_route_denial",
] as const);
export const UntrustedD1BetterAuthProbeReportV1Schema = reportSchema("d1_better_auth", [
    "bootstrap",
    "reset",
    "closed_registration",
    "request_scoped_construction",
    "session_rotation",
    "d1_storage",
] as const);
export const UntrustedJurisdictionProbeReportV1Schema = reportSchema("jurisdiction", [
    "d1_placement",
    "durable_object_placement",
    "sandbox_placement",
    "metorial_placement",
    "openrouter_placement",
] as const);

export const UntrustedD1CollectorFailureReportV1Schema = z
    .object({
        ...commonFields,
        kind: z.enum(["d1_guarded_create", "gateway_reservation"]),
        collection_status: z.enum(["inconclusive", "manual_required"]),
        failure_stage: z.enum(["setup", "trial", "readback", "cleanup"]),
        failure_code: z.enum([
            "timeout",
            "missing_response",
            "malformed_response",
            "unknown_platform_result",
            "worker_restart",
            "cleanup_ambiguity",
        ]),
        operator_action_required: z.literal(true),
        checks: z.array(z.never()).length(0),
    })
    .strict()
    .superRefine((report, context) => {
        if (!(report.observed_at <= report.completed_at && report.completed_at < report.valid_until)) {
            context.addIssue({ code: "custom", path: ["completed_at"], message: "Probe timestamps are invalid" });
        }
        if (report.valid_until - report.completed_at > ITEM2_MAX_REPORT_TTL_MS_V1) {
            context.addIssue({ code: "custom", path: ["valid_until"], message: "Probe report TTL exceeds 24 hours" });
        }
        if ((report.failure_stage === "cleanup") !== (report.collection_status === "manual_required")) {
            context.addIssue({
                code: "custom",
                path: ["collection_status"],
                message: "Cleanup ambiguity requires manual intervention; other collector failures are inconclusive",
            });
        }
    });

export const UntrustedItem2ProbeReportV1Schema = z.union([
    UntrustedConnectorProbeReportV1Schema,
    UntrustedD1GuardedCreateProbeReportV1Schema,
    UntrustedGatewayReservationProbeReportV1Schema,
    UntrustedMetorialProvisioningProbeReportV1Schema,
    UntrustedMetorialCleanupProbeReportV1Schema,
    UntrustedOpenRouterProbeReportV1Schema,
    UntrustedSandboxProbeReportV1Schema,
    UntrustedRuntimeWireProtocolProbeReportV1Schema,
    UntrustedD1BetterAuthProbeReportV1Schema,
    UntrustedJurisdictionProbeReportV1Schema,
    UntrustedD1CollectorFailureReportV1Schema,
]);
export type UntrustedItem2ProbeReportV1 = z.infer<typeof UntrustedItem2ProbeReportV1Schema>;

export type UntrustedProbeReportDenialV1 =
    "invalid_probe_report" | "future_probe_report" | "report_digest_mismatch" | "digest_unavailable";

export const parseUntrustedItem2ProbeReportV1 = (
    input: unknown,
    options: { as_of_ms: number }
):
    | { success: true; report: UntrustedItem2ProbeReportV1 }
    | { success: false; code: "invalid_probe_report" | "future_probe_report" } => {
    if (!Number.isSafeInteger(options.as_of_ms) || options.as_of_ms < 0) {
        return { success: false, code: "invalid_probe_report" };
    }
    let parsed: ReturnType<typeof UntrustedItem2ProbeReportV1Schema.safeParse>;
    try {
        parsed = UntrustedItem2ProbeReportV1Schema.safeParse(input);
    } catch {
        return { success: false, code: "invalid_probe_report" };
    }
    if (!parsed.success) return { success: false, code: "invalid_probe_report" };
    if (parsed.data.observed_at > options.as_of_ms || parsed.data.completed_at > options.as_of_ms) {
        return { success: false, code: "future_probe_report" };
    }
    return { success: true, report: parsed.data };
};
