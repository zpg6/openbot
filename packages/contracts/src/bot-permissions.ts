import { z } from "zod";

import {
    AccountIdSchema,
    BotIdSchema,
    BotRevisionIdSchema,
    ConnectorReleaseIdSchema,
    OrganizationComputePolicyIdSchema,
    OrganizationToolPolicyIdSchema,
    RunIdSchema,
    SkillRevisionIdSchema,
    UserIdSchema,
} from "./ids.js";
import { RequestedRunLimitsV1Schema } from "./limits.js";
import {
    DisclosureDestinationV1Schema,
    EpochMillisecondsSchema,
    PositiveVersionSchema,
    SafeDisplayLabelSchema,
    Sha256DigestSchema,
    utf8String,
} from "./primitives.js";

const localAssetKey = utf8String({
    minBytes: 1,
    maxBytes: 96,
    pattern: /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
});
const botName = SafeDisplayLabelSchema.refine(
    value => new TextEncoder().encode(value).byteLength <= 128,
    "Bot name exceeds 128 UTF-8 bytes"
);
const unsafeDisplayCharacters = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const botShortDescription = utf8String({ minBytes: 1, maxBytes: 512 })
    .refine(value => value === value.trim(), "Bot short description cannot have outer whitespace")
    .refine(value => !unsafeDisplayCharacters.test(value), "Bot short description contains unsafe characters");
const paletteColor = z.enum(["slate", "blue", "teal", "green", "amber", "orange", "rose", "violet"]);
const userContent = (maximum: number) => utf8String({ minBytes: 1, maxBytes: maximum });

export const OrganizationRoleV1Schema = z.enum(["owner", "admin", "user"]);
export type OrganizationRoleV1 = z.infer<typeof OrganizationRoleV1Schema>;

export const BotIconRefV1Schema = z
    .object({
        kind: z.literal("reviewed_local_pack"),
        pack_key: localAssetKey,
        pack_revision: PositiveVersionSchema,
        icon_key: localAssetKey,
        asset_digest: Sha256DigestSchema,
        motion: z.enum(["none", "ambient"]),
    })
    .strict();
export type BotIconRefV1 = z.infer<typeof BotIconRefV1Schema>;

export const BotProfileV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_id: BotIdSchema,
        account_id: AccountIdSchema,
        name: botName,
        short_description: botShortDescription,
        icon: BotIconRefV1Schema.nullable(),
        palette_color_id: paletteColor,
        profile_version: PositiveVersionSchema,
        updated_at: EpochMillisecondsSchema,
    })
    .strict();
export type BotProfileV1 = z.infer<typeof BotProfileV1Schema>;

export const BotV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_id: BotIdSchema,
        account_id: AccountIdSchema,
        owner_user_id: UserIdSchema,
        lifecycle: z.enum(["active", "disabled"]),
        active_revision_id: BotRevisionIdSchema,
        profile: BotProfileV1Schema,
        created_at: EpochMillisecondsSchema,
    })
    .strict()
    .superRefine((bot, context) => {
        if (bot.profile.bot_id !== bot.bot_id || bot.profile.account_id !== bot.account_id) {
            context.addIssue({
                code: "custom",
                path: ["profile"],
                message: "Bot profile must belong to the same Bot and account",
            });
        }
    });
export type BotV1 = z.infer<typeof BotV1Schema>;

const exactPolicyIds = z
    .array(OrganizationToolPolicyIdSchema)
    .min(1)
    .max(4)
    .refine(values => new Set(values).size === values.length, { message: "Permission policy IDs must be unique" });

export const CreateBotCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        name: botName,
        icon_key: z.null(),
        palette_color_id: paletteColor,
        short_description: botShortDescription,
        purpose: userContent(512),
        standing_instructions: userContent(32 * 1024),
        organization_tool_policy_ids: exactPolicyIds,
        skill_revision_ids: z
            .array(SkillRevisionIdSchema)
            .max(4)
            .refine(values => new Set(values).size === values.length, { message: "Skill revision IDs must be unique" }),
        model_route_key: utf8String({ minBytes: 1, maxBytes: 128 }),
        organization_compute_policy_id: OrganizationComputePolicyIdSchema.nullable(),
        expected_permission_catalog_digest: Sha256DigestSchema,
        expected_revision_selection_digest: Sha256DigestSchema,
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
export type CreateBotCommandV1 = z.infer<typeof CreateBotCommandV1Schema>;

