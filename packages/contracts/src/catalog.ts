import { z } from "zod";
import {
    AccountIdSchema,
    BotIdSchema,
    BotRevisionIdSchema,
    CapabilityGrantIdSchema,
    ComputeGrantIdSchema,
    ConfigurationContentIdSchema,
    ConfirmationIdSchema,
    ConnectorReleaseIdSchema,
    OrganizationToolPolicyIdSchema,
    OrganizationComputePolicyIdSchema,
    ProviderDeploymentIdSchema,
    RunIdSchema,
    SkillIdSchema,
    SkillRevisionIdSchema,
    UserIdSchema,
} from "./ids.js";
import { JsonSchemaSubsetV1Schema } from "./json-schema.js";
import {
    CodeExecutionLimitsV1Schema,
    NarrowedCodeExecutionLimitsV1Schema,
    RuntimeLimitsV1Schema,
    type CodeExecutionLimitsV1,
    type NarrowedCodeExecutionLimitsV1,
    type RuntimeLimitsV1,
} from "./limits.js";
import { UnverifiedManifestExtensionEnvelopeV1Schema } from "./manifest-extensions.js";
import {
    DataClassV1Schema,
    DisclosureDestinationV1Schema,
    EpochMillisecondsSchema,
    NonnegativeFenceSchema,
    PositiveVersionSchema,
    SafeDisplayLabelSchema,
    Sha256DigestSchema,
    boundedJsonValue,
    utf8String,
} from "./primitives.js";

const lifecycle = z.enum(["active", "disabled"]);
const AuthorityDisplayLabelV1Schema = SafeDisplayLabelSchema.refine(
    value => new TextEncoder().encode(value).byteLength <= 128,
    "Authority label exceeds 128 UTF-8 bytes"
);
export const PersistedUserContentDataClassV1Schema = z.enum(["organization", "restricted"]);
export type PersistedUserContentDataClassV1 = z.infer<typeof PersistedUserContentDataClassV1Schema>;

export const classifyUserAuthoredContentV1 = (
    trustedClassification?: PersistedUserContentDataClassV1
): PersistedUserContentDataClassV1 => trustedClassification ?? "organization";
export const CanonicalToolSchemaV1Schema = boundedJsonValue({
    maxBytes: 128 * 1024,
    maxDepth: 16,
    maxNodes: 2_048,
}).refine(value => typeof value === "object" && value !== null && !Array.isArray(value), {
    message: "Canonical tool schema must be an object",
});
export const CanonicalResourceScopeV1Schema = boundedJsonValue({
    maxBytes: 16 * 1024,
    maxDepth: 8,
    maxNodes: 256,
}).refine(value => typeof value === "object" && value !== null && !Array.isArray(value), {
    message: "Canonical resource scope must be an object",
});
const nonemptyUnique = <T extends z.ZodType>(schema: T, maximum: number) =>
    z
        .array(schema)
        .min(1)
        .max(maximum)
        .refine(values => new Set(values).size === values.length, {
            message: "Values must be unique",
        });

export const ResourceRuleV1Schema = z
    .object({
        kind: z.literal("connector_specific"),
        mapping_key: utf8String({ minBytes: 1, maxBytes: 128 }),
        mapping_version: PositiveVersionSchema,
        canonical_scope: CanonicalResourceScopeV1Schema,
        scope_digest: Sha256DigestSchema,
    })
    .strict();
export type ResourceRuleV1 = z.infer<typeof ResourceRuleV1Schema>;

export const OutboundDataRuleV1Schema = z
    .object({
        data_classes: nonemptyUnique(DataClassV1Schema, DataClassV1Schema.options.length),
        destinations: nonemptyUnique(DisclosureDestinationV1Schema, 4),
        allowed_argument_fields: z
            .array(utf8String({ minBytes: 1, maxBytes: 128 }))
            .max(64)
            .refine(values => new Set(values).size === values.length, {
                message: "Allowed argument fields must be unique",
            }),
        tool_result_may_reach_model: z.boolean(),
    })
    .strict()
    .superRefine((rule, context) => {
        const destinations = new Set(rule.destinations);
        for (const required of ["metorial", "connector_provider"] as const) {
            if (!destinations.has(required)) {
                context.addIssue({
                    code: "custom",
                    path: ["destinations"],
                    message: `Tool disclosure must include ${required}`,
                });
            }
        }
        if (rule.tool_result_may_reach_model) {
            for (const required of ["openrouter", "model_provider"] as const) {
                if (!destinations.has(required)) {
                    context.addIssue({
                        code: "custom",
                        path: ["destinations"],
                        message: `Model-visible tool results must include ${required}`,
                    });
                }
            }
        }
    });
export type OutboundDataRuleV1 = z.infer<typeof OutboundDataRuleV1Schema>;

