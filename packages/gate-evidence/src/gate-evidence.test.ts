import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspectRecordedItem2BlockersV1, RECORDED_ITEM2_CORE_BLOCKERS_V1 } from "./blockers.js";
import {
    assessD1ProbeReportForOperatorReviewV1,
    digestD1DeploymentCommitmentV1,
    digestD1FinalObservationSetV1,
} from "./adjudicate.js";
import {
    canonicalUntrustedProbeReportBytesV1,
    digestUntrustedProbeReportV1,
    inspectUntrustedProbeReportIntegrityV1,
} from "./canonical.js";
import {
    CONNECTOR_COMMON_CHECK_IDS_V1,
    D1_GATEWAY_TRIAL_IDS_V1,
    D1_GUARDED_TRIAL_IDS_V1,
    D1_GUARDED_CREATE_CHECK_IDS_V1,
    GATEWAY_RESERVATION_CHECK_IDS_V1,
    ITEM2_MAX_REPORT_TTL_MS_V1,
    UntrustedConnectorProbeReportV1Schema,
    UntrustedD1GuardedCreateProbeReportV1Schema,
    UntrustedGatewayReservationProbeReportV1Schema,
} from "./contracts.js";

const hex = (character: string): string => character.repeat(64);
const observedAt = 1_000;
const completedAt = 2_000;
const validUntil = 3_000;
const asOf = 2_500;

const common = {
    schema_version: 1 as const,
    report_digest: hex("0"),
    configuration_digest: hex("1"),
    installation_digest: hex("2"),
    environment_digest: hex("3"),
    probe_definition_digest: hex("4"),
    collector_build_digest: hex("5"),
    probe_run_digest: hex("6"),
    commitment_key_id_digest: hex("7"),
    redaction_version: 1 as const,
    observed_at: observedAt,
    completed_at: completedAt,
    valid_until: validUntil,
};

const transcript = (checkId: string, index: number, gateId = "first_connector", observationCommitment = hex("9")) => ({
    commitment_algorithm: "hmac-sha256-v1" as const,
    commitment_key_id_digest: common.commitment_key_id_digest,
    reference_commitment: index.toString(16).padStart(64, "0"),
    gate_id: gateId,
    check_id: checkId,
    configuration_digest: common.configuration_digest,
    installation_digest: common.installation_digest,
    environment_digest: common.environment_digest,
    probe_run_digest: common.probe_run_digest,
    observed_at: observedAt + index,
    request_commitment: hex("7"),
    response_commitment: hex("8"),
    observation_commitment: observationCommitment,
    redacted_fields: ["authorization"] as const,
});

const checks = (
    ids: readonly string[],
    gateId = "first_connector",
    observationsByCheck: Readonly<Record<string, readonly string[]>> = {}
) => {
    let referenceIndex = 0;
    return ids.map(check_id => ({
        check_id,
        outcome: "passed" as const,
        transcript_commitments: (observationsByCheck[check_id] ?? [hex("9")]).map(observationCommitment =>
            transcript(check_id, ++referenceIndex, gateId, observationCommitment)
        ),
    }));
};

const setCheckOutcome = (
    report: { checks: Array<{ check_id: string }> },
    checkId: string,
    outcome: "failed" | "inconclusive"
): void => {
    const check = report.checks.find(candidate => candidate.check_id === checkId);
    if (check === undefined) throw new Error(`Missing test check ${checkId}`);
    Object.assign(check, { outcome });
};

const d1Deployment = () => ({
    platform: "cloudflare_d1_deployed" as const,
    identity_commitment_spec: {
        commitment_algorithm: "hmac-sha256-v1" as const,
        commitment_key_id_digest: common.commitment_key_id_digest,
        role_in_preimage: false as const,
        domains: {
            account_id: "openbot.identity.cloudflare_account_id.v1" as const,
            zone_id: "openbot.identity.cloudflare_zone_id.v1" as const,
            database_id: "openbot.identity.cloudflare_d1_database_id.v1" as const,
            worker_script_id: "openbot.identity.cloudflare_worker_script_id.v1" as const,
            worker_version_id: "openbot.identity.cloudflare_worker_version_id.v1" as const,
            worker_deployment_id: "openbot.identity.cloudflare_worker_deployment_id.v1" as const,
            route_id: "openbot.identity.cloudflare_worker_route_id.v1" as const,
            route_pattern: "openbot.identity.cloudflare_worker_route_pattern.v1" as const,
            access_application_id: "openbot.identity.cloudflare_access_application_id.v1" as const,
            access_policy_id: "openbot.identity.cloudflare_access_policy_id.v1" as const,
            access_service_token_id: "openbot.identity.cloudflare_access_service_token_id.v1" as const,
        },
    },
    account_identity: {
        commitment_algorithm: "hmac-sha256-v1" as const,
        identity_type: "cloudflare_account_id" as const,
        commitment_domain: "openbot.identity.cloudflare_account_id.v1" as const,
        commitment_key_id_digest: common.commitment_key_id_digest,
        identity_commitment: hex("1"),
        synthetic: false as const,
    },
    zone_identity: {
        commitment_algorithm: "hmac-sha256-v1" as const,
        identity_type: "cloudflare_zone_id" as const,
        commitment_domain: "openbot.identity.cloudflare_zone_id.v1" as const,
        commitment_key_id_digest: common.commitment_key_id_digest,
        identity_commitment: hex("2"),
        synthetic: false as const,
    },
    wrangler_version: "4.33.1",
    database_id_commitment: hex("a"),
    writer_a_database_id_commitment: hex("a"),
    writer_b_database_id_commitment: hex("a"),
    sink_database_id_commitment: hex("a"),
    compatibility_date: "2026-08-22",
    read_replication_enabled: true as const,
    read_replication_setting_digest: hex("b"),
    writer_a_script_commitment: hex("c"),
    writer_a_version_commitment: hex("d"),
    writer_b_script_commitment: hex("e"),
    writer_b_version_commitment: hex("f"),
    sink_script_commitment: hex("8"),
    sink_version_commitment: hex("9"),
    worker_deployments: {
        writer_a: {
            script_commitment: hex("c"),
            version_commitment: hex("d"),
            deployment_id_commitment: hex("1"),
        },
        writer_b: {
            script_commitment: hex("e"),
            version_commitment: hex("f"),
            deployment_id_commitment: hex("3"),
        },
        sink_readback: {
            script_commitment: hex("8"),
            version_commitment: hex("9"),
            deployment_id_commitment: hex("5"),
        },
    },
    routes: {
        writer_a: {
            route_id_commitment: hex("7"),
            exact_pattern_commitment: hex("a"),
            target_script_commitment: hex("c"),
        },
        writer_b: {
            route_id_commitment: hex("8"),
            exact_pattern_commitment: hex("c"),
            target_script_commitment: hex("e"),
        },
        readback: {
            route_id_commitment: hex("9"),
            exact_pattern_commitment: hex("b"),
            target_script_commitment: hex("8"),
            allowed_method: "GET" as const,
            allowed_endpoint_contract_digest: hex("6"),
        },
        workers_dev: false as const,
        preview_urls: false as const,
    },
    access: {
        application_commitment: hex("1"),
        policy_commitment: hex("2"),
        service_token_commitment: hex("7"),
    },
    generated_names: {
        safe_prefix_commitment: hex("4"),
        operator_database_deny_list_digest: hex("5"),
        resources: [
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
        ].map((resource_kind, index) => ({
            resource_kind,
            generated_name_commitment: (900 + index).toString(16).padStart(64, "0"),
            lowercase_random_suffix_commitment: (920 + index).toString(16).padStart(64, "0"),
        })),
    },
    sink_service_binding: {
        writer_a_binding_config_digest: hex("a"),
        writer_b_binding_config_digest: hex("b"),
        writer_a_target_script_commitment: hex("8"),
        writer_b_target_script_commitment: hex("8"),
        binding_name_commitment: hex("c"),
        sink_active_version_count: 1 as const,
        sink_active_version_traffic_percent: 100 as const,
    },
});

const d1ResultMetadata = (index: number, returningRowCount = 1) => ({
    success: true as const,
    changes: 1,
    rows_read: 1,
    rows_written: 1,
    changed_db: true,
    served_by_primary: true as const,
    served_by: "cloudflare-primary",
    served_by_region: "WNAM",
    duration: 1,
    timings: { sql_duration_ms: 1 },
    total_attempts: 2,
    last_row_id: null,
    size_after: 4_096,
    returning_row_count: returningRowCount,
    returning_identity_commitments: returningRowCount === 0 ? [] : [index.toString(16).padStart(64, "0")],
});

const d1ReadMetadata = (index: number, servedByPrimary: boolean | true = true) => ({
    ...d1ResultMetadata(index),
    changes: 0 as const,
    rows_written: 0 as const,
    changed_db: false as const,
    served_by_primary: servedByPrimary,
});

