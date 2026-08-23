import { describe, expect, it } from "vitest";

import * as publicContracts from "./public.js";
import {
    AdminProviderActivityViewV1Schema,
    BotIconRefV1Schema,
    BotPermissionGroupsViewV1Schema,
    BotPermissionSelectionV1Schema,
    BotV1Schema,
    ConnectionRequiredCardV1Schema,
    CreateBotCommandV1Schema,
    OrganizationRoleV1Schema,
    PermissionGroupViewV1Schema,
    PinnedBotPermissionV1Schema,
    UpdateBotProfileCommandV1Schema,
} from "./internal.js";

const ids = {
    account: "01890f3e-7b42-7cc1-98c3-4f760f7c9101",
    bot: "01890f3e-7b42-7cc1-98c3-4f760f7c9102",
    revision: "01890f3e-7b42-7cc1-98c3-4f760f7c9103",
    user: "01890f3e-7b42-7cc1-98c3-4f760f7c9104",
    readPolicy: "01890f3e-7b42-7cc1-98c3-4f760f7c9105",
    writePolicy: "01890f3e-7b42-7cc1-98c3-4f760f7c9106",
    destructivePolicy: "01890f3e-7b42-7cc1-98c3-4f760f7c9107",
    connector: "01890f3e-7b42-7cc1-98c3-4f760f7c9108",
    run: "01890f3e-7b42-7cc1-98c3-4f760f7c9109",
    activity: "01890f3e-7b42-7cc1-98c3-4f760f7c9110",
    computePolicy: "01890f3e-7b42-7cc1-98c3-4f760f7c9111",
} as const;
const digest = "a".repeat(64);

const createBotCommand = {
    schema_version: 1,
    name: "Jira helper",
    icon_key: null,
    palette_color_id: "blue",
    short_description: "Summarizes issues and proposes reviewed changes.",
    purpose: "Help the support team review Jira work without broad provider access.",
    standing_instructions: "Use only the exact permissions selected for this Bot.",
    organization_tool_policy_ids: [ids.readPolicy],
    skill_revision_ids: [],
    model_route_key: "reviewed-default",
    organization_compute_policy_id: null,
    expected_permission_catalog_digest: digest,
    expected_revision_selection_digest: digest,
    requested_limits: {
        max_model_turns: 5,
        max_tool_calls: 2,
        max_code_executions: 0,
        max_code_execution_ms: 15_000,
        max_model_output_tokens_per_request: 2_048,
        max_runtime_wall_time_ms: 240_000,
        max_estimated_run_cost_usd_micros: 250_000,
    },
} as const;

const icon = {
    kind: "reviewed_local_pack",
    pack_key: "openbot.creatures",
    pack_revision: 1,
    icon_key: "orbit.bot",
    asset_digest: digest,
    motion: "ambient",
} as const;

