import { readFile } from "node:fs/promises";

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const errors = [];
const failUnless = (condition, message) => {
    if (!condition) errors.push(message);
};
const sameSet = (left, right) => left.length === right.length && left.every(value => right.includes(value));

const coreFixture = await readJson("apps/control-plane/fixtures/core-routes.json");
const denyFixture = await readJson("apps/control-plane/fixtures/artifact-prefix-deny.json");
const commandFixture = await readJson("docs/fixtures/core-command-matrix.json");
const sandboxFixture = await readJson("docs/fixtures/sandbox-execution-contract.json");
const itemTwoFixture = await readJson("docs/fixtures/item-2-gates.json");
const connectorFixture = await readJson("docs/fixtures/first-connector.json");
const jurisdictionFixture = await readJson("docs/fixtures/installation-jurisdictions.json");
const openRouterFixture = await readJson("docs/fixtures/openrouter-route.json");
const commandMarkdown = await readFile("docs/command-matrix.md", "utf8");

const routeKeys = coreFixture.routes.map(route => `${route.method} ${route.path}`);
const routeKeySet = new Set(routeKeys);

failUnless(
    coreFixture.schema_version === 1 && Array.isArray(coreFixture.routes) && coreFixture.routes.length > 0,
    "core-routes.json must contain a nonempty version 1 route list"
);
failUnless(new Set(routeKeys).size === routeKeys.length, "core-routes.json contains a duplicate method and path");

for (const route of coreFixture.routes) {
    if (denyFixture.denied_prefixes.some(prefix => route.path.startsWith(prefix))) {
        errors.push(`deferred artifact prefix registered: ${route.method} ${route.path}`);
    }
    if (denyFixture.denied_fragments.some(fragment => route.path.includes(fragment))) {
        errors.push(`deferred artifact fragment registered: ${route.method} ${route.path}`);
    }
}

const commandIds = commandFixture.commands.map(command => command.id);
const markdownCommandIds = [...commandMarkdown.matchAll(/^\|\s+`([a-z][a-z0-9_]*)`/gmu)].map(match => match[1]);
const requiredCommandFields = [
    "id",
    "routes",
    "actor",
    "idempotency_scope",
    "expected_version",
    "success",
    "repeat",
    "stale",
    "audit_event",
    "outbox_effects",
];

failUnless(commandFixture.schema_version === 1, "core-command-matrix.json must use schema version 1");
failUnless(
    commandFixture.implementation_status === "design_only",
    "core command fixture must not claim implementation"
);
failUnless(new Set(commandIds).size === commandIds.length, "core command fixture contains duplicate command IDs");
failUnless(
    new Set(markdownCommandIds).size === markdownCommandIds.length,
    "command-matrix.md contains duplicate command IDs"
);
failUnless(
    sameSet(commandIds, markdownCommandIds),
    "command IDs differ between command-matrix.md and core-command-matrix.json"
);

const fixtureCommandRoutes = new Set();
for (const command of commandFixture.commands) {
    for (const field of requiredCommandFields) {
        failUnless(Object.hasOwn(command, field), `command ${command.id ?? "<missing>"} is missing ${field}`);
    }
    failUnless(/^[a-z][a-z0-9_]*$/u.test(command.id), `invalid command ID: ${command.id}`);
    failUnless(Array.isArray(command.routes) && command.routes.length > 0, `command ${command.id} needs a route`);
    failUnless(Array.isArray(command.outbox_effects), `command ${command.id} needs an outbox array`);
    for (const route of command.routes) {
        if (route.startsWith("PRIVATE ")) continue;
        fixtureCommandRoutes.add(route);
        failUnless(routeKeySet.has(route), `command ${command.id} references an unknown route: ${route}`);
    }
}

const mutationRoutes = coreFixture.routes
    .filter(route => route.method !== "GET" || route.path === "/oauth/metorial/callback")
    .map(route => `${route.method} ${route.path}`);
for (const route of mutationRoutes) {
    failUnless(fixtureCommandRoutes.has(route), `mutation route has no command record: ${route}`);
}