const d1BatchStatements = {
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

const d1TrialCommitment = (trialId: string, offset = 0): string => {
    const trialIds: readonly string[] = [...D1_GUARDED_TRIAL_IDS_V1, ...D1_GATEWAY_TRIAL_IDS_V1];
    return (trialIds.indexOf(trialId) + 1 + offset).toString(16).padStart(64, "0");
};

const guardedTrialWriterCommitment = (trialId: string, childIndex: number, offset: number): string =>
    ((D1_GUARDED_TRIAL_IDS_V1 as readonly string[]).indexOf(trialId) * 8 + childIndex + offset)
        .toString(16)
        .padStart(64, "0");

const d1TrialSnapshot = (trialId: string) => {
    if (D1_GATEWAY_TRIAL_IDS_V1.includes(trialId as (typeof D1_GATEWAY_TRIAL_IDS_V1)[number])) {
        const call_kind = trialId.startsWith("provider_tool_")
            ? ("provider_tool" as const)
            : trialId.startsWith("code_")
              ? ("code" as const)
              : ("model" as const);
        const scenario = trialId.slice(`${call_kind}_`.length) as
            "changed_digest" | "dispatch_response_lost" | "normal" | "reserve_then_crash";
        return {
            kind: "gateway" as const,
            call_kind,
            scenario,
            spent_reservations: 1,
            sink_receipts: scenario === "reserve_then_crash" ? 0 : 1,
            sink_receipt_identity_commitments:
                scenario === "reserve_then_crash" ? [] : [d1TrialCommitment(trialId, 120)],
            winning_dispatches: scenario === "reserve_then_crash" ? 0 : 1,
            losing_dispatches: 0,
            result:
                scenario === "normal"
                    ? ("committed" as const)
                    : scenario === "changed_digest"
                      ? ("guarded_denial" as const)
                      : ("outcome_unknown" as const),
        };
    }
    if (trialId === "sandbox_capacity_contention") {
        return {
            kind: "capacity" as const,
            reserved: 4,
            active_claims: 4,
            released_claims: 0,
            destroy_observations: 0,
            fifth_claim_committed: false,
        };
    }
    if (trialId === "destroy_observed_capacity_release") {
        return {
            kind: "capacity" as const,
            reserved: 4,
            active_claims: 4,
            released_claims: 1,
            destroy_observations: 1,
            fifth_claim_committed: true,
        };
    }
    if (trialId === "audit_head_contention") {
        return {
            kind: "audit" as const,
            head_sequence: 1,
            event_rows: 1,
            head_hash_commitment: hex("a"),
            chain_verified: true,
            head_event_split_observed: false,
        };
    }
    const revokeFirst = trialId === "revoke_first";
    return {
        kind: "guarded_history" as const,
        authority_state: "revoked" as const,
        confirmation_state: revokeFirst ? ("discarded" as const) : ("consumed" as const),
        live_confirmation_slot: "clear" as const,
        run_rows: revokeFirst ? 0 : 1,
        assertion_rows: revokeFirst ? 0 : 1,
        cancellation_requested_rows: revokeFirst ? 0 : 1,
        cancellation_outbox_rows: revokeFirst ? 0 : 1,
    };
};

const d1TrialExecutions = (trialIds: readonly string[]) => {
    const deployment = d1Deployment();
    return trialIds.map((trial_id, index) => {
        const childCount = trial_id === "sandbox_capacity_contention" ? 5 : 2;
        return {
            trial_id,
            separate_operator_processes: true as const,
            cross_network_requests: true as const,
            request_set_commitment: d1TrialCommitment(trial_id, 32),
            observation_commitment: d1TrialCommitment(trial_id, 64),
            gateway_request_bindings: (D1_GATEWAY_TRIAL_IDS_V1 as readonly string[]).includes(trial_id)
                ? gatewayBindings(
                      trial_id.startsWith("provider_tool_")
                          ? "provider_tool"
                          : trial_id.startsWith("code_")
                            ? "code"
                            : "model",
                      trial_id.endsWith("_changed_digest")
                          ? "changed_digest"
                          : trial_id.endsWith("_reserve_then_crash")
                            ? "reserve_then_crash"
                            : trial_id.endsWith("_dispatch_response_lost")
                              ? "dispatch_response_lost"
                              : "normal"
                  )
                : null,
            barrier: {
                driver_child_process_count: childCount,
                ready_ipc_signal_count: childCount,
                go_signal_count: childCount,
                worker_readiness_row_count: childCount,
                child_process_id_commitments: Array.from({ length: childCount }, (_, childIndex) =>
                    (index * 8 + childIndex + 40).toString(16).padStart(64, "0")
                ),
                readiness_child_process_id_commitments: Array.from({ length: childCount }, (_, childIndex) =>
                    (index * 8 + childIndex + 40).toString(16).padStart(64, "0")
                ),
                go_receipt_commitments: Array.from({ length: childCount }, (_, childIndex) =>
                    (index * 8 + childIndex + 80).toString(16).padStart(64, "0")
                ),
            },
            writer_results: Array.from({ length: childCount }, (_, childIndex) => {
                const writer_role =
                    trial_id === "equal_release_race_roles_swapped"
                        ? childIndex % 2 === 0
                            ? ("writer_b" as const)
                            : ("writer_a" as const)
                        : childIndex % 2 === 0
                          ? ("writer_a" as const)
                          : ("writer_b" as const);
                const batch_operation =
                    trial_id === "create_first" ||
                    trial_id === "revoke_first" ||
                    trial_id === "equal_release_race" ||
                    trial_id === "equal_release_race_roles_swapped"
                        ? childIndex === 0
                            ? ("guarded_create" as const)
                            : ("grant_revoke" as const)
                        : trial_id === "sandbox_capacity_contention"
                          ? ("capacity_claim" as const)
                          : trial_id === "destroy_observed_capacity_release"
                            ? childIndex === 0
                                ? ("destroy_observation" as const)
                                : ("capacity_release" as const)
                            : trial_id === "audit_head_contention"
                              ? ("audit_append" as const)
                              : ("gateway_reserve" as const);
                const denied =
                    (trial_id === "revoke_first" && batch_operation === "guarded_create") ||
                    (trial_id === "sandbox_capacity_contention" && childIndex === 4) ||
                    (trial_id === "audit_head_contention" && childIndex === 1) ||
                    ((D1_GATEWAY_TRIAL_IDS_V1 as readonly string[]).includes(trial_id) && childIndex === 1);
                const request_id_commitment = (index * 8 + childIndex + 128).toString(16).padStart(64, "0");
                const request_content_commitment = (index * 8 + childIndex + 192).toString(16).padStart(64, "0");
                const commonResult = {
                    writer_role,
                    child_process_id_commitment: (index * 8 + childIndex + 40).toString(16).padStart(64, "0"),
                    go_receipt_commitment: (index * 8 + childIndex + 80).toString(16).padStart(64, "0"),
                    network_request_count: 1 as const,
                    worker_readiness_row_count: 1 as const,
                    request_id_commitment,
                    request_content_commitment,
                    script_commitment: deployment[`${writer_role}_script_commitment`],
                    version_commitment: deployment[`${writer_role}_version_commitment`],
                    application_retry_count: 0 as const,
                    batch_operation,
                    capacity_claim_binding:
                        batch_operation === "capacity_claim"
                            ? {
                                  installation_id_commitment: hex("1"),
                                  run_id_commitment:
                                      childIndex === 0 ? hex("2") : (900 + childIndex).toString(16).padStart(64, "0"),
                                  run_attempt_fence: 7,
                                  claim_id_commitment:
                                      childIndex === 0 ? hex("3") : (910 + childIndex).toString(16).padStart(64, "0"),
                                  sandbox_id_commitment:
                                      childIndex === 0 ? hex("4") : (920 + childIndex).toString(16).padStart(64, "0"),
                              }
                            : null,
                    capacity_release_binding:
                        batch_operation === "destroy_observation" || batch_operation === "capacity_release"
                            ? {
                                  installation_id_commitment: hex("1"),
                                  run_id_commitment: hex("2"),
                                  run_attempt_fence: 7,
                                  claim_id_commitment: hex("3"),
                                  sandbox_id_commitment: hex("4"),
                                  destroy_observation_id_commitment: hex("5"),
                                  destroy_receipt_commitment: hex("6"),
                              }
                            : null,
                    audit_binding:
                        batch_operation === "audit_append"
                            ? {
                                  attempt_id_commitment: childIndex === 0 ? hex("1") : hex("2"),
                                  expected_sequence: 0,
                                  previous_head_hash_commitment: hex("9"),
                                  event_hash_commitment: childIndex === 0 ? hex("a") : hex("c"),
                              }
                            : null,
                };
                const faultScenario =
                    childIndex === 0 &&
                    (trial_id.endsWith("_reserve_then_crash") || trial_id.endsWith("_dispatch_response_lost"));
                if (faultScenario) {
                    return {
                        ...commonResult,
                        outcome: "transport_outcome_unknown" as const,
                        fault_kind: trial_id.endsWith("_reserve_then_crash")
                            ? ("crash_after_reservation" as const)
                            : ("sink_response_lost" as const),
                        transport_response_observed: false as const,
                        state_inferred_only_from_fresh_first_primary_readback: true as const,
                    };
                }
                if (denied) {
                    return {
                        ...commonResult,
                        outcome: "recognized_guard_denial" as const,
                        bookmark_observed: false as const,
                        writer_receipt_observed: false as const,
                        guard_kind:
                            batch_operation === "audit_append"
                                ? ("audit_head_trigger" as const)
                                : batch_operation === "gateway_reserve"
                                  ? ("unique_reservation" as const)
                                  : ("foreign_key_tripwire" as const),
                        error_commitment: hex("7"),
                        no_partial_write_readback: {
                            read_commitment: hex("8"),
                            session_constraint: "first-primary" as const,
                            fresh_session: true as const,
                            guarded_row_count: 0 as const,
                            metadata: d1ReadMetadata(index + childIndex + 1),
                        },
                    };
                }
                const response_commitment = (index * 8 + childIndex + 256).toString(16).padStart(64, "0");
                const bookmark_commitment = (index * 8 + childIndex + 384).toString(16).padStart(64, "0");
                const writer_receipt_identity_commitment = (index * 8 + childIndex + 416)
                    .toString(16)
                    .padStart(64, "0");
                return {
                    ...commonResult,
                    response_commitment,
                    bookmark_commitment,
                    writer_receipt_identity_commitment,
                    bookmark_causal_readback: {
                        source_bookmark_commitment: bookmark_commitment,
                        read_commitment: (index * 8 + childIndex + 448).toString(16).padStart(64, "0"),
                        session_constraint: "bookmark" as const,
                        writer_request_id_commitment: request_id_commitment,
                        writer_receipt_identity_commitment,
                        writer_receipt_count: 1 as const,
                        metadata: d1ReadMetadata(index + childIndex + 60, false),
                    },
                    outcome: "committed" as const,
                    statement_results: d1BatchStatements[batch_operation].map((statement_kind, statement_index) => {
                        const expectedReturning =
                            batch_operation === "grant_revoke"
                                ? (trial_id === "revoke_first" ? [1, 1, 1, 0, 0] : [1, 0, 0, 1, 1])[statement_index]!
                                : 1;
                        return {
                            statement_index,
                            statement_kind,
                            expected_returning_row_count: expectedReturning,
                            metadata: d1ResultMetadata(index + childIndex + statement_index + 1, expectedReturning),
                        };
                    }),
                };
            }),
            decisive_reads: [
                {
                    read_commitment: (index + 32).toString(16).padStart(64, "0"),
                    session_constraint: "first-primary" as const,
                    fresh_session: true as const,
                    bookmark_source: "none" as const,
                    metadata: d1ReadMetadata(index + 3),
                    snapshot: d1TrialSnapshot(trial_id),
                },
            ],
        };
    });
};

const gatewayBindings = (
    callKind: "code" | "model" | "provider_tool",
    scenario: "changed_digest" | "dispatch_response_lost" | "normal" | "reserve_then_crash"
) => {
    const localTrialIndex = (D1_GATEWAY_TRIAL_IDS_V1 as readonly string[]).indexOf(`${callKind}_${scenario}`);
    return [
        {
            writer_role: "writer_a" as const,
            request_variant: "exact" as const,
            request_id_commitment: (localTrialIndex * 8 + 128).toString(16).padStart(64, "0"),
            request_content_commitment: (localTrialIndex * 8 + 192).toString(16).padStart(64, "0"),
            call_kind: callKind,
            logical_call_id_commitment: hex("1"),
            attempt_id_commitment: hex("2"),
            sequence: 1,
            request_digest: hex("3"),
            reservation_key_commitment: hex("4"),
        },
        {
            writer_role: "writer_b" as const,
            request_variant: scenario === "changed_digest" ? ("substituted" as const) : ("duplicate" as const),
            request_id_commitment: (localTrialIndex * 8 + 129).toString(16).padStart(64, "0"),
            request_content_commitment: (localTrialIndex * 8 + 193).toString(16).padStart(64, "0"),
            call_kind: callKind,
            logical_call_id_commitment: hex("1"),
            attempt_id_commitment: hex("2"),
            sequence: 1,
            request_digest: scenario === "changed_digest" ? hex("5") : hex("3"),
            reservation_key_commitment: hex("4"),
        },
    ];
};

const gatewayTrialBinding = (
    callKind: "code" | "model" | "provider_tool",
    scenario: "changed_digest" | "dispatch_response_lost" | "normal" | "reserve_then_crash"
) => {
    const trialId = `${callKind}_${scenario}`;
    return {
        request_set_commitment: d1TrialCommitment(trialId, 32),
        observation_commitment: d1TrialCommitment(trialId, 64),
    };
};

const gatewaySinkRpc = (
    callKind: "code" | "model" | "provider_tool",
    scenario: "changed_digest" | "dispatch_response_lost" | "normal" | "reserve_then_crash"
) => {
    const trialId = `${callKind}_${scenario}`;
    const notInvoked = scenario === "reserve_then_crash";
    return {
        binding_configuration_observation_commitment: hex("d"),
        rpc_observation_commitment: d1TrialCommitment(trialId, 96),
        writer_role: notInvoked ? null : ("writer_a" as const),
        writer_binding_commitment: notInvoked ? null : hex("a"),
        target_script_commitment: hex("8"),
        runtime_version_commitment: notInvoked ? null : hex("9"),
        rpc_outcome: notInvoked
            ? ("not_invoked_before_fault" as const)
            : scenario === "dispatch_response_lost"
              ? ("awaited_response_lost" as const)
              : ("awaited_response" as const),
        access_context_forwarded: false as const,
        sink_receipt_identity_commitments: notInvoked ? [] : [d1TrialCommitment(trialId, 120)],
    };
};

const capacityOperations = () => {
    const exactTarget = {
        installation_id_commitment: hex("1"),
        run_id_commitment: hex("2"),
        run_attempt_fence: 7,
        claim_id_commitment: hex("3"),
        sandbox_id_commitment: hex("4"),
        destroy_observation_id_commitment: hex("5"),
        destroy_receipt_commitment: hex("6"),
    };
    const operations = [
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
    ] as const;
    return operations.map((operation, index) => {
        const beforeDestroy = operation === "release_before_destroy";
        const afterRelease = operation === "release_exact_destroy" || operation === "release_replay";
        const afterReclaim = operation === "fifth_claim_after_release";
        const snapshot = beforeDestroy
            ? {
                  reserved: 4,
                  active_claims: 4,
                  released_claims: 0,
                  destroy_observations: 0,
                  fifth_claim_committed: false,
              }
            : afterReclaim
              ? {
                    reserved: 4,
                    active_claims: 4,
                    released_claims: 1,
                    destroy_observations: 1,
                    fifth_claim_committed: true,
                }
              : afterRelease
                ? {
                      reserved: 3,
                      active_claims: 3,
                      released_claims: 1,
                      destroy_observations: 1,
                      fifth_claim_committed: false,
                  }
                : {
                      reserved: 4,
                      active_claims: 4,
                      released_claims: 0,
                      destroy_observations: 1,
                      fifth_claim_committed: false,
                  };
        const wrongField: string | undefined = (
            {
                release_wrong_installation: "installation_id_commitment",
                release_wrong_run: "run_id_commitment",
                release_wrong_fence: "run_attempt_fence",
                release_wrong_claim: "claim_id_commitment",
                release_wrong_sandbox: "sandbox_id_commitment",
                release_wrong_receipt: "destroy_receipt_commitment",
            } as Partial<Record<(typeof operations)[number], string>>
        )[operation];
        const target = { ...exactTarget };
        if (wrongField === "run_attempt_fence") target.run_attempt_fence = 8;
        else if (wrongField !== undefined) Object.assign(target, { [wrongField]: hex("f") });
        const trialChildIndex = operation === "record_exact_destroy" ? 0 : 1;
        const request_id_commitment =
            operation === "record_exact_destroy" || operation === "release_exact_destroy"
                ? guardedTrialWriterCommitment("destroy_observed_capacity_release", trialChildIndex, 128)
                : (520 + index).toString(16).padStart(64, "0");
        const request_content_commitment =
            operation === "record_exact_destroy" || operation === "release_exact_destroy"
                ? guardedTrialWriterCommitment("destroy_observed_capacity_release", trialChildIndex, 192)
                : (560 + index).toString(16).padStart(64, "0");
        const outcome =
            operation === "record_exact_destroy" ||
            operation === "release_exact_destroy" ||
            operation === "fifth_claim_after_release"
                ? ("committed" as const)
                : ("guarded_denial" as const);
        const result = {
            operation_id_commitment: (500 + index).toString(16).padStart(64, "0"),
            operation,
            writer_role:
                operation === "record_exact_destroy"
                    ? ("writer_a" as const)
                    : operation === "release_exact_destroy"
                      ? ("writer_b" as const)
                      : index % 2 === 0
                        ? ("writer_a" as const)
                        : ("writer_b" as const),
            request_id_commitment,
            request_content_commitment,
            observation_commitment: (540 + index).toString(16).padStart(64, "0"),
            target,
            fresh_first_primary_readback: {
                read_commitment: (640 + index).toString(16).padStart(64, "0"),
                session_constraint: "first-primary" as const,
                fresh_session: true as const,
                bookmark_source: "none" as const,
                metadata: d1ReadMetadata(120 + index),
                snapshot: { kind: "capacity" as const, ...snapshot },
            },
        };
        if (outcome === "guarded_denial") {
            return {
                ...result,
                outcome,
                bookmark_observed: false as const,
                writer_receipt_observed: false as const,
                guard_kind: "foreign_key_tripwire" as const,
                error_commitment: hex("e"),
                no_partial_state_change: true as const,
            };
        }
        const bookmark_commitment =
            operation === "record_exact_destroy" || operation === "release_exact_destroy"
                ? guardedTrialWriterCommitment("destroy_observed_capacity_release", trialChildIndex, 384)
                : (600 + index).toString(16).padStart(64, "0");
        const writer_receipt_identity_commitment =
            operation === "record_exact_destroy" || operation === "release_exact_destroy"
                ? guardedTrialWriterCommitment("destroy_observed_capacity_release", trialChildIndex, 416)
                : (610 + index).toString(16).padStart(64, "0");
        return {
            ...result,
            outcome,
            operation_result_metadata: d1ResultMetadata(80 + index),
            bookmark_commitment,
            writer_receipt_identity_commitment,
            bookmark_causal_readback: {
                source_bookmark_commitment: bookmark_commitment,
                read_commitment: (620 + index).toString(16).padStart(64, "0"),
                session_constraint: "bookmark" as const,
                writer_request_id_commitment: request_id_commitment,
                writer_receipt_identity_commitment,
                writer_receipt_count: 1 as const,
                metadata: d1ReadMetadata(100 + index, false),
            },
        };
    });
};

const auditOperations = () => {
    const operations = ["follow_up_append", "stale_sequence", "gap_sequence", "wrong_previous_hash"] as const;
    return operations.map((operation, index) => {
        const request_id_commitment = (720 + index).toString(16).padStart(64, "0");
        const request_content_commitment = (730 + index).toString(16).padStart(64, "0");
        const result = {
            operation_id_commitment: (680 + index).toString(16).padStart(64, "0"),
            operation,
            writer_role:
                operation === "follow_up_append"
                    ? ("writer_b" as const)
                    : index % 2 === 0
                      ? ("writer_a" as const)
                      : ("writer_b" as const),
            request_id_commitment,
            request_content_commitment,
            observation_commitment: (740 + index).toString(16).padStart(64, "0"),
            attempt_id_commitment: index === 0 ? hex("3") : (760 + index).toString(16).padStart(64, "0"),
            expected_sequence:
                operation === "follow_up_append" || operation === "stale_sequence"
                    ? 1
                    : operation === "gap_sequence"
                      ? 3
                      : 2,
            previous_head_hash_commitment:
                operation === "follow_up_append" ? hex("a") : operation === "wrong_previous_hash" ? hex("f") : hex("b"),
            event_hash_commitment:
                operation === "follow_up_append" ? hex("b") : (840 + index).toString(16).padStart(64, "0"),
            fresh_first_primary_readback: {
                read_commitment: (800 + index).toString(16).padStart(64, "0"),
                session_constraint: "first-primary" as const,
                fresh_session: true as const,
                bookmark_source: "none" as const,
                metadata: d1ReadMetadata(180 + index),
                snapshot: {
                    kind: "audit" as const,
                    head_sequence: 2,
                    event_rows: 2,
                    head_hash_commitment: hex("b"),
                    chain_verified: true,
                    head_event_split_observed: false,
                },
            },
        };
        if (operation !== "follow_up_append") {
            return {
                ...result,
                outcome: "guarded_denial" as const,
                bookmark_observed: false as const,
                writer_receipt_observed: false as const,
                guard_kind: "audit_head_trigger" as const,
                error_commitment: hex("e"),
                no_partial_state_change: true as const,
            };
        }
        const bookmark_commitment = (700 + index).toString(16).padStart(64, "0");
        const writer_receipt_identity_commitment = (710 + index).toString(16).padStart(64, "0");
        return {
            ...result,
            outcome: "committed" as const,
            operation_result_metadata: d1ResultMetadata(140 + index),
            bookmark_commitment,
            writer_receipt_identity_commitment,
            bookmark_causal_readback: {
                source_bookmark_commitment: bookmark_commitment,
                read_commitment: (780 + index).toString(16).padStart(64, "0"),
                session_constraint: "bookmark" as const,
                writer_request_id_commitment: request_id_commitment,
                writer_receipt_identity_commitment,
                writer_receipt_count: 1 as const,
                metadata: d1ReadMetadata(160 + index, false),
            },
        };
    });
};

const d1Cleanup = (kind: "gateway" | "guarded") => {
    const deployment = d1Deployment();
    const trials = d1TrialExecutions(kind === "guarded" ? D1_GUARDED_TRIAL_IDS_V1 : D1_GATEWAY_TRIAL_IDS_V1);
    const capacity = kind === "guarded" ? capacityOperations() : [];
    const audit = kind === "guarded" ? auditOperations() : [];
    const requestIds = [
        ...new Set([
            ...trials.flatMap(trial => trial.writer_results.map(result => result.request_id_commitment)),
            ...capacity.map(operation => operation.request_id_commitment),
            ...audit.map(operation => operation.request_id_commitment),
        ]),
    ];
    const requestContents = [
        ...new Set([
            ...trials.flatMap(trial => trial.writer_results.map(result => result.request_content_commitment)),
            ...capacity.map(operation => operation.request_content_commitment),
            ...audit.map(operation => operation.request_content_commitment),
        ]),
    ];
    const currentStateSnapshots =
        kind === "gateway"
            ? trials.map(trial => ({ case_key: trial.trial_id, snapshot: trial.decisive_reads[0]!.snapshot }))
            : ["create_first", "revoke_first", "equal_release_race", "equal_release_race_roles_swapped"]
                  .map(caseKey => ({
                      case_key: caseKey,
                      snapshot: trials.find(trial => trial.trial_id === caseKey)!.decisive_reads[0]!.snapshot,
                  }))
                  .concat([
                      {
                          case_key: "sandbox_capacity",
                          snapshot: capacity.find(operation => operation.operation === "fifth_claim_after_release")!
                              .fresh_first_primary_readback.snapshot,
                      },
                      {
                          case_key: "audit_head",
                          snapshot: audit.find(operation => operation.operation === "wrong_previous_hash")!
                              .fresh_first_primary_readback.snapshot,
                      },
                  ]);
    const gateId = kind === "guarded" ? "d1_guarded_create" : "gateway_reservation";
    return {
        status: "succeeded" as const,
        application_retry_count: 0 as const,
        run_fence_closed: true as const,
        cleanup_observation_commitment: hex("d"),
        operator_database_deny_list_digest: deployment.generated_names.operator_database_deny_list_digest,
        generated_name_guards: deployment.generated_names.resources.map(resource => ({
            ...resource,
            safe_prefix_commitment: deployment.generated_names.safe_prefix_commitment,
            validation_outcome: "prefix_and_lowercase_random_suffix_match" as const,
        })),
        database_deny_list_check: {
            candidate_database_id_commitment: deployment.database_id_commitment,
            operator_database_deny_list_digest: deployment.generated_names.operator_database_deny_list_digest,
            outcome: "not_listed" as const,
        },
        all_routes_and_access_retained_until_final_readback: true as const,
        in_flight_requests: {
            started_request_id_commitments: requestIds,
            settled_request_id_commitments: [...requestIds],
            request_content_commitments: requestContents,
            unknown_request_id_commitments: [],
        },
        final_first_primary_readback: {
            read_commitment: hex("e"),
            request_id_commitment: hex("c"),
            request_content_commitment: hex("b"),
            session_constraint: "first-primary" as const,
            fresh_session: true as const,
            metadata: d1ReadMetadata(220),
            observation_set_commitment: hex("f"),
            current_state_snapshots: currentStateSnapshots,
        },
        cleanup_transcript_commitment: {
            ...transcript("cleanup", 999, gateId, hex("d")),
            request_commitment: hex("b"),
            response_commitment: hex("8"),
        },
        cleanup_transcript_response_projection: {
            final_observation_set_digest: hex("f"),
            projection_hmac_commitment: hex("8"),
        },
        service_token_revoked_after_final_readback: true as const,
        routes_confirmed_absent_before_worker_deletion: true as const,
        database_deleted_last: true as const,
        completed_steps: [
            "close_run_fence",
            "settle_in_flight_requests",
            "capture_final_first_primary_readback",
            "revoke_access_service_token",
            "delete_all_exact_routes",
            "confirm_routes_absent",
            "delete_access_application_and_policy",
            "delete_writer_scripts_without_force",
            "delete_sink_script_without_force",
            "delete_database_last",
            "confirm_all_recorded_resources_absent",
        ] as const,
        worker_script_deletions: [
            ["writer_a", deployment.writer_a_script_commitment],
            ["writer_b", deployment.writer_b_script_commitment],
            ["sink_readback", deployment.sink_script_commitment],
        ].map(([role, script_commitment]) => ({
            role,
            script_commitment,
            force: false as const,
            confirmed_absent: true as const,
        })),
        absence_checks: [
            ["database", deployment.database_id_commitment],
            ["writer_a_script", deployment.writer_a_script_commitment],
            ["writer_b_script", deployment.writer_b_script_commitment],
            ["sink_script", deployment.sink_script_commitment],
            ["writer_a_deployment", deployment.worker_deployments.writer_a.deployment_id_commitment],
            ["writer_b_deployment", deployment.worker_deployments.writer_b.deployment_id_commitment],
            ["sink_deployment", deployment.worker_deployments.sink_readback.deployment_id_commitment],
            ["writer_a_route", deployment.routes.writer_a.route_id_commitment],
            ["writer_b_route", deployment.routes.writer_b.route_id_commitment],
            ["readback_route", deployment.routes.readback.route_id_commitment],
            ["access_application", deployment.access.application_commitment],
            ["access_policy", deployment.access.policy_commitment],
            ["access_service_token", deployment.access.service_token_commitment],
        ].map(([resource_kind, resource_commitment]) => ({
            resource_kind,
            resource_commitment,
            create_response_id_commitment: resource_commitment,
            cleanup_target_id_commitment: resource_commitment,
            create_response_id_equals_cleanup_target: true as const,
            absent: true as const,
        })),
    };
};

const d1Setup = () => ({
    read_replication: {
        configured: "enabled" as const,
        readback: "enabled" as const,
        readback_commitment: hex("1"),
        first_primary_metadata: d1ReadMetadata(40),
    },
    foreign_keys: {
        pragma_readback: 1 as const,
        readback_commitment: hex("2"),
        first_primary_metadata: d1ReadMetadata(41),
    },
    rollback_canary: {
        operation: "foreign_key_tripwire_batch" as const,
        result: "recognized_constraint_rejection" as const,
        error_commitment: hex("3"),
        guarded_rows_after: 0 as const,
        readback_commitment: hex("4"),
        first_primary_metadata: d1ReadMetadata(42),
    },
    sink_runtime: {
        public_sink_ingress_denied: true as const,
        public_sink_ingress_denial_observation_commitment: hex("5"),
        access_protected_readback_get_allowed: true as const,
        readback_get_observation_commitment: hex("6"),
        private_rpc_awaited: true as const,
        private_rpc_observation_commitment: hex("d"),
        access_context_forwarded: false as const,
        writer_a_binding_config_digest: hex("a"),
        writer_b_binding_config_digest: hex("b"),
        runtime_version_commitment: hex("9"),
        sink_receipt_identity_commitment: hex("c"),
        sink_receipt_count: 1 as const,
    },
});

const guardedTranscriptObservations = () => ({
    create_linearizes_first: [d1TrialCommitment("create_first", 64)],
    revoke_linearizes_first: [d1TrialCommitment("revoke_first", 64)],
    concurrent_history_is_legal: [
        d1TrialCommitment("equal_release_race", 64),
        d1TrialCommitment("equal_release_race_roles_swapped", 64),
    ],
    two_independent_writers: D1_GUARDED_TRIAL_IDS_V1.map(trial => d1TrialCommitment(trial, 64)),
    sandbox_capacity_contention: [d1TrialCommitment("sandbox_capacity_contention", 64)],
    destroy_observed_capacity_release: [
        d1TrialCommitment("destroy_observed_capacity_release", 64),
        ...capacityOperations().map(operation => operation.observation_commitment),
    ],
    audit_head_contention: [
        d1TrialCommitment("audit_head_contention", 64),
        ...auditOperations().map(operation => operation.observation_commitment),
    ],
});

const gatewayTranscriptObservations = () => {
    const scenario = (name: "changed_digest" | "dispatch_response_lost" | "normal" | "reserve_then_crash") => [
        hex("d"),
        ...(["model", "provider_tool", "code"] as const).flatMap(callKind => [
            d1TrialCommitment(`${callKind}_${name}`, 64),
            d1TrialCommitment(`${callKind}_${name}`, 96),
        ]),
    ];
    return {
        model_duplicate_sequence: [
            hex("d"),
            d1TrialCommitment("model_normal", 64),
            d1TrialCommitment("model_normal", 96),
        ],
        provider_tool_duplicate_sequence: [
            hex("d"),
            d1TrialCommitment("provider_tool_normal", 64),
            d1TrialCommitment("provider_tool_normal", 96),
        ],
        code_duplicate_sequence: [hex("d"), d1TrialCommitment("code_normal", 64), d1TrialCommitment("code_normal", 96)],
        one_outbound_request_per_kind: scenario("normal"),
        one_spent_reservation_per_kind: scenario("normal"),
        changed_digest_denied: scenario("changed_digest"),
        reserve_then_crash_not_redispatched: scenario("reserve_then_crash"),
        dispatch_response_lost_not_redispatched: scenario("dispatch_response_lost"),
        two_independent_writers: [
            hex("d"),
            ...D1_GATEWAY_TRIAL_IDS_V1.flatMap(trial => [d1TrialCommitment(trial, 64), d1TrialCommitment(trial, 96)]),
        ],
    };
};

const guardedReport = () => ({
    ...common,
    kind: "d1_guarded_create" as const,
    collection_status: "complete" as const,
    check_set_version: 1 as const,
    deployment_digest: hex("a"),
    final_observation_set_commitment: hex("f"),
    deployment: d1Deployment(),
    setup: d1Setup(),
    cleanup: d1Cleanup("guarded"),
    observations: {
        trial_executions: d1TrialExecutions(D1_GUARDED_TRIAL_IDS_V1),
        histories: ["create_first", "revoke_first", "equal_release_race", "equal_release_race_roles_swapped"].map(
            (historyCase, index) => ({
                case: historyCase,
                observation_commitment: d1TrialCommitment(historyCase, 64),
                observed_history: index === 1 ? "revoke_before_create" : "create_before_revoke",
                authority_state: "revoked",
                confirmation_state: index === 1 ? "discarded" : "consumed",
                live_confirmation_slot: "clear",
                run_rows: index === 1 ? 0 : 1,
                assertion_rows: index === 1 ? 0 : 1,
                cancellation_requested_rows: index === 1 ? 0 : 1,
                cancellation_outbox_rows: index === 1 ? 0 : 1,
            })
        ),
        capacity: {
            contention_observation_commitment: d1TrialCommitment("sandbox_capacity_contention", 64),
            release_observation_commitment: d1TrialCommitment("destroy_observed_capacity_release", 64),
            contenders: 5,
            committed_claims: 4,
            denied_claims: 1,
            releases_before_destroy_observation: 0,
            releases_after_exact_destroy_observation: 1,
            exact_release_target: {
                installation_id_commitment: hex("1"),
                run_id_commitment: hex("2"),
                run_attempt_fence: 7,
                claim_id_commitment: hex("3"),
                sandbox_id_commitment: hex("4"),
                destroy_observation_id_commitment: hex("5"),
                destroy_receipt_commitment: hex("6"),
            },
            wrong_target_releases: [
                "installation_id",
                "run_id",
                "run_attempt_fence",
                "claim_id",
                "sandbox_id",
                "destroy_receipt",
            ].map(target => ({ target, attempts: 1 as const, state_changes: 0 as const })),
            release_replay_attempts: 1,
            release_replay_state_changes: 0,
            fifth_claim_after_release_commits: 1,
            reserved_after_fifth_claim: 4,
            operations: capacityOperations(),
        },
        audit: {
            observation_commitment: d1TrialCommitment("audit_head_contention", 64),
            initial_head_hash_commitment: hex("9"),
            first_event_hash_commitment: hex("a"),
            final_head_hash_commitment: hex("b"),
            first_phase_attempt_id_commitments: [hex("1"), hex("2")],
            follow_up_attempt_id_commitment: hex("3"),
            same_head_contenders: 2,
            first_phase_commits: 1,
            first_phase_conflicts: 1,
            follow_up_commits: 1,
            final_event_rows: 2,
            final_head_sequence: 2,
            final_chain_verified: true,
            stale_sequence_denied: true,
            gap_sequence_denied: true,
            wrong_previous_hash_denied: true,
            head_event_split_observed: false,
            operations: auditOperations(),
        },
    },
    checks: checks(D1_GUARDED_CREATE_CHECK_IDS_V1, "d1_guarded_create", guardedTranscriptObservations()),
});

const gatewayReport = () => ({
    ...common,
    kind: "gateway_reservation" as const,
    collection_status: "complete" as const,
    check_set_version: 1 as const,
    deployment_digest: hex("a"),
    final_observation_set_commitment: hex("f"),
    deployment: d1Deployment(),
    setup: d1Setup(),
    cleanup: d1Cleanup("gateway"),
    observations: {
        trial_executions: d1TrialExecutions(D1_GATEWAY_TRIAL_IDS_V1),
        call_kinds: (["model", "provider_tool", "code"] as const).map(callKind => ({
            call_kind: callKind,
            normal: {
                ...gatewayTrialBinding(callKind, "normal"),
                competing_requests: gatewayBindings(callKind, "normal"),
                spent_reservations: 1,
                sink_receipts: 1,
                winning_dispatches: 1,
                losing_dispatches: 0,
                sink_rpc: gatewaySinkRpc(callKind, "normal"),
            },
            changed_digest: {
                ...gatewayTrialBinding(callKind, "changed_digest"),
                competing_requests: gatewayBindings(callKind, "changed_digest"),
                substituted_request_dispatches: 0,
                sink_rpc: gatewaySinkRpc(callKind, "changed_digest"),
            },
            reserve_then_crash: {
                ...gatewayTrialBinding(callKind, "reserve_then_crash"),
                competing_requests: gatewayBindings(callKind, "reserve_then_crash"),
                spent_reservations: 1,
                sink_receipts: 0,
                result: "outcome_unknown" as const,
                retry_attempts: 0,
                sink_rpc: gatewaySinkRpc(callKind, "reserve_then_crash"),
            },
            dispatch_response_lost: {
                ...gatewayTrialBinding(callKind, "dispatch_response_lost"),
                competing_requests: gatewayBindings(callKind, "dispatch_response_lost"),
                spent_reservations: 1,
                sink_receipts: 1,
                result: "outcome_unknown" as const,
                retry_attempts: 0,
                sink_rpc: gatewaySinkRpc(callKind, "dispatch_response_lost"),
            },
        })),
    },
    checks: checks(GATEWAY_RESERVATION_CHECK_IDS_V1, "gateway_reservation", gatewayTranscriptObservations()),
});

const globalChecks = [
    ...CONNECTOR_COMMON_CHECK_IDS_V1,
    "global_public_target_validation",
    "operator_auth_config_absence_readback",
] as const;
const specificChecks = [
    ...CONNECTOR_COMMON_CHECK_IDS_V1,
    "positive_resource_scope",
    "sibling_resource_denial",
] as const;

const connectorReport = (resourceRule: "global" | "specific" = "global") => ({
    ...common,
    kind: "first_connector" as const,
    identity_digest_algorithm: "hmac-sha256-v1" as const,
    metorial_api_version: "2026-01-01-magnetar" as const,
    sdk_version: "3.0.9",
    generated_client_version: "3.0.2",
    package_integrity_digest: hex("9"),
    deployment_status: "active" as const,
    effective_filter_digest: hex("8"),
    deployment_digest: hex("a"),
    provider_digest: hex("b"),
    provider_version_digest: hex("c"),
    provider_spec_digest: hex("d"),
    auth_setup: { kind: "none" as const },
    tools: [
        {
            tool_key_digest: hex("e"),
            input_schema_digest: hex("f"),
            output_schema_digest: hex("a"),
            descriptor_digest: hex("b"),
            vendor_effect_tags: { read_only: true as const, destructive: false as const },
            reviewed_effect: "read_only" as const,
            resource_rule:
                resourceRule === "global"
                    ? ({ kind: "global_public_read_only" } as const)
                    : ({
                          kind: "connector_specific",
                          mapping_key_digest: hex("c"),
                          mapping_version: 1,
                          scope_digest: hex("d"),
                      } as const),
            incidental_effects: ["provider_access_log" as const],
            maximum_observed_result_bytes: 65_536,
            enforced_result_max_bytes: 65_536,
        },
    ],
    checks: checks(resourceRule === "global" ? globalChecks : specificChecks),
});

const withReportDigest = async (input: unknown): Promise<Record<string, unknown>> => {
    let report = input as Record<string, unknown>;
    if (report["kind"] === "d1_guarded_create" || report["kind"] === "gateway_reservation") {
        const deployment = await digestD1DeploymentCommitmentV1(report["deployment"]);
        if (!deployment.success) throw new Error(deployment.code);
        const cleanup = structuredClone(report["cleanup"]) as {
            final_first_primary_readback: {
                current_state_snapshots: unknown;
                observation_set_commitment: string;
            };
            cleanup_transcript_response_projection: {
                final_observation_set_digest: string;
                projection_hmac_commitment: string;
            };
        };
        const finalObservationSet = await digestD1FinalObservationSetV1(
            cleanup.final_first_primary_readback.current_state_snapshots
        );
        if (!finalObservationSet.success) throw new Error(finalObservationSet.code);
        cleanup.final_first_primary_readback.observation_set_commitment = finalObservationSet.digest;
        cleanup.cleanup_transcript_response_projection.final_observation_set_digest = finalObservationSet.digest;
        report = {
            ...report,
            cleanup,
            deployment_digest: deployment.digest,
            final_observation_set_commitment: finalObservationSet.digest,
        };
    }
    const result = await digestUntrustedProbeReportV1(report, { as_of_ms: asOf });
    if (!result.success) throw new Error(result.code);
    return { ...report, report_digest: result.digest };
};

describe("recorded Item 2 blockers", () => {
    it("exports operational APIs only through the internal entrypoint", async () => {
        const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
            exports: Record<string, unknown>;
        };
        expect(Object.keys(manifest.exports)).toEqual(["./internal"]);
    });

    it("returns the exact core blocker list including the runtime wire protocol", async () => {
        const fixture = JSON.parse(
            await readFile(new URL("../../../docs/fixtures/item-2-gates.json", import.meta.url), "utf8")
        ) as unknown;
        expect(inspectRecordedItem2BlockersV1(fixture)).toEqual({
            success: true,
            blockers: RECORDED_ITEM2_CORE_BLOCKERS_V1,
        });
    });

    it("cannot remove blockers when registry statuses change", async () => {
        const fixture = JSON.parse(
            await readFile(new URL("../../../docs/fixtures/item-2-gates.json", import.meta.url), "utf8")
        ) as { gates: Array<Record<string, unknown>> };
        for (const gate of fixture.gates) gate["status"] = "passed";
        expect(inspectRecordedItem2BlockersV1(fixture)).toEqual({
            success: true,
            blockers: RECORDED_ITEM2_CORE_BLOCKERS_V1,
        });
    });

    it("rejects a registry that omits the jurisdiction gate", async () => {
        const fixture = JSON.parse(
            await readFile(new URL("../../../docs/fixtures/item-2-gates.json", import.meta.url), "utf8")
        ) as { gates: Array<Record<string, unknown>> };
        fixture.gates = fixture.gates.filter(gate => gate["id"] !== "jurisdiction");
        expect(inspectRecordedItem2BlockersV1(fixture)).toEqual({
            success: false,
            code: "invalid_gate_registry",
        });
    });
});

