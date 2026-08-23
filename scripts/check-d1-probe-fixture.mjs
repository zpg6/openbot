import { readFile } from "node:fs/promises";

const fixturePath = "docs/fixtures/d1-concurrency-probe.json";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const item2Fixture = JSON.parse(await readFile("docs/fixtures/item-2-gates.json", "utf8"));
const errors = [];
const check = (condition, message) => {
    if (!condition) errors.push(message);
};
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

check(fixture.schema_version === 1, "schema_version must be 1");
check(fixture.kind === "d1_concurrency_probe_deployment_contract", "kind changed");
check(fixture.status === "not_run", "the checked-in D1 probe must remain not_run");
check(fixture.platform === "cloudflare_d1_deployed", "only deployed Cloudflare D1 can satisfy this contract");
check(fixture.authority?.fixture_is_evidence === false, "the fixture must not claim evidence");
check(fixture.authority?.local_or_miniflare_eligible === false, "local and Miniflare runs must remain ineligible");
check(fixture.authority?.may_promote_gate === false, "the fixture must not promote a gate");
check(fixture.authority?.operator_attestation_required === true, "operator attestation must remain required");
check(
    same(fixture.authority?.gate_statuses, {
        d1_guarded_create: { status: "not_run", deny_code: "control_store_unverified" },
        gateway_reservation: { status: "not_run", deny_code: "gateway_reservation_unverified" },
    }),
    "D1 gate statuses or denial codes changed"
);
check(
    Object.values(fixture.mutation_state ?? {}).every(value => value === false),
    "the contract fixture must record no mutation, credential, migration, schema, or observation"
);
check(
    Array.isArray(fixture.observations) && fixture.observations.length === 0,
    "the fixture must have no observations"
);

const item2Gates = new Map((item2Fixture.gates ?? []).map(gate => [gate.id, gate]));
check(
    same(item2Gates.get("d1_guarded_create")?.required_checks, [
        "revoke_linearizes_first",
        "create_linearizes_first",
        "concurrent_history_is_legal",
        "two_independent_writers",
        "sandbox_capacity_contention",
        "destroy_observed_capacity_release",
        "audit_head_contention",
    ]),
    "Item 2 guarded-create checks must cover histories, capacity, and audit contention"
);
check(
    same(item2Gates.get("gateway_reservation")?.required_checks, [
        "model_duplicate_sequence",
        "provider_tool_duplicate_sequence",
        "code_duplicate_sequence",
        "one_outbound_request_per_kind",
        "one_spent_reservation_per_kind",
        "changed_digest_denied",
        "reserve_then_crash_not_redispatched",
        "dispatch_response_lost_not_redispatched",
        "two_independent_writers",
    ]),
    "Item 2 gateway checks must cover every call kind and ambiguous-response history"
);

const rules = fixture.resource_rules ?? {};
check(rules.generated_name_prefix === "openbot-d1-probe-", "generated resource prefix changed");
check(rules.generated_name_pattern === "^openbot-d1-probe-[a-z0-9]{16}$", "safe-name pattern changed");
check(rules.new_disposable_database_required === true, "a new disposable database is required");
check(rules.production_database_denied === true, "production databases must be denied");
check(rules.synthetic_ids_and_payloads_only === true, "only synthetic IDs and payloads are allowed");
check(rules.returned_resource_ids_must_match_cleanup_ids === true, "cleanup must bind returned resource IDs");