export const OrganizationToolPolicyV1Schema = z
    .object({
        schema_version: z.literal(1),
        organization_tool_policy_id: OrganizationToolPolicyIdSchema,
        account_id: AccountIdSchema,
        revision_number: PositiveVersionSchema,
        lifecycle,
        dependency_revocation_fence: NonnegativeFenceSchema,
        connector_release_id: ConnectorReleaseIdSchema,
        provider_deployment_id: ProviderDeploymentIdSchema,
        provider_version: utf8String({ minBytes: 1, maxBytes: 128 }),
        tool_key: utf8String({ minBytes: 1, maxBytes: 256 }),
        display_name: AuthorityDisplayLabelV1Schema,
        canonical_tool_schema: CanonicalToolSchemaV1Schema,
        tool_schema_digest: Sha256DigestSchema,
        effect: z.literal("read_only"),
        incidental_effects: z
            .array(z.enum(["provider_access_log", "provider_access_timestamp", "provider_quota"]))
            .max(3)
            .refine(values => new Set(values).size === values.length, {
                message: "Incidental effects must be unique",
            }),
        resource_rule: ResourceRuleV1Schema,
        outbound_data_rule: OutboundDataRuleV1Schema,
        reviewer: utf8String({ minBytes: 1, maxBytes: 128 }),
        reviewed_at: EpochMillisecondsSchema,
        created_at: EpochMillisecondsSchema,
        policy_digest: Sha256DigestSchema,
    })
    .strict()
    .superRefine((policy, context) => {
        try {
            const schema = policy.canonical_tool_schema;
            if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
                context.addIssue({
                    code: "custom",
                    path: ["canonical_tool_schema"],
                    message: "Canonical input schema must be an object",
                });
                return;
            }
            const properties = Object.hasOwn(schema, "properties") ? schema["properties"] : undefined;
            if (
                policy.outbound_data_rule.allowed_argument_fields.length > 0 &&
                (typeof properties !== "object" || properties === null || Array.isArray(properties))
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["canonical_tool_schema", "properties"],
                    message: "Allowed argument fields require canonical input properties",
                });
                return;
            }
            if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
                for (const field of policy.outbound_data_rule.allowed_argument_fields) {
                    if (!Object.hasOwn(properties, field)) {
                        context.addIssue({
                            code: "custom",
                            path: ["outbound_data_rule", "allowed_argument_fields"],
                            message: "Allowed argument field is absent from the canonical input schema",
                        });
                    }
                }
            }
        } catch {
            context.addIssue({
                code: "custom",
                path: ["canonical_tool_schema"],
                message: "Canonical input schema could not be inspected",
            });
        }
    });
export type OrganizationToolPolicyV1 = z.infer<typeof OrganizationToolPolicyV1Schema>;
export const StoredOrganizationToolPolicyV1Schema = OrganizationToolPolicyV1Schema;
export type StoredOrganizationToolPolicyV1 = OrganizationToolPolicyV1;

export const CreateOrganizationToolPolicyCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        provider_deployment_id: ProviderDeploymentIdSchema,
        expected_provider_deployment_version: PositiveVersionSchema,
        expected_connector_release_id: ConnectorReleaseIdSchema,
        connector_tool_key: utf8String({ minBytes: 1, maxBytes: 256 }),
        expected_tool_schema_digest: Sha256DigestSchema,
        expected_catalog_fence: NonnegativeFenceSchema,
    })
    .strict();
export type CreateOrganizationToolPolicyCommandV1 = z.infer<typeof CreateOrganizationToolPolicyCommandV1Schema>;

export const SkillRevisionV1Schema = z
    .object({
        schema_version: z.literal(1),
        skill_id: SkillIdSchema,
        skill_revision_id: SkillRevisionIdSchema,
        account_id: AccountIdSchema,
        revision_number: PositiveVersionSchema,
        lifecycle,
        dependency_revocation_fence: NonnegativeFenceSchema,
        name: AuthorityDisplayLabelV1Schema,
        purpose: utf8String({ minBytes: 1, maxBytes: 512 }),
        instruction_content_id: ConfigurationContentIdSchema,
        instruction_plaintext_digest: Sha256DigestSchema,
        instruction_data_class: PersistedUserContentDataClassV1Schema,
        maximum_instruction_bytes: z
            .number()
            .int()
            .positive()
            .max(32 * 1024),
        input_schema: JsonSchemaSubsetV1Schema,
        output_schema: JsonSchemaSubsetV1Schema,
        requested_organization_tool_policy_ids: z
            .array(OrganizationToolPolicyIdSchema)
            .max(4)
            .refine(values => new Set(values).size === values.length, { message: "Policy IDs must be unique" }),
        author_user_id: UserIdSchema,
        created_at: EpochMillisecondsSchema,
        revision_digest: Sha256DigestSchema,
    })
    .strict();
export type SkillRevisionV1 = z.infer<typeof SkillRevisionV1Schema>;
export const StoredSkillRevisionV1Schema = SkillRevisionV1Schema;
export type StoredSkillRevisionV1 = SkillRevisionV1;

export const CreateSkillRevisionCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        skill_id: SkillIdSchema.optional(),
        name: AuthorityDisplayLabelV1Schema,
        purpose: utf8String({ minBytes: 1, maxBytes: 512 }),
        instruction_text: utf8String({ minBytes: 1, maxBytes: 32 * 1024 }),
        input_schema: JsonSchemaSubsetV1Schema,
        output_schema: JsonSchemaSubsetV1Schema,
        requested_organization_tool_policy_ids: z
            .array(OrganizationToolPolicyIdSchema)
            .max(4)
            .refine(values => new Set(values).size === values.length, { message: "Policy IDs must be unique" }),
    })
    .strict();
export type CreateSkillRevisionCommandV1 = z.infer<typeof CreateSkillRevisionCommandV1Schema>;