export const UpdateBotProfileCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_id: BotIdSchema,
        expected_profile_version: PositiveVersionSchema,
        name: botName,
        short_description: botShortDescription,
        icon_key: z.null(),
        palette_color_id: paletteColor,
    })
    .strict();
export type UpdateBotProfileCommandV1 = z.infer<typeof UpdateBotProfileCommandV1Schema>;

export const ToolEffectV1Schema = z.enum(["read", "write", "destructive"]);
export type ToolEffectV1 = z.infer<typeof ToolEffectV1Schema>;

export const ToolExecutionModeV1Schema = z.enum(["direct", "proposal_requires_approval"]);
export type ToolExecutionModeV1 = z.infer<typeof ToolExecutionModeV1Schema>;

const pinnedPermissionFields = {
    organization_tool_policy_id: OrganizationToolPolicyIdSchema,
    policy_revision: PositiveVersionSchema,
    policy_digest: Sha256DigestSchema,
    tool_key: utf8String({ minBytes: 1, maxBytes: 256 }),
    display_name: SafeDisplayLabelSchema,
    consequence_summary: SafeDisplayLabelSchema,
} as const;

export const PinnedBotPermissionV1Schema = z.discriminatedUnion("effect", [
    z
        .object({
            ...pinnedPermissionFields,
            effect: z.literal("read"),
            execution_mode: z.literal("direct"),
        })
        .strict(),
    z
        .object({
            ...pinnedPermissionFields,
            effect: z.literal("write"),
            execution_mode: z.literal("proposal_requires_approval"),
        })
        .strict(),
    z
        .object({
            ...pinnedPermissionFields,
            effect: z.literal("destructive"),
            execution_mode: z.literal("proposal_requires_approval"),
        })
        .strict(),
]);
export type PinnedBotPermissionV1 = z.infer<typeof PinnedBotPermissionV1Schema>;

export const BotPermissionSelectionV1Schema = z
    .object({
        schema_version: z.literal(1),
        bot_revision_id: BotRevisionIdSchema,
        permissions: z
            .array(PinnedBotPermissionV1Schema)
            .min(1)
            .max(4)
            .refine(values => new Set(values.map(value => value.organization_tool_policy_id)).size === values.length, {
                message: "Pinned permission policy IDs must be unique",
            }),
        selection_digest: Sha256DigestSchema,
    })
    .strict();
export type BotPermissionSelectionV1 = z.infer<typeof BotPermissionSelectionV1Schema>;

const permissionItemViewFields = {
    organization_tool_policy_id: OrganizationToolPolicyIdSchema,
    policy_revision: PositiveVersionSchema,
    technical_tool_key: utf8String({ minBytes: 1, maxBytes: 256 }),
    display_name: SafeDisplayLabelSchema,
    consequence_summary: SafeDisplayLabelSchema,
    resource_scope_summary: SafeDisplayLabelSchema,
    incidental_effects: z
        .array(z.enum(["provider_access_log", "provider_access_timestamp", "provider_quota"]))
        .max(3)
        .refine(values => new Set(values).size === values.length, { message: "Incidental effects must be unique" }),
    outbound_fields: z
        .array(utf8String({ minBytes: 1, maxBytes: 128 }))
        .max(32)
        .refine(values => new Set(values).size === values.length, { message: "Outbound fields must be unique" }),
    destinations: z
        .array(DisclosureDestinationV1Schema)
        .max(4)
        .refine(values => new Set(values).size === values.length, { message: "Destinations must be unique" }),
    per_run_call_limit: z.number().int().positive().max(2),
    grant_expires_at: EpochMillisecondsSchema.nullable(),
    effective_status: z.enum([
        "needs_connection",
        "needs_grant",
        "available",
        "expired",
        "revoked",
        "connector_changed",
        "blocked_by_organization_policy",
    ]),
    selected: z.boolean(),
} as const;