describe("Bot permission foundation", () => {
    it("exports safe commands and views without stored permission authority", () => {
        expect(publicContracts).toHaveProperty("CreateBotCommandV1Schema");
        expect(publicContracts).toHaveProperty("BotPermissionGroupsViewV1Schema");
        expect(publicContracts).toHaveProperty("ConnectionRequiredCardV1Schema");
        expect(publicContracts).toHaveProperty("AdminProviderActivityViewV1Schema");
        expect(publicContracts).not.toHaveProperty("BotIconRefV1Schema");
        expect(publicContracts).not.toHaveProperty("PinnedBotPermissionV1Schema");
        expect(publicContracts).not.toHaveProperty("BotPermissionSelectionV1Schema");
    });

    it("defines owner, admin, and user without accepting invented roles", () => {
        for (const role of ["owner", "admin", "user"]) {
            expect(OrganizationRoleV1Schema.safeParse(role).success).toBe(true);
        }
        expect(OrganizationRoleV1Schema.safeParse("member").success).toBe(false);
    });

    it("accepts only reviewed local-pack icon references", () => {
        expect(BotIconRefV1Schema.safeParse(icon).success).toBe(true);
        expect(BotIconRefV1Schema.safeParse({ ...icon, kind: "remote_url" }).success).toBe(false);
        expect(BotIconRefV1Schema.safeParse({ ...icon, icon_key: "https://example.com/bot.svg" }).success).toBe(false);
        expect(BotIconRefV1Schema.safeParse({ ...icon, svg: "<svg onload=alert(1)>" }).success).toBe(false);
    });

    it("keeps public Bot commands free of server-derived permission claims", () => {
        expect(CreateBotCommandV1Schema.safeParse(createBotCommand).success).toBe(true);
        for (const derivedClaim of [
            { effect: "read" },
            { execution_mode: "direct" },
            { policy_digest: digest },
            { permission_groups: [{ effect: "read", selection_state: "all" }] },
        ]) {
            expect(CreateBotCommandV1Schema.safeParse({ ...createBotCommand, ...derivedClaim }).success).toBe(false);
        }
        expect(
            CreateBotCommandV1Schema.safeParse({
                ...createBotCommand,
                organization_tool_policy_ids: [ids.readPolicy, ids.readPolicy],
            }).success
        ).toBe(false);
        expect(
            CreateBotCommandV1Schema.safeParse({ ...createBotCommand, short_description: "Hidden\u202e text" }).success
        ).toBe(false);
        expect(CreateBotCommandV1Schema.safeParse({ ...createBotCommand, icon_key: "orbit.bot" }).success).toBe(false);
        expect(
            CreateBotCommandV1Schema.safeParse({
                ...createBotCommand,
                organization_compute_policy_id: ids.computePolicy,
                requested_limits: { ...createBotCommand.requested_limits, max_code_executions: 0 },
            }).success
        ).toBe(false);
        expect(
            CreateBotCommandV1Schema.safeParse({
                ...createBotCommand,
                organization_compute_policy_id: ids.computePolicy,
                organization_tool_policy_ids: [
                    ids.readPolicy,
                    ids.writePolicy,
                    ids.destructivePolicy,
                    "01890f3e-7b42-7cc1-98c3-4f760f7c9112",
                ],
                requested_limits: { ...createBotCommand.requested_limits, max_code_executions: 1 },
            }).success
        ).toBe(false);
    });

    it("limits profile updates to cosmetic fields", () => {
        const update = {
            schema_version: 1,
            bot_id: ids.bot,
            expected_profile_version: 2,
            name: "Jira helper",
            short_description: "Summarizes Jira issues.",
            icon_key: null,
            palette_color_id: "teal",
        } as const;
        expect(UpdateBotProfileCommandV1Schema.safeParse(update).success).toBe(true);
        expect(UpdateBotProfileCommandV1Schema.safeParse({ ...update, purpose: "Delete old boards" }).success).toBe(
            false
        );
        expect(
            UpdateBotProfileCommandV1Schema.safeParse({
                ...update,
                organization_tool_policy_ids: [ids.destructivePolicy],
            }).success
        ).toBe(false);
    });

    it("binds a Bot and profile to the same account and Bot ID", () => {
        const bot = {
            schema_version: 1,
            bot_id: ids.bot,
            account_id: ids.account,
            owner_user_id: ids.user,
            lifecycle: "active",
            active_revision_id: ids.revision,
            profile: {
                schema_version: 1,
                bot_id: ids.bot,
                account_id: ids.account,
                name: "Jira helper",
                short_description: "Summarizes Jira issues.",
                icon,
                palette_color_id: "blue",
                profile_version: 1,
                updated_at: 1,
            },
            created_at: 1,
        } as const;
        expect(BotV1Schema.safeParse(bot).success).toBe(true);
        expect(BotV1Schema.safeParse({ ...bot, profile: { ...bot.profile, bot_id: ids.run } }).success).toBe(false);
    });

    it("makes write and destructive permissions proposal-only", () => {
        const base = {
            organization_tool_policy_id: ids.readPolicy,
            policy_revision: 1,
            policy_digest: digest,
            tool_key: "issues.get",
            display_name: "Read Jira issues",
            consequence_summary: "Reads issue fields allowed by the connection.",
        } as const;
        expect(
            PinnedBotPermissionV1Schema.safeParse({ ...base, effect: "read", execution_mode: "direct" }).success
        ).toBe(true);
        expect(
            PinnedBotPermissionV1Schema.safeParse({
                ...base,
                organization_tool_policy_id: ids.writePolicy,
                effect: "write",
                execution_mode: "proposal_requires_approval",
            }).success
        ).toBe(true);
        expect(
            PinnedBotPermissionV1Schema.safeParse({
                ...base,
                organization_tool_policy_id: ids.destructivePolicy,
                effect: "destructive",
                execution_mode: "proposal_requires_approval",
            }).success
        ).toBe(true);
        for (const effect of ["write", "destructive"] as const) {
            expect(PinnedBotPermissionV1Schema.safeParse({ ...base, effect, execution_mode: "direct" }).success).toBe(
                false
            );
        }
    });

    it("stores an exact unique permission selection", () => {
        const selected = {
            schema_version: 1,
            bot_revision_id: ids.revision,
            permissions: [
                {
                    organization_tool_policy_id: ids.readPolicy,
                    policy_revision: 1,
                    policy_digest: digest,
                    tool_key: "issues.get",
                    display_name: "Read Jira issues",
                    consequence_summary: "Reads issue fields allowed by the connection.",
                    effect: "read",
                    execution_mode: "direct",
                },
            ],
            selection_digest: digest,
        } as const;
        expect(BotPermissionSelectionV1Schema.safeParse(selected).success).toBe(true);
        expect(
            BotPermissionSelectionV1Schema.safeParse({
                ...selected,
                permissions: [selected.permissions[0], selected.permissions[0]],
            }).success
        ).toBe(false);
        expect(BotPermissionSelectionV1Schema.safeParse({ ...selected, permissions: [] }).success).toBe(false);
    });

    it("derives high-level group state from exact selected permissions", () => {
        const group = {
            effect: "write",
            availability: "available",
            selection_state: "some",
            permissions: [
                {
                    organization_tool_policy_id: ids.writePolicy,
                    policy_revision: 1,
                    technical_tool_key: "issues.comment.create",
                    display_name: "Comment on issue",
                    consequence_summary: "Adds a comment to one issue.",
                    resource_scope_summary: "One reviewed Jira project.",
                    incidental_effects: ["provider_access_log"],
                    outbound_fields: ["issue_key", "comment"],
                    destinations: ["metorial", "connector_provider"],
                    per_run_call_limit: 1,
                    grant_expires_at: 60_000,
                    effective_status: "available",
                    selected: true,
                    effect: "write",
                    execution_mode: "proposal_requires_approval",
                },
                {
                    organization_tool_policy_id: ids.readPolicy,
                    policy_revision: 1,
                    technical_tool_key: "issues.update",
                    display_name: "Edit issue",
                    consequence_summary: "Changes fields on one issue.",
                    resource_scope_summary: "One reviewed Jira project.",
                    incidental_effects: ["provider_access_log"],
                    outbound_fields: ["issue_key", "fields"],
                    destinations: ["metorial", "connector_provider"],
                    per_run_call_limit: 1,
                    grant_expires_at: null,
                    effective_status: "needs_grant",
                    selected: false,
                    effect: "write",
                    execution_mode: "proposal_requires_approval",
                },
            ],
        } as const;
        expect(PermissionGroupViewV1Schema.safeParse(group).success).toBe(true);
        expect(PermissionGroupViewV1Schema.safeParse({ ...group, selection_state: "all" }).success).toBe(false);
        expect(
            PermissionGroupViewV1Schema.safeParse({
                ...group,
                effect: "destructive",
            }).success
        ).toBe(false);
        expect(
            PermissionGroupViewV1Schema.safeParse({ ...group, availability: "unavailable_read_only_release" }).success
        ).toBe(false);
    });

    it("requires one independently derived group for every effect", () => {
        const emptyGroup = (effect: "read" | "write" | "destructive") => ({
            effect,
            availability: effect === "read" ? ("available" as const) : ("unavailable_read_only_release" as const),
            selection_state: "none" as const,
            permissions: [],
        });
        const groups = {
            max_selected_permissions: 4,
            selected_permission_count: 0,
            code_execution_consumes_tool_slot: false,
            read: emptyGroup("read"),
            write: emptyGroup("write"),
            destructive: emptyGroup("destructive"),
        };
        expect(BotPermissionGroupsViewV1Schema.safeParse(groups).success).toBe(true);
        expect(BotPermissionGroupsViewV1Schema.safeParse({ ...groups, destructive: emptyGroup("write") }).success).toBe(
            false
        );
        expect(BotPermissionGroupsViewV1Schema.safeParse({ ...groups, selected_permission_count: 1 }).success).toBe(
            false
        );
        expect(
            BotPermissionGroupsViewV1Schema.safeParse({
                ...groups,
                code_execution_consumes_tool_slot: true,
                max_selected_permissions: 4,
            }).success
        ).toBe(false);

        const selectedRead = {
            organization_tool_policy_id: ids.readPolicy,
            policy_revision: 1,
            technical_tool_key: "issues.get",
            display_name: "Read issue",
            consequence_summary: "Reads one issue.",
            resource_scope_summary: "One reviewed Jira project.",
            incidental_effects: [],
            outbound_fields: ["issue_key"],
            destinations: ["metorial", "connector_provider"],
            per_run_call_limit: 1,
            grant_expires_at: null,
            effective_status: "available",
            selected: true,
            effect: "read",
            execution_mode: "direct",
        } as const;
        const oneSelected = {
            ...groups,
            selected_permission_count: 1,
            read: {
                effect: "read",
                availability: "available",
                selection_state: "all",
                permissions: [selectedRead],
            },
        } as const;
        expect(BotPermissionGroupsViewV1Schema.safeParse(oneSelected).success).toBe(true);
        expect(
            BotPermissionGroupsViewV1Schema.safeParse({
                ...oneSelected,
                write: {
                    effect: "write",
                    availability: "available",
                    selection_state: "all",
                    permissions: [
                        {
                            ...selectedRead,
                            organization_tool_policy_id: ids.writePolicy,
                            effect: "write",
                            execution_mode: "proposal_requires_approval",
                        },
                    ],
                },
                selected_permission_count: 2,
            }).success
        ).toBe(false);
    });

    it("keeps the connection card server-directed and free of provider URLs", () => {
        const card = {
            schema_version: 1,
            kind: "connection_required",
            bot_id: ids.bot,
            bot_revision_id: ids.revision,
            connector_release_id: ids.connector,
            connector_display_name: "Jira",
            reason: "authorization_missing",
            required_permissions: [
                {
                    organization_tool_policy_id: ids.readPolicy,
                    display_name: "Read Jira issues",
                    effect: "read",
                    execution_mode: "direct",
                },
            ],
            available_action: { kind: "start_bot_connection_setup", method: "POST" },
        } as const;
        expect(ConnectionRequiredCardV1Schema.safeParse(card).success).toBe(true);
        expect(ConnectionRequiredCardV1Schema.safeParse({ ...card, reason: "authorization_revoked" }).success).toBe(
            true
        );
        expect(
            ConnectionRequiredCardV1Schema.safeParse({
                ...card,
                provider_url: "https://metorial.example/secret",
            }).success
        ).toBe(false);
        expect(
            ConnectionRequiredCardV1Schema.safeParse({
                ...card,
                available_action: { ...card.available_action, path: "https://example.com/oauth" },
            }).success
        ).toBe(false);
        expect(
            ConnectionRequiredCardV1Schema.safeParse({
                ...card,
                required_permissions: Array.from({ length: 5 }, (_, index) => ({
                    ...card.required_permissions[0],
                    organization_tool_policy_id: `01890f3e-7b42-7cc1-98c3-4f760f7c92${String(index).padStart(2, "0")}`,
                })),
            }).success
        ).toBe(false);
    });

    it("allows detailed provider-log navigation only in an owner or admin view", () => {
        const view = {
            schema_version: 1,
            provider_activity_id: ids.activity,
            account_id: ids.account,
            bot_id: ids.bot,
            run_id: ids.run,
            viewer_role: "admin",
            connector_display_name: "Jira",
            tool_display_name: "Read Jira issues",
            effect: "read",
            outcome: "completed",
            occurred_at: 1,
            detailed_logs_link: {
                kind: "open_metorial_dashboard_root",
                href: "https://app.metorial.com/logs",
                display_hostname: "app.metorial.com",
            },
        } as const;
        expect(AdminProviderActivityViewV1Schema.safeParse(view).success).toBe(true);
        expect(AdminProviderActivityViewV1Schema.safeParse({ ...view, viewer_role: "user" }).success).toBe(false);
        expect(
            AdminProviderActivityViewV1Schema.safeParse({
                ...view,
                detailed_logs_link: {
                    ...view.detailed_logs_link,
                    display_hostname: "attacker.example",
                },
            }).success
        ).toBe(false);
        expect(
            AdminProviderActivityViewV1Schema.safeParse({
                ...view,
                detailed_logs_link: {
                    ...view.detailed_logs_link,
                    href: "https://attacker.example/logs",
                    display_hostname: "attacker.example",
                },
            }).success
        ).toBe(false);
        expect(
            AdminProviderActivityViewV1Schema.safeParse({
                ...view,
                detailed_logs_link: {
                    ...view.detailed_logs_link,
                    href: "https://app.metorial.com/logs?session=secret",
                },
            }).success
        ).toBe(false);
        expect(AdminProviderActivityViewV1Schema.safeParse({ ...view, metorial_bearer: "secret" }).success).toBe(false);
    });
});