export const ModelRouteV1Schema = z
    .object({
        openrouter_model_id: utf8String({ minBytes: 1, maxBytes: 256 }),
        provider_slug: utf8String({ minBytes: 1, maxBytes: 128 }),
        allow_fallbacks: z.literal(false),
        require_parameters: z.literal(true),
        data_collection: z.literal("deny"),
        zdr: z.literal(true),
        parallel_tool_calls_parameter: z.literal("omitted_unsupported"),
        max_tool_calls_per_turn: z.literal(1),
    })
    .strict();
export type ModelRouteV1 = z.infer<typeof ModelRouteV1Schema>;

export const CodeLanguageV1Schema = z.enum(["javascript"]);
export type CodeLanguageV1 = z.infer<typeof CodeLanguageV1Schema>;

const SandboxAdoptionChecksV1Schema = z
    .object({
        package_image_match: z.literal("passed"),
        fixed_argv_launch: z.literal("passed"),
        enumerated_dns_sentinel_not_observed: z.literal("passed"),
        filesystem_limit: z.literal("passed"),
        process_limit: z.literal("passed"),
        startup_timeout: z.literal("passed"),
        execution_timeout_and_kill: z.literal("passed"),
        teardown_and_destroy: z.literal("passed"),
        repeat_destroy_safe: z.literal("passed"),
        sandbox_lifetime: z.literal("passed"),
        fresh_generation: z.literal("passed"),
        output_backpressure: z.literal("passed"),
        replacement_uncertainty: z.literal("passed"),
        placement: z.literal("passed"),
        installation_capacity: z.literal("passed"),
        private_route: z.literal("passed"),
        secret_sentinel: z.literal("passed"),
        mismatched_package_image_denial: z.literal("passed"),
    })
    .strict();

export const SandboxAdoptionEvidenceV1Schema = z
    .object({
        schema_version: z.literal(1),
        reviewed_configuration_digest: Sha256DigestSchema,
        evidence_digest: Sha256DigestSchema,
        observed_at: EpochMillisecondsSchema,
        valid_until: EpochMillisecondsSchema,
        cloudflare_platform_fingerprint: utf8String({ minBytes: 1, maxBytes: 512 }),
        checks: SandboxAdoptionChecksV1Schema,
    })
    .strict()
    .refine(evidence => evidence.valid_until > evidence.observed_at, {
        message: "Sandbox adoption evidence must expire after it is observed",
        path: ["valid_until"],
    });
export type SandboxAdoptionEvidenceV1 = z.infer<typeof SandboxAdoptionEvidenceV1Schema>;

export const CodeExecutionProfileV1Schema = z
    .object({
        schema_version: z.literal(1),
        profile_key: utf8String({ minBytes: 1, maxBytes: 128 }),
        profile_revision: PositiveVersionSchema,
        configuration_digest: Sha256DigestSchema,
        profile_digest: Sha256DigestSchema,
        display_name: AuthorityDisplayLabelV1Schema,
        runner_protocol_version: z.literal(1),
        runner_protocol_digest: Sha256DigestSchema,
        runner_version: utf8String({ minBytes: 1, maxBytes: 64 }),
        runner_digest: Sha256DigestSchema,
        node_version: utf8String({ minBytes: 1, maxBytes: 64 }),
        sandbox_sdk_version: utf8String({ minBytes: 1, maxBytes: 64 }),
        sandbox_sdk_package_digest: Sha256DigestSchema,
        image_digest: Sha256DigestSchema,
        instance_type: z.enum(["lite", "basic"]),
        adoption_status: z.enum(["candidate", "enabled"]),
        lifecycle: z.enum(["active", "disabled"]),
        languages: z
            .array(CodeLanguageV1Schema)
            .min(1)
            .max(CodeLanguageV1Schema.options.length)
            .refine(values => new Set(values).size === values.length, { message: "Code languages must be unique" }),
        admitted_data_classes: z
            .array(z.enum(["public", "synthetic", "organization"]))
            .min(1)
            .max(3)
            .refine(values => new Set(values).size === values.length, {
                message: "Code data classes must be unique",
            }),
        network_policy: z.literal("public_internet_blocked_unverified_dns"),
        adoption_evidence: SandboxAdoptionEvidenceV1Schema.nullable(),
        filesystem_policy: z.literal("ephemeral_per_run"),
        package_installation: z.literal(false),
        interactive_terminal: z.literal(false),
        limits: CodeExecutionLimitsV1Schema,
    })
    .strict()
    .superRefine((profile, context) => {
        const classes = new Set(profile.admitted_data_classes);
        if (profile.adoption_status === "candidate") {
            if (profile.adoption_evidence !== null || classes.size !== 1 || !classes.has("synthetic")) {
                context.addIssue({
                    code: "custom",
                    path: ["admitted_data_classes"],
                    message: "A candidate profile accepts only server-seeded synthetic probe data",
                });
            }
        } else if (
            profile.adoption_evidence === null ||
            profile.adoption_evidence.reviewed_configuration_digest !== profile.configuration_digest
        ) {
            context.addIssue({
                code: "custom",
                path: ["adoption_evidence"],
                message: "An enabled profile requires complete evidence for the reviewed profile digest",
            });
        }
    });
export type CodeExecutionProfileV1 = z.infer<typeof CodeExecutionProfileV1Schema>;