export const PermissionItemViewV1Schema = z.discriminatedUnion("effect", [
    z
        .object({
            ...permissionItemViewFields,
            effect: z.literal("read"),
            execution_mode: z.literal("direct"),
        })
        .strict(),
    z
        .object({
            ...permissionItemViewFields,
            effect: z.literal("write"),
            execution_mode: z.literal("proposal_requires_approval"),
        })
        .strict(),
    z
        .object({
            ...permissionItemViewFields,
            effect: z.literal("destructive"),
            execution_mode: z.literal("proposal_requires_approval"),
        })
        .strict(),
]);
export type PermissionItemViewV1 = z.infer<typeof PermissionItemViewV1Schema>;

export const PermissionGroupViewV1Schema = z
    .object({
        effect: ToolEffectV1Schema,
        availability: z.enum(["available", "unavailable_read_only_release"]),
        selection_state: z.enum(["none", "some", "all"]),
        permissions: z.array(PermissionItemViewV1Schema).max(64),
    })
    .strict()
    .superRefine((group, context) => {
        if (group.permissions.some(permission => permission.effect !== group.effect)) {
            context.addIssue({ code: "custom", path: ["permissions"], message: "Permission effect must match group" });
        }
        if (
            new Set(group.permissions.map(permission => permission.organization_tool_policy_id)).size !==
            group.permissions.length
        ) {
            context.addIssue({ code: "custom", path: ["permissions"], message: "Permission IDs must be unique" });
        }
        const selected = group.permissions.filter(permission => permission.selected).length;
        const expectedState = selected === 0 ? "none" : selected === group.permissions.length ? "all" : "some";
        if (group.selection_state !== expectedState) {
            context.addIssue({
                code: "custom",
                path: ["selection_state"],
                message: "Permission group state must be derived from its exact selected permissions",
            });
        }
        if (group.availability !== "available" && selected !== 0) {
            context.addIssue({
                code: "custom",
                path: ["permissions"],
                message: "An unavailable permission group cannot contain selected permissions",
            });
        }
    });
export type PermissionGroupViewV1 = z.infer<typeof PermissionGroupViewV1Schema>;

export const BotPermissionGroupsViewV1Schema = z
    .object({
        max_selected_permissions: z.number().int().positive().max(4),
        selected_permission_count: z.number().int().nonnegative().max(4),
        code_execution_consumes_tool_slot: z.boolean(),
        read: PermissionGroupViewV1Schema,
        write: PermissionGroupViewV1Schema,
        destructive: PermissionGroupViewV1Schema,
    })
    .strict()
    .superRefine((groups, context) => {
        for (const effect of ToolEffectV1Schema.options) {
            if (groups[effect].effect !== effect) {
                context.addIssue({
                    code: "custom",
                    path: [effect, "effect"],
                    message: "Permission group must appear under its matching effect key",
                });
            }
        }
        if (
            groups.read.availability !== "available" ||
            groups.write.availability !== "unavailable_read_only_release" ||
            groups.destructive.availability !== "unavailable_read_only_release"
        ) {
            context.addIssue({
                code: "custom",
                path: [],
                message: "Version 1 exposes only read permissions as selectable",
            });
        }
        const permissions = ToolEffectV1Schema.options.flatMap(effect => groups[effect].permissions);
        const policyIds = permissions.map(permission => permission.organization_tool_policy_id);
        if (new Set(policyIds).size !== policyIds.length) {
            context.addIssue({
                code: "custom",
                path: [],
                message: "Permission IDs must be unique across effect groups",
            });
        }
        const selectedCount = permissions.filter(permission => permission.selected).length;
        if (
            groups.max_selected_permissions !== (groups.code_execution_consumes_tool_slot ? 3 : 4) ||
            groups.selected_permission_count !== selectedCount ||
            selectedCount > groups.max_selected_permissions
        ) {
            context.addIssue({
                code: "custom",
                path: ["selected_permission_count"],
                message: "Selected permission count must fit the current model-tool slots",
            });
        }
    });