const deployment = fixture.deployment ?? {};
check(deployment.database?.count === 1, "the probe requires exactly one D1 database");
check(deployment.database?.same_exact_database_id_for_all_workers === true, "all Workers must bind one exact D1 ID");
check(deployment.database?.exact_database_id_commitment_required === true, "the database ID needs a commitment");
check(deployment.database?.read_replication_setting_required === true, "the read-replication setting is required");
check(deployment.database?.read_replication === "enabled", "read replication must be enabled for the deployed probe");
check(deployment.database?.product_tables_allowed === false, "product tables are forbidden in the probe database");
check(
    deployment.database?.probe_sql_location === "ephemeral_non_migration_setup",
    "probe SQL must stay out of migrations"
);
check(Array.isArray(deployment.workers) && deployment.workers.length === 3, "two writers and one sink are required");
check(
    same(
        deployment.workers?.map(worker => worker.role),
        ["writer_a", "writer_b", "sink_readback"]
    ),
    "required Worker roles changed"
);
for (const worker of deployment.workers ?? []) {
    check(worker.separate_script === true, `${worker.role} must be a separate script`);
    check(worker.script_id_commitment_required === true, `${worker.role} must commit its script ID`);
    check(worker.version_id_commitment_required === true, `${worker.role} must commit its version ID`);
    check(worker.exact_database_binding_required === true, `${worker.role} must bind the exact disposable D1 ID`);
}
check(deployment.distinct_writer_script_and_version_ids_required === true, "writers need distinct deployments");
check(
    deployment.all_worker_script_and_version_ids_pairwise_distinct_required === true,
    "writer and sink script/version identities must all differ"
);
check(deployment.sink_deployment_recorded_separately === true, "sink deployment must be recorded separately");
check(deployment.compatibility_date_required === true, "compatibility date is required");
check(deployment.public_exposure?.workers_dev === false, "workers.dev must stay disabled");
check(deployment.public_exposure?.preview_urls === false, "preview URLs must stay disabled");
check(
    deployment.public_exposure?.sink_readback_routes === "one_temporary_access_protected_exact_get_only",
    "the sink/readback Worker needs one narrow temporary readback route"
);
check(
    deployment.public_exposure?.writer_routes === "temporary_access_protected_exact_post_only",
    "writer routes must be temporary, Access protected, and exact POST only"
);
check(deployment.public_exposure?.request_body_accepts_sql === false, "trigger requests must not accept SQL");
check(
    deployment.public_exposure?.request_body_accepts_table_names === false,
    "trigger requests must not accept table names"
);
check(
    deployment.public_exposure?.one_use_run_bound_request_required === true,
    "writer requests must be one-use and bound to the generated probe run"
);
check(deployment.public_exposure?.readback_accepts_parameters === false, "readback must accept no query parameters");
check(
    deployment.public_exposure?.readback_response === "fixed_synthetic_schema_for_generated_probe_run",
    "readback must return one fixed synthetic schema"
);
check(
    deployment.workers?.find(worker => worker.role === "sink_readback")?.trigger ===
        "private_service_binding_sink_and_access_protected_exact_readback",
    "sink recording must use a private binding and readback must use the narrow Access route"
);

const execution = fixture.execution ?? {};
check(execution.writer_processes === 2, "the operator driver needs two processes");
check(execution.same_request_promise_all_eligible === false, "same-request Promise.all is not two-writer evidence");
check(execution.cross_network_requests_required === true, "writer requests must cross the network");
check(execution.automatic_application_retries === 0, "automatic retries are forbidden");
check(execution.ambiguous_request_retry_allowed === false, "ambiguous requests must not be retried");
check(execution.ready_barrier_required === true, "a two-writer barrier is required");
check(execution.barrier_timeout_result === "inconclusive", "barrier timeout must be inconclusive");
check(execution.writer_session_constraint === "first-primary", "writer sessions must start first-primary");
check(execution.decisive_readback_session_constraint === "first-primary", "decisive reads must start first-primary");
check(execution.bookmark_readback_is_decisive === false, "bookmark reads cannot replace first-primary readback");
check(execution.writer_bookmark_required === true, "writer bookmarks are required");
check(execution.bookmark_causal_read_required === true, "bookmark causal reads are required");
check(
    execution.served_by_primary_absent_or_false === "inconclusive",
    "missing or false served_by_primary metadata must be inconclusive"
);
check(
    same(Object.keys(execution.d1_result_validation ?? {}).sort(), [
        "changed_db",
        "changes",
        "duration",
        "returning_identity_and_cardinality",
        "rows_read",
        "rows_written",
        "served_by_primary",
        "served_by_region",
        "size_after",
        "statement_count",
        "success",
    ]),
    "exact D1Result validation fields changed"
);
check(
    execution.d1_result_validation?.returning_identity_and_cardinality ===
        "exact_authority_with_first_primary_readback",
    "affected-row authority must come from exact RETURNING rows plus first-primary readback"
);
check(execution.d1_result_validation?.changes === "recorded_non_authoritative", "D1 meta.changes is not authority");
check(
    execution.d1_result_validation?.rows_written === "recorded_non_authoritative_nonnegative_integer",
    "D1 meta.rows_written is not authority"
);
check(
    same(execution.batch_outcome_validation, {
        committed: "exact_returning_rows_result_shape_and_first_primary_readback",
        expected_tripwire_rollback: "recognized_d1_constraint_failure_and_first_primary_zero_row_readback",
        other_error: "inconclusive",
    }),
    "committed and expected-rollback batches need separate validation"
);
check(
    execution.unknown_malformed_contradictory_or_lost_worker_sink_or_d1_result === "inconclusive",
    "unknown, malformed, contradictory, or lost Worker, sink, or D1 results must be inconclusive"
);