export const OrganizationComputePolicyV1Schema = z
    .object({
        schema_version: z.literal(1),
        organization_compute_policy_id: OrganizationComputePolicyIdSchema,
        account_id: AccountIdSchema,
        revision_number: PositiveVersionSchema,
        lifecycle,
        dependency_revocation_fence: NonnegativeFenceSchema,
        profile_key: utf8String({ minBytes: 1, maxBytes: 128 }),
        profile_revision: PositiveVersionSchema,
        profile_digest: Sha256DigestSchema,
        admitted_data_classes: z
            .array(z.enum(["public", "synthetic", "organization"]))
            .min(1)
            .max(3)
            .refine(values => new Set(values).size === values.length, {
                message: "Compute-policy data classes must be unique",
            }),
        limits: NarrowedCodeExecutionLimitsV1Schema,
        created_at: EpochMillisecondsSchema,
        policy_digest: Sha256DigestSchema,
    })
    .strict();
export type OrganizationComputePolicyV1 = z.infer<typeof OrganizationComputePolicyV1Schema>;

export const CreateOrganizationComputePolicyCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        profile_key: utf8String({ minBytes: 1, maxBytes: 128 }),
        expected_profile_revision: PositiveVersionSchema,
        expected_profile_digest: Sha256DigestSchema,
        expected_profile_dependency_fence: NonnegativeFenceSchema,
        admitted_data_classes: z
            .array(z.enum(["public", "synthetic", "organization"]))
            .min(1)
            .max(3)
            .refine(values => new Set(values).size === values.length, {
                message: "Compute-policy data classes must be unique",
            }),
        limits: NarrowedCodeExecutionLimitsV1Schema,
    })
    .strict();
export type CreateOrganizationComputePolicyCommandV1 = z.infer<typeof CreateOrganizationComputePolicyCommandV1Schema>;

export const ComputeGrantV1Schema = z
    .object({
        schema_version: z.literal(1),
        compute_grant_id: ComputeGrantIdSchema,
        account_id: AccountIdSchema,
        bot_revision_id: BotRevisionIdSchema,
        organization_compute_policy_id: OrganizationComputePolicyIdSchema,
        compute_policy_revision: PositiveVersionSchema,
        compute_policy_digest: Sha256DigestSchema,
        admitted_data_classes: nonemptyUnique(z.enum(["public", "synthetic", "organization"]), 3),
        lifecycle,
        revocation_fence: NonnegativeFenceSchema,
        purpose: utf8String({ minBytes: 1, maxBytes: 512 }),
        expires_at: EpochMillisecondsSchema,
        limits: NarrowedCodeExecutionLimitsV1Schema,
        created_at: EpochMillisecondsSchema,
        grant_digest: Sha256DigestSchema,
    })
    .strict();
export type ComputeGrantV1 = z.infer<typeof ComputeGrantV1Schema>;

export const CreateComputeGrantCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_revision_id: BotRevisionIdSchema,
        organization_compute_policy_id: OrganizationComputePolicyIdSchema,
        expected_bot_revision_digest: Sha256DigestSchema,
        expected_compute_policy_revision: PositiveVersionSchema,
        expected_compute_policy_digest: Sha256DigestSchema,
        expected_compute_policy_fence: NonnegativeFenceSchema,
        admitted_data_classes: nonemptyUnique(z.enum(["public", "synthetic", "organization"]), 3),
        purpose: utf8String({ minBytes: 1, maxBytes: 512 }),
        expires_at: EpochMillisecondsSchema,
        limits: NarrowedCodeExecutionLimitsV1Schema,
    })
    .strict();
export type CreateComputeGrantCommandV1 = z.infer<typeof CreateComputeGrantCommandV1Schema>;

const codeLimitKeys = Object.keys(CodeExecutionLimitsV1Schema.shape) as (keyof CodeExecutionLimitsV1)[];

export const computeLimitsAreNarrowerOrEqualV1 = (
    narrower: NarrowedCodeExecutionLimitsV1,
    broader: NarrowedCodeExecutionLimitsV1 | CodeExecutionLimitsV1
): boolean => codeLimitKeys.every(key => narrower[key] <= broader[key]);

const runtimeCodeLimitsV1 = (runtime: RuntimeLimitsV1): NarrowedCodeExecutionLimitsV1 => ({
    max_executions: 1,
    max_source_bytes: runtime.max_code_source_bytes_per_call,
    max_input_bytes: runtime.max_code_input_bytes_per_call,
    max_stdout_bytes: runtime.max_code_stdout_bytes_per_call,
    max_stderr_bytes: runtime.max_code_stderr_bytes_per_call,
    max_result_bytes: runtime.max_code_result_bytes_per_call,
    max_output_bytes: runtime.max_code_output_bytes_per_run,
    max_filesystem_bytes: runtime.max_sandbox_filesystem_bytes,
    max_processes: runtime.max_sandbox_processes,
    max_outbound_requests: 0,
    max_output_frames: runtime.max_sandbox_output_frames,
    startup_timeout_ms: runtime.max_sandbox_startup_ms,
    execution_timeout_ms: runtime.max_code_execution_ms,
    teardown_timeout_ms: runtime.max_sandbox_teardown_ms,
    sandbox_lifetime_ms: runtime.max_sandbox_lifetime_ms,
});

