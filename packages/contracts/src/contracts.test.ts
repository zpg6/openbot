import { describe, expect, it } from "vitest";
import {
    AccountIdSchema,
    BotRevisionV1Schema,
    CanonicalResourceScopeV1Schema,
    CanonicalToolSchemaV1Schema,
    CreateBotRevisionCommandV1Schema,
    CreateComputeGrantCommandV1Schema,
    CreateOrganizationComputePolicyCommandV1Schema,
    CreateOrganizationToolPolicyCommandV1Schema,
    CreateRunConfirmationCommandV1Schema,
    CreateSkillRevisionCommandV1Schema,
    DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1,
    DEFAULT_CODE_EXECUTION_LIMITS_V1,
    DEFAULT_RUNTIME_LIMITS_V1,
    DENY_CODES_V1,
    DisclosureSnapshotV1Schema,
    ERROR_CODES_V1,
    JsonSchemaSubsetV1Schema,
    JsonValueSchema,
    ModelRouteV1Schema,
    UnverifiedManifestExtensionEnvelopeV1Schema,
    OrganizationToolPolicyV1Schema,
    OutboundDataRuleV1Schema,
    CodeExecutionProfileV1Schema,
    ComputeGrantV1Schema,
    OrganizationComputePolicyV1Schema,
    PersistedUserContentDataClassV1Schema,
    RuntimeLimitsV1Schema,
    classifyUserAuthoredContentV1,
    computeLimitsAreNarrowerOrEqualV1,
    computeAuthorityChainIsValidV1,
    verifyCompilerManifestExtensionEnvelopeV1,
} from "./internal.js";

const ids = {
    account: "01890f3e-7b42-7cc1-98c3-4f760f7c9132",
    bot: "01890f3e-7b42-7cc1-98c3-4f760f7c9133",
    revision: "01890f3e-7b42-7cc1-98c3-4f760f7c9134",
    confirmation: "01890f3e-7b42-7cc1-98c3-4f760f7c9135",
    policy: "01890f3e-7b42-7cc1-98c3-4f760f7c9136",
    connector: "01890f3e-7b42-7cc1-98c3-4f760f7c9137",
    deployment: "01890f3e-7b42-7cc1-98c3-4f760f7c9138",
    grant: "01890f3e-7b42-7cc1-98c3-4f760f7c9139",
    computePolicy: "01890f3e-7b42-7cc1-98c3-4f760f7c9142",
    computeGrant: "01890f3e-7b42-7cc1-98c3-4f760f7c9143",
    skillRevision: "01890f3e-7b42-7cc1-98c3-4f760f7c9141",
} as const;
const digest = "0".repeat(64);

describe("branded IDs", () => {
    it("accepts lowercase UUIDv7 and rejects other UUID versions", () => {
        expect(AccountIdSchema.parse(ids.account)).toBe(ids.account);
        expect(AccountIdSchema.safeParse("01890f3e-7b42-4cc1-98c3-4f760f7c9132").success).toBe(false);
        expect(AccountIdSchema.safeParse(ids.account.toUpperCase()).success).toBe(false);
    });
});

describe("RuntimeLimitsV1", () => {
    it("parses the exact core and artifact defaults", () => {
        expect(RuntimeLimitsV1Schema.parse(DEFAULT_RUNTIME_LIMITS_V1)).toEqual(DEFAULT_RUNTIME_LIMITS_V1);
        expect(
            RuntimeLimitsV1Schema.parse({
                ...DEFAULT_RUNTIME_LIMITS_V1,
                artifact_workspace: DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1,
            }).artifact_workspace
        ).toEqual(DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1);
    });

    it("rejects limits above the reviewed maximum and invalid lease timing", () => {
        expect(RuntimeLimitsV1Schema.safeParse({ ...DEFAULT_RUNTIME_LIMITS_V1, max_tool_calls: 3 }).success).toBe(
            false
        );
        expect(
            RuntimeLimitsV1Schema.safeParse({
                ...DEFAULT_RUNTIME_LIMITS_V1,
                run_attempt_heartbeat_ms: 180_000,
            }).success
        ).toBe(false);
    });

    it("rejects contradictory artifact limits", () => {
        expect(
            RuntimeLimitsV1Schema.safeParse({
                ...DEFAULT_RUNTIME_LIMITS_V1,
                artifact_workspace: {
                    ...DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1,
                    max_total_read_bytes: 64 * 1024,
                },
            }).success
        ).toBe(false);
        expect(
            RuntimeLimitsV1Schema.safeParse({
                ...DEFAULT_RUNTIME_LIMITS_V1,
                artifact_workspace: {
                    ...DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1,
                    max_operations: 4,
                },
            }).success
        ).toBe(false);
    });
});