const sink = fixture.sink ?? {};
check(
    sink.synthetic === true && sink.sink_ingress_private_service_binding_only === true,
    "synthetic sink ingress must remain private"
);
check(
    sink.readback_channel === "temporary_access_protected_exact_get_route",
    "final readback needs an implementable narrow channel"
);
check(
    sink.readback_route_retained_after_writer_routes_disabled === true,
    "cleanup must retain readback after intake closes"
);
check(
    sink.readback_route_removed_before_worker_deletion === true,
    "cleanup must remove readback before Worker deletion"
);
check(sink.records_every_request_before_response === true, "the sink must record before response");
check(sink.random_receipt_per_request === true, "the sink must issue a new random receipt for every request");
check(sink.deduplication === "none", "the sink must not deduplicate");
check(
    same(sink.dedupe_keys_forbidden, [
        "call_kind",
        "logical_call_id",
        "attempt_id",
        "reservation_id",
        "request_digest",
    ]),
    "sink deduplication exclusions changed"
);
check(sink.decisive_readback === "fresh_first_primary_session", "sink readback must use a fresh first-primary session");

check(fixture.probe_tables?.temporary_only === true, "probe tables must be temporary");
check(fixture.probe_tables?.migration_files_allowed === false, "probe tables must stay out of migrations");
check(fixture.probe_tables?.product_schema_promotion_allowed === false, "probe tables cannot become product schema");
check(fixture.probe_tables?.foreign_key_tripwires_required === true, "guarded batches need foreign-key tripwires");
check(
    fixture.probe_tables?.foreign_key_enforcement_readback_required === true,
    "setup must read back foreign-key enforcement"
);
check(
    fixture.probe_tables?.tripwire_failure_and_batch_rollback_canary_required === true,
    "setup must prove tripwire failure rolls back its batch"
);

const guarded = fixture.trials?.guarded_create ?? {};
check(
    same(guarded.cases, ["create_first", "revoke_first", "equal_release_race", "equal_release_race_roles_swapped"]),
    "guarded-create cases changed"
);
check(
    same(guarded.legal_histories, [
        {
            id: "create_before_revoke",
            create: "committed",
            revoke: "committed",
            authority: "revoked",
            confirmation_state: "consumed",
            live_confirmation_slot: "clear",
            run_state: "cancellation_requested",
            run_rows: 1,
            assertion_rows: 1,
            cancellation_outbox_rows: 1,
        },
        {
            id: "revoke_before_create",
            create: "foreign_key_tripwire_rollback",
            revoke: "committed",
            authority: "revoked",
            confirmation_state: "discarded",
            live_confirmation_slot: "clear",
            run_state: "absent",
            run_rows: 0,
            assertion_rows: 0,
            cancellation_outbox_rows: 0,
        },
    ]),
    "guarded-create legal histories changed"
);
check(guarded.any_other_history === "failed", "every other guarded-create history must fail");

const gateway = fixture.trials?.gateway_reservation ?? {};
check(same(gateway.call_kinds, ["model", "provider_tool", "code"]), "gateway coverage must include all call kinds");
check(
    same(gateway.exact_duplicate_fields, [
        "call_kind",
        "logical_call_id",
        "attempt_id",
        "sequence",
        "request_digest",
        "reservation_key",
    ]),
    "gateway contenders must duplicate one exact call kind, attempt, sequence, digest, and reservation"
);
check(
    same(gateway.normal_case, {
        spent_reservations: 1,
        sink_receipts: 1,
        winner_dispatches: 1,
        loser_dispatches: 0,
        loser_result: "guarded_denial",
    }),
    "gateway normal-case result changed"
);
check(
    same(gateway.fault_cases, [
        {
            id: "reserve_crash_before_sink",
            spent_reservations: 1,
            sink_receipts: 0,
            result: "outcome_unknown",
            retry: false,
        },
        {
            id: "sink_response_lost",
            spent_reservations: 1,
            sink_receipts: 1,
            result: "outcome_unknown",
            retry: false,
        },
    ]),
    "gateway fault histories changed"
);

const capacity = fixture.trials?.sandbox_capacity ?? {};
check(capacity.limit === 4 && capacity.contenders === 5, "capacity trial must run five contenders for four slots");
check(capacity.writer_deployments_used === 2, "capacity trial must use both writers");
check(
    capacity.committed_claims === 4 && capacity.denied_claims === 1,
    "capacity result must be four commits and one denial"
);
check(capacity.denied_platform_calls === 0, "the denied capacity claim must not call the platform sink");
check(
    same(capacity.release_requires, [
        "exact_installation_id",
        "exact_run_id",
        "exact_run_attempt_fence",
        "exact_claim_id",
        "exact_sandbox_id",
        "random_destroy_receipt",
        "sink_recorded_observation",
    ]),
    "capacity release binding changed"
);
check(capacity.release_before_observation === "no_change", "capacity cannot release before destroy observation");
check(capacity.release_with_mismatched_receipt === "no_change", "a mismatched receipt cannot release capacity");
check(
    capacity.release_replay === "no_change" && capacity.matching_release_count === 1,
    "capacity release must be one-time"
);
check(
    capacity.lost_or_unknown_destroy_response === "manual_required_capacity_remains_reserved",
    "ambiguous destroy must retain capacity"
);