describe("untrusted probe reports", () => {
    it("accepts both global-public and connector-specific report shapes", () => {
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(connectorReport("global")).success).toBe(true);
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(connectorReport("specific")).success).toBe(true);
    });

    it("requires typed deployed observations for every D1 schema-freeze check", () => {
        const guarded = guardedReport();
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(guarded).success).toBe(true);
        const missingCapacity = structuredClone(guarded) as Record<string, unknown>;
        delete (missingCapacity["observations"] as Record<string, unknown>)["capacity"];
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(missingCapacity).success).toBe(false);

        const gateway = gatewayReport();
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(gateway).success).toBe(true);
        const missingCode = structuredClone(gateway);
        missingCode.observations.call_kinds.pop();
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(missingCode).success).toBe(false);

        const duplicateDeployment = structuredClone(guarded);
        duplicateDeployment.deployment.writer_b_script_commitment =
            duplicateDeployment.deployment.writer_a_script_commitment;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(duplicateDeployment).success).toBe(false);
        const duplicateDeploymentVersion = structuredClone(guarded);
        duplicateDeploymentVersion.deployment.sink_version_commitment =
            duplicateDeploymentVersion.deployment.writer_a_version_commitment;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(duplicateDeploymentVersion).success).toBe(false);
        const mismatchedDatabase = structuredClone(guarded);
        mismatchedDatabase.deployment.writer_b_database_id_commitment = hex("1");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(mismatchedDatabase).success).toBe(false);

        const absentPrimaryObservation = structuredClone(guarded) as Record<string, unknown>;
        delete (
            (absentPrimaryObservation["setup"] as { read_replication: Record<string, unknown> }).read_replication[
                "first_primary_metadata"
            ] as Record<string, unknown>
        )["served_by_primary"];
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(absentPrimaryObservation).success).toBe(false);

        const falsePrimaryObservation = structuredClone(guarded);
        falsePrimaryObservation.setup.read_replication.first_primary_metadata.served_by_primary = false as never;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(falsePrimaryObservation).success).toBe(false);

        const absentBookmark = structuredClone(guarded) as Record<string, unknown>;
        const absentBookmarkObservations = absentBookmark["observations"] as {
            trial_executions: Array<{ writer_results: Array<Record<string, unknown>> }>;
        };
        delete absentBookmarkObservations.trial_executions[0]!.writer_results[0]!["bookmark_commitment"];
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(absentBookmark).success).toBe(false);

        const replicaRead = structuredClone(guarded) as Record<string, unknown>;
        const replicaReadObservations = replicaRead["observations"] as {
            trial_executions: Array<{ decisive_reads: Array<{ metadata: Record<string, unknown> }> }>;
        };
        replicaReadObservations.trial_executions[0]!.decisive_reads[0]!.metadata["served_by_primary"] = false;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(replicaRead).success).toBe(false);

        const repeatedWriter = structuredClone(guarded);
        repeatedWriter.observations.trial_executions[0]!.writer_results[1]!.writer_role = "writer_a";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(repeatedWriter).success).toBe(false);

        const wrongWriterDeployment = structuredClone(guarded);
        wrongWriterDeployment.observations.trial_executions[0]!.writer_results[0]!.script_commitment = hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(wrongWriterDeployment).success).toBe(false);

        const missingSetup = structuredClone(guarded) as Record<string, unknown>;
        delete missingSetup["setup"];
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(missingSetup).success).toBe(false);

        const reorderedCleanup = structuredClone(guarded);
        const reorderedSteps = reorderedCleanup.cleanup.completed_steps as unknown as string[];
        [reorderedSteps[1], reorderedSteps[2]] = [reorderedSteps[2]!, reorderedSteps[1]!];
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(reorderedCleanup).success).toBe(false);

        const copiedCapacityParticipant = structuredClone(guarded);
        copiedCapacityParticipant.observations.trial_executions[4]!.writer_results[4]!.request_id_commitment =
            copiedCapacityParticipant.observations.trial_executions[4]!.writer_results[0]!.request_id_commitment;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(copiedCapacityParticipant).success).toBe(false);

        const wrongBatchStatement = structuredClone(guarded);
        const committedCreate = wrongBatchStatement.observations.trial_executions[0]!.writer_results[0]!;
        if (committedCreate.outcome === "committed") {
            committedCreate.statement_results[0]!.statement_kind = "insert_audit_event";
        }
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(wrongBatchStatement).success).toBe(false);

        const callerChosenReturningCount = structuredClone(guarded);
        const committedCapacity = callerChosenReturningCount.observations.trial_executions[4]!.writer_results[0]!;
        if (committedCapacity.outcome === "committed") {
            committedCapacity.statement_results[0]!.expected_returning_row_count = 0;
            committedCapacity.statement_results[0]!.metadata.returning_row_count = 0;
            committedCapacity.statement_results[0]!.metadata.returning_identity_commitments = [];
        }
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(callerChosenReturningCount).success).toBe(false);

        const invalidForcedHistory = structuredClone(guarded);
        invalidForcedHistory.observations.histories[0]!.observed_history = "revoke_before_create";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidForcedHistory).success).toBe(false);
        setCheckOutcome(invalidForcedHistory, "create_linearizes_first", "failed");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidForcedHistory).success).toBe(false);

        const invalidConfirmationState = structuredClone(guarded);
        invalidConfirmationState.observations.histories[0]!.confirmation_state = "discarded";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidConfirmationState).success).toBe(false);
        setCheckOutcome(invalidConfirmationState, "create_linearizes_first", "failed");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidConfirmationState).success).toBe(false);

        const occupiedConfirmationSlot = structuredClone(guarded);
        occupiedConfirmationSlot.observations.histories[1]!.live_confirmation_slot = "present";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(occupiedConfirmationSlot).success).toBe(false);
        setCheckOutcome(occupiedConfirmationSlot, "revoke_linearizes_first", "inconclusive");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(occupiedConfirmationSlot).success).toBe(false);

        const invalidCapacity = structuredClone(guarded);
        invalidCapacity.observations.capacity.committed_claims = 3;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidCapacity).success).toBe(false);
        setCheckOutcome(invalidCapacity, "sandbox_capacity_contention", "inconclusive");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidCapacity).success).toBe(true);

        const invalidAudit = structuredClone(guarded);
        invalidAudit.observations.audit.final_chain_verified = false;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidAudit).success).toBe(false);
        setCheckOutcome(invalidAudit, "audit_head_contention", "failed");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(invalidAudit).success).toBe(true);

        const invalidGatewayNormal = structuredClone(gateway);
        invalidGatewayNormal.observations.call_kinds[0]!.normal.sink_receipts = 2;
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(invalidGatewayNormal).success).toBe(false);
        setCheckOutcome(invalidGatewayNormal, "model_duplicate_sequence", "failed");
        setCheckOutcome(invalidGatewayNormal, "one_outbound_request_per_kind", "failed");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(invalidGatewayNormal).success).toBe(false);

        const invalidGatewayFault = structuredClone(gateway);
        invalidGatewayFault.observations.call_kinds[2]!.reserve_then_crash.sink_receipts = 1;
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(invalidGatewayFault).success).toBe(false);
        setCheckOutcome(invalidGatewayFault, "reserve_then_crash_not_redispatched", "inconclusive");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(invalidGatewayFault).success).toBe(false);

        const mismatchedGatewayBinding = structuredClone(gateway);
        mismatchedGatewayBinding.observations.call_kinds[0]!.normal.competing_requests[1]!.attempt_id_commitment =
            hex("0");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(mismatchedGatewayBinding).success).toBe(false);

        const unboundGatewayTrial = structuredClone(gateway);
        unboundGatewayTrial.observations.trial_executions[0]!.gateway_request_bindings![0]!.logical_call_id_commitment =
            hex("0");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(unboundGatewayTrial).success).toBe(false);

        const duplicateRoute = structuredClone(guarded);
        duplicateRoute.deployment.routes.writer_b.route_id_commitment =
            duplicateRoute.deployment.routes.writer_a.route_id_commitment;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(duplicateRoute).success).toBe(false);

        const roleSpecificIdentityDomain = structuredClone(guarded) as Record<string, unknown>;
        const roleSpecificDeployment = roleSpecificIdentityDomain["deployment"] as {
            identity_commitment_spec: { domains: Record<string, unknown> };
        };
        roleSpecificDeployment.identity_commitment_spec.domains["worker_script_id"] =
            "openbot.identity.cloudflare_worker_script_id.writer_a.v1";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(roleSpecificIdentityDomain).success).toBe(false);

        const substitutedIdentityKey = structuredClone(guarded);
        substitutedIdentityKey.deployment.identity_commitment_spec.commitment_key_id_digest = hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(substitutedIdentityKey).success).toBe(false);

        const falseFifthReclaim = structuredClone(guarded);
        falseFifthReclaim.observations.capacity.fifth_claim_after_release_commits = 0;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(falseFifthReclaim).success).toBe(false);

        const wrongBookmarkSource = structuredClone(guarded);
        const firstWriter = wrongBookmarkSource.observations.trial_executions[0]!.writer_results[0]!;
        if (firstWriter.outcome === "committed") {
            firstWriter.bookmark_causal_readback.source_bookmark_commitment = hex("0");
        }
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(wrongBookmarkSource).success).toBe(false);

        const missingCapacityOperation = structuredClone(guarded);
        missingCapacityOperation.observations.capacity.operations.pop();
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(missingCapacityOperation).success).toBe(false);

        const incoherentDestroy = structuredClone(guarded);
        incoherentDestroy.observations.capacity.operations[1]!.outcome = "guarded_denial";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(incoherentDestroy).success).toBe(false);

        const falseDecisiveSnapshot = structuredClone(guarded);
        const capacitySnapshot = falseDecisiveSnapshot.observations.trial_executions[4]!.decisive_reads[0]!.snapshot;
        if (capacitySnapshot.kind === "capacity") capacitySnapshot.reserved = 3;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(falseDecisiveSnapshot).success).toBe(false);

        const unboundTranscript = structuredClone(guarded);
        unboundTranscript.checks[5]!.transcript_commitments[0]!.observation_commitment = hex("9");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(unboundTranscript).success).toBe(false);

        const emptyInflightCleanup = structuredClone(guarded);
        emptyInflightCleanup.cleanup.in_flight_requests.started_request_id_commitments = [];
        emptyInflightCleanup.cleanup.in_flight_requests.settled_request_id_commitments = [];
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(emptyInflightCleanup).success).toBe(false);

        const forcedScriptDelete = structuredClone(guarded) as Record<string, unknown>;
        const forcedCleanup = forcedScriptDelete["cleanup"] as {
            worker_script_deletions: Array<Record<string, unknown>>;
        };
        forcedCleanup.worker_script_deletions[0]!["force"] = true;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(forcedScriptDelete).success).toBe(false);

        const mismatchedCleanupTarget = structuredClone(guarded);
        mismatchedCleanupTarget.cleanup.absence_checks[0]!.cleanup_target_id_commitment = hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(mismatchedCleanupTarget).success).toBe(false);

        const incompleteFinalReadback = structuredClone(guarded);
        incompleteFinalReadback.cleanup.final_first_primary_readback.current_state_snapshots.pop();
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(incompleteFinalReadback).success).toBe(false);

        const publicSink = structuredClone(guarded);
        publicSink.setup.sink_runtime.public_sink_ingress_denied = false as never;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(publicSink).success).toBe(false);

        const writerRequestMismatch = structuredClone(gateway);
        writerRequestMismatch.observations.call_kinds[0]!.normal.competing_requests[0]!.request_id_commitment =
            hex("0");
        writerRequestMismatch.observations.trial_executions[0]!.gateway_request_bindings![0]!.request_id_commitment =
            hex("0");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(writerRequestMismatch).success).toBe(false);

        const fakeFaultResponse = structuredClone(gateway) as Record<string, unknown>;
        const faultObservations = fakeFaultResponse["observations"] as {
            trial_executions: Array<{ writer_results: Array<Record<string, unknown>> }>;
        };
        faultObservations.trial_executions[2]!.writer_results[0]!["response_commitment"] = hex("0");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(fakeFaultResponse).success).toBe(false);

        const falseDestroyOutcome = structuredClone(guarded) as Record<string, unknown>;
        const falseDestroyTrials = (
            falseDestroyOutcome["observations"] as {
                trial_executions: Array<{ trial_id: string; writer_results: Array<Record<string, unknown>> }>;
            }
        ).trial_executions;
        falseDestroyTrials.find(trial => trial.trial_id === "destroy_observed_capacity_release")!.writer_results[1]![
            "outcome"
        ] = "guarded_denial";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(falseDestroyOutcome).success).toBe(false);

        const twoFieldCapacitySubstitution = structuredClone(guarded);
        const wrongInstallation = twoFieldCapacitySubstitution.observations.capacity.operations.find(
            operation => operation.operation === "release_wrong_installation"
        )!;
        wrongInstallation.target.run_id_commitment = hex("f");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(twoFieldCapacitySubstitution).success).toBe(false);

        const falseAuditStaleHead = structuredClone(guarded);
        falseAuditStaleHead.observations.audit.operations.find(
            operation => operation.operation === "stale_sequence"
        )!.previous_head_hash_commitment = hex("a");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(falseAuditStaleHead).success).toBe(false);

        const reusedAuditAttempt = structuredClone(guarded);
        reusedAuditAttempt.observations.audit.operations.find(
            operation => operation.operation === "gap_sequence"
        )!.attempt_id_commitment = hex("3");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(reusedAuditAttempt).success).toBe(false);

        const swappedFaultKind = structuredClone(gateway) as Record<string, unknown>;
        const swappedFaultTrials = (
            swappedFaultKind["observations"] as {
                trial_executions: Array<{ trial_id: string; writer_results: Array<Record<string, unknown>> }>;
            }
        ).trial_executions;
        swappedFaultTrials.find(trial => trial.trial_id === "model_reserve_then_crash")!.writer_results[0]![
            "fault_kind"
        ] = "sink_response_lost";
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(swappedFaultKind).success).toBe(false);

        const wrongWriterReceipt = structuredClone(guarded) as Record<string, unknown>;
        const receiptWriter = (
            wrongWriterReceipt["observations"] as {
                trial_executions: Array<{ writer_results: Array<Record<string, unknown>> }>;
            }
        ).trial_executions[0]!.writer_results[0]!;
        (receiptWriter["bookmark_causal_readback"] as Record<string, unknown>)["writer_receipt_identity_commitment"] =
            hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(wrongWriterReceipt).success).toBe(false);

        const forgedGatewaySnapshot = structuredClone(gateway);
        forgedGatewaySnapshot.observations.trial_executions[1]!.decisive_reads[0]!.snapshot.losing_dispatches = 1;
        forgedGatewaySnapshot.observations.call_kinds[0]!.changed_digest.substituted_request_dispatches = 1;
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(forgedGatewaySnapshot).success).toBe(false);

        const copiedChildIdentity = structuredClone(guarded);
        const capacityTrial = copiedChildIdentity.observations.trial_executions.find(
            trial => trial.trial_id === "sandbox_capacity_contention"
        )!;
        capacityTrial.writer_results[4]!.child_process_id_commitment =
            capacityTrial.writer_results[0]!.child_process_id_commitment;
        capacityTrial.barrier.child_process_id_commitments[4] =
            capacityTrial.writer_results[0]!.child_process_id_commitment;
        capacityTrial.barrier.readiness_child_process_id_commitments[4] =
            capacityTrial.writer_results[0]!.child_process_id_commitment;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(copiedChildIdentity).success).toBe(false);

        const wrongSinkRuntime = structuredClone(gateway);
        wrongSinkRuntime.observations.call_kinds[0]!.normal.sink_rpc.runtime_version_commitment = hex("0");
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(wrongSinkRuntime).success).toBe(false);

        const unboundCleanupTranscript = structuredClone(guarded);
        unboundCleanupTranscript.cleanup.cleanup_transcript_commitment.observation_commitment = hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(unboundCleanupTranscript).success).toBe(false);

        const substitutedCleanupResponse = structuredClone(guarded);
        substitutedCleanupResponse.cleanup.cleanup_transcript_commitment.response_commitment = hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(substitutedCleanupResponse).success).toBe(false);

        const wrongCapacityGuard = structuredClone(guarded);
        const deniedCapacityOperation = wrongCapacityGuard.observations.capacity.operations.find(
            operation => operation.outcome === "guarded_denial"
        );
        if (deniedCapacityOperation?.outcome === "guarded_denial")
            deniedCapacityOperation.guard_kind = "unique_reservation" as never;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(wrongCapacityGuard).success).toBe(false);

        const wrongAuditGuard = structuredClone(guarded);
        const deniedAuditOperation = wrongAuditGuard.observations.audit.operations.find(
            operation => operation.outcome === "guarded_denial"
        );
        if (deniedAuditOperation?.outcome === "guarded_denial")
            deniedAuditOperation.guard_kind = "foreign_key_tripwire" as never;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(wrongAuditGuard).success).toBe(false);

        const repeatedRaceOrientation = structuredClone(guarded);
        const swappedRace = repeatedRaceOrientation.observations.trial_executions.find(
            trial => trial.trial_id === "equal_release_race_roles_swapped"
        )!;
        const swappedCreate = swappedRace.writer_results.find(result => result.batch_operation === "guarded_create")!;
        const swappedRevoke = swappedRace.writer_results.find(result => result.batch_operation === "grant_revoke")!;
        swappedCreate.writer_role = "writer_a";
        swappedCreate.script_commitment = repeatedRaceOrientation.deployment.writer_a_script_commitment;
        swappedCreate.version_commitment = repeatedRaceOrientation.deployment.writer_a_version_commitment;
        swappedRevoke.writer_role = "writer_b";
        swappedRevoke.script_commitment = repeatedRaceOrientation.deployment.writer_b_script_commitment;
        swappedRevoke.version_commitment = repeatedRaceOrientation.deployment.writer_b_version_commitment;
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(repeatedRaceOrientation).success).toBe(false);

        const substitutedFirstPhaseAttempt = structuredClone(guarded);
        const firstPhaseWriter = substitutedFirstPhaseAttempt.observations.trial_executions.find(
            trial => trial.trial_id === "audit_head_contention"
        )!.writer_results[0]!;
        if (firstPhaseWriter.audit_binding !== null) firstPhaseWriter.audit_binding.attempt_id_commitment = hex("4");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(substitutedFirstPhaseAttempt).success).toBe(false);

        const winnerFollowUp = structuredClone(guarded);
        winnerFollowUp.observations.audit.operations.find(
            operation => operation.operation === "follow_up_append"
        )!.writer_role = "writer_a";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(winnerFollowUp).success).toBe(false);

        const swappedDigestVariants = structuredClone(gateway);
        const changedObservation = swappedDigestVariants.observations.call_kinds[0]!.changed_digest;
        changedObservation.competing_requests[0]!.request_variant = "substituted";
        changedObservation.competing_requests[1]!.request_variant = "exact";
        const changedTrial = swappedDigestVariants.observations.trial_executions.find(
            trial => trial.trial_id === "model_changed_digest"
        )!;
        changedTrial.gateway_request_bindings![0]!.request_variant = "substituted";
        changedTrial.gateway_request_bindings![1]!.request_variant = "exact";
        expect(UntrustedGatewayReservationProbeReportV1Schema.safeParse(swappedDigestVariants).success).toBe(false);

        const substitutedCapacityTuple = structuredClone(guarded);
        substitutedCapacityTuple.observations.capacity.exact_release_target.run_id_commitment = hex("f");
        for (const operation of substitutedCapacityTuple.observations.capacity.operations) {
            if (operation.operation !== "release_wrong_run") operation.target.run_id_commitment = hex("f");
        }
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(substitutedCapacityTuple).success).toBe(false);

        const substitutedCapacityRole = structuredClone(guarded);
        substitutedCapacityRole.observations.capacity.operations.find(
            operation => operation.operation === "record_exact_destroy"
        )!.writer_role = "writer_b";
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(substitutedCapacityRole).success).toBe(false);

        const substitutedCapacityReceipt = structuredClone(guarded);
        const recordedRelease = substitutedCapacityReceipt.observations.capacity.operations.find(
            operation => operation.operation === "release_exact_destroy"
        )!;
        if (recordedRelease.outcome === "committed") recordedRelease.writer_receipt_identity_commitment = hex("0");
        expect(UntrustedD1GuardedCreateProbeReportV1Schema.safeParse(substitutedCapacityReceipt).success).toBe(false);
    }, 30_000);

    it("requires credential-free global tools, one resource-rule family, and the 128 KiB result limit", () => {
        const credentialed = {
            ...connectorReport("global"),
            auth_setup: { kind: "oauth", scope_digests: [hex("a")] },
        };
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(credentialed).success).toBe(false);

        const mixed = structuredClone(connectorReport("global"));
        mixed.tools.push(structuredClone(connectorReport("specific").tools[0]!));
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(mixed).success).toBe(false);

        const oversized = structuredClone(connectorReport());
        oversized.tools[0]!.enforced_result_max_bytes = 128 * 1024 + 1;
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(oversized).success).toBe(false);
    });

    it("rejects raw connector IDs and secret-bearing fields", () => {
        expect(
            UntrustedConnectorProbeReportV1Schema.safeParse({
                ...connectorReport(),
                provider_deployment_id: "raw-provider-id",
            }).success
        ).toBe(false);
        expect(
            UntrustedConnectorProbeReportV1Schema.safeParse({
                ...connectorReport(),
                metorial_mcp_session_url: [
                    "https://mcp.metorial.example/session?",
                    "access_",
                    "token=metorial_bearer_capability_fixture",
                ].join(""),
            }).success
        ).toBe(false);
        expect(
            UntrustedConnectorProbeReportV1Schema.safeParse({
                ...connectorReport(),
                provider_auth_config_ref: "auth-config-bearer-reference-fixture",
            }).success
        ).toBe(false);
    });

    it("rejects future reports, excessive TTLs, and transcript reuse", () => {
        const future = connectorReport();
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: observedAt - 1 })).toEqual({
            success: false,
            code: "future_probe_report",
        });
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: Number.NaN })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: Number.POSITIVE_INFINITY })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: -1 })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });

        const longLived = { ...connectorReport(), valid_until: completedAt + ITEM2_MAX_REPORT_TTL_MS_V1 + 1 };
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(longLived).success).toBe(false);

        const reused = structuredClone(connectorReport());
        reused.checks[1]!.transcript_commitments[0]!.reference_commitment =
            reused.checks[0]!.transcript_commitments[0]!.reference_commitment;
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(reused).success).toBe(false);
    });

    it("returns typed denials for cyclic, getter, and hostile proxy input", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic["self"] = cyclic;
        expect(canonicalUntrustedProbeReportBytesV1(cyclic, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });

        const getter = Object.defineProperty({}, "kind", {
            enumerable: true,
            get: () => {
                throw new Error("getter ran");
            },
        });
        expect(canonicalUntrustedProbeReportBytesV1(getter, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });

        const proxy = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("hostile proxy");
                },
            }
        );
        expect(canonicalUntrustedProbeReportBytesV1(proxy, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
    });

    it("canonicalizes key order and matches a fixed digest vector", async () => {
        const report = connectorReport();
        const reordered = Object.fromEntries(Object.entries(report).reverse());
        const left = await digestUntrustedProbeReportV1(report, { as_of_ms: asOf });
        const right = await digestUntrustedProbeReportV1(reordered, { as_of_ms: asOf });
        expect(left).toEqual(right);
        expect(left.success && left.digest).toBe("30d3293083164940ca977702600e0233e14c49622466f524659869e92c060fb4");
    });

    it("checks only content integrity and retains the untrusted report name", async () => {
        const report = await withReportDigest(connectorReport());
        const inspected = await inspectUntrustedProbeReportIntegrityV1(report, { as_of_ms: asOf });
        expect(inspected.success).toBe(true);
        if (inspected.success) expect(inspected.report.kind).toBe("first_connector");

        const forged = { ...report, completed_at: completedAt + 1 };
        expect(await inspectUntrustedProbeReportIntegrityV1(forged, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "report_digest_mismatch",
        });
    });
});

