import { z } from "zod";
import {
    AccountIdSchema,
    BotIdSchema,
    BotRevisionIdSchema,
    CapabilityGrantIdSchema,
    ConfigurationContentIdSchema,
    ConfirmationIdSchema,
    ConnectorReleaseIdSchema,
    OrganizationToolPolicyIdSchema,
    ProviderDeploymentIdSchema,
    RunIdSchema,
    SkillIdSchema,
    SkillRevisionIdSchema,
    UserIdSchema,
} from "./ids.js";
import { JsonSchemaSubsetV1Schema } from "./json-schema.js";
import { RuntimeLimitsV1Schema } from "./limits.js";
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
        connector_tool_key: utf8String({ minBytes: 1, maxBytes: 256 }),
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
        parallel_tool_calls: z.literal(false),
    })
    .strict();
export type ModelRouteV1 = z.infer<typeof ModelRouteV1Schema>;

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
        limits: RuntimeLimitsV1Schema,
        outbound_data_rule: OutboundDataRuleV1Schema,
        manifest_extensions: UnverifiedManifestExtensionEnvelopeV1Schema,
        created_at: EpochMillisecondsSchema,
        revision_digest: Sha256DigestSchema,
    })
    .strict();
export type BotRevisionV1 = z.infer<typeof BotRevisionV1Schema>;
export const StoredBotRevisionV1Schema = BotRevisionV1Schema;
export type StoredBotRevisionV1 = BotRevisionV1;

export const RequestedRunLimitsV1Schema = z
    .object({
        max_model_turns: z.number().int().positive().max(3),
        max_tool_calls: z.number().int().positive().max(2),
        max_model_output_tokens_per_request: z.number().int().positive().max(2_048),
        max_runtime_wall_time_ms: z.number().int().positive().max(120_000),
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
        requested_limits: RequestedRunLimitsV1Schema,
    })
    .strict();
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
        disclosure_destinations: nonemptyUnique(DisclosureDestinationV1Schema, 4),
        incidental_effects: z
            .array(z.enum(["provider_access_log", "provider_access_timestamp", "provider_quota"]))
            .max(3)
            .refine(values => new Set(values).size === values.length, {
                message: "Incidental effects must be unique",
            }),
        model_route: ModelRouteV1Schema,
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
        for (const destination of DisclosureDestinationV1Schema.options) {
            if (!destinations.has(destination)) {
                context.addIssue({
                    code: "custom",
                    path: ["disclosure_destinations"],
                    message: "Initial disclosure must name every external destination",
                });
                break;
            }
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
        prompt: utf8String({ minBytes: 1, maxBytes: 16 * 1024 }),
    })
    .strict();
export type CreateRunConfirmationCommandV1 = z.infer<typeof CreateRunConfirmationCommandV1Schema>;