const sandboxLimits = sandboxFixture.unverified_limit_targets;
failUnless(sandboxFixture.schema_version === 1, "sandbox execution fixture must use schema version 1");
failUnless(
    sandboxFixture.status === "design_accepted_probe_not_run",
    "sandbox execution fixture must not claim a passed deployed gate"
);
failUnless(
    sandboxFixture.execute_request_caller === "openbot_run_durable_object" &&
        sandboxFixture.authority_owner === "openbot_capability_gateway" &&
        sandboxFixture.run_lifecycle_owner === "openbot_orchestrator",
    "sandbox caller direction does not match the authority design"
);
failUnless(
    sandboxFixture.runner_bindings["SandboxExecutionService.execute"] === "openbot_capability_gateway" &&
        sandboxFixture.runner_bindings["SandboxLifecycleService.kill"] === "openbot_orchestrator" &&
        sandboxFixture.runner_bindings["SandboxLifecycleService.destroy"] === "openbot_orchestrator" &&
        sandboxFixture.runner_bindings.generic_actor_union === false &&
        sandboxFixture.runner_bindings.callers_share_method_sets === false,
    "sandbox runner entrypoint ownership drifted"
);
failUnless(
    sandboxFixture.dispatch_reservation.rpc_original_wire_byte_identity_claimed === false &&
        sandboxFixture.dispatch_reservation.runner_receives.includes("canonical_field_projection_digest") &&
        !sandboxFixture.dispatch_reservation.runner_receives.includes("canonical_request_bytes"),
    "sandbox RPC fixture must describe a canonical field projection, not original wire-byte identity"
);
failUnless(
    sandboxFixture.profile_identity.configuration_digest === null &&
        sandboxFixture.profile_identity.profile_digest === null &&
        sandboxFixture.unresolved_literals.includes("configuration_digest") &&
        sandboxFixture.unresolved_literals.includes("profile_digest"),
    "unresolved immutable configuration and record digests must remain explicit"
);
failUnless(
    sandboxFixture.adoption_status.current === "candidate" &&
        sandboxFixture.record_lifecycle.current === "active" &&
        sameSet(sandboxFixture.record_lifecycle.allowed, ["active", "disabled"]),
    "adoption status and record lifecycle must remain separate"
);
for (const field of [
    "reviewed_configuration_digest",
    "evidence_digest",
    "observed_at",
    "valid_until",
    "cloudflare_platform_fingerprint",
    "checks",
]) {
    failUnless(
        sandboxFixture.adoption_evidence.required_fields.includes(field),
        `sandbox adoption evidence is missing required field ${field}`
    );
}
failUnless(
    sandboxFixture.adoption_evidence.current === null &&
        sandboxFixture.adoption_evidence.required_check_result === "passed",
    "sandbox evidence must stay absent until every typed check passes"
);
failUnless(
    sameSet(sandboxFixture.adoption_evidence.checks, [
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
    ]),
    "sandbox adoption check names drifted from the typed evidence contract"
);
failUnless(
    sameSet(sandboxFixture.runtime.allowed_instance_types, ["lite", "basic"]) &&
        sandboxFixture.runtime.instance_type === null &&
        sandboxFixture.runtime.probe_candidate === "lite",
    "sandbox instance selection must remain lite or basic and unresolved until its probe passes"
);
failUnless(
    sandboxLimits.source_utf8_bytes === 32 * 1024 &&
        sandboxLimits.input_json_bytes === 128 * 1024 &&
        sandboxLimits.stdout_bytes === 48 * 1024 &&
        sandboxLimits.stderr_bytes === 16 * 1024 &&
        sandboxLimits.result_json_bytes === 64 * 1024 &&
        sandboxLimits.aggregate_output_bytes === 128 * 1024 &&
        sandboxLimits.filesystem_bytes_unverified_target === 256 * 1024 * 1024 &&
        sandboxLimits.processes_unverified_target === 8 &&
        sandboxLimits.outbound_requests === 0 &&
        sandboxLimits.startup_ms === 60_000 &&
        sandboxLimits.remote_process_lifetime_ms === 15_000 &&
        sandboxLimits.teardown_ms === 30_000 &&
        sandboxLimits.sandbox_age_ms === 120_000 &&
        sandboxLimits.run_wall_ms === 240_000,
    "sandbox clock, byte, or outbound-request target drifted"
);
failUnless(
    sandboxFixture.limit_enforcement.filesystem_and_process_targets_are_enforced_claims === false &&
        sandboxFixture.limit_enforcement.filesystem_bytes_unverified_target ===
            "os_or_container_mechanism_unresolved" &&
        sandboxFixture.limit_enforcement.processes_unverified_target === "os_or_container_mechanism_unresolved" &&
        sandboxFixture.limit_enforcement.target_numbers_may_enter_enabled_profile_before_mechanisms_pass === false,
    "unverified filesystem and process targets must not be described as enforced"
);
failUnless(
    sandboxFixture.data_profile.compute_policy_must_narrow_profile_classes === true &&
        sandboxFixture.data_profile.compute_grant_must_narrow_policy_classes === true &&
        sandboxFixture.data_profile.effective_limits.includes("componentwise_minimum") &&
        sandboxFixture.compute_authority.provider_capability_grant_authorizes_code === false &&
        sandboxFixture.compute_authority.organization_compute_policy.admitted_data_classes.includes("narrower") &&
        sandboxFixture.compute_authority.organization_compute_policy.limits.includes("componentwise") &&
        sandboxFixture.compute_authority.compute_grant.admitted_data_classes.includes("narrower") &&
        sandboxFixture.compute_authority.compute_grant.limits.includes("componentwise"),
    "compute policy and grant narrowing drifted"
);
failUnless(
    sandboxFixture.lifecycle_commands.kill_authority.fence_kind === "run_attempt" &&
        sandboxFixture.lifecycle_commands.kill_authority.exact_process_handle_required === true &&
        sameSet(Object.keys(sandboxFixture.lifecycle_commands.destroy_authority_variants), [
            "active_attempt",
            "cleanup_obligation",
        ]) &&
        sandboxFixture.lifecycle_commands.destroy_authority_variants.cleanup_obligation.includes(
            "cleanup_obligation_id"
        ),
    "sandbox lifecycle authority variants drifted"
);
failUnless(
    sameSet(sandboxFixture.cleanup.sdk_response_states, ["sdk_acknowledged", "not_found", "outcome_unknown"]) &&
        sandboxFixture.cleanup.independent_destroy_observation_claimed === false,
    "sandbox cleanup responses must preserve SDK acknowledgement, not-found, and uncertainty"
);
failUnless(
    sandboxFixture.result_contract.exactly_one_value === true &&
        sandboxFixture.result_contract.canonical_json_required === true &&
        sandboxFixture.result_contract.terminal_digest_required === true,
    "sandbox success must require one digest-bound canonical JSON result"
);