describe("D1 report adjudication", () => {
    const trustedExpectations = (gateId: "d1_guarded_create" | "gateway_reservation") => ({
        schema_version: 1 as const,
        expected_platform: "cloudflare_d1_deployed" as const,
        gate_id: gateId,
        required_check_set_version: 1,
        as_of_ms: asOf,
        expected_report_digest:
            gateId === "d1_guarded_create"
                ? "bf6c9ed1700ab5422d7f49cfc5125ea257a049bae0ef6294e7584318a99b830b"
                : "54629ea1a0e9ccd3aa5e198f30cd1f4bc99327cb6bc7801ad9e30fe5a0ae4431",
        expected_deployment_digest: "2d6999645a8721fa4a6abae3a349402ae973e0970f04498a718b602caf5d27ce",
        expected_configuration_digest: hex("1"),
        expected_probe_definition_digest: hex("4"),
        expected_collector_build_digest: hex("5"),
        expected_installation_digest: hex("2"),
        expected_environment_digest: hex("3"),
        expected_probe_run_digest: hex("6"),
        expected_commitment_key_id_digest: hex("7"),
    });

    it("returns only a non-authoritative operator-review assessment", async () => {
        for (const [gateId, candidate] of [
            ["d1_guarded_create", guardedReport()],
            ["gateway_reservation", gatewayReport()],
        ] as const) {
            const report = await withReportDigest(candidate);
            const result = await assessD1ProbeReportForOperatorReviewV1(report, trustedExpectations(gateId));
            expect(result.success).toBe(true);
            if (!result.success) continue;
            expect(result).toMatchObject({
                assessment: "eligible_for_operator_review",
                authoritative: false,
                gate_promotion_allowed: false,
                attestation_created: false,
            });
            expect(JSON.stringify(result)).not.toMatch(/"(?:passed|ready|verified)"/u);
        }
    });

    it("denies a current, integrity-valid report when any check did not pass", async () => {
        const candidate = guardedReport();
        setCheckOutcome(candidate, "audit_head_contention", "failed");
        const report = await withReportDigest(candidate);
        const expectations = {
            ...trustedExpectations("d1_guarded_create"),
            expected_report_digest: "9667142424e158defd8d4e27e232a2426e3574273f675b425b324ffb5e8f9372",
        };
        expect(await assessD1ProbeReportForOperatorReviewV1(report, expectations)).toEqual({
            success: false,
            code: "check_not_passed",
        });
    });

    it("binds every trusted report and deployment digest", async () => {
        const report = await withReportDigest(guardedReport());
        const cases = [
            ["expected_report_digest", "unexpected_report_digest"],
            ["expected_deployment_digest", "unexpected_deployment_digest"],
            ["expected_configuration_digest", "unexpected_configuration_digest"],
            ["expected_probe_definition_digest", "unexpected_probe_definition_digest"],
            ["expected_collector_build_digest", "unexpected_collector_build_digest"],
            ["expected_installation_digest", "unexpected_installation_digest"],
            ["expected_environment_digest", "unexpected_environment_digest"],
            ["expected_probe_run_digest", "unexpected_probe_run_digest"],
            ["expected_commitment_key_id_digest", "unexpected_commitment_key_id_digest"],
        ] as const;
        for (const [field, code] of cases) {
            const expectations = { ...trustedExpectations("d1_guarded_create"), [field]: hex("f") };
            expect(await assessD1ProbeReportForOperatorReviewV1(report, expectations)).toEqual({
                success: false,
                code,
            });
        }
    });

    it("recomputes the domain-separated deployment digest", async () => {
        const report = await withReportDigest(guardedReport());
        const mutated = structuredClone(report);
        (mutated["deployment"] as { wrangler_version: string }).wrangler_version = "4.33.2";
        const reportDigest = await digestUntrustedProbeReportV1(mutated, { as_of_ms: asOf });
        if (!reportDigest.success) throw new Error(reportDigest.code);
        mutated["report_digest"] = reportDigest.digest;
        expect(
            await assessD1ProbeReportForOperatorReviewV1(mutated, {
                ...trustedExpectations("d1_guarded_create"),
                expected_report_digest: mutated["report_digest"],
                expected_deployment_digest: report["deployment_digest"],
            })
        ).toEqual({ success: false, code: "deployment_digest_mismatch" });

        const deploymentDigest = await digestD1DeploymentCommitmentV1(mutated["deployment"]);
        if (!deploymentDigest.success) throw new Error(deploymentDigest.code);
        mutated["deployment_digest"] = deploymentDigest.digest;
        const reboundReportDigest = await digestUntrustedProbeReportV1(mutated, { as_of_ms: asOf });
        if (!reboundReportDigest.success) throw new Error(reboundReportDigest.code);
        mutated["report_digest"] = reboundReportDigest.digest;
        expect(
            await assessD1ProbeReportForOperatorReviewV1(mutated, {
                ...trustedExpectations("d1_guarded_create"),
                expected_report_digest: mutated["report_digest"],
                expected_deployment_digest: report["deployment_digest"],
            })
        ).toEqual({ success: false, code: "unexpected_deployment_digest" });
    });

    it("denies stale reports, another gate, and another check-set version", async () => {
        const report = await withReportDigest(guardedReport());
        expect(
            await assessD1ProbeReportForOperatorReviewV1(report, {
                ...trustedExpectations("d1_guarded_create"),
                as_of_ms: validUntil,
            })
        ).toEqual({ success: false, code: "report_not_current" });
        expect(
            await assessD1ProbeReportForOperatorReviewV1(report, {
                ...trustedExpectations("d1_guarded_create"),
                gate_id: "gateway_reservation",
            })
        ).toEqual({ success: false, code: "unexpected_gate" });
        expect(
            await assessD1ProbeReportForOperatorReviewV1(report, {
                ...trustedExpectations("d1_guarded_create"),
                required_check_set_version: 2,
            })
        ).toEqual({ success: false, code: "unexpected_check_set_version" });
    });

    it("denies a passed claim when the legal observation is false", async () => {
        const candidate = guardedReport();
        candidate.observations.capacity.wrong_target_releases[0]!.state_changes = 1 as never;
        const report = { ...candidate, report_digest: hex("0") };
        expect(await assessD1ProbeReportForOperatorReviewV1(report, trustedExpectations("d1_guarded_create"))).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
    });

    it("returns typed denials for hostile expectations and deployment inputs", async () => {
        const hostileExpectations = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("hostile expectations");
                },
            }
        );
        expect(await assessD1ProbeReportForOperatorReviewV1({}, hostileExpectations)).toEqual({
            success: false,
            code: "invalid_adjudication_expectations",
        });

        const hostileDeployment = Object.defineProperty({}, "platform", {
            enumerable: true,
            get: () => {
                throw new Error("hostile deployment");
            },
        });
        expect(await digestD1DeploymentCommitmentV1(hostileDeployment)).toEqual({
            success: false,
            code: "invalid_deployment",
        });
    });

    it("denies typed collector failures and a forged final observation-set digest", async () => {
        const failureCandidate = {
            ...common,
            kind: "d1_guarded_create" as const,
            collection_status: "inconclusive" as const,
            failure_stage: "trial" as const,
            failure_code: "timeout" as const,
            operator_action_required: true as const,
            checks: [],
        };
        const failureDigest = await digestUntrustedProbeReportV1(failureCandidate, { as_of_ms: asOf });
        if (!failureDigest.success) throw new Error(failureDigest.code);
        const failureReport = { ...failureCandidate, report_digest: failureDigest.digest };
        expect(
            await assessD1ProbeReportForOperatorReviewV1(failureReport, trustedExpectations("d1_guarded_create"))
        ).toEqual({ success: false, code: "collector_inconclusive" });

        const report = await withReportDigest(guardedReport());
        const forged = structuredClone(report);
        forged["final_observation_set_commitment"] = hex("f");
        const cleanup = forged["cleanup"] as {
            final_first_primary_readback: { observation_set_commitment: string };
            cleanup_transcript_response_projection: {
                final_observation_set_digest: string;
                projection_hmac_commitment: string;
            };
        };
        cleanup.final_first_primary_readback.observation_set_commitment = hex("f");
        cleanup.cleanup_transcript_response_projection.final_observation_set_digest = hex("f");
        const forgedDigest = await digestUntrustedProbeReportV1(forged, { as_of_ms: asOf });
        if (!forgedDigest.success) throw new Error(forgedDigest.code);
        forged["report_digest"] = forgedDigest.digest;
        expect(
            await assessD1ProbeReportForOperatorReviewV1(forged, {
                ...trustedExpectations("d1_guarded_create"),
                expected_report_digest: forgedDigest.digest,
            })
        ).toEqual({ success: false, code: "final_observation_set_digest_mismatch" });
    });
});
