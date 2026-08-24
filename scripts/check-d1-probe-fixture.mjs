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
    item2Gates.get("d1_guarded_create")?.operator_review_assessment_required === true,
    "D1 guarded-create evidence needs a pure operator-review assessment before signing"
);
check(
    item2Gates.get("gateway_reservation")?.operator_review_assessment_required === true,
    "gateway evidence needs a pure operator-review assessment before signing"
);
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
check(
    rules.synthetic_probe_domain_ids_and_payloads_only === true,
    "only probe-domain IDs and payloads may be synthetic"
);
check(rules.cloudflare_account_and_zone_are_real === true, "Cloudflare account and zone IDs are operational IDs");
check(rules.returned_resource_ids_must_match_cleanup_ids === true, "cleanup must bind returned resource IDs");

const deployment = fixture.deployment ?? {};
const preflightVerification = deployment.preflight_verification ?? {};
check(preflightVerification.shape_only_plan_accepted === false, "shape-only D1 preflight plans must deny");
check(
    preflightVerification.complete_plan_recompiled_from_request_and_hmac_key === true,
    "D1 preflight verification must recompile the complete plan"
);
check(
    preflightVerification.canonical_plan_bytes_must_match === true,
    "D1 preflight verification must compare canonical plan bytes"
);
check(preflightVerification.database_jurisdiction_bound === true, "D1 preflight must bind the database jurisdiction");
check(
    preflightVerification.canonical_https_dns_origin_required === true &&
        preflightVerification.origin_path_port_credentials_query_and_fragment_forbidden === true,
    "D1 preflight must require one canonical HTTPS DNS origin"
);
check(
    preflightVerification.exact_routes_derived_under_fixed_prefix === true &&
        preflightVerification.route_target_script_and_method_bound === true,
    "D1 preflight must derive exact role-bound routes"
);
check(
    preflightVerification.single_access_application_path_derived === true &&
        preflightVerification.origin_access_path_and_route_patterns_hmac_committed === true,
    "D1 preflight must derive and commit the narrow Access path and route patterns"
);
check(
    preflightVerification.deployment_must_verify_zone_and_proxied_dns === true,
    "D1 deployment must verify the planned origin against the zone and proxied DNS"
);
check(
    preflightVerification.untrusted_route_readback_inspector_implemented === true &&
        preflightVerification.zone_id_account_status_type_and_paused_bound === true &&
        preflightVerification.probe_hostname_must_belong_to_zone === true,
    "D1 route precheck must bind the planned origin to one usable Cloudflare zone"
);
check(
    preflightVerification.exact_name_proxied_dns_query_required === true &&
        preflightVerification.complete_dns_pagination_and_unique_records_required === true &&
        JSON.stringify(preflightVerification.accepted_dns_record_types) === JSON.stringify(["A", "AAAA", "CNAME"]),
    "D1 route precheck must require a complete exact-name proxied DNS readback"
);
check(
    preflightVerification.route_readback_inspection_eligible_for_deployment === false &&
        preflightVerification.credentialed_cloudflare_readback_adapter_implemented === true,
    "the credentialed Cloudflare reader must remain separate from deployment authority"
);
check(
    preflightVerification.verified_context_is_opaque_and_in_memory_only === true,
    "the verified D1 preflight context must remain opaque and in memory"
);
check(
    preflightVerification.resolved_request_and_plan_deeply_frozen === true,
    "resolved D1 preflight data must be deeply frozen"
);
check(
    preflightVerification.hmac_key_retained_or_serialized === false,
    "the D1 preflight verifier must not retain or serialize the HMAC key"
);
check(
    preflightVerification.performs_deployment === false && preflightVerification.authoritative === false,
    "D1 preflight verification must perform no deployment and grant no authority"
);
const routeReader = deployment.cloudflare_route_reader ?? {};
check(
    routeReader.api_origin === "https://api.cloudflare.com/client/v4" &&
        JSON.stringify(routeReader.http_methods) === JSON.stringify(["GET"]) &&
        routeReader.zone_details_and_dns_list_only === true,
    "the D1 Cloudflare reader must use only the fixed read endpoints"
);
check(
    routeReader.zone_read_and_dns_read_for_exact_zone_required === true &&
        routeReader.authorization_scheme === "bearer_api_token" &&
        routeReader.token_persisted_or_serialized === false,
    "the D1 Cloudflare reader needs a narrow zone token and must not retain it"
);
check(
    routeReader.redirects_followed === false &&
        routeReader.automatic_retries === 0 &&
        routeReader.response_limit_bytes === 262144 &&
        routeReader.aggregate_response_limit_bytes === 1048576 &&
        routeReader.total_timeout_ms === 20000 &&
        routeReader.accept_encoding === "identity" &&
        routeReader.dns_per_page === 1000 &&
        routeReader.dns_page_limit === 64,
    "the D1 Cloudflare reader transport limits changed"
);
check(
    routeReader.operator_command_registered === true &&
        routeReader.operator_command === "pnpm d1-probe:check-route" &&
        routeReader.arguments_allowed === false &&
        routeReader.stdin?.kind === "canonical_route_check_command_v1" &&
        routeReader.stdin?.maximum_bytes === 2097152 &&
        routeReader.stdin?.optional_single_trailing_lf === true &&
        routeReader.commitment_key_input?.file_descriptor === 3 &&
        routeReader.commitment_key_input?.maximum_bytes === 128 &&
        JSON.stringify(routeReader.commitment_key_input?.allowed_descriptor_types) ===
            JSON.stringify(["fifo", "socket"]) &&
        routeReader.commitment_key_input?.environment_fallback === false &&
        routeReader.api_token_input?.file_descriptor === 4 &&
        routeReader.api_token_input?.maximum_bytes === 256 &&
        JSON.stringify(routeReader.api_token_input?.allowed_descriptor_types) === JSON.stringify(["fifo", "socket"]) &&
        routeReader.api_token_input?.environment_fallback === false &&
        routeReader.stdout === "canonical_non_authoritative_inspection_only" &&
        routeReader.stderr === "fixed_error_code_only" &&
        routeReader.performs_mutation === false &&
        routeReader.performs_deployment === false &&
        routeReader.gate_promotion_allowed === false &&
        routeReader.authoritative === false,
    "the D1 Cloudflare reader command boundary changed"
);
check(
    deployment.operational_identity?.account_id_hmac_commitment_required === true,
    "account ID needs an HMAC commitment"
);
check(deployment.operational_identity?.zone_id_hmac_commitment_required === true, "zone ID needs an HMAC commitment");
check(
    deployment.operational_identity?.identity_commitment_algorithm === "hmac-sha256-v1",
    "identity commitment algorithm changed"
);
check(
    deployment.operational_identity?.shared_preimage_domain_per_identity_type === true,
    "roles must share one identity preimage domain"
);
check(
    deployment.operational_identity?.role_in_identity_preimage === false,
    "roles cannot alter identity equality commitments"
);
check(deployment.operational_identity?.wrangler_version_required === true, "the Wrangler version must be recorded");
check(deployment.database?.count === 1, "the probe requires exactly one D1 database");
check(deployment.database?.creation_adapter_implemented === true, "the D1 creation adapter is required");
check(deployment.database?.operator_command_registered === false, "D1 creation must remain unwired this round");
check(
    deployment.database?.api_endpoint === "POST /accounts/{account_id}/d1/database" &&
        deployment.database?.d1_write_token_required === true &&
        deployment.database?.token_persisted_or_serialized === false,
    "the D1 creation endpoint or credential boundary changed"
);
check(
    deployment.database?.opaque_live_route_observation_required === true &&
        deployment.database?.route_observation_max_age_ms === 300000 &&
        deployment.database?.complete_plan_and_hmac_key_reverified_before_request === true &&
        deployment.database?.exact_bound_lifecycle_journal_required === true,
    "D1 creation must recheck every pre-mutation dependency"
);
check(
    same(deployment.database?.request_body_fields, ["name", "read_replication", "jurisdiction_when_not_automatic"]) &&
        deployment.database?.read_replication_create_mode === "auto" &&
        deployment.database?.database_jurisdiction_source === "verified_preflight",
    "the D1 create body changed"
);
check(
    deployment.database?.redirects_followed === false &&
        deployment.database?.automatic_retries === 0 &&
        deployment.database?.response_limit_bytes === 262144 &&
        deployment.database?.total_timeout_ms === 20000,
    "the D1 create transport limits changed"
);
check(
    deployment.database?.returned_id_name_jurisdiction_and_replication_verified === true &&
        deployment.database?.production_id_collision === "manual_required_with_opaque_cleanup_target" &&
        deployment.database?.ambiguous_response === "manual_required_without_retry" &&
        deployment.database?.raw_database_id_in_output === false &&
        deployment.database?.eligible_for_attestation === false &&
        deployment.database?.authoritative === false,
    "D1 create results must remain bound, opaque, and non-authoritative"
);
check(
    deployment.database?.delete_adapter_implemented === true &&
        deployment.database?.delete_operator_command_registered === false &&
        deployment.database?.delete_api_endpoint === "DELETE /accounts/{account_id}/d1/database/{database_id}" &&
        deployment.database?.delete_target_source === "opaque_created_database_context" &&
        deployment.database?.delete_normal_journal_step === "database_deleted" &&
        deployment.database?.delete_emergency_journal === "exact_bound_database_create_failure_only" &&
        deployment.database?.delete_plan_hmac_id_and_name_reverified === true &&
        deployment.database?.delete_request_one_use === true,
    "D1 deletion must bind the exact created target, plan, journal, and one-use request"
);
check(
    deployment.database?.delete_redirects_followed === false &&
        deployment.database?.delete_automatic_retries === 0 &&
        deployment.database?.delete_response_limit_bytes === 262144 &&
        deployment.database?.delete_total_timeout_ms === 20000 &&
        deployment.database?.delete_ambiguous_response === "manual_required_without_retry",
    "the D1 delete transport or ambiguity policy changed"
);
check(
    deployment.database?.delete_success_status === "sdk_acknowledged" &&
        deployment.database?.delete_absence_verified === false &&
        deployment.database?.delete_raw_database_id_in_output === false &&
        deployment.database?.delete_eligible_for_attestation === false &&
        deployment.database?.delete_authoritative === false,
    "a D1 delete acknowledgement cannot claim absence or gate authority"
);
check(
    deployment.database?.absence_adapter_implemented === true &&
        deployment.database?.absence_operator_command_registered === false &&
        deployment.database?.absence_api_endpoint ===
            "GET /accounts/{account_id}/d1/database?name={exact_name}&page={page}&per_page=100" &&
        deployment.database?.absence_token_permission === "D1 Read" &&
        deployment.database?.absence_token_persisted_or_serialized === false &&
        deployment.database?.absence_target_source === "opaque_created_database_context" &&
        deployment.database?.absence_delete_outcome_required === true &&
        deployment.database?.absence_plan_journal_hmac_id_and_name_reverified === true,
    "D1 absence readback must bind the prior cleanup target and use the documented read endpoint"
);
check(
    deployment.database?.absence_name_filter_exact_input === true &&
        deployment.database?.absence_complete_pagination_required === true &&
        deployment.database?.absence_per_page === 100 &&
        deployment.database?.absence_max_pages === 4 &&
        deployment.database?.absence_response_limit_bytes_per_page === 262144 &&
        deployment.database?.absence_total_response_limit_bytes === 1048576 &&
        deployment.database?.absence_total_timeout_ms === 20000 &&
        deployment.database?.absence_redirects_followed === false &&
        deployment.database?.absence_automatic_retries === 0 &&
        deployment.database?.absence_read_reinvocation_allowed === true,
    "D1 absence pagination and transport bounds changed"
);
check(
    deployment.database?.absence_exact_id_or_name_present === "database_still_present" &&
        deployment.database?.absence_success_status === "control_plane_absence_observed" &&
        deployment.database?.absence_opaque_context_minted === true &&
        same(deployment.database?.absence_context_binding_fields, [
            "created_database_object_identity",
            "plan_digest",
            "journal_digest",
            "database_id_commitment",
            "database_name_commitment",
            "deletion_outcome",
            "observation_digest",
        ]) &&
        deployment.database?.absence_context_object_frozen === true &&
        deployment.database?.absence_forged_or_serialized_copy_resolves === false &&
        deployment.database?.absence_exact_target_and_journal_match_required === true &&
        deployment.database?.absence_token_one_use_enforced === false &&
        deployment.database?.absence_future_aggregate_consumer_required === true &&
        deployment.database?.absence_independent_proof === false &&
        deployment.database?.absence_cleanup_confirmed === false &&
        deployment.database?.absence_lifecycle_advanced === false &&
        deployment.database?.absence_final_all_resource_confirmation_still_required === true &&
        deployment.database?.absence_raw_database_id_in_output === false &&
        deployment.database?.absence_eligible_for_attestation === false &&
        deployment.database?.absence_authoritative === false,
    "database-list absence must remain opaque and cannot finish cleanup or claim independent proof"
);
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
    check(worker.deployment_id_commitment_required === true, `${worker.role} must commit its deployment ID`);
    check(worker.version_id_commitment_required === true, `${worker.role} must commit its version ID`);
    check(worker.runtime_version_metadata_required === true, `${worker.role} must return runtime version metadata`);
    check(worker.exact_database_binding_required === true, `${worker.role} must bind the exact disposable D1 ID`);
}
check(deployment.distinct_writer_script_and_version_ids_required === true, "writers need distinct deployments");
check(
    deployment.all_worker_script_and_version_ids_pairwise_distinct_required === true,
    "writer and sink script/version identities must all differ"
);
check(deployment.sink_deployment_recorded_separately === true, "sink deployment must be recorded separately");
check(deployment.compatibility_date_required === true, "compatibility date is required");
check(deployment.service_bindings?.writer_to_sink_binding_count === 2, "both writers need sink bindings");
check(
    deployment.service_bindings?.both_target_exact_sink_script === true,
    "both service bindings must target the exact sink script"
);
check(deployment.service_bindings?.binding_configuration_digest_required === true, "binding configs need digests");
check(
    deployment.service_bindings?.active_sink_deployment_single_version_100_percent === true,
    "sink deployment must route all traffic to one version"
);
check(
    deployment.service_bindings?.sink_rpc_runtime_version_response_required === true,
    "sink RPC must report its runtime version"
);
check(deployment.service_bindings?.awaited_rpc_required === true, "sink delivery must use awaited RPC");
check(deployment.service_bindings?.sink_rpc_observation_required === true, "sink RPC must be observed");
check(
    deployment.service_bindings?.access_context_expected_on_private_rpc === false,
    "Access context does not propagate over service bindings"
);
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
check(
    deployment.public_exposure?.fixed_route_path_prefix === "/_openbot-d1-probe/" &&
        deployment.public_exposure?.route_patterns_end_with_wildcard === false &&
        deployment.public_exposure?.query_strings_match_worker_routes === false,
    "Worker routes must use exact HTTPS paths that do not match query strings"
);
check(
    deployment.public_exposure?.access_application_path === "<probe-hostname>/_openbot-d1-probe/*",
    "the Access application must cover only the shared probe path"
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
check(
    deployment.public_exposure?.route_id_and_exact_pattern_commitments_required === true,
    "every route needs an ID and exact-pattern commitment"
);
check(
    deployment.public_exposure?.access_application_policy_and_service_token_id_commitments_required === true,
    "Access application, policy, and service-token IDs need commitments"
);
check(deployment.public_exposure?.access_application_count === 1, "the probe uses one Access application");
check(deployment.public_exposure?.reusable_access_policy_count === 1, "the probe uses one reusable Access policy");
check(deployment.public_exposure?.access_service_token_count === 1, "the probe uses one Access service token");
check(
    deployment.public_exposure?.worker_access_context_required === true,
    "Writer routes require Worker Access context"
);
check(
    deployment.public_exposure?.access_audience_exact_match_required === true,
    "Writer routes require the exact Access audience"
);
check(
    deployment.public_exposure?.access_service_token_identity_exact_match_required === true,
    "Writer routes require the exact Access service-token identity"
);
check(deployment.public_exposure?.manual_access_jwt_parsing === false, "Writer routes use verified Access context");
check(deployment.public_exposure?.canonical_request_body_required === true, "Writer requests must be canonical JSON");
check(deployment.public_exposure?.request_body_limit_bytes === 16384, "Writer request body limit changed");
check(deployment.public_exposure?.content_length_exact_required === true, "Writer requests require exact length");
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
check(
    same(execution.driver_child_processes_by_trial, {
        guarded_create: 2,
        gateway_reservation: 2,
        audit_head: 2,
        sandbox_capacity: 5,
    }),
    "the driver needs one child process per contender"
);
check(execution.parent_ipc_go_release_required === true, "the parent must release ready children over IPC");
const gatewayParent = execution.gateway_parent_coordinator ?? {};
check(gatewayParent.implemented === true, "the gateway parent coordinator is required");
check(
    gatewayParent.root_cli_registered === false,
    "the gateway parent command must not be registered at the repository root"
);
check(gatewayParent.package_parent_command_implemented === true, "the private package parent command is required");
check(gatewayParent.command_arguments_allowed === false, "the gateway parent command must reject arguments");
check(gatewayParent.assignment_body_limit_bytes === 65536, "the gateway parent assignment cap changed");
check(gatewayParent.canonical_assignment_required === true, "the gateway parent assignment must be canonical");
check(gatewayParent.service_token_file_descriptor === 3, "the gateway parent credential descriptor changed");
check(
    gatewayParent.service_token_read_and_closed_before_child_spawn === true,
    "the gateway parent must close its credential descriptor before child spawn"
);
check(
    gatewayParent.service_token_max_bytes_excluding_optional_newline === 512,
    "the gateway parent service-token cap changed"
);
check(
    gatewayParent.service_token_optional_trailing_newline === true,
    "the gateway parent service-token newline rule changed"
);
check(
    gatewayParent.credential_arguments_or_environment_allowed === false,
    "the gateway parent must not accept credentials through arguments or environment variables"
);
check(gatewayParent.child_environment_inherited === false, "gateway children must not inherit the parent environment");
check(gatewayParent.exact_child_count === 2, "the gateway parent must use two child processes");
check(same(gatewayParent.fixed_child_order, ["writer_a", "writer_b"]), "the gateway child order changed");
check(
    same(gatewayParent.shared_trial_fields, [
        "probe_run_id",
        "trial_id",
        "call_kind",
        "logical_call_id",
        "attempt_id",
        "call_sequence",
        "reservation_id",
    ]),
    "the gateway parent shared-trial binding changed"
);
check(
    same(gatewayParent.distinct_child_fields, [
        "child_process_id",
        "trial_request_id",
        "trial_request_digest",
        "go_receipt_digest",
        "gateway_request_id",
        "writer_route",
    ]),
    "the gateway parent child-identity binding changed"
);
check(gatewayParent.one_access_service_token_identity === true, "the gateway parent Access identity changed");
check(gatewayParent.one_writer_origin === true, "the gateway parent Writer origin changed");
check(gatewayParent.one_request_timeout === true, "the gateway parent request-timeout binding changed");
check(
    gatewayParent.all_children_ready_before_go_attempt === true,
    "the gateway parent must wait for every READY before attempting GO"
);
check(gatewayParent.ready_timeout_ms === 5000, "the gateway parent READY timeout changed");
check(gatewayParent.result_timeout_ms === 20000, "the gateway parent result timeout changed");
check(gatewayParent.termination_timeout_ms === 1000, "the gateway parent termination timeout changed");
check(gatewayParent.partial_spawn_termination_required === true, "a partial gateway child spawn must terminate");
check(
    gatewayParent.sigint_and_sigterm_abort_and_terminate_children === true,
    "gateway parent signals must terminate spawned children"
);
check(
    gatewayParent.substituted_ready_or_result_is_inconclusive === true,
    "substituted gateway child messages must stay inconclusive"
);
check(gatewayParent.node_child_adapter_implemented === true, "the gateway Node child adapter is required");
check(gatewayParent.child_output_limit_bytes === 131072, "the gateway child output cap changed");
check(
    gatewayParent.completed_means_protocol_completed_not_gate_passed === true,
    "gateway parent completion must not mean the gate passed"
);
check(gatewayParent.canonical_result_only === true, "the gateway parent must emit one canonical result");
check(gatewayParent.inconclusive_exit_code === 2, "the gateway parent inconclusive exit code changed");
check(
    gatewayParent.authoritative === false &&
        gatewayParent.eligible_for_attestation === false &&
        gatewayParent.gate_promotion_allowed === false,
    "the gateway parent coordinator must remain non-authoritative"
);
check(
    execution.writer_network_transport?.package === "packages/d1-probe-driver",
    "the Writer network transport package changed"
);
check(
    execution.writer_network_transport?.private_node_only === true,
    "the network transport must stay private Node code"
);
check(
    execution.writer_network_transport?.root_cli_registered === false,
    "the Writer child command must not be registered as a root operator command"
);
check(
    execution.writer_network_transport?.parent_only_child_command_implemented === true,
    "the parent-only Writer child command is required"
);
check(
    execution.writer_network_transport?.assignment_body_limit_bytes === 32768,
    "the child assignment byte cap changed"
);
check(execution.writer_network_transport?.ipc_required === true, "the Writer child must require parent IPC");
check(execution.writer_network_transport?.ready_before_go === true, "the Writer child must signal READY before GO");
check(execution.writer_network_transport?.go_timeout_ms === 10000, "the Writer child GO timeout changed");
check(
    same(execution.writer_network_transport?.go_binds, [
        "child_process_id",
        "writer_role",
        "request_digest",
        "go_receipt_digest",
    ]),
    "the Writer child GO binding changed"
);
check(
    execution.writer_network_transport?.service_token_file_descriptor === 4,
    "the Writer child service-token descriptor changed"
);
check(
    execution.writer_network_transport?.service_token_read_after_valid_go === true,
    "the Writer child must not read its service token before valid GO"
);
check(
    execution.writer_network_transport?.service_token_max_bytes_excluding_optional_newline === 512,
    "the Writer child service-token cap changed"
);
check(
    execution.writer_network_transport?.service_token_optional_trailing_newline === true,
    "the Writer child service-token newline rule changed"
);
check(
    execution.writer_network_transport?.service_token_file_descriptor_closed_before_result === true,
    "the Writer child must close its service-token descriptor before reporting"
);
check(
    execution.writer_network_transport?.canonical_child_result_required === true,
    "the Writer child result must be canonical JSON"
);
check(execution.writer_network_transport?.one_request_per_invocation === true, "each invocation sends one request");
check(execution.writer_network_transport?.automatic_retries === 0, "the Writer network transport must not retry");
check(
    execution.writer_network_transport?.redirect_policy === "error",
    "the Writer network transport rejects redirects"
);
check(
    execution.writer_network_transport?.standard_access_header_pair === true,
    "the Writer transport uses the standard Access service-token headers"
);
check(execution.writer_network_transport?.request_timeout_max_ms === 15000, "the Writer transport timeout changed");
check(
    execution.writer_network_transport?.timeout_covers_response_body === true,
    "the Writer timeout must cover the full response body"
);
check(execution.writer_network_transport?.response_body_limit_bytes === 65536, "the Writer response cap changed");
check(
    execution.writer_network_transport?.canonical_response_required === true,
    "the Writer response must be canonical JSON"
);
check(
    execution.writer_network_transport?.response_request_digest_and_writer_role_required === true,
    "the Writer response must bind the request digest and role"
);
check(
    execution.writer_network_transport?.no_store_response_headers_required === true,
    "the Writer response must carry no-store headers"
);
check(
    execution.writer_network_transport?.ambiguous_result === "outcome_unknown",
    "ambiguous Writer transport results stay unknown"
);
check(execution.one_go_receipt_per_child_required === true, "every child needs one GO receipt");
check(execution.one_network_request_per_child_required === true, "every child sends one network request");
check(execution.readiness_identity_set_matches_child_set === true, "readiness rows must bind every child");
check(execution.same_request_promise_all_eligible === false, "same-request Promise.all is not two-writer evidence");
check(execution.cross_network_requests_required === true, "writer requests must cross the network");
check(execution.automatic_application_retries === 0, "automatic retries are forbidden");
check(
    execution.platform_read_query_retries === "record_total_attempts_without_requiring_one",
    "D1 read retries must be observed without being mistaken for application retries"
);
check(execution.ambiguous_request_retry_allowed === false, "ambiguous requests must not be retried");
check(execution.ready_barrier_required === true, "a two-writer barrier is required");
check(execution.barrier_timeout_result === "inconclusive", "barrier timeout must be inconclusive");
check(execution.writer_session_constraint === "first-primary", "writer sessions must start first-primary");
check(execution.decisive_readback_session_constraint === "first-primary", "decisive reads must start first-primary");
check(execution.bookmark_readback_is_decisive === false, "bookmark reads cannot replace first-primary readback");
check(execution.committed_writer_bookmark_required === true, "committed writer bookmarks are required");
check(execution.recognized_guard_denial_bookmark_required === false, "recognized denials cannot invent bookmarks");
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
        "last_row_id",
        "returning_identity_and_cardinality",
        "rows_read",
        "rows_written",
        "served_by",
        "served_by_primary",
        "served_by_region",
        "size_after",
        "statement_count",
        "success",
        "timings_sql_duration_ms",
        "total_attempts",
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
    sink.writer_intake_closed_by_stored_fence_before_final_readback === true,
    "the stored fence must close writer intake before final readback"
);
check(
    sink.all_access_and_routes_retained_until_final_readback === true,
    "Access and exact routes must remain active through final readback"
);
check(sink.all_routes_removed_before_worker_deletion === true, "routes must close before Worker deletion");
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
    same(guarded.concurrent_role_orientations, ["writer_a_create_writer_b_revoke", "writer_b_create_writer_a_revoke"]),
    "concurrent guarded histories must swap writer roles"
);
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
    same(gateway.changed_digest_case, {
        exact_request_commits: true,
        changed_digest_is_guarded_denial: true,
        second_sink_dispatches: 0,
    }),
    "gateway changed-digest result changed"
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
    capacity.wrong_installation_run_fence_claim_sandbox_and_receipt_each_tested === true,
    "every capacity release binding needs a negative test"
);
check(
    capacity.release_replay === "no_change" && capacity.matching_release_count === 1,
    "capacity release must be one-time"
);
check(capacity.fifth_claim_after_release_commits === 1, "one new claim must commit after exact release");
check(
    capacity.exact_target_bound_to_committed_claim_destroy_and_release === true,
    "capacity target must bind the claim, destroy, and release"
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
check(
    audit.follow_up?.first_phase_attempt_ids_bound_to_writer_requests === true,
    "audit contender attempt IDs must bind their writer requests"
);
check(audit.follow_up?.issued_by_first_phase_loser === true, "audit loser must issue the follow-up");
check(audit.follow_up?.new_first_primary_head_read === true, "audit follow-up must reread first-primary");
check(audit.follow_up?.automatic_retry === false, "audit follow-up is not an automatic retry");
check(audit.follow_up?.next_sequence_commits === 1, "audit follow-up must commit the next sequence");
check(
    same(audit.negative_cases, {
        stale_sequence: "guarded_denial",
        gap_sequence: "guarded_denial",
        wrong_previous_hash: "guarded_denial",
        head_event_split_observed: false,
    }),
    "audit negative cases changed"
);
check(
    audit.final_chain_entries === 2 && audit.final_chain_must_verify === true,
    "the final two-entry chain must verify"
);

const report = fixture.report_requirements ?? {};
check(report.report_platform_literal === "cloudflare_d1_deployed", "deployed reports need the exact platform literal");
check(report.required_check_set_version === 1, "D1 adjudication check-set version changed");
check(report.database_id_commitment === true, "deployed reports need a database-ID commitment");
check(
    report.deployment_digest_recomputed_from_typed_projection === true,
    "the deployment digest must be recomputed from the typed deployment projection"
);
check(
    report.deployment_digest_contains_pre_run_configuration_only === true,
    "deployment expectations must be fixed before the probe runs"
);
check(report.writer_deployment_commitments === 2, "deployed reports need two writer commitments");
check(report.sink_deployment_commitment === true, "deployed reports need the sink deployment commitment");
check(report.read_replication_setting === true, "deployed reports need the read-replication setting");
check(report.served_by_primary_observed_true === true, "deployed reports must record true served_by_primary metadata");
check(report.compatibility_date === true, "deployed reports need the compatibility date");
check(report.cloudflare_account_and_zone_commitments === true, "deployed reports need account and zone commitments");
check(
    report.worker_deployment_and_runtime_version_commitments === true,
    "deployed reports need deployment and runtime-version commitments"
);
check(
    report.service_binding_and_awaited_sink_rpc_commitments === true,
    "deployed reports need service-binding and awaited sink RPC commitments"
);
check(report.route_and_access_resource_commitments === true, "deployed reports need route and Access commitments");
check(report.wrangler_version === true, "deployed reports need the Wrangler version");
check(report.bookmarks_and_result_meta === true, "deployed reports need bookmarks and D1Result metadata");
check(report.cleanup_outcome_and_absence_checks === true, "deployed reports need cleanup and absence observations");
check(report.canonical_final_current_state_digest_recomputed === true, "final current-state digest must be recomputed");
check(
    report.cleanup_transcript_hmac_and_typed_response_projection_required === true,
    "cleanup transcript must bind the typed final-state projection"
);
check(
    report.cleanup_transcript_response_hmac_matches_projection_commitment === true,
    "cleanup transcript HMAC must match its projection commitment"
);
check(
    report.typed_inconclusive_and_manual_required_failure_envelope === true,
    "collector failures need a typed fail-closed envelope"
);
check(report.redacted_transcript_commitments === true, "deployed reports need redacted transcript commitments");
check(report.all_required_trials_conclusive === true, "all required trials must be conclusive");
check(
    report.deployment_commitments_semantically_coherent === true,
    "deployment commitments must agree on distinct Workers and one database"
);
check(report.worker_deployment_commitments_pairwise_distinct === true, "all Worker commitments must be distinct");
check(report.all_worker_database_commitments_equal === true, "all Worker commitments must bind one database");
check(report.pure_operator_review_assessment_required === true, "reports need a pure review assessment");
check(report.operator_review_assessment_is_authority === false, "the review assessment cannot grant authority");
check(report.external_operator_review_and_signature === true, "deployed reports require external review and signature");

const cleanup = fixture.cleanup ?? {};
check(cleanup.initial_status === "not_run", "checked-in cleanup status must remain not_run");
check(
    same(cleanup.order, [
        "close_probe_run_fence_while_access_remains_active",
        "settle_or_mark_unknown_in_flight_requests",
        "capture_final_first_primary_readback_through_retained_exact_access_route",
        "revoke_exact_access_service_token",
        "delete_and_confirm_absent_all_three_exact_routes",
        "delete_exact_access_application_and_reusable_policy",
        "delete_exact_writer_a_and_writer_b_scripts_without_force",
        "delete_exact_sink_readback_script_without_force",
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