const sandboxGate = itemTwoFixture.gates.find(gate => gate.id === "sandbox_execution");
failUnless(itemTwoFixture.status === "blocked", "item 2 must remain blocked while deployed probes are open");
failUnless(
    new Set(itemTwoFixture.gates.map(gate => gate.id)).size === itemTwoFixture.gates.length,
    "item 2 fixture contains duplicate gate IDs"
);
failUnless(
    sandboxGate?.adoption_status === "candidate" && sandboxGate?.record_lifecycle === "active",
    "item 2 sandbox gate must distinguish adoption status from lifecycle"
);
failUnless(
    connectorFixture.schema_version === 1 &&
        connectorFixture.status === "blocked" &&
        connectorFixture.decision === "metorial_search_candidate_literals_missing" &&
        connectorFixture.metorial.api_version_header === "2026-01-01-magnetar" &&
        connectorFixture.metorial.provider_identifier === "metorial-search" &&
        connectorFixture.metorial.provider_deployment_id_hmac === null &&
        connectorFixture.metorial.tool_keys.length === 0 &&
        connectorFixture.metorial.auth_setup.kind === "none" &&
        connectorFixture.metorial.resource_rule.kind === "global_public_read_only" &&
        connectorFixture.metorial.resource_rule.operator_supplied_provider_auth_config_present === false,
    "first connector candidate must remain denied until literal deployment and tool evidence exists"
);
failUnless(
    openRouterFixture.schema_version === 1 &&
        openRouterFixture.status === "candidate_documented_probe_not_run" &&
        openRouterFixture.request_route.allow_fallbacks === false &&
        openRouterFixture.request_route.require_parameters === true &&
        openRouterFixture.request_route.data_collection === "deny" &&
        openRouterFixture.request_route.zdr === true &&
        openRouterFixture.openbot_response_policy.maximum_tool_calls_per_model_turn === 1 &&
        !Object.hasOwn(openRouterFixture.request_route, "parallel_tool_calls"),
    "OpenRouter fixture must remain a no-fallback, ZDR probe candidate without the unsupported parallel parameter"
);
failUnless(
    sameSet(Object.keys(jurisdictionFixture.profiles), ["automatic", "eu", "us", "fedramp"]) &&
        jurisdictionFixture.profiles.automatic.release_status === "blocked" &&
        jurisdictionFixture.profiles.eu.release_status === "blocked" &&
        jurisdictionFixture.profiles.us.release_status === "deny" &&
        jurisdictionFixture.profiles.fedramp.release_status === "blocked",
    "installation jurisdiction fixture drifted from the documented deny matrix"
);

for (const [name, fixture] of [
    ["first-connector.json", connectorFixture],
    ["installation-jurisdictions.json", jurisdictionFixture],
    ["openrouter-route.json", openRouterFixture],
    ["sandbox-execution-contract.json", sandboxFixture],
]) {
    failUnless(Array.isArray(fixture.sources) && fixture.sources.length > 0, `${name} needs primary source URLs`);
    for (const source of fixture.sources ?? []) {
        failUnless(/^https:\/\//u.test(source), `${name} contains a non-HTTPS source URL`);
    }
}

if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
} else {
    console.log(
        `checked ${routeKeys.length} routes, ${commandIds.length} commands, artifact denies, and sandbox evidence invariants`
    );
}