export type BotPermissionGroupsViewV1 = z.infer<typeof BotPermissionGroupsViewV1Schema>;

const requiredPermissionSummary = z.discriminatedUnion("effect", [
    z
        .object({
            organization_tool_policy_id: OrganizationToolPolicyIdSchema,
            display_name: SafeDisplayLabelSchema,
            effect: z.literal("read"),
            execution_mode: z.literal("direct"),
        })
        .strict(),
    z
        .object({
            organization_tool_policy_id: OrganizationToolPolicyIdSchema,
            display_name: SafeDisplayLabelSchema,
            effect: z.literal("write"),
            execution_mode: z.literal("proposal_requires_approval"),
        })
        .strict(),
    z
        .object({
            organization_tool_policy_id: OrganizationToolPolicyIdSchema,
            display_name: SafeDisplayLabelSchema,
            effect: z.literal("destructive"),
            execution_mode: z.literal("proposal_requires_approval"),
        })
        .strict(),
]);

export const ConnectionRequiredCardV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("connection_required"),
        bot_id: BotIdSchema,
        bot_revision_id: BotRevisionIdSchema,
        connector_release_id: ConnectorReleaseIdSchema,
        connector_display_name: SafeDisplayLabelSchema,
        reason: z.enum([
            "authorization_missing",
            "authorization_expired",
            "authorization_revoked",
            "authorization_unusable",
        ]),
        required_permissions: z
            .array(requiredPermissionSummary)
            .min(1)
            .max(4)
            .refine(values => new Set(values.map(value => value.organization_tool_policy_id)).size === values.length, {
                message: "Required permission IDs must be unique",
            }),
        available_action: z
            .object({
                kind: z.literal("start_bot_connection_setup"),
                method: z.literal("POST"),
            })
            .strict(),
    })
    .strict();
export type ConnectionRequiredCardV1 = z.infer<typeof ConnectionRequiredCardV1Schema>;

const providerActivityId = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    .brand<"ProviderActivityId">();
const metorialDashboardRoot = z.string().superRefine((value, context) => {
    try {
        const parsed = new URL(value);
        if (
            parsed.protocol !== "https:" ||
            parsed.hostname !== "app.metorial.com" ||
            parsed.username !== "" ||
            parsed.password !== "" ||
            parsed.port !== "" ||
            parsed.search !== "" ||
            parsed.hash !== ""
        ) {
            context.addIssue({ code: "custom", message: "Metorial dashboard root must be a clean HTTPS URL" });
        }
    } catch {
        context.addIssue({ code: "custom", message: "Metorial dashboard root must be a valid URL" });
    }
});

export const AdminProviderActivityViewV1Schema = z
    .object({
        schema_version: z.literal(1),
        provider_activity_id: providerActivityId,
        account_id: AccountIdSchema,
        bot_id: BotIdSchema,
        run_id: RunIdSchema,
        viewer_role: z.enum(["owner", "admin"]),
        connector_display_name: SafeDisplayLabelSchema,
        tool_display_name: SafeDisplayLabelSchema,
        effect: ToolEffectV1Schema,
        outcome: z.enum(["completed", "denied", "outcome_unknown"]),
        occurred_at: EpochMillisecondsSchema,
        detailed_logs_link: z
            .object({
                kind: z.literal("open_metorial_dashboard_root"),
                href: metorialDashboardRoot,
                display_hostname: SafeDisplayLabelSchema,
            })
            .strict(),
    })
    .strict()
    .superRefine((view, context) => {
        try {
            const parsed = new URL(view.detailed_logs_link.href);
            if (view.detailed_logs_link.display_hostname !== parsed.hostname) {
                context.addIssue({
                    code: "custom",
                    path: ["detailed_logs_link", "display_hostname"],
                    message: "Displayed Metorial hostname must match the dashboard root",
                });
            }
        } catch {
            context.addIssue({
                code: "custom",
                path: ["detailed_logs_link", "href"],
                message: "Metorial dashboard root could not be inspected",
            });
        }
    });
export type AdminProviderActivityViewV1 = z.infer<typeof AdminProviderActivityViewV1Schema>;
