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

const checkResult = <T extends z.ZodType<string>>(checkId: T) =>
    z
        .object({
            check_id: checkId,
            outcome: UntrustedProbeOutcomeV1Schema,
            transcript_commitments: z.array(UntrustedRedactedTranscriptCommitmentV1Schema).max(8),
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
    extraFields: V = {} as V
) => {
    const checkId = z.enum(checkIds);
    return z
        .object({
            ...commonFields,
            ...extraFields,
            kind: z.literal(kind),
            checks: z
                .array(checkResult(checkId))
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

const D1DeploymentCommitmentV1Schema = z
    .object({
        platform: z.literal("cloudflare_d1_deployed"),
        database_id_commitment: Item2DigestV1Schema,
        writer_a_database_id_commitment: Item2DigestV1Schema,
        writer_b_database_id_commitment: Item2DigestV1Schema,
        sink_database_id_commitment: Item2DigestV1Schema,
        compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        read_replication_enabled: z.literal(true),
        read_replication_setting_digest: Item2DigestV1Schema,
        served_by_primary_observed: z.literal(true),
        writer_a_script_commitment: Item2DigestV1Schema,
        writer_a_version_commitment: Item2DigestV1Schema,
        writer_b_script_commitment: Item2DigestV1Schema,
        writer_b_version_commitment: Item2DigestV1Schema,
        sink_script_commitment: Item2DigestV1Schema,
        sink_version_commitment: Item2DigestV1Schema,
        first_primary_decisive_readback: z.literal(true),
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
    });

const BoundedProbeCountV1Schema = z.number().int().nonnegative().max(64);
const GuardedHistoryObservationV1Schema = z
    .object({
        case: z.enum(["create_first", "revoke_first", "equal_release_race", "equal_release_race_roles_swapped"]),
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
        histories: z
            .array(GuardedHistoryObservationV1Schema)
            .length(4)
            .refine(values => new Set(values.map(value => value.case)).size === 4, "History cases must be unique"),
        capacity: z
            .object({
                contenders: BoundedProbeCountV1Schema,
                committed_claims: BoundedProbeCountV1Schema,
                denied_claims: BoundedProbeCountV1Schema,
                releases_before_destroy_observation: BoundedProbeCountV1Schema,
                releases_after_exact_destroy_observation: BoundedProbeCountV1Schema,
                duplicate_release_state_changes: BoundedProbeCountV1Schema,
            })
            .strict(),
        audit: z
            .object({
                same_head_contenders: BoundedProbeCountV1Schema,
                first_phase_commits: BoundedProbeCountV1Schema,
                first_phase_conflicts: BoundedProbeCountV1Schema,
                follow_up_commits: BoundedProbeCountV1Schema,
                final_event_rows: BoundedProbeCountV1Schema,
                final_head_sequence: BoundedProbeCountV1Schema,
                final_chain_verified: z.boolean(),
            })
            .strict(),
    })
    .strict();

const GatewayCallKindObservationV1Schema = z
    .object({
        call_kind: z.enum(["model", "provider_tool", "code"]),
        normal: z
            .object({
                spent_reservations: BoundedProbeCountV1Schema,
                sink_receipts: BoundedProbeCountV1Schema,
                winning_dispatches: BoundedProbeCountV1Schema,
                losing_dispatches: BoundedProbeCountV1Schema,
            })
            .strict(),
        changed_digest: z.object({ dispatches: BoundedProbeCountV1Schema }).strict(),
        reserve_then_crash: z
            .object({
                spent_reservations: BoundedProbeCountV1Schema,
                sink_receipts: BoundedProbeCountV1Schema,
                result: z.enum(["outcome_unknown", "inconclusive", "invalid"]),
                retry_attempts: BoundedProbeCountV1Schema,
            })
            .strict(),
        dispatch_response_lost: z
            .object({
                spent_reservations: BoundedProbeCountV1Schema,
                sink_receipts: BoundedProbeCountV1Schema,
                result: z.enum(["outcome_unknown", "inconclusive", "invalid"]),
                retry_attempts: BoundedProbeCountV1Schema,
            })
            .strict(),
    })
    .strict();
const GatewayReservationObservationsV1Schema = z
    .object({
        call_kinds: z
            .array(GatewayCallKindObservationV1Schema)
            .length(3)
            .refine(values => new Set(values.map(value => value.call_kind)).size === 3, "Call kinds must be unique"),
    })
    .strict();

type ProbeCheckObservationV1 = {
    check_id: string;
    outcome: z.infer<typeof UntrustedProbeOutcomeV1Schema>;
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

function refineD1GuardedCreateReport(
    report: {
        checks: readonly ProbeCheckObservationV1[];
        observations: z.infer<typeof D1GuardedCreateObservationsV1Schema>;
    },
    context: z.RefinementCtx
): void {
    const histories = new Map(report.observations.histories.map(history => [history.case, history]));
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
            capacity.duplicate_release_state_changes === 0
        )
    ) {
        addPassedCheckIssue(context, "destroy_observed_capacity_release");
    }
    const audit = report.observations.audit;
    if (
        checkPassed(report.checks, "audit_head_contention") &&
        !(
            audit.same_head_contenders === 2 &&
            audit.first_phase_commits === 1 &&
            audit.first_phase_conflicts === 1 &&
            audit.follow_up_commits === 1 &&
            audit.final_event_rows === 2 &&
            audit.final_head_sequence === 2 &&
            audit.final_chain_verified
        )
    ) {
        addPassedCheckIssue(context, "audit_head_contention");
    }
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
        observations: z.infer<typeof GatewayReservationObservationsV1Schema>;
    },
    context: z.RefinementCtx
): void {
    const observations = new Map(
        report.observations.call_kinds.map(observation => [observation.call_kind, observation])
    );
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
        [...observations.values()].some(observation => observation.changed_digest.dispatches !== 0)
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
        deployment: D1DeploymentCommitmentV1Schema,
        observations: D1GuardedCreateObservationsV1Schema,
    }
).superRefine((report, context) => {
    refineD1GuardedCreateReport(report as unknown as Parameters<typeof refineD1GuardedCreateReport>[0], context);
});
export const UntrustedGatewayReservationProbeReportV1Schema = reportSchema(
    "gateway_reservation",
    GATEWAY_RESERVATION_CHECK_IDS_V1,
    {
        deployment: D1DeploymentCommitmentV1Schema,
        observations: GatewayReservationObservationsV1Schema,
    }
).superRefine((report, context) => {
    refineGatewayReservationReport(report as unknown as Parameters<typeof refineGatewayReservationReport>[0], context);
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

export const UntrustedItem2ProbeReportV1Schema = z.discriminatedUnion("kind", [
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