describe("bounded JSON Schema subset", () => {
    it("accepts an acyclic local reference", () => {
        expect(
            JsonSchemaSubsetV1Schema.safeParse({
                type: "object",
                $defs: { Name: { type: "string", maxLength: 80 } },
                properties: { name: { $ref: "#/$defs/Name" } },
                required: ["name"],
                additionalProperties: false,
            }).success
        ).toBe(true);
    });

    it("rejects external and recursive references", () => {
        expect(JsonSchemaSubsetV1Schema.safeParse({ $ref: "https://example.com/schema" }).success).toBe(false);
        expect(
            JsonSchemaSubsetV1Schema.safeParse({
                $defs: {
                    A: { $ref: "#/$defs/B" },
                    B: { $ref: "#/$defs/A" },
                },
                $ref: "#/$defs/A",
            }).success
        ).toBe(false);
        expect(
            JsonSchemaSubsetV1Schema.safeParse({
                $defs: {},
                $ref: "#/$defs/toString",
            }).success
        ).toBe(false);
    });

    it("rejects unreviewed keywords", () => {
        expect(JsonSchemaSubsetV1Schema.safeParse({ type: "string", pattern: "(a+)+$" }).success).toBe(false);
    });

    it("requires required fields to be own properties", () => {
        expect(
            JsonSchemaSubsetV1Schema.safeParse({
                type: "object",
                properties: {},
                required: ["toString"],
            }).success
        ).toBe(false);
    });

    it("rejects values that JSON serialization would drop", () => {
        expect(JsonSchemaSubsetV1Schema.safeParse({ type: "string", const: undefined }).success).toBe(false);
        expect(JsonSchemaSubsetV1Schema.safeParse({ enum: ["ok", () => "lost"] }).success).toBe(false);
    });

    it("rejects deep and hostile values without invoking accessors or throwing", () => {
        let deep: Record<string, unknown> = {};
        for (let depth = 0; depth < 80; depth += 1) deep = { deep };
        expect(() => JsonValueSchema.safeParse(deep)).not.toThrow();
        expect(JsonValueSchema.safeParse(deep).success).toBe(false);

        let getterCalls = 0;
        const accessor = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(accessor, "secret", {
            enumerable: true,
            get: () => {
                getterCalls += 1;
                return "leaked";
            },
        });
        expect(JsonValueSchema.safeParse(accessor).success).toBe(false);
        expect(getterCalls).toBe(0);

        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        expect(() => JsonValueSchema.safeParse(hostile)).not.toThrow();
        expect(JsonValueSchema.safeParse(hostile).success).toBe(false);

        let ownKeyReads = 0;
        const changingArray = new Proxy([], {
            ownKeys: () => {
                ownKeyReads += 1;
                return ownKeyReads === 1 ? ["length"] : ["length", "evil"];
            },
            getOwnPropertyDescriptor: (target, key) => {
                if (key === "evil") {
                    return { configurable: true, enumerable: true, value: "hidden", writable: true };
                }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        expect(() => JsonValueSchema.safeParse(changingArray)).not.toThrow();
        expect(JsonValueSchema.safeParse(changingArray).success).toBe(false);
    });
});

describe("versioned contracts", () => {
    const modelRoute = {
        openrouter_model_id: "vendor/model",
        provider_slug: "vendor",
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
        parallel_tool_calls_parameter: "omitted_unsupported",
        max_tool_calls_per_turn: 1,
    } as const;

    it("omits an unsupported parallel-tool parameter and denies multi-call turns", () => {
        expect(ModelRouteV1Schema.safeParse(modelRoute).success).toBe(true);
        expect(
            ModelRouteV1Schema.safeParse({
                ...modelRoute,
                parallel_tool_calls: false,
            }).success
        ).toBe(false);
        expect(
            ModelRouteV1Schema.safeParse({
                ...modelRoute,
                max_tool_calls_per_turn: 2,
            }).success
        ).toBe(false);
    });

    it("keeps compute authority separate and blocks an unverified user profile", () => {
        const candidate = {
            schema_version: 1,
            profile_key: "sandbox-javascript-v1",
            profile_revision: 1,
            configuration_digest: digest,
            profile_digest: digest,
            display_name: "Isolated code execution",
            runner_protocol_version: 1,
            runner_protocol_digest: digest,
            runner_version: "1.0.0",
            runner_digest: digest,
            node_version: "22.19.0",
            sandbox_sdk_version: "1.0.0-next.1",
            sandbox_sdk_package_digest: digest,
            image_digest: digest,
            instance_type: "lite",
            adoption_status: "candidate",
            lifecycle: "active",
            languages: ["javascript"],
            admitted_data_classes: ["synthetic"],
            network_policy: "public_internet_blocked_unverified_dns",
            adoption_evidence: null,
            filesystem_policy: "ephemeral_per_run",
            package_installation: false,
            interactive_terminal: false,
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
        } as const;
        expect(CodeExecutionProfileV1Schema.safeParse(candidate).success).toBe(true);
        expect(
            CodeExecutionProfileV1Schema.safeParse({
                ...candidate,
                admitted_data_classes: ["public", "synthetic"],
            }).success
        ).toBe(false);
        expect(
            CodeExecutionProfileV1Schema.safeParse({
                ...candidate,
                adoption_status: "enabled",
            }).success
        ).toBe(false);
        expect(
            CodeExecutionProfileV1Schema.safeParse({
                ...candidate,
                instance_type: "basic",
            }).success
        ).toBe(true);
        expect(
            CreateOrganizationComputePolicyCommandV1Schema.safeParse({
                schema_version: 1,
                profile_key: candidate.profile_key,
                expected_profile_revision: candidate.profile_revision,
                expected_profile_digest: candidate.profile_digest,
                expected_profile_dependency_fence: 0,
                admitted_data_classes: ["synthetic"],
                limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
            }).success
        ).toBe(true);
        expect(
            CreateComputeGrantCommandV1Schema.safeParse({
                schema_version: 1,
                bot_revision_id: ids.revision,
                organization_compute_policy_id: ids.computePolicy,
                expected_bot_revision_digest: digest,
                expected_compute_policy_revision: 1,
                expected_compute_policy_digest: digest,
                expected_compute_policy_fence: 0,
                admitted_data_classes: ["synthetic"],
                purpose: "Calculate a summary",
                expires_at: 60_000,
                limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                provider_authorization_id: ids.grant,
            }).success
        ).toBe(false);

        expect(
            computeLimitsAreNarrowerOrEqualV1(
                { ...DEFAULT_CODE_EXECUTION_LIMITS_V1, max_source_bytes: 16 * 1024 },
                DEFAULT_CODE_EXECUTION_LIMITS_V1
            )
        ).toBe(true);
        expect(
            computeLimitsAreNarrowerOrEqualV1(
                { ...DEFAULT_CODE_EXECUTION_LIMITS_V1, max_source_bytes: 16 * 1024 },
                { ...DEFAULT_CODE_EXECUTION_LIMITS_V1, max_source_bytes: 8 * 1024 }
            )
        ).toBe(false);
    });

    it("requires every tool destination and all model destinations when results reach the model", () => {
        const base = {
            data_classes: ["public"],
            allowed_argument_fields: ["query"],
            tool_result_may_reach_model: false,
        } as const;
        expect(
            OutboundDataRuleV1Schema.safeParse({
                ...base,
                destinations: ["connector_provider"],
            }).success
        ).toBe(false);
        expect(
            OutboundDataRuleV1Schema.safeParse({
                ...base,
                tool_result_may_reach_model: true,
                destinations: ["metorial", "connector_provider"],
            }).success
        ).toBe(false);
        expect(
            OutboundDataRuleV1Schema.safeParse({
                ...base,
                tool_result_may_reach_model: true,
                destinations: ["metorial", "connector_provider", "openrouter", "model_provider"],
            }).success
        ).toBe(true);
    });

    it("requires allowed argument fields to exist in the canonical input schema", () => {
        const policy = {
            schema_version: 1,
            organization_tool_policy_id: ids.policy,
            account_id: ids.account,
            revision_number: 1,
            lifecycle: "active",
            dependency_revocation_fence: 0,
            connector_release_id: ids.connector,
            provider_deployment_id: ids.deployment,
            provider_version: "2026-08-01",
            tool_key: "records.search",
            display_name: "Search records",
            canonical_tool_schema: { type: "object", properties: { query: { type: "string" } } },
            tool_schema_digest: digest,
            effect: "read_only",
            incidental_effects: [],
            resource_rule: {
                kind: "connector_specific",
                mapping_key: "public_dataset",
                mapping_version: 1,
                canonical_scope: { dataset: "public" },
                scope_digest: digest,
            },
            outbound_data_rule: {
                data_classes: ["public"],
                destinations: ["metorial", "connector_provider"],
                allowed_argument_fields: ["query"],
                tool_result_may_reach_model: false,
            },
            reviewer: "connector-release",
            reviewed_at: 1,
            created_at: 2,
            policy_digest: digest,
        };
        expect(OrganizationToolPolicyV1Schema.safeParse(policy).success).toBe(true);
        expect(
            OrganizationToolPolicyV1Schema.safeParse({
                ...policy,
                outbound_data_rule: {
                    ...policy.outbound_data_rule,
                    allowed_argument_fields: ["missing"],
                },
            }).success
        ).toBe(false);

        const descriptorHostile = new Proxy(policy.canonical_tool_schema, {
            ownKeys: target => Reflect.ownKeys(target),
            getOwnPropertyDescriptor: (target, key) => {
                if (key === "properties") throw new Error("descriptor trap");
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        expect(() =>
            OrganizationToolPolicyV1Schema.safeParse({
                ...policy,
                canonical_tool_schema: descriptorHostile,
            })
        ).not.toThrow();
    });

    it("rejects owner-authored fields on a server-derived tool policy", () => {
        const policy = {
            schema_version: 1,
            organization_tool_policy_id: ids.policy,
            account_id: ids.account,
            revision_number: 1,
            lifecycle: "active",
            dependency_revocation_fence: 0,
            connector_release_id: ids.connector,
            provider_deployment_id: ids.deployment,
            provider_version: "2026-08-01",
            tool_key: "records.search",
            display_name: "Search records",
            canonical_tool_schema: { type: "object" },
            tool_schema_digest: digest,
            effect: "read_only",
            incidental_effects: ["provider_access_log"],
            resource_rule: {
                kind: "connector_specific",
                mapping_key: "public_dataset",
                mapping_version: 1,
                canonical_scope: { dataset: "public" },
                scope_digest: digest,
            },
            outbound_data_rule: {
                data_classes: ["public"],
                destinations: ["metorial", "connector_provider"],
                allowed_argument_fields: ["query"],
                tool_result_may_reach_model: true,
            },
            reviewer: "connector-release",
            reviewed_at: 1,
            created_at: 2,
            policy_digest: digest,
            owner_effect_override: "write",
        };
        expect(OrganizationToolPolicyV1Schema.safeParse(policy).success).toBe(false);
    });

    it("keeps public policy commands narrower than stored authority", () => {
        const command = {
            schema_version: 1,
            provider_deployment_id: ids.deployment,
            expected_provider_deployment_version: 1,
            expected_connector_release_id: ids.connector,
            connector_tool_key: "records.search",
            expected_tool_schema_digest: digest,
            expected_catalog_fence: 0,
        };
        expect(CreateOrganizationToolPolicyCommandV1Schema.safeParse(command).success).toBe(true);
        expect(
            CreateOrganizationToolPolicyCommandV1Schema.safeParse({
                ...command,
                effect: "read_only",
                policy_digest: digest,
            }).success
        ).toBe(false);
    });

    it("does not let public commands lower user-authored content classification", () => {
        const skillCommand = {
            schema_version: 1,
            name: "Terms",
            purpose: "Apply organization terminology",
            instruction_text: "Use the internal account labels.",
            input_schema: { type: "object", additionalProperties: false },
            output_schema: { type: "object", additionalProperties: false },
            requested_organization_tool_policy_ids: [],
        };
        expect(CreateSkillRevisionCommandV1Schema.safeParse(skillCommand).success).toBe(true);
        expect(
            CreateSkillRevisionCommandV1Schema.safeParse({
                ...skillCommand,
                instruction_data_class: "public",
            }).success
        ).toBe(false);
        for (const unsafeName of [" Terms", "Terms\u0000", "Term\u202es"]) {
            expect(
                CreateSkillRevisionCommandV1Schema.safeParse({
                    ...skillCommand,
                    name: unsafeName,
                }).success
            ).toBe(false);
        }
        expect(classifyUserAuthoredContentV1()).toBe("organization");
        expect(classifyUserAuthoredContentV1("restricted")).toBe("restricted");
        expect(PersistedUserContentDataClassV1Schema.safeParse("public").success).toBe(false);

        const confirmationCommand = {
            schema_version: 1,
            bot_id: ids.bot,
            bot_revision_id: ids.revision,
            capability_grant_id: ids.grant,
            expected_bot_revision_digest: digest,
            expected_capability_grant_revision: 1,
            expected_capability_grant_digest: digest,
            expected_authority_fence: 0,
            expected_compute_grant_digest: null,
            prompt: "Read the public test records.",
        };
        expect(CreateRunConfirmationCommandV1Schema.safeParse(confirmationCommand).success).toBe(true);
        expect(
            CreateRunConfirmationCommandV1Schema.safeParse({
                ...confirmationCommand,
                prompt_data_class: "public",
            }).success
        ).toBe(false);
    });

    it("does not let a Bot revision command set operational limits or route flags", () => {
        const command = {
            schema_version: 1,
            bot_id: ids.bot,
            expected_bot_version: 1,
            job: "Read public records",
            standing_instructions: "Return a short factual summary.",
            organization_tool_policy_ids: [ids.policy],
            skill_revision_ids: [],
            model_route_key: "reviewed-default",
            organization_compute_policy_id: null,
            expected_catalog_fence: 0,
            expected_selection_digest: digest,
            requested_limits: {
                max_model_turns: 5,
                max_tool_calls: 2,
                max_code_executions: 0,
                max_code_execution_ms: 15_000,
                max_model_output_tokens_per_request: 2_048,
                max_runtime_wall_time_ms: 240_000,
                max_estimated_run_cost_usd_micros: 250_000,
            },
        };
        expect(CreateBotRevisionCommandV1Schema.safeParse(command).success).toBe(true);
        expect(
            CreateBotRevisionCommandV1Schema.safeParse({
                ...command,
                requested_limits: { ...command.requested_limits, max_code_executions: 1 },
            }).success
        ).toBe(false);
        expect(
            CreateBotRevisionCommandV1Schema.safeParse({
                ...command,
                requested_limits: {
                    ...command.requested_limits,
                    max_queue_delivery_attempts: 1,
                },
            }).success
        ).toBe(false);
        expect(CreateBotRevisionCommandV1Schema.safeParse({ ...command, allow_fallbacks: true }).success).toBe(false);
        expect(CreateBotRevisionCommandV1Schema.safeParse({ ...command, job_data_class: "public" }).success).toBe(
            false
        );
    });

    it("bounds the canonical vendor tool schema", () => {
        const policy = {
            schema_version: 1,
            organization_tool_policy_id: ids.policy,
            account_id: ids.account,
            revision_number: 1,
            lifecycle: "active",
            dependency_revocation_fence: 0,
            connector_release_id: ids.connector,
            provider_deployment_id: ids.deployment,
            provider_version: "2026-08-01",
            tool_key: "records.search",
            display_name: "Search records",
            canonical_tool_schema: { description: "x".repeat(128 * 1024) },
            tool_schema_digest: digest,
            effect: "read_only",
            incidental_effects: [],
            resource_rule: {
                kind: "connector_specific",
                mapping_key: "public_dataset",
                mapping_version: 1,
                canonical_scope: { dataset: "public" },
                scope_digest: digest,
            },
            outbound_data_rule: {
                data_classes: ["public"],
                destinations: ["metorial"],
                allowed_argument_fields: [],
                tool_result_may_reach_model: false,
            },
            reviewer: "connector-release",
            reviewed_at: 1,
            created_at: 2,
            policy_digest: digest,
        };
        expect(OrganizationToolPolicyV1Schema.safeParse(policy).success).toBe(false);

        let nested: Record<string, unknown> = {};
        for (let depth = 0; depth < 18; depth += 1) nested = { nested };
        expect(CanonicalToolSchemaV1Schema.safeParse(nested).success).toBe(false);
    });

    it("never throws on stateful proxies in bounded canonical JSON", () => {
        const statefulProxy = () => {
            let prototypeReads = 0;
            return new Proxy(
                {},
                {
                    getPrototypeOf: () => {
                        prototypeReads += 1;
                        if (prototypeReads > 1) throw new Error("state changed");
                        return Object.prototype;
                    },
                    ownKeys: () => [],
                }
            );
        };
        for (const schema of [CanonicalToolSchemaV1Schema, CanonicalResourceScopeV1Schema]) {
            const hostile = statefulProxy();
            expect(() => schema.safeParse(hostile)).not.toThrow();
            const parsed = schema.safeParse(statefulProxy());
            expect(parsed.success).toBe(true);
            if (parsed.success) expect(Object.getPrototypeOf(parsed.data)).toBeNull();
        }
    });

    it("keeps a disclosure snapshot free of future tool arguments and results", () => {
        const snapshot = {
            schema_version: 1,
            confirmation_id: ids.confirmation,
            candidate_run_id: "01890f3e-7b42-7cc1-98c3-4f760f7c9140",
            account_id: ids.account,
            bot_id: ids.bot,
            bot_revision_id: ids.revision,
            capability_grant_id: ids.grant,
            capability_grant_revision: 1,
            capability_grant_digest: digest,
            purpose: "Read the public test records requested in this task",
            grant_expires_at: 600_000,
            connector_provider_label: "Example records",
            connected_account_label: "Public test account",
            prompt: { plaintext_digest: digest, data_class: "organization" },
            bot_configuration: {
                bot_revision_digest: digest,
                job: { plaintext_digest: digest, data_class: "organization" },
                standing_instructions: { plaintext_digest: digest, data_class: "organization" },
            },
            tools: [
                {
                    organization_tool_policy_id: ids.policy,
                    policy_revision_number: 1,
                    display_name: "Search records",
                    tool_key: "records.search",
                    tool_schema_digest: digest,
                    policy_digest: digest,
                    resource_display_label: "Public test dataset",
                    resource_scope_digest: digest,
                    possible_data_classes: ["public"],
                    disclosure_destinations: ["metorial", "connector_provider"],
                    incidental_effects: ["provider_access_log"],
                },
            ],
            skills: [],
            possible_data_classes: ["public", "organization"],
            disclosure_destinations: ["metorial", "openrouter", "model_provider", "connector_provider"],
            incidental_effects: ["provider_access_log"],
            model_route: modelRoute,
            code_execution: null,
            limits: DEFAULT_RUNTIME_LIMITS_V1,
            manifest_extensions: { schema_version: 1, extensions: [] },
            issued_at: 1,
            expires_at: 2,
            snapshot_digest: digest,
        };
        expect(DisclosureSnapshotV1Schema.safeParse(snapshot).success).toBe(true);
        const withoutCandidate: Record<string, unknown> = { ...snapshot };
        delete withoutCandidate["candidate_run_id"];
        expect(DisclosureSnapshotV1Schema.safeParse(withoutCandidate).success).toBe(false);
        expect(DisclosureSnapshotV1Schema.safeParse({ ...snapshot, tool_arguments: { query: "later" } }).success).toBe(
            false
        );
        expect(DisclosureSnapshotV1Schema.safeParse({ ...snapshot, expires_at: 300_002 }).success).toBe(false);
        expect(
            DisclosureSnapshotV1Schema.safeParse({ ...snapshot, possible_data_classes: ["synthetic"] }).success
        ).toBe(false);
        expect(DisclosureSnapshotV1Schema.safeParse({ ...snapshot, incidental_effects: [] }).success).toBe(false);

        const codeExecution = {
            schema_version: 1,
            profile_key: "sandbox-javascript-v1",
            profile_revision: 1,
            configuration_digest: digest,
            profile_digest: digest,
            display_name: "Isolated code execution",
            runner_protocol_version: 1,
            runner_protocol_digest: digest,
            runner_version: "1.0.0",
            runner_digest: digest,
            node_version: "22.19.0",
            sandbox_sdk_version: "1.0.0-next.1",
            sandbox_sdk_package_digest: digest,
            image_digest: digest,
            instance_type: "lite",
            adoption_status: "enabled",
            lifecycle: "active",
            languages: ["javascript"],
            admitted_data_classes: ["public", "synthetic", "organization"],
            network_policy: "public_internet_blocked_unverified_dns",
            adoption_evidence: {
                schema_version: 1,
                reviewed_configuration_digest: digest,
                evidence_digest: digest,
                observed_at: 1,
                valid_until: 600_000,
                cloudflare_platform_fingerprint: "workers-2026-08-22",
                checks: {
                    package_image_match: "passed",
                    fixed_argv_launch: "passed",
                    enumerated_dns_sentinel_not_observed: "passed",
                    filesystem_limit: "passed",
                    process_limit: "passed",
                    startup_timeout: "passed",
                    execution_timeout_and_kill: "passed",
                    teardown_and_destroy: "passed",
                    repeat_destroy_safe: "passed",
                    sandbox_lifetime: "passed",
                    fresh_generation: "passed",
                    output_backpressure: "passed",
                    replacement_uncertainty: "passed",
                    placement: "passed",
                    installation_capacity: "passed",
                    private_route: "passed",
                    secret_sentinel: "passed",
                    mismatched_package_image_denial: "passed",
                },
            },
            filesystem_policy: "ephemeral_per_run",
            package_installation: false,
            interactive_terminal: false,
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
        } as const;
        const codeEnabledSnapshot = {
            ...snapshot,
            limits: { ...snapshot.limits, max_code_executions: 1 },
        } as const;
        const parsedCodeExecution = CodeExecutionProfileV1Schema.parse(codeExecution);
        const computePolicy = OrganizationComputePolicyV1Schema.parse({
            schema_version: 1,
            organization_compute_policy_id: ids.computePolicy,
            account_id: ids.account,
            revision_number: 1,
            lifecycle: "active",
            dependency_revocation_fence: 0,
            profile_key: codeExecution.profile_key,
            profile_revision: codeExecution.profile_revision,
            profile_digest: codeExecution.profile_digest,
            admitted_data_classes: ["public", "synthetic", "organization"],
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
            created_at: 1,
            policy_digest: digest,
        });
        const computeGrant = ComputeGrantV1Schema.parse({
            schema_version: 1,
            compute_grant_id: ids.computeGrant,
            account_id: ids.account,
            bot_revision_id: ids.revision,
            organization_compute_policy_id: ids.computePolicy,
            compute_policy_revision: 1,
            compute_policy_digest: digest,
            admitted_data_classes: ["public", "synthetic", "organization"],
            limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
            lifecycle: "active",
            revocation_fence: 0,
            purpose: "Calculate the requested summary",
            expires_at: 600_000,
            created_at: 1,
            grant_digest: digest,
        });
        const botRevision = BotRevisionV1Schema.parse({
            schema_version: 1,
            bot_revision_id: ids.revision,
            bot_id: ids.bot,
            account_id: ids.account,
            revision_number: 1,
            job_content_id: "01890f3e-7b42-7cc1-98c3-4f760f7c9144",
            job_plaintext_digest: digest,
            job_data_class: "organization",
            standing_instructions_content_id: "01890f3e-7b42-7cc1-98c3-4f760f7c9145",
            standing_instructions_plaintext_digest: digest,
            standing_instructions_data_class: "organization",
            prompt_template_version: 1,
            organization_tool_policy_ids: [ids.policy],
            skill_revision_ids: [],
            connector_release_id: ids.connector,
            model_route: modelRoute,
            compute_selection: {
                organization_compute_policy_id: ids.computePolicy,
                compute_policy_revision: 1,
                compute_policy_digest: digest,
                compute_policy_admitted_data_classes: ["public", "synthetic", "organization"],
                compute_policy_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                profile: codeExecution,
            },
            limits: codeEnabledSnapshot.limits,
            outbound_data_rule: {
                data_classes: ["public"],
                destinations: ["metorial", "connector_provider"],
                allowed_argument_fields: [],
                tool_result_may_reach_model: false,
            },
            manifest_extensions: { schema_version: 1, extensions: [] },
            created_at: 1,
            revision_digest: digest,
        });
        const expectedComputeAuthority = {
            account_id: ids.account,
            bot_revision_id: ids.revision,
            as_of_ms: 2,
            cloudflare_platform_fingerprint: "workers-2026-08-22",
        } as const;
        expect(
            computeAuthorityChainIsValidV1(
                botRevision,
                parsedCodeExecution,
                computePolicy,
                computeGrant,
                expectedComputeAuthority
            )
        ).toBe(true);
        expect(
            computeAuthorityChainIsValidV1(botRevision, parsedCodeExecution, computePolicy, computeGrant, {
                ...expectedComputeAuthority,
                account_id: "01890f3e-7b42-7cc1-98c3-4f760f7c9199",
            })
        ).toBe(false);
        expect(
            computeAuthorityChainIsValidV1(
                botRevision,
                parsedCodeExecution,
                OrganizationComputePolicyV1Schema.parse({ ...computePolicy, policy_digest: "1".repeat(64) }),
                computeGrant,
                expectedComputeAuthority
            )
        ).toBe(false);
        expect(
            computeAuthorityChainIsValidV1(botRevision, parsedCodeExecution, computePolicy, computeGrant, {
                ...expectedComputeAuthority,
                as_of_ms: computeGrant.expires_at,
            })
        ).toBe(false);
        expect(
            computeAuthorityChainIsValidV1(botRevision, parsedCodeExecution, computePolicy, computeGrant, {
                ...expectedComputeAuthority,
                as_of_ms: parsedCodeExecution.adoption_evidence!.valid_until,
            })
        ).toBe(false);
        expect(
            computeAuthorityChainIsValidV1(botRevision, parsedCodeExecution, computePolicy, computeGrant, {
                ...expectedComputeAuthority,
                cloudflare_platform_fingerprint: "workers-changed",
            })
        ).toBe(false);
        const candidateProfile = CodeExecutionProfileV1Schema.parse({
            ...codeExecution,
            adoption_status: "candidate",
            admitted_data_classes: ["synthetic"],
            adoption_evidence: null,
        });
        expect(
            computeAuthorityChainIsValidV1(
                botRevision,
                candidateProfile,
                computePolicy,
                computeGrant,
                expectedComputeAuthority
            )
        ).toBe(false);
        expect(
            DisclosureSnapshotV1Schema.safeParse({
                ...codeEnabledSnapshot,
                code_execution: {
                    profile: codeExecution,
                    organization_compute_policy_id: ids.computePolicy,
                    compute_policy_revision: 1,
                    compute_policy_digest: digest,
                    compute_policy_admitted_data_classes: ["public", "synthetic", "organization"],
                    compute_policy_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                    compute_grant_id: ids.computeGrant,
                    compute_grant_digest: digest,
                    compute_grant_purpose: "Summarize the reviewed public records",
                    compute_grant_expires_at: 300_000,
                    compute_grant_admitted_data_classes: ["public", "synthetic", "organization"],
                    compute_grant_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                    possible_code_input_data_classes: ["organization"],
                    effective_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                },
                disclosure_destinations: [
                    "metorial",
                    "openrouter",
                    "model_provider",
                    "connector_provider",
                    "cloudflare_sandbox",
                ],
            }).success
        ).toBe(true);
        expect(
            DisclosureSnapshotV1Schema.safeParse({
                ...codeEnabledSnapshot,
                code_execution: {
                    profile: codeExecution,
                    organization_compute_policy_id: ids.computePolicy,
                    compute_policy_revision: 1,
                    compute_policy_digest: digest,
                    compute_policy_admitted_data_classes: ["public"],
                    compute_policy_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                    compute_grant_id: ids.computeGrant,
                    compute_grant_digest: digest,
                    compute_grant_purpose: "Summarize the reviewed public records",
                    compute_grant_expires_at: 300_000,
                    compute_grant_admitted_data_classes: ["public"],
                    compute_grant_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                    possible_code_input_data_classes: ["organization"],
                    effective_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                },
                disclosure_destinations: [
                    "metorial",
                    "openrouter",
                    "model_provider",
                    "connector_provider",
                    "cloudflare_sandbox",
                ],
            }).success
        ).toBe(false);
        expect(
            DisclosureSnapshotV1Schema.safeParse({
                ...codeEnabledSnapshot,
                code_execution: {
                    profile: codeExecution,
                    organization_compute_policy_id: ids.computePolicy,
                    compute_policy_revision: 1,
                    compute_policy_digest: digest,
                    compute_policy_admitted_data_classes: ["public", "synthetic", "organization"],
                    compute_policy_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                    compute_grant_id: ids.computeGrant,
                    compute_grant_digest: digest,
                    compute_grant_purpose: "Summarize the reviewed public records",
                    compute_grant_expires_at: 300_000,
                    compute_grant_admitted_data_classes: ["public", "synthetic", "organization"],
                    compute_grant_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                    possible_code_input_data_classes: ["organization"],
                    effective_limits: DEFAULT_CODE_EXECUTION_LIMITS_V1,
                },
            }).success
        ).toBe(false);
        expect(
            DisclosureSnapshotV1Schema.safeParse({
                ...snapshot,
                disclosure_destinations: [
                    "metorial",
                    "openrouter",
                    "model_provider",
                    "connector_provider",
                    "cloudflare_sandbox",
                ],
            }).success
        ).toBe(false);

        const restrictedSkill = {
            skill_revision_id: ids.skillRevision,
            name: "Private terminology",
            skill_revision_digest: digest,
            instruction_plaintext_digest: digest,
            instruction_data_class: "restricted",
        } as const;
        expect(DisclosureSnapshotV1Schema.safeParse({ ...snapshot, skills: [restrictedSkill] }).success).toBe(false);
        expect(
            DisclosureSnapshotV1Schema.safeParse({
                ...snapshot,
                skills: [restrictedSkill],
                possible_data_classes: ["public", "organization", "restricted"],
            }).success
        ).toBe(true);
        expect(
            DisclosureSnapshotV1Schema.safeParse({
                ...snapshot,
                prompt: { ...snapshot.prompt, data_class: "unknown" },
                possible_data_classes: ["public", "organization", "unknown"],
            }).success
        ).toBe(false);
    });
});

describe("stable code and extension registries", () => {
    it("contains unique snake-case codes", () => {
        expect(new Set(DENY_CODES_V1).size).toBe(DENY_CODES_V1.length);
        expect(new Set(ERROR_CODES_V1).size).toBe(ERROR_CODES_V1.length);
        expect(ERROR_CODES_V1.every(code => /^[a-z][a-z0-9_]*$/.test(code))).toBe(true);
        expect(ERROR_CODES_V1).toContain("content_deleted");
    });

    it("rejects duplicate extension identities", () => {
        const extension = {
            extension_id: "org.openbot.artifacts",
            extension_version: 1,
            required: false,
            payload: {},
            payload_digest: digest,
        };
        expect(
            UnverifiedManifestExtensionEnvelopeV1Schema.safeParse({
                schema_version: 1,
                extensions: [extension, { ...extension, extension_version: 2 }],
            }).success
        ).toBe(false);
    });

    it("never lets a hostile manifest payload escape the JSON boundary", () => {
        const hostilePayload = new Proxy(
            { value: "safe" },
            {
                ownKeys: target => Reflect.ownKeys(target),
                getOwnPropertyDescriptor: (_target, key) => {
                    if (key === "value") throw new Error("descriptor trap");
                    return undefined;
                },
            }
        );
        expect(() =>
            UnverifiedManifestExtensionEnvelopeV1Schema.safeParse({
                schema_version: 1,
                extensions: [
                    {
                        extension_id: "org.openbot.artifacts",
                        extension_version: 1,
                        required: false,
                        payload: hostilePayload,
                        payload_digest: digest,
                    },
                ],
            })
        ).not.toThrow();
    });

    it("rejects unknown required extensions and mismatched payload digests", () => {
        const extension = {
            extension_id: "org.openbot.artifacts",
            extension_version: 1,
            required: true,
            payload: {},
            payload_digest: digest,
        };
        expect(
            verifyCompilerManifestExtensionEnvelopeV1(
                { schema_version: 1, extensions: [extension] },
                { supported_versions: {}, verify_payload_digest: () => true }
            )
        ).toEqual({ success: false, code: "unknown_required_extension" });
        expect(
            verifyCompilerManifestExtensionEnvelopeV1(
                { schema_version: 1, extensions: [extension] },
                {
                    supported_versions: { "org.openbot.artifacts": [1] },
                    verify_payload_digest: () => false,
                }
            )
        ).toEqual({ success: false, code: "extension_digest_mismatch" });
        expect(
            verifyCompilerManifestExtensionEnvelopeV1(
                { schema_version: 1, extensions: [extension] },
                {
                    supported_versions: { "org.openbot.artifacts": [1] },
                    verify_payload_digest: () => true,
                }
            ).success
        ).toBe(true);
    });
});