export const deriveEffectiveCodeExecutionLimitsV1 = (
    profile: CodeExecutionLimitsV1,
    policy: NarrowedCodeExecutionLimitsV1,
    grant: NarrowedCodeExecutionLimitsV1,
    runtime: RuntimeLimitsV1
): NarrowedCodeExecutionLimitsV1 | null => {
    if (runtime.max_code_executions !== 1) return null;
    const runtimeLimits = runtimeCodeLimitsV1(runtime);
    return Object.fromEntries(
        codeLimitKeys.map(key => [key, Math.min(profile[key], policy[key], grant[key], runtimeLimits[key])])
    ) as NarrowedCodeExecutionLimitsV1;
};

export const computeAuthorityChainIsValidV1 = (
    botRevision: BotRevisionV1,
    profile: CodeExecutionProfileV1,
    policy: OrganizationComputePolicyV1,
    grant: ComputeGrantV1,
    expected: {
        account_id: string;
        bot_revision_id: string;
        as_of_ms: number;
        cloudflare_platform_fingerprint: string;
    }
): boolean => {
    const profileClasses = new Set(profile.admitted_data_classes);
    const selection = botRevision.compute_selection;
    const evidence = profile.adoption_evidence;
    return (
        selection !== null &&
        botRevision.account_id === expected.account_id &&
        botRevision.bot_revision_id === expected.bot_revision_id &&
        profile.adoption_status === "enabled" &&
        profile.lifecycle === "active" &&
        evidence !== null &&
        evidence.reviewed_configuration_digest === profile.configuration_digest &&
        evidence.valid_until > expected.as_of_ms &&
        evidence.cloudflare_platform_fingerprint === expected.cloudflare_platform_fingerprint &&
        policy.lifecycle === "active" &&
        grant.lifecycle === "active" &&
        policy.account_id === expected.account_id &&
        grant.account_id === expected.account_id &&
        grant.bot_revision_id === expected.bot_revision_id &&
        grant.expires_at > expected.as_of_ms &&
        selection.organization_compute_policy_id === policy.organization_compute_policy_id &&
        selection.compute_policy_revision === policy.revision_number &&
        selection.compute_policy_digest === policy.policy_digest &&
        selection.profile.profile_revision === profile.profile_revision &&
        selection.profile.profile_digest === profile.profile_digest &&
        selection.compute_policy_admitted_data_classes.length === policy.admitted_data_classes.length &&
        selection.compute_policy_admitted_data_classes.every(dataClass =>
            policy.admitted_data_classes.includes(dataClass)
        ) &&
        codeLimitKeys.every(key => selection.compute_policy_limits[key] === policy.limits[key]) &&
        policy.profile_key === profile.profile_key &&
        policy.profile_revision === profile.profile_revision &&
        policy.profile_digest === profile.profile_digest &&
        grant.organization_compute_policy_id === policy.organization_compute_policy_id &&
        grant.compute_policy_revision === policy.revision_number &&
        grant.compute_policy_digest === policy.policy_digest &&
        policy.admitted_data_classes.every(dataClass => profileClasses.has(dataClass)) &&
        grant.admitted_data_classes.every(dataClass => policy.admitted_data_classes.includes(dataClass)) &&
        computeLimitsAreNarrowerOrEqualV1(policy.limits, profile.limits) &&
        grant.limits.max_outbound_requests === 0 &&
        computeLimitsAreNarrowerOrEqualV1(grant.limits, policy.limits)
    );
};

export const BotRevisionV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_revision_id: BotRevisionIdSchema,
        bot_id: BotIdSchema,
        account_id: AccountIdSchema,
        revision_number: PositiveVersionSchema,
        job_content_id: ConfigurationContentIdSchema,
        job_plaintext_digest: Sha256DigestSchema,
        job_data_class: PersistedUserContentDataClassV1Schema,
        standing_instructions_content_id: ConfigurationContentIdSchema,
        standing_instructions_plaintext_digest: Sha256DigestSchema,
        standing_instructions_data_class: PersistedUserContentDataClassV1Schema,
        prompt_template_version: PositiveVersionSchema,
        organization_tool_policy_ids: nonemptyUnique(OrganizationToolPolicyIdSchema, 4),
        skill_revision_ids: z
            .array(SkillRevisionIdSchema)
            .max(4)
            .refine(values => new Set(values).size === values.length, { message: "Skill IDs must be unique" }),
        connector_release_id: ConnectorReleaseIdSchema,
        model_route: ModelRouteV1Schema,
        compute_selection: z
            .object({
                organization_compute_policy_id: OrganizationComputePolicyIdSchema,
                compute_policy_revision: PositiveVersionSchema,
                compute_policy_digest: Sha256DigestSchema,
                compute_policy_admitted_data_classes: nonemptyUnique(
                    z.enum(["public", "synthetic", "organization"]),
                    3
                ),
                compute_policy_limits: NarrowedCodeExecutionLimitsV1Schema,
                profile: CodeExecutionProfileV1Schema,
            })
            .strict()
            .nullable(),
        limits: RuntimeLimitsV1Schema,
        outbound_data_rule: OutboundDataRuleV1Schema,
        manifest_extensions: UnverifiedManifestExtensionEnvelopeV1Schema,
        created_at: EpochMillisecondsSchema,
        revision_digest: Sha256DigestSchema,
    })
    .strict()
    .superRefine((revision, context) => {
        if (revision.compute_selection !== null && revision.organization_tool_policy_ids.length > 3) {
            context.addIssue({
                code: "custom",
                path: ["organization_tool_policy_ids"],
                message: "Code execution consumes one of the four exposed tool slots",
            });
        }
        if (
            revision.compute_selection !== null &&
            (revision.compute_selection.profile.adoption_status !== "enabled" ||
                revision.compute_selection.profile.lifecycle !== "active" ||
                !computeLimitsAreNarrowerOrEqualV1(
                    revision.compute_selection.compute_policy_limits,
                    revision.compute_selection.profile.limits
                ) ||
                revision.compute_selection.compute_policy_admitted_data_classes.some(
                    dataClass => !revision.compute_selection?.profile.admitted_data_classes.includes(dataClass)
                ))
        ) {
            context.addIssue({
                code: "custom",
                path: ["compute_selection"],
                message: "A Bot revision may select only a narrower policy on an enabled active code profile",
            });
        }
        if ((revision.compute_selection === null) !== (revision.limits.max_code_executions === 0)) {
            context.addIssue({
                code: "custom",
                path: ["limits", "max_code_executions"],
                message: "Code execution count must be zero without compute selection and one with it",
            });
        }
    });