const audit = fixture.trials?.audit_head ?? {};
check(audit.same_expected_sequence_and_hash === true, "audit contenders must bind the same head");
check(audit.different_event_ids_and_hashes === true, "audit contenders need different proposed events");
check(audit.barrier_before_append_required === true, "audit append needs a same-head barrier");
check(
    audit.first_phase_commits === 1 && audit.first_phase_conflicts === 1,
    "audit first phase must commit one and conflict one"
);
check(audit.loser_batch_result === "rolled_back", "the losing audit batch must roll back");
check(audit.follow_up?.new_attempt_id === true, "audit follow-up needs a new attempt ID");
check(audit.follow_up?.new_first_primary_head_read === true, "audit follow-up must reread first-primary");
check(audit.follow_up?.automatic_retry === false, "audit follow-up is not an automatic retry");
check(audit.follow_up?.next_sequence_commits === 1, "audit follow-up must commit the next sequence");
check(
    audit.final_chain_entries === 2 && audit.final_chain_must_verify === true,
    "the final two-entry chain must verify"
);

const report = fixture.report_requirements ?? {};
check(report.report_platform_literal === "cloudflare_d1_deployed", "deployed reports need the exact platform literal");
check(report.database_id_commitment === true, "deployed reports need a database-ID commitment");
check(report.writer_deployment_commitments === 2, "deployed reports need two writer commitments");
check(report.sink_deployment_commitment === true, "deployed reports need the sink deployment commitment");
check(report.read_replication_setting === true, "deployed reports need the read-replication setting");
check(report.served_by_primary_observed_true === true, "deployed reports must record true served_by_primary metadata");
check(report.compatibility_date === true, "deployed reports need the compatibility date");
check(report.bookmarks_and_result_meta === true, "deployed reports need bookmarks and D1Result metadata");
check(report.redacted_transcript_commitments === true, "deployed reports need redacted transcript commitments");
check(report.all_required_trials_conclusive === true, "all required trials must be conclusive");
check(
    report.deployment_commitments_semantically_coherent === true,
    "deployment commitments must agree on distinct Workers and one database"
);
check(report.worker_deployment_commitments_pairwise_distinct === true, "all Worker commitments must be distinct");
check(report.all_worker_database_commitments_equal === true, "all Worker commitments must bind one database");
check(report.external_operator_review_and_signature === true, "deployed reports require external review and signature");

const cleanup = fixture.cleanup ?? {};
check(cleanup.initial_status === "not_run", "checked-in cleanup status must remain not_run");
check(
    same(cleanup.order, [
        "close_stored_run_fence_and_disable_writer_routes_and_access_entry_points",
        "settle_or_mark_unknown_in_flight_requests",
        "capture_final_first_primary_readback_through_retained_exact_access_route",
        "disable_and_delete_exact_readback_route_and_access_entry_point",
        "delete_exact_writer_a_and_writer_b_deployments",
        "delete_exact_sink_readback_deployment",
        "delete_exact_remaining_access_service_bindings_and_driver_configuration",
        "delete_exact_disposable_d1_database_last",
        "confirm_recorded_resource_ids_absent",
    ]),
    "cleanup order changed"
);
check(cleanup.validate_generated_prefix_before_each_delete === true, "cleanup must validate generated names");
check(cleanup.validate_returned_resource_id_before_each_delete === true, "cleanup must validate returned IDs");
check(cleanup.ambiguous_delete_result === "manual_required", "ambiguous deletion must require manual work");
check(cleanup.unknown_in_flight_result === "manual_required", "unknown in-flight work must require manual work");
check(cleanup.failed_absence_check === "manual_required", "failed absence checks must require manual work");
check(cleanup.request_success_alone_proves_cleanup === false, "a delete response alone cannot prove cleanup");

const serialized = JSON.stringify(fixture);
for (const forbidden of ['"status":"passed"', '"may_promote_gate":true', '"fixture_is_evidence":true']) {
    check(!serialized.includes(forbidden), `forbidden authority claim found: ${forbidden}`);
}

if (errors.length > 0) {
    for (const error of errors) console.error(`d1-probe fixture: ${error}`);
    process.exitCode = 1;
} else {
    console.log("D1 concurrency probe fixture is blocked, non-authoritative, and internally consistent.");
}
