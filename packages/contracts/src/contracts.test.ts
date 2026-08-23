import { describe, expect, it } from "vitest";
import {
    AccountIdSchema,
    CanonicalResourceScopeV1Schema,
    CanonicalToolSchemaV1Schema,
    CreateBotRevisionCommandV1Schema,
    CreateOrganizationToolPolicyCommandV1Schema,
    CreateRunConfirmationCommandV1Schema,
    CreateSkillRevisionCommandV1Schema,
    DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1,
    DEFAULT_RUNTIME_LIMITS_V1,
    DENY_CODES_V1,
    DisclosureSnapshotV1Schema,
    ERROR_CODES_V1,
    JsonSchemaSubsetV1Schema,
    JsonValueSchema,
    UnverifiedManifestExtensionEnvelopeV1Schema,
    OrganizationToolPolicyV1Schema,
    OutboundDataRuleV1Schema,
    PersistedUserContentDataClassV1Schema,
    RuntimeLimitsV1Schema,
    classifyUserAuthoredContentV1,
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
        parallel_tool_calls: false,
    } as const;

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
            connector_tool_key: "records.search",
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
            requested_limits: {
                max_model_turns: 3,
                max_tool_calls: 2,
                max_model_output_tokens_per_request: 2_048,
                max_runtime_wall_time_ms: 120_000,
                max_estimated_run_cost_usd_micros: 250_000,
            },
        };
        expect(CreateBotRevisionCommandV1Schema.safeParse(command).success).toBe(true);
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