export type BotRevisionV1 = z.infer<typeof BotRevisionV1Schema>;
export const StoredBotRevisionV1Schema = BotRevisionV1Schema;
export type StoredBotRevisionV1 = BotRevisionV1;

export const RequestedRunLimitsV1Schema = z
    .object({
        max_model_turns: z.number().int().positive().max(5),
        max_tool_calls: z.number().int().positive().max(2),
        max_code_executions: z.number().int().nonnegative().max(1),
        max_code_execution_ms: z.number().int().positive().max(15_000),
        max_model_output_tokens_per_request: z.number().int().positive().max(2_048),
        max_runtime_wall_time_ms: z.number().int().positive().max(240_000),
        max_estimated_run_cost_usd_micros: z.number().int().positive().max(250_000),
    })
    .strict();
export type RequestedRunLimitsV1 = z.infer<typeof RequestedRunLimitsV1Schema>;

export const CreateBotRevisionCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_id: BotIdSchema,
        expected_bot_version: PositiveVersionSchema,
        job: utf8String({ minBytes: 1, maxBytes: 4 * 1024 }),
        standing_instructions: utf8String({ minBytes: 1, maxBytes: 32 * 1024 }),
        organization_tool_policy_ids: nonemptyUnique(OrganizationToolPolicyIdSchema, 4),
        skill_revision_ids: z
            .array(SkillRevisionIdSchema)
            .max(4)
            .refine(values => new Set(values).size === values.length, { message: "Skill IDs must be unique" }),
        model_route_key: utf8String({ minBytes: 1, maxBytes: 128 }),
        organization_compute_policy_id: OrganizationComputePolicyIdSchema.nullable(),
        expected_catalog_fence: NonnegativeFenceSchema,
        expected_selection_digest: Sha256DigestSchema,
        requested_limits: RequestedRunLimitsV1Schema,
    })
    .strict()
    .superRefine((command, context) => {
        if (command.organization_compute_policy_id !== null && command.organization_tool_policy_ids.length > 3) {
            context.addIssue({
                code: "custom",
                path: ["organization_tool_policy_ids"],
                message: "Code execution consumes one of the four exposed tool slots",
            });
        }
        if (
            (command.organization_compute_policy_id === null) !==
            (command.requested_limits.max_code_executions === 0)
        ) {
            context.addIssue({
                code: "custom",
                path: ["requested_limits", "max_code_executions"],
                message: "Code execution count must be zero without compute selection and one with it",
            });
        }
    });
export type CreateBotRevisionCommandV1 = z.infer<typeof CreateBotRevisionCommandV1Schema>;

