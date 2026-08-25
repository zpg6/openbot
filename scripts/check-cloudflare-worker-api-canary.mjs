import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixturePath = "docs/fixtures/cloudflare-worker-api-canary.json";

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

export const checkCloudflareWorkerApiCanaryFixture = fixture => {
    const errors = [];
    const check = (condition, message) => {
        if (!condition) errors.push(message);
    };
    const isolation = fixture.isolation ?? {};
    const fixedModule = fixture.fixed_module ?? {};
    const workflow = fixture.workflow ?? {};
    const baseLayer = fixture.base_layer_priority ?? {};
    const steps = workflow.steps ?? {};
    const claims = fixture.claims ?? {};
    const blocker = fixture.production_path_blocker ?? {};

    check(fixture.schema_version === 1, "schema_version must be 1");
    check(fixture.kind === "cloudflare_worker_api_interoperability_canary", "kind changed");
    check(fixture.status === "not_run", "the checked-in Worker API canary must remain not_run");
    check(fixture.purpose === "isolated_beta_to_classic_worker_api_interoperability_only", "scope changed");
    check(
        fixture.implementation?.credentialed_runner_implemented === true &&
            fixture.implementation?.root_command_registered === false &&
            fixture.implementation?.credentialed_cli_fail_closed === true &&
            fixture.implementation?.shared_bounded_transport_implemented === true &&
            fixture.implementation?.unregistered_runner_uses_shared_bounded_transport === true &&
            fixture.implementation?.caller_controlled_pre_dispatch_ordering_seam_implemented === true &&
            fixture.implementation?.durable_forward_dispatch_claim_adapter_implemented === true &&
            fixture.implementation?.durable_cleanup_dispatch_claim_adapter_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_dispatch_claim_adapter === false &&
            fixture.implementation?.credentialed_runner_persists_pre_dispatch_claims === false &&
            fixture.implementation?.canonical_plan_generator_implemented === true &&
            fixture.implementation?.root_plan_command_registered === true &&
            fixture.implementation?.durable_operation_state_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_operation_state === false &&
            fixture.implementation?.durable_driver_bootstrap_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_driver_bootstrap === false &&
            fixture.implementation?.durable_driver_session_composer_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_driver_session === false &&
            fixture.implementation?.durable_driver_recovery_observation_session_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_driver_recovery_observation_session === false &&
            fixture.implementation?.checkout_local_driver_lease_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_driver_lease === false &&
            fixture.implementation?.untrusted_effect_claim_journal_implemented === true &&
            fixture.implementation?.credentialed_runner_writes_effect_claim_journal === false &&
            fixture.implementation?.shared_execution_nonce_commitment_domain_implemented === true &&
            fixture.implementation?.effect_claim_lease_epoch_binding_implemented === true &&
            fixture.implementation?.read_only_state_effect_consistency_implemented === true &&
            fixture.implementation?.read_only_state_effect_lease_consistency_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_state_effect_consistency === false &&
            fixture.implementation?.automatic_cleanup_core_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_automatic_cleanup_core === false &&
            fixture.implementation?.durable_cleanup_obligation_record_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_cleanup_obligation_record === false &&
            fixture.implementation?.cleanup_cli_registered === false &&
            fixture.implementation?.manual_cleanup_authority_implemented === false &&
            fixture.implementation?.response_projection_contract_implemented === true &&
            fixture.implementation?.read_only_recovery_inspector_implemented === true &&
            fixture.implementation?.root_recovery_inspector_command_registered === true &&
            fixture.implementation?.secure_secret_fd_launcher_implemented === false &&
            fixture.implementation?.encrypted_response_preimage_archive_implemented === true &&
            fixture.implementation?.bounded_response_preimage_capture_hook_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_response_preimage_capture_hook === false &&
            fixture.implementation?.joined_response_claim_adapter_implemented === true &&
            fixture.implementation?.cleanup_bound_response_claim_adapter_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_joined_response_claim_adapter === false &&
            fixture.implementation?.credentialed_runner_writes_encrypted_response_preimages === false &&
            fixture.implementation?.read_only_response_archive_inventory_implemented === true &&
            fixture.implementation?.cleanup_obligation_digest_archive_binding_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_response_archive_inventory === false &&
            fixture.implementation?.tri_store_consistency_implemented === true &&
            fixture.implementation?.untrusted_base_recovery_classifier_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_base_recovery_classifier === false &&
            fixture.implementation?.keyed_archive_integrity_resolver_implemented === true &&
            fixture.implementation?.archive_ahead_recovery_reducer_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_archive_ahead_recovery_reducer === false &&
            fixture.implementation?.cleanup_resumption_planner_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_cleanup_resumption_planner === false &&
            fixture.implementation?.read_only_durable_transcript_reconstruction_implemented === true &&
            fixture.implementation?.credentialed_runner_uses_durable_transcript_reconstruction === false &&
            fixture.implementation?.local_base_layer_e2e_benchmark_implemented === true &&
            fixture.implementation?.local_base_layer_e2e_uses_public_storage_and_claim_apis === true &&
            fixture.implementation?.local_base_layer_e2e_uses_durable_driver_bootstrap === true &&
            fixture.implementation?.local_base_layer_e2e_uses_durable_driver_session === true &&
            fixture.implementation?.local_base_layer_e2e_imports_driver_bootstrap_directly === false &&
            fixture.implementation?.local_base_layer_e2e_durable_session_identity_contention_implemented === true &&
            fixture.implementation?.reviewed_base_layer_benchmark_profiles_runner_implemented === true &&
            fixture.implementation?.local_base_layer_e2e_reconstructs_durable_transcript === true &&
            fixture.implementation?.local_base_layer_e2e_remote_network_requests === false &&
            fixture.implementation?.credentialed_runner_covered_by_local_base_layer_e2e === false &&
            fixture.implementation?.response_preimage_capture_implemented === false &&
            fixture.implementation?.reviewed_observation_fixture_transition_implemented === false &&
            fixture.implementation?.credentials_recorded === false &&
            fixture.implementation?.observations_recorded === false,
        "the isolated canary implementation state drifted"
    );
    check(
        baseLayer.priority === "base_layer_before_product_facing_work" &&
            baseLayer.durable_identities_required === true &&
            baseLayer.append_only_state_effect_archive_histories_required === true &&
            baseLayer.lease_epochs_required === true &&
            baseLayer.effect_claim_lease_epoch_binding_required === true &&
            baseLayer.composed_dispatch_response_sessions_required === true &&
            baseLayer.tri_store_consistency_required === true &&
            baseLayer.restart_transcript_reconstruction_required === true &&
            baseLayer.recovery_reducers_required === true &&
            baseLayer.cleanup_obligations_required === true &&
            baseLayer.cleanup_obligation_digest_end_to_end_binding_required === true &&
            baseLayer.pre_dispatch_bootstrap_required === true &&
            baseLayer.private_driver_session_composition_required === true &&
            baseLayer.restart_recovery_observation_session_required === true &&
            baseLayer.cleanup_resumption_planning_required === true &&
            baseLayer.reviewed_maximum_benchmark_profiles_required === true &&
            baseLayer.scalable_local_e2e_required === true &&
            baseLayer.authority_separation_required === true &&
            baseLayer.product_facing_work_may_precede_base_layer === false,
        "the canary base-layer-first priority drifted"
    );
    check(
        Object.values(fixture.authority ?? {}).every(value => value === false) &&
            fixture.authority?.dispatch_claim_adapter_authenticates_transport === false &&
            fixture.authority?.effect_claim_lease_epoch_authenticates_process_ownership === false &&
            fixture.authority?.response_capture_hook_proves_archive_publication === false &&
            fixture.authority?.response_capture_hook_prevents_plaintext_retention === false &&
            fixture.authority?.response_claim_adapter_authenticates_cloudflare_effects === false &&
            fixture.authority?.response_archive_inventory_authenticates_envelopes_or_responses === false &&
            fixture.authority?.response_archive_inventory_proves_key_possession_or_decryptability === false &&
            fixture.authority?.response_archive_inventory_authorizes_recovery_or_actions === false &&
            fixture.authority?.base_recovery_classifier_authenticates_local_or_remote_effects === false &&
            fixture.authority?.base_recovery_classifier_authorizes_actions === false &&
            fixture.authority?.durable_transcript_authenticates_local_or_remote_effects === false &&
            fixture.authority?.durable_transcript_authorizes_replay_cleanup_lifecycle_or_gate === false &&
            fixture.authority?.archive_ahead_reducer_authenticates_cloudflare_effects === false &&
            fixture.authority?.archive_ahead_reducer_authorizes_remote_mutation_cleanup_lifecycle_or_gate === false &&
            fixture.authority?.cleanup_obligation_record_authenticates_remote_effects === false &&
            fixture.authority?.cleanup_obligation_record_authorizes_cleanup_or_mutation === false &&
            fixture.authority?.cleanup_obligation_digest_authenticates_obligation_or_effect === false &&
            fixture.authority?.driver_bootstrap_authenticates_local_or_remote_effects === false &&
            fixture.authority?.driver_bootstrap_authorizes_remote_dispatch_or_cleanup === false &&
            fixture.authority?.durable_driver_session_authenticates_local_or_remote_effects === false &&
            fixture.authority?.durable_driver_session_authorizes_remote_dispatch_or_cleanup === false &&
            fixture.authority?.durable_driver_session_prevents_caller_retention_of_operation_or_archive_key === false &&
            fixture.authority?.durable_driver_recovery_session_authorizes_actions === false &&
            fixture.authority?.cleanup_resumption_plan_authorizes_actions === false &&
            fixture.authority?.reviewed_base_layer_benchmark_report_is_evidence === false,
        "the isolated canary must grant no evidence, upload, lifecycle, attestation, or gate authority"
    );
    check(
        isolation.one_new_disposable_worker_required === true &&
            isolation.generated_name_prefix === "openbot-d1-probe-canary-" &&
            isolation.production_worker_names_denied === true &&
            isolation.d1_database_created === false &&
            isolation.access_resources_created === false &&
            isolation.routes_created === false &&
            isolation.workers_dev_enabled === false &&
            isolation.preview_urls_enabled === false &&
            isolation.logpush_enabled === false &&
            isolation.observability_enabled === false &&
            same(isolation.tail_consumers, []) &&
            same(isolation.bindings, []) &&
            same(isolation.assets, []),
        "the canary must remain one isolated, private, no-binding Worker"
    );
    check(
        fixedModule.main_module === "entry.js" &&
            fixedModule.content_type === "application/javascript+module" &&
            fixedModule.utf8_source === "export default { fetch() { return new Response(null, { status: 404 }); } };" &&
            fixedModule.sha256 === "af90db18d8d6707e755a035fc78d7ebf066147edfaaeb22b95c52fbb654be7db" &&
            same(fixedModule.bindings, []) &&
            fixedModule.accepts_environment === false &&
            fixedModule.performs_outbound_requests === false &&
            fixedModule.writes_data === false &&
            fixedModule.runtime_invocation_required === false,
        "the fixed inert no-binding module changed"
    );
    check(
        workflow.automatic_retries === 0 &&
            workflow.redirects_followed === false &&
            workflow.response_encoding_requested === "identity" &&
            workflow.shared_aggregate_response_budget_bytes === 2 * 1024 * 1024 &&
            same(workflow.forward_transport_methods, ["GET", "POST"]) &&
            same(workflow.cleanup_transport_methods, ["GET", "DELETE"]) &&
            workflow.ambiguous_mutation_result === "manual_cleanup_required_no_retry" &&
            workflow.checkout_local_plan_reservation === true &&
            workflow.distributed_plan_reservation === false &&
            workflow.driver_lease_scope === "cooperative_single_checkout_only" &&
            workflow.driver_bootstrap_scope ===
                "prepared_state_cleanup_obligation_and_current_lease_before_effect_unwired" &&
            workflow.driver_bootstrap_rejects_prior_effect_or_archive_history === true &&
            workflow.driver_bootstrap_accepts_exact_concurrent_local_publication === true &&
            workflow.driver_bootstrap_remote_requests === false &&
            workflow.driver_bootstrap_grants_dispatch_or_cleanup_authority === false &&
            workflow.durable_driver_session_scope ===
                "private_bootstrap_lease_owner_and_composed_response_claim_factory_unwired" &&
            workflow.durable_driver_session_exposes_lease_owner === false &&
            workflow.durable_driver_session_exposes_raw_execution_identity === false &&
            workflow.durable_driver_session_requires_exact_execution_identity === true &&
            workflow.durable_driver_session_prepares_or_dispatches_requests === false &&
            workflow.durable_driver_recovery_scope ===
                "double_sampled_operation_lease_recovery_transcript_observation_only" &&
            workflow.durable_driver_recovery_retries_or_mutates === false &&
            workflow.durable_driver_recovery_exposes_raw_identity_or_lease_owner === false &&
            workflow.cleanup_resumption_scope ===
                "double_sampled_consistency_recovery_obligation_digest_only_planning" &&
            workflow.cleanup_resumption_performs_requests_or_mutations === false &&
            workflow.cleanup_resumption_accepts_adjacent_forward_terminal_cleanup_entry === true &&
            workflow.effect_claim_journal_scope === "caller_constructible_redacted_hash_chain_only" &&
            workflow.effect_claim_lease_epoch_scope ===
                "exact_generation_and_canonical_lease_record_digest_non_authenticating" &&
            workflow.consistency_snapshot_scope === "locally_forgeable_may_stale_reassert_heads_before_effect" &&
            same(workflow.consistency_snapshot_stores, ["operation_state", "effect_journal", "driver_lease"]) &&
            workflow.consistency_reader_filesystem_writes === false &&
            workflow.pre_dispatch_ordering_scope === "caller_controlled_one_use_hook_no_persistence_proof" &&
            workflow.durable_dispatch_claim_adapter_scope ===
                "forward_and_cleanup_obligation_bound_intent_then_started_non_atomic_unwired" &&
            workflow.durable_dispatch_claim_adapter_binds_cleanup_grace === true &&
            workflow.durable_dispatch_claim_adapter_writes_terminal_claims === false &&
            workflow.started_claim_may_remain_ambiguous_after_local_failure === true &&
            workflow.response_capture_scope === "caller_controlled_bounded_byte_copy_no_archive_or_claim_proof" &&
            workflow.response_capture_caller_can_retain_plaintext === true &&
            workflow.archive_before_response_observed_enforced === false &&
            workflow.joined_response_claim_adapter_scope ===
                "forward_and_cleanup_obligation_bound_started_archive_before_append_unwired" &&
            workflow.joined_response_claim_adapter_archive_before_append === true &&
            workflow.direct_public_effect_journal_append_remains_caller_constructible === true &&
            workflow.archive_ahead_of_effect_journal_requires_recovery === true &&
            workflow.response_archive_scope ===
                "encrypted_caller_claim_bound_body_preimage_with_keyed_internal_integrity_resolution" &&
            workflow.response_archive_production_plaintext_export_available === false &&
            workflow.response_archive_claims_complete_transport_observation === false &&
            workflow.response_archive_inventory_scope ===
                "read_only_redacted_local_encrypted_envelope_shape_non_authenticating" &&
            workflow.response_archive_inventory_filesystem_writes === false &&
            workflow.response_archive_inventory_returns_plaintext_ciphertext_nonce_or_tag === false &&
            workflow.response_archive_inventory_snapshots_are_plan_scoped === true &&
            workflow.unrelated_plan_archive_publication_destabilizes_inventory === false &&
            workflow.base_recovery_classifier_scope ===
                "read_only_stable_state_effect_lease_archive_shape_classification_only" &&
            workflow.base_recovery_classifier_allows_mutation_replay === false &&
            workflow.durable_transcript_scope ===
                "read_only_double_sampled_effect_archive_join_with_redacted_request_history" &&
            workflow.durable_transcript_reconstructs_raw_paths_or_response_bodies === false &&
            workflow.durable_transcript_allows_mutation_replay_or_cleanup === false &&
            workflow.archive_ahead_reducer_scope ===
                "exact_started_head_current_lease_keyed_local_claim_append_only_unwired" &&
            workflow.archive_ahead_reducer_preserves_dispatch_lease_epoch_under_takeover === true &&
            workflow.archive_ahead_reducer_remote_requests === false &&
            workflow.archive_ahead_reducer_plaintext_output === false &&
            workflow.archive_ahead_reducer_transitions_operation_state === false &&
            workflow.fresh_execution_ownership_tag_required === true &&
            workflow.durable_private_attempt_record_implemented === true &&
            workflow.credentialed_runner_records_raw_execution_ownership_tag === false &&
            workflow.durable_delete_dispatch_fence_implemented === true &&
            workflow.credentialed_runner_uses_durable_delete_dispatch_fence === false &&
            workflow.automatic_cleanup_grace_contract_implemented === true &&
            workflow.credentialed_runner_uses_automatic_cleanup_grace === false &&
            workflow.cleanup_obligation_record_scope ===
                "immutable_private_caller_constructible_pre_effect_plan_execution_operation_and_grace_binding_only" &&
            workflow.cleanup_obligation_read_only_verification_implemented === true &&
            workflow.cleanup_obligation_record_filesystem_writes_during_read === false &&
            workflow.cleanup_obligation_unrelated_plan_publication_destabilizes_read === false &&
            workflow.cleanup_effect_claims_bind_obligation_digest === true &&
            workflow.cleanup_response_claims_bind_obligation_digest === true &&
            workflow.response_archive_inventory_carries_cleanup_obligation_digest === true &&
            workflow.base_recovery_matches_cleanup_obligation_digest === true &&
            workflow.manual_cleanup_after_grace_implemented === false &&
            workflow.complete_pagination_metadata_required_for_absence === true &&
            workflow.optional_response_projection_contract_implemented === true &&
            workflow.local_base_layer_e2e_workload_scope ===
                "public_local_durable_driver_session_state_lease_effect_archive_obligation_recovery_and_durable_transcript_apis_only" &&
            workflow.local_base_layer_e2e_default_operations === 3 &&
            workflow.local_base_layer_e2e_max_operations === 128 &&
            workflow.local_base_layer_e2e_max_concurrency === 16 &&
            workflow.local_base_layer_e2e_max_response_bytes === 256 * 1024 &&
            workflow.local_base_layer_e2e_same_plan_state_cas_contention === true &&
            workflow.local_base_layer_e2e_durable_session_max_parallel_attempts === 512 &&
            workflow.local_base_layer_e2e_durable_session_identity_fields_challenged === 5 &&
            workflow.local_base_layer_e2e_durable_session_contention_writes_records === false &&
            workflow.local_base_layer_e2e_latency_threshold_enforced === false &&
            same(workflow.reviewed_base_layer_benchmark_profiles, [
                "max_scale_128_16_4096",
                "max_payload_1_1_262144",
            ]) &&
            workflow.recovery_inspector?.command === "d1-probe:inspect-worker-api-canary-recovery" &&
            workflow.recovery_inspector?.canonical_stdin_required === true &&
            same(workflow.recovery_inspector?.credential_inputs, []) &&
            workflow.recovery_inspector?.network_access === false &&
            workflow.recovery_inspector?.filesystem_writes === false &&
            workflow.recovery_inspector?.raw_identity_output === false &&
            workflow.recovery_inspector?.mutation_executable === false &&
            workflow.recovery_inspector?.authoritative === false &&
            workflow.uncertain_or_interrupted_exit_is_nonzero === true,
        "the canary mutation transport must not redirect or retry ambiguity"
    );
    check(
        same(workflow.steps_in_order, [
            "beta_worker_list_name_absence",
            "beta_empty_shell_create",
            "beta_empty_shell_readback",
            "classic_subdomain_readback_before_version",
            "beta_version_list_empty",
            "classic_deployment_list_empty",
            "beta_version_create_deploy_false",
            "beta_version_list_exact",
            "beta_version_module_readback",
            "classic_version_readback",
            "classic_deployment_list_still_empty",
            "classic_deployment_create_force_false",
            "classic_deployment_list_exact",
            "classic_deployment_readback",
            "beta_worker_deployed_readback",
            "classic_subdomain_readback_after_deployment",
            "beta_worker_cleanup_ownership_readback",
            "beta_worker_delete_by_immutable_id",
            "beta_worker_get_absence",
            "beta_worker_list_absence",
        ]),
        "the beta-to-classic canary sequence changed"
    );
    check(
        same(Object.keys(steps).sort(), [...workflow.steps_in_order].sort()),
        "the canary must define every ordered step exactly once"
    );
    check(
        steps.beta_worker_list_name_absence?.method === "GET" &&
            steps.beta_worker_list_name_absence?.path === "/accounts/{account_id}/workers/workers" &&
            steps.beta_worker_list_name_absence?.complete_pagination_required === true &&
            steps.beta_worker_list_name_absence?.exact_generated_name_present === false,
        "the canary must prove the generated Worker name is absent before creation"
    );
    check(
        steps.beta_empty_shell_create?.method === "POST" &&
            steps.beta_empty_shell_create?.path === "/accounts/{account_id}/workers/workers" &&
            steps.beta_empty_shell_create?.requires_disabled_exposure === true &&
            steps.beta_empty_shell_create?.requires_empty_version_and_deployment_lists === true,
        "beta empty-shell creation changed"
    );
    check(
        steps.beta_version_create_deploy_false?.method === "POST" &&
            steps.beta_version_create_deploy_false?.path ===
                "/accounts/{account_id}/workers/workers/{worker_id}/versions" &&
            same(steps.beta_version_create_deploy_false?.query, { deploy: false }) &&
            steps.beta_version_create_deploy_false?.fixed_module_only === true &&
            same(steps.beta_version_create_deploy_false?.bindings, []),
        "beta Version creation must use the fixed module with deploy=false and no bindings"
    );
    check(
        steps.classic_version_readback?.method === "GET" &&
            steps.classic_version_readback?.path ===
                "/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}" &&
            steps.classic_version_readback?.exact_beta_version_id_required === true &&
            steps.classic_version_readback?.preview_disabled_required === true,
        "classic Version readback changed"
    );
    check(
        steps.classic_deployment_create_force_false?.method === "POST" &&
            steps.classic_deployment_create_force_false?.path ===
                "/accounts/{account_id}/workers/scripts/{script_name}/deployments" &&
            same(steps.classic_deployment_create_force_false?.query, { force: false }) &&
            steps.classic_deployment_create_force_false?.exact_version_count === 1 &&
            steps.classic_deployment_create_force_false?.traffic_percentage === 100,
        "classic Deployment must remain one Version at 100 percent with force=false"
    );
    check(
        steps.beta_worker_cleanup_ownership_readback?.method === "GET" &&
            steps.beta_worker_cleanup_ownership_readback?.path ===
                "/accounts/{account_id}/workers/workers/{worker_id}" &&
            steps.beta_worker_cleanup_ownership_readback
                ?.exact_returned_worker_id_generated_name_and_ownership_marker_required === true &&
            steps.beta_worker_cleanup_ownership_readback?.private_settings_required === true,
        "cleanup must freshly re-read the exact private owned Worker before deletion"
    );
    check(
        steps.beta_worker_delete_by_immutable_id?.method === "DELETE" &&
            steps.beta_worker_delete_by_immutable_id?.path === "/accounts/{account_id}/workers/workers/{worker_id}" &&
            same(steps.beta_worker_delete_by_immutable_id?.query, {}) &&
            steps.beta_worker_delete_by_immutable_id
                ?.exact_predelete_worker_id_generated_name_and_ownership_marker_required === true &&
            steps.beta_worker_delete_by_immutable_id?.success_envelope_acknowledgement_required === true,
        "cleanup must bind and delete the exact returned immutable Worker ID"
    );
    check(
        steps.beta_worker_get_absence?.not_found_required === true &&
            steps.beta_worker_list_absence?.complete_pagination_required === true &&
            steps.beta_worker_list_absence?.exact_id_or_name_present === false,
        "cleanup needs exact GET and complete-list absence"
    );
    check(
        claims.beta_classic_api_canary_passed === false &&
            claims.access_protected_runtime_identity_canary_passed === false &&
            claims.runtime_identity_observed === false,
        "API interoperability and runtime identity must remain separate unpassed claims"
    );
    check(
        same(claims.proves_only, [
            "beta_empty_shell_creation",
            "beta_non_deploying_version_creation",
            "classic_version_readback",
            "classic_single_version_deployment_without_force",
            "exact_beta_worker_deletion_by_immutable_id",
            "exact_worker_control_plane_absence",
        ]),
        "the isolated canary proof scope expanded"
    );
    check(
        [
            "access_protected_route_behavior",
            "runtime_version_metadata_identity",
            "production_artifact_byte_identity",
            "production_digest_compatibility",
            "d1_lifecycle_evidence",
            "d1_gate_eligibility",
        ].every(value => claims.does_not_prove?.includes(value)),
        "the canary must explicitly exclude runtime, production artifact, lifecycle, and gate claims"
    );
    check(
        blocker.status === "local_digest_identity_resolved_remote_safety_unresolved" &&
            blocker.worker_version_contract === "beta_worker_json_version_v1" &&
            blocker.artifact_and_protocol_upload_interface === "canonical_beta_json_modules" &&
            blocker.artifact_and_protocol_binding_digest === "bare_canonical_role_and_caller_bound_sha256" &&
            blocker.artifact_and_protocol_version_request_digest ===
                "bare_canonical_method_path_query_and_body_sha256" &&
            blocker.lifecycle_digest_encoding === "bare_sha256_hex" &&
            blocker.protocol_carries_artifact_digest === true &&
            blocker.artifact_protocol_lifecycle_digest_compatible === true &&
            blocker.isolated_canary_required_for_digest_compatibility === false &&
            blocker.isolated_canary_status === "not_run" &&
            blocker.first_version_preview_safety_resolved === false &&
            blocker.credentialed_production_adapters_implemented === false &&
            blocker.opaque_evidence_consumer_implemented === false,
        "local digest identity may be resolved only while remote safety and evidence remain blocked"
    );
    check(
        Array.isArray(fixture.observations) && fixture.observations.length === 0,
        "not_run cannot contain observations"
    );
    check(
        Array.isArray(fixture.sources) &&
            fixture.sources.length >= 5 &&
            fixture.sources.every(source => /^https:\/\/developers\.cloudflare\.com\//u.test(source)),
        "the canary needs Cloudflare API primary sources"
    );
    return errors;
};

export const readAndCheckCloudflareWorkerApiCanaryFixture = async () => {
    const [fixture, rootManifest, operatorManifest, unitConfig, baseE2EConfig] = await Promise.all([
        readFile(fixturePath, "utf8").then(JSON.parse),
        readFile("package.json", "utf8").then(JSON.parse),
        readFile("packages/d1-probe-operator/package.json", "utf8").then(JSON.parse),
        readFile("vitest.config.ts", "utf8"),
        readFile("vitest.base-layer.e2e.config.ts", "utf8"),
    ]);
    const errors = checkCloudflareWorkerApiCanaryFixture(fixture);
    const forbiddenLiveCommandRegistered = [rootManifest.scripts ?? {}, operatorManifest.scripts ?? {}].some(scripts =>
        Object.values(scripts).some(
            command =>
                typeof command === "string" &&
                (command.includes("src/cloudflare-worker-canary-cli.ts") ||
                    /(?:^|\s)canary-worker-api(?:\s|$)/u.test(command))
        )
    );
    if (
        rootManifest.scripts?.["d1-probe:plan-worker-api-canary"] !==
            "corepack pnpm --dir packages/d1-probe-operator plan-worker-api-canary" ||
        operatorManifest.scripts?.["plan-worker-api-canary"] !==
            "node --import tsx src/cloudflare-worker-canary-plan-cli.ts" ||
        rootManifest.scripts?.["d1-probe:inspect-worker-api-canary-recovery"] !==
            "corepack pnpm --dir packages/d1-probe-operator inspect-worker-api-canary-recovery" ||
        operatorManifest.scripts?.["inspect-worker-api-canary-recovery"] !==
            "node --import tsx src/cloudflare-worker-canary-recovery-inspect-cli.ts" ||
        rootManifest.scripts?.["test:base-layer:e2e"] !==
            "corepack pnpm --dir packages/d1-probe-operator test:base-layer:e2e" ||
        rootManifest.scripts?.["bench:base-layer"] !==
            "corepack pnpm --dir packages/d1-probe-operator bench:base-layer" ||
        typeof rootManifest.scripts?.verify !== "string" ||
        !rootManifest.scripts.verify.includes("corepack pnpm test:base-layer:e2e") ||
        operatorManifest.scripts?.["test:base-layer:e2e"] !==
            "vitest run --config ../../vitest.base-layer.e2e.config.ts" ||
        operatorManifest.scripts?.["bench:base-layer"] !==
            "OPENBOT_BASE_E2E_REPORT=1 vitest run --config ../../vitest.base-layer.e2e.config.ts --reporter=verbose" ||
        !unitConfig.includes('exclude: [...configDefaults.exclude, "packages/**/*.e2e.test.ts"]') ||
        !baseE2EConfig.includes(
            'include: ["packages/d1-probe-operator/src/cloudflare-worker-canary-base.e2e.test.ts"]'
        ) ||
        !baseE2EConfig.includes("fileParallelism: false") ||
        !baseE2EConfig.includes("maxWorkers: 1") ||
        rootManifest.scripts?.["d1-probe:canary-worker-api"] !== undefined ||
        operatorManifest.scripts?.["canary-worker-api"] !== undefined ||
        forbiddenLiveCommandRegistered
    ) {
        errors.push(
            "the Worker API canary may register only its plan, read-only recovery inspector, and local base-layer test commands"
        );
    }
    return errors;
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
    const errors = await readAndCheckCloudflareWorkerApiCanaryFixture();
    if (errors.length > 0) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
    } else {
        console.log(`checked ${fileURLToPath(import.meta.url)} against ${fixturePath}`);
    }
}
