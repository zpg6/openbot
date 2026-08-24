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
    const steps = workflow.steps ?? {};
    const claims = fixture.claims ?? {};
    const blocker = fixture.production_path_blocker ?? {};

    check(fixture.schema_version === 1, "schema_version must be 1");
    check(fixture.kind === "cloudflare_worker_api_interoperability_canary", "kind changed");
    check(fixture.status === "not_run", "the checked-in Worker API canary must remain not_run");
    check(fixture.purpose === "isolated_beta_to_classic_worker_api_interoperability_only", "scope changed");
    check(
        fixture.implementation?.credentialed_runner_implemented === true &&
            fixture.implementation?.root_command_registered === true &&
            fixture.implementation?.credentials_recorded === false &&
            fixture.implementation?.observations_recorded === false,
        "the isolated canary implementation state drifted"
    );
    check(
        Object.values(fixture.authority ?? {}).every(value => value === false),
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
            workflow.ambiguous_mutation_result === "manual_cleanup_required_no_retry" &&
            workflow.checkout_local_plan_reservation === true &&
            workflow.distributed_plan_reservation === false &&
            workflow.fresh_execution_ownership_tag_required === true &&
            workflow.raw_execution_ownership_tag_recorded === false &&
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
                ?.exact_returned_worker_id_generated_name_and_ownership_marker_required === true,
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
        blocker.status === "unresolved" &&
            blocker.artifact_upload_interface === "classic_multipart_metadata_and_module_parts" &&
            blocker.protocol_upload_interface === "beta_json_modules" &&
            blocker.artifact_binding_digest === "bare_canonical_role_and_caller_bound_sha256" &&
            blocker.protocol_binding_digest === "sha256_prefixed_beta_binding_only_sha256" &&
            blocker.lifecycle_digest_encoding === "bare_sha256_hex" &&
            blocker.protocol_carries_artifact_digest === false &&
            blocker.artifact_protocol_lifecycle_digest_compatible === false &&
            blocker.isolated_canary_may_resolve_this_blocker === false,
        "the production artifact/protocol/lifecycle digest incompatibility must remain explicit"
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
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    return checkCloudflareWorkerApiCanaryFixture(fixture);
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