export const DisclosureSnapshotV1Schema = z
    .object({
        schema_version: z.literal(1),
        confirmation_id: ConfirmationIdSchema,
        candidate_run_id: RunIdSchema,
        account_id: AccountIdSchema,
        bot_id: BotIdSchema,
        bot_revision_id: BotRevisionIdSchema,
        capability_grant_id: CapabilityGrantIdSchema,
        capability_grant_revision: PositiveVersionSchema,
        capability_grant_digest: Sha256DigestSchema,
        purpose: utf8String({ minBytes: 1, maxBytes: 512 }),
        grant_expires_at: EpochMillisecondsSchema,
        connector_provider_label: SafeDisplayLabelSchema,
        connected_account_label: SafeDisplayLabelSchema,
        prompt: z
            .object({
                plaintext_digest: Sha256DigestSchema,
                data_class: DataClassV1Schema,
            })
            .strict(),
        bot_configuration: z
            .object({
                bot_revision_digest: Sha256DigestSchema,
                job: z
                    .object({
                        plaintext_digest: Sha256DigestSchema,
                        data_class: DataClassV1Schema,
                    })
                    .strict(),
                standing_instructions: z
                    .object({
                        plaintext_digest: Sha256DigestSchema,
                        data_class: DataClassV1Schema,
                    })
                    .strict(),
            })
            .strict(),
        tools: z
            .array(
                z
                    .object({
                        organization_tool_policy_id: OrganizationToolPolicyIdSchema,
                        policy_revision_number: PositiveVersionSchema,
                        display_name: AuthorityDisplayLabelV1Schema,
                        tool_key: utf8String({ minBytes: 1, maxBytes: 256 }),
                        tool_schema_digest: Sha256DigestSchema,
                        policy_digest: Sha256DigestSchema,
                        resource_display_label: SafeDisplayLabelSchema,
                        resource_scope_digest: Sha256DigestSchema,
                        possible_data_classes: nonemptyUnique(DataClassV1Schema, DataClassV1Schema.options.length),
                        disclosure_destinations: nonemptyUnique(DisclosureDestinationV1Schema, 4),
                        incidental_effects: z
                            .array(z.enum(["provider_access_log", "provider_access_timestamp", "provider_quota"]))
                            .max(3)
                            .refine(values => new Set(values).size === values.length, {
                                message: "Incidental effects must be unique",
                            }),
                    })
                    .strict()
            )
            .min(1)
            .max(4)
            .refine(tools => new Set(tools.map(tool => tool.organization_tool_policy_id)).size === tools.length, {
                message: "Tool policies must be unique",
            }),
        skills: z
            .array(
                z
                    .object({
                        skill_revision_id: SkillRevisionIdSchema,
                        name: AuthorityDisplayLabelV1Schema,
                        skill_revision_digest: Sha256DigestSchema,
                        instruction_plaintext_digest: Sha256DigestSchema,
                        instruction_data_class: DataClassV1Schema,
                    })
                    .strict()
            )
            .max(4)
            .refine(skills => new Set(skills.map(skill => skill.skill_revision_id)).size === skills.length, {
                message: "Skill revisions must be unique",
            }),
        possible_data_classes: nonemptyUnique(DataClassV1Schema, DataClassV1Schema.options.length),
        disclosure_destinations: nonemptyUnique(DisclosureDestinationV1Schema, 5),
        incidental_effects: z
            .array(z.enum(["provider_access_log", "provider_access_timestamp", "provider_quota"]))
            .max(3)
            .refine(values => new Set(values).size === values.length, {
                message: "Incidental effects must be unique",
            }),
        model_route: ModelRouteV1Schema,
        code_execution: z
            .object({
                profile: CodeExecutionProfileV1Schema,
                organization_compute_policy_id: OrganizationComputePolicyIdSchema,
                compute_policy_revision: PositiveVersionSchema,
                compute_policy_digest: Sha256DigestSchema,
                compute_policy_admitted_data_classes: nonemptyUnique(
                    z.enum(["public", "synthetic", "organization"]),
                    3
                ),
                compute_policy_limits: NarrowedCodeExecutionLimitsV1Schema,
                compute_grant_id: ComputeGrantIdSchema,
                compute_grant_digest: Sha256DigestSchema,
                compute_grant_purpose: utf8String({ minBytes: 1, maxBytes: 512 }),
                compute_grant_expires_at: EpochMillisecondsSchema,
                compute_grant_admitted_data_classes: nonemptyUnique(z.enum(["public", "synthetic", "organization"]), 3),
                compute_grant_limits: NarrowedCodeExecutionLimitsV1Schema,
                possible_code_input_data_classes: nonemptyUnique(z.enum(["public", "synthetic", "organization"]), 3),
                effective_limits: NarrowedCodeExecutionLimitsV1Schema,
            })
            .strict()
            .nullable(),
        limits: RuntimeLimitsV1Schema,
        manifest_extensions: UnverifiedManifestExtensionEnvelopeV1Schema,
        issued_at: EpochMillisecondsSchema,
        expires_at: EpochMillisecondsSchema,
        snapshot_digest: Sha256DigestSchema,
    })
    .strict()
    .superRefine((snapshot, context) => {
        if (snapshot.expires_at <= snapshot.issued_at || snapshot.expires_at - snapshot.issued_at > 5 * 60 * 1000) {
            context.addIssue({
                code: "custom",
                path: ["expires_at"],
                message: "Disclosure snapshot lifetime must be at most five minutes",
            });
        }
        if (snapshot.grant_expires_at < snapshot.expires_at) {
            context.addIssue({
                code: "custom",
                path: ["grant_expires_at"],
                message: "Grant expires before the confirmation",
            });
        }
        if (snapshot.code_execution !== null) {
            const effectiveLimits = deriveEffectiveCodeExecutionLimitsV1(
                snapshot.code_execution.profile.limits,
                snapshot.code_execution.compute_policy_limits,
                snapshot.code_execution.compute_grant_limits,
                snapshot.limits
            );
            if (
                effectiveLimits === null ||
                snapshot.code_execution.profile.adoption_status !== "enabled" ||
                snapshot.code_execution.profile.lifecycle !== "active" ||
                snapshot.code_execution.profile.adoption_evidence === null ||
                snapshot.code_execution.profile.adoption_evidence.valid_until < snapshot.expires_at ||
                snapshot.code_execution.compute_grant_expires_at < snapshot.expires_at ||
                !computeLimitsAreNarrowerOrEqualV1(
                    snapshot.code_execution.compute_policy_limits,
                    snapshot.code_execution.profile.limits
                ) ||
                !computeLimitsAreNarrowerOrEqualV1(
                    snapshot.code_execution.compute_grant_limits,
                    snapshot.code_execution.compute_policy_limits
                ) ||
                snapshot.code_execution.possible_code_input_data_classes.some(
                    dataClass =>
                        !snapshot.code_execution?.compute_policy_admitted_data_classes.includes(dataClass) ||
                        !snapshot.code_execution.compute_grant_admitted_data_classes.includes(dataClass) ||
                        !snapshot.code_execution.profile.admitted_data_classes.includes(dataClass)
                ) ||
                codeLimitKeys.some(key => snapshot.code_execution?.effective_limits[key] !== effectiveLimits?.[key])
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["code_execution"],
                    message: "Code execution authority is inactive, expired, or broader than its parent",
                });
            }
        }
        if ((snapshot.code_execution === null) !== (snapshot.limits.max_code_executions === 0)) {
            context.addIssue({
                code: "custom",
                path: ["limits", "max_code_executions"],
                message: "Code execution count must be zero without disclosed compute authority and one with it",
            });
        }
        const possibleClasses = new Set(snapshot.possible_data_classes);
        const destinations = new Set(snapshot.disclosure_destinations);
        const incidentalEffects = new Set(snapshot.incidental_effects);
        const sourceClasses = new Set([
            snapshot.prompt.data_class,
            snapshot.bot_configuration.job.data_class,
            snapshot.bot_configuration.standing_instructions.data_class,
            ...snapshot.skills.map(skill => skill.instruction_data_class),
            ...snapshot.tools.flatMap(tool => tool.possible_data_classes),
        ]);
        const toolIncidentalEffects = new Set(snapshot.tools.flatMap(tool => tool.incidental_effects));
        if (snapshot.code_execution !== null) {
            if (snapshot.code_execution.compute_grant_expires_at < snapshot.expires_at) {
                context.addIssue({
                    code: "custom",
                    path: ["code_execution", "compute_grant_expires_at"],
                    message: "Compute grant expires before the confirmation",
                });
            }
            if (snapshot.code_execution.profile.adoption_status !== "enabled") {
                context.addIssue({
                    code: "custom",
                    path: ["code_execution", "profile", "adoption_status"],
                    message: "A candidate Sandbox profile cannot authorize a user run",
                });
            }
            const admitted = new Set(snapshot.code_execution.profile.admitted_data_classes);
            if ([...sourceClasses].some(value => !admitted.has(value as "public" | "synthetic" | "organization"))) {
                context.addIssue({
                    code: "custom",
                    path: ["code_execution", "profile", "admitted_data_classes"],
                    message: "The Sandbox profile does not admit every disclosed input data class",
                });
            }
        }
        if (
            possibleClasses.size !== sourceClasses.size ||
            [...possibleClasses].some(value => !sourceClasses.has(value))
        ) {
            context.addIssue({
                code: "custom",
                path: ["possible_data_classes"],
                message: "Data classes must equal every model-visible content source",
            });
        }
        if (sourceClasses.has("unknown")) {
            context.addIssue({
                code: "custom",
                path: ["possible_data_classes"],
                message: "Unknown data classification denies model dispatch",
            });
        }
        if (
            incidentalEffects.size !== toolIncidentalEffects.size ||
            [...incidentalEffects].some(value => !toolIncidentalEffects.has(value))
        ) {
            context.addIssue({
                code: "custom",
                path: ["incidental_effects"],
                message: "Incidental effects must equal the effects disclosed by tools",
            });
        }
        const requiredDestinations = new Set(["metorial", "openrouter", "model_provider", "connector_provider"]);
        if (snapshot.code_execution !== null) requiredDestinations.add("cloudflare_sandbox");
        if (
            destinations.size !== requiredDestinations.size ||
            [...destinations].some(destination => !requiredDestinations.has(destination))
        ) {
            context.addIssue({
                code: "custom",
                path: ["disclosure_destinations"],
                message: "Disclosure destinations must equal the enabled execution destinations",
            });
        }
        for (const [index, tool] of snapshot.tools.entries()) {
            if (tool.possible_data_classes.some(value => !possibleClasses.has(value))) {
                context.addIssue({
                    code: "custom",
                    path: ["tools", index],
                    message: "Tool data class is missing from disclosure",
                });
            }
            if (tool.disclosure_destinations.some(value => !destinations.has(value))) {
                context.addIssue({
                    code: "custom",
                    path: ["tools", index],
                    message: "Tool destination is missing from disclosure",
                });
            }
            if (tool.incidental_effects.some(value => !incidentalEffects.has(value))) {
                context.addIssue({
                    code: "custom",
                    path: ["tools", index],
                    message: "Tool incidental effect is missing from disclosure",
                });
            }
        }
    });
export type DisclosureSnapshotV1 = z.infer<typeof DisclosureSnapshotV1Schema>;
export const StoredDisclosureSnapshotV1Schema = DisclosureSnapshotV1Schema;
export type StoredDisclosureSnapshotV1 = DisclosureSnapshotV1;

export const CreateRunConfirmationCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_id: BotIdSchema,
        bot_revision_id: BotRevisionIdSchema,
        capability_grant_id: CapabilityGrantIdSchema,
        expected_bot_revision_digest: Sha256DigestSchema,
        expected_capability_grant_revision: PositiveVersionSchema,
        expected_capability_grant_digest: Sha256DigestSchema,
        expected_authority_fence: NonnegativeFenceSchema,
        expected_compute_grant_digest: Sha256DigestSchema.nullable(),
        prompt: utf8String({ minBytes: 1, maxBytes: 16 * 1024 }),
    })
    .strict();
export type CreateRunConfirmationCommandV1 = z.infer<typeof CreateRunConfirmationCommandV1Schema>;
