import { describe, expect, it, vi } from "vitest";

import { createControlPlane } from "../src/app.ts";
import type {
    ControlPlaneActorV1,
    ProductProofBotV1,
    ProductProofConfirmationV1,
    ProductProofMetorialIntegrationV1,
    ProductProofRepositoryV1,
    ProductProofRoutineProposalV1,
    ProductProofRunV1,
} from "../src/product-proof.ts";

const actor: ControlPlaneActorV1 = {
    account_id: "account_test",
    organization_name: "Test Organization",
    user_id: "user_test",
    display_name: "Test Owner",
    csrf_token: "csrf_test",
    role: "owner",
};

const policyMetadata = {
    policy_revision: "revision_v1",
    policy_sha256: "a".repeat(64),
    input_schema_sha256: "b".repeat(64),
    output_schema_sha256: "c".repeat(64),
} as const;

const integrations: readonly ProductProofMetorialIntegrationV1[] = [
    {
        integration_id: "integration_test_linear",
        provider_identifier: "linear",
        provider_deployment_id: "pdp_test_linear",
        provider_version_id: "pver_test_linear",
        provider_specification_id: "pspec_test_linear",
        auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
        connected_account_label: "Linear · OpenBot test workspace",
        display_name: "Linear",
        description: "Issues and projects.",
        connection_state: "connected",
        permissions: [
            {
                integration_id: "integration_test_linear",
                policy_id: "policy_linear_read_v1",
                display_name: "List issues",
                tool_key: "list_issues",
                effect: "read",
                consequence_summary: "Issue data may be returned.",
                resource_scope_summary: "Connected workspace.",
                enabled: true,
                ...policyMetadata,
            },
            {
                integration_id: "integration_test_linear",
                policy_id: "policy_linear_write_v1",
                display_name: "Create issue",
                tool_key: "create_issue",
                effect: "write",
                consequence_summary: "Creates an issue.",
                resource_scope_summary: "Connected workspace.",
                enabled: false,
                ...policyMetadata,
            },
        ],
    },
    {
        integration_id: "integration_test_slack",
        provider_identifier: "slack",
        provider_deployment_id: "pdp_test_slack",
        provider_version_id: "pver_test_slack",
        provider_specification_id: "pspec_test_slack",
        auth: { mode: "user_grant", connection_grant_id: "grant_test_slack_primary" },
        connected_account_label: "Slack · OpenBot test workspace",
        display_name: "Slack",
        description: "Channels and messages.",
        connection_state: "connected",
        permissions: [
            {
                integration_id: "integration_test_slack",
                policy_id: "policy_slack_read_v1",
                display_name: "List channels",
                tool_key: "list_channels",
                effect: "read",
                consequence_summary: "Channel data may be returned.",
                resource_scope_summary: "Connected workspace.",
                enabled: true,
                ...policyMetadata,
            },
        ],
    },
];

const bot: ProductProofBotV1 = {
    bot_id: "bot_test_1",
    account_id: actor.account_id,
    owner_user_id: actor.user_id,
    name: "Support reader",
    short_description: "Reads support cases.",
    palette_color_id: "sky",
    avatar_shape_id: "hexagon",
    avatar_face_id: "cheerful",
    purpose: "Review cases.",
    standing_instructions: "Do not guess.",
    integrations: [
        {
            integration_id: "integration_test_linear",
            provider_deployment_id: "pdp_test_linear",
            provider_version_id: "pver_test_linear",
            provider_specification_id: "pspec_test_linear",
            auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
            permission_pins: [
                {
                    policy_id: "policy_linear_read_v1",
                    policy_revision: "revision_v1",
                    policy_sha256: "a".repeat(64),
                    tool_key: "list_issues",
                    effect: "read",
                    input_schema_sha256: "b".repeat(64),
                    output_schema_sha256: "c".repeat(64),
                },
            ],
        },
    ],
    created_at_ms: 1_788_000_000_000,
};

const routineRepositoryStubs = {
    listRoutines: async () => [],
    getRoutine: async () => null,
    createRoutineProposal: async () => {
        throw new Error("unexpected routine proposal");
    },
    getRoutineProposal: async () => null,
    saveRoutineProposal: async () => null,
    updateRoutine: async () => null,
} satisfies Pick<
    ProductProofRepositoryV1,
    | "listRoutines"
    | "getRoutine"
    | "createRoutineProposal"
    | "getRoutineProposal"
    | "saveRoutineProposal"
    | "updateRoutine"
>;

const repository = (createBot: ProductProofRepositoryV1["createBot"]): ProductProofRepositoryV1 => ({
    listBots: async () => [],
    createBot,
    getBot: async () => null,
    createConfirmation: async () => {
        throw new Error("unexpected confirmation");
    },
    getConfirmation: async () => null,
    claimConfirmation: async () => null,
    completeRun: async () => null,
    getRun: async () => null,
    ...routineRepositoryStubs,
});

const form = (
    permission: string,
    csrf = actor.csrf_token,
    integrationId = bot.integrations[0]?.integration_id ?? "integration_test_linear"
): URLSearchParams =>
    new URLSearchParams({
        _csrf: csrf,
        name: bot.name,
        short_description: bot.short_description,
        palette_color_id: bot.palette_color_id,
        avatar_shape_id: bot.avatar_shape_id,
        avatar_face_id: bot.avatar_face_id,
        purpose: bot.purpose,
        standing_instructions: bot.standing_instructions,
        integration: integrationId,
        [`permission.${integrationId}`]: permission,
    });

const mutationHeaders = { Origin: "https://openbot.invalid" } as const;
const metorialContract = {
    plugin_id: "metorial",
    api_version: "2026-07-24",
    session_serialization_identity: "openbot-test-serializer@1",
} as const;

describe("control-plane product proof", () => {
    it("starts a Metorial connection only for an organization owner with CSRF", async () => {
        const beginIntegrationConnection = vi.fn(async () => "https://connect.metorial.com/setup/test");
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: {
                ...metorialContract,
                listIntegrations: async () => [],
                listCatalogApps: async () => [
                    {
                        identifier: "linear",
                        display_name: "Linear",
                        description: "Issues and projects.",
                        categories: ["task-and-project-management"],
                        icon_url: null,
                        featured_rank: 0,
                        icon_data_uri: null,
                        provider_id: "pro_linear",
                        provider_version_id: "prv_linear",
                    },
                ],
                beginIntegrationConnection,
            },
            repository: repository(async () => bot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/integration-connections", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({ _csrf: actor.csrf_token, provider_identifier: "linear" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: "https://connect.metorial.com/setup/test" });
        expect(beginIntegrationConnection).toHaveBeenCalledWith({
            account_id: actor.account_id,
            user_id: actor.user_id,
            app: expect.objectContaining({ identifier: "linear", provider_version_id: "prv_linear" }),
        });
    });

    it("does not start an organization connection for a member", async () => {
        const beginIntegrationConnection = vi.fn(async () => "https://connect.metorial.com/setup/test");
        const app = createControlPlane({
            resolveActor: async () => ({ ...actor, role: "member" }),
            connector: {
                ...metorialContract,
                listIntegrations: async () => [],
                listCatalogApps: async () => [],
                beginIntegrationConnection,
            },
            repository: repository(async () => bot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/integration-connections", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({ _csrf: actor.csrf_token, provider_identifier: "linear" }),
        });

        expect(response.status).toBe(403);
        expect(beginIntegrationConnection).not.toHaveBeenCalled();
    });

    it("binds the Metorial callback to the current organization and user", async () => {
        const completeIntegrationConnection = vi.fn(async () => true);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: {
                ...metorialContract,
                listIntegrations: async () => [],
                completeIntegrationConnection,
            },
            repository: repository(async () => bot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/integrations/metorial/callback?flow=flow_test_01");

        expect(response.status).toBe(303);
        expect(completeIntegrationConnection).toHaveBeenCalledWith({
            account_id: actor.account_id,
            user_id: actor.user_id,
            flow_id: "flow_test_01",
        });
    });

    it("turns a chat message into a routine draft with the exact current authority snapshot", async () => {
        const proposal: ProductProofRoutineProposalV1 = {
            proposal_id: "routine_proposal_test_1",
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            name: "Weekday support brief",
            prompt: "Summarize urgent cases.",
            schedule: "Every weekday at 9:00 AM Pacific",
            metorial_session_intent: {
                intent_version: "openbot_metorial_session_intent_v1",
                connector_plugin_id: metorialContract.plugin_id,
                metorial_api_version: metorialContract.api_version,
                serialization_identity: metorialContract.session_serialization_identity,
                providers: [
                    {
                        provider_deployment_id: "pdp_test_linear",
                        provider_version_id: "pver_test_linear",
                        provider_specification_id: "pspec_test_linear",
                        auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
                        allowed_tool_keys: ["list_issues"],
                    },
                ],
            },
            metorial_authority_snapshot: bot.integrations,
            permissions_snapshot: integrations[0]?.permissions.slice(0, 1) ?? [],
            created_at_ms: 1_788_000_000_000,
            expires_at_ms: 1_788_000_300_000,
            state: "pending",
        };
        const createRoutineProposal = vi.fn(async () => proposal);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations.slice(0, 1) },
            repository: {
                ...repository(async () => bot),
                getBot: async () => bot,
                createRoutineProposal,
            },
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
            now: () => 1_788_000_000_000,
        });
        const response = await app.request("https://openbot.invalid/actions/routine-proposals", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({
                _csrf: actor.csrf_token,
                bot_id: bot.bot_id,
                routine_name: proposal.name,
                prompt: proposal.prompt,
                schedule: proposal.schedule,
            }),
        });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/routine-proposals/routine_proposal_test_1");
        expect(createRoutineProposal).toHaveBeenCalledWith(
            expect.objectContaining({
                account_id: actor.account_id,
                bot_id: bot.bot_id,
                metorial_authority_snapshot: bot.integrations,
                permissions_snapshot: [integrations[0]?.permissions[0]],
            })
        );
    });

    it("does not save a routine draft after the organization ceiling changes", async () => {
        const proposal: ProductProofRoutineProposalV1 = {
            proposal_id: "routine_proposal_test_drift",
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            name: "Weekday support brief",
            prompt: "Summarize urgent cases.",
            schedule: "Every weekday at 9:00 AM Pacific",
            metorial_session_intent: {
                intent_version: "openbot_metorial_session_intent_v1",
                connector_plugin_id: metorialContract.plugin_id,
                metorial_api_version: metorialContract.api_version,
                serialization_identity: metorialContract.session_serialization_identity,
                providers: [
                    {
                        provider_deployment_id: "pdp_test_linear",
                        provider_version_id: "pver_test_linear",
                        provider_specification_id: "pspec_test_linear",
                        auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
                        allowed_tool_keys: ["list_issues"],
                    },
                ],
            },
            metorial_authority_snapshot: bot.integrations,
            permissions_snapshot: integrations[0]?.permissions.slice(0, 1) ?? [],
            created_at_ms: 1_788_000_000_000,
            expires_at_ms: 1_788_000_300_000,
            state: "pending",
        };
        const changedCatalog = [
            {
                ...integrations[0]!,
                permissions: integrations[0]!.permissions.map(permission => ({ ...permission, enabled: false })),
            },
        ];
        const saveRoutineProposal = vi.fn(async () => null);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => changedCatalog },
            repository: {
                ...repository(async () => bot),
                getBot: async () => bot,
                getRoutineProposal: async () => proposal,
                saveRoutineProposal,
            },
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
            now: () => 1_788_000_001_000,
        });
        const response = await app.request("https://openbot.invalid/actions/routines", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({ _csrf: actor.csrf_token, proposal_id: proposal.proposal_id }),
        });

        expect(response.status).toBe(409);
        expect(saveRoutineProposal).not.toHaveBeenCalled();
    });

    it("changes an exact organization permission only through the owner action", async () => {
        const setOrganizationPermissionEnabled = vi.fn(async () => true);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: {
                ...metorialContract,
                listIntegrations: async () => integrations,
                setOrganizationPermissionEnabled,
            },
            repository: repository(async () => bot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/organization-permissions", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({
                _csrf: actor.csrf_token,
                integration_id: "integration_test_linear",
                policy_id: "policy_linear_read_v1",
                enabled: "false",
            }),
        });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/organization/settings");
        expect(setOrganizationPermissionEnabled).toHaveBeenCalledWith({
            account_id: actor.account_id,
            user_id: actor.user_id,
            integration_id: "integration_test_linear",
            policy_id: "policy_linear_read_v1",
            enabled: false,
        });
    });

    it("does not let a member change the organization ceiling", async () => {
        const setOrganizationPermissionEnabled = vi.fn(async () => true);
        const app = createControlPlane({
            resolveActor: async () => ({ ...actor, role: "member" as const }),
            connector: {
                ...metorialContract,
                listIntegrations: async () => integrations,
                setOrganizationPermissionEnabled,
            },
            repository: repository(async () => bot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/organization-permissions", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({
                _csrf: actor.csrf_token,
                integration_id: "integration_test_linear",
                policy_id: "policy_linear_read_v1",
                enabled: "false",
            }),
        });

        expect(response.status).toBe(403);
        expect(setOrganizationPermissionEnabled).not.toHaveBeenCalled();
    });

    it("creates a Bot only with an enabled account-scoped Metorial permission", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_read_v1"),
        });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/bots/bot_test_1");
        expect(createBot).toHaveBeenCalledOnce();
        expect(createBot.mock.calls[0]?.[0]).toMatchObject({
            integrations: [
                {
                    integration_id: "integration_test_linear",
                    provider_deployment_id: "pdp_test_linear",
                    auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
                    permission_pins: [
                        {
                            policy_id: "policy_linear_read_v1",
                            policy_revision: "revision_v1",
                            policy_sha256: "a".repeat(64),
                            tool_key: "list_issues",
                            effect: "read",
                            input_schema_sha256: "b".repeat(64),
                            output_schema_sha256: "c".repeat(64),
                        },
                    ],
                },
            ],
        });
    });

    it.each(["deployment", "authless"] as const)("accepts a connected %s Metorial auth mode", async mode => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const catalog: readonly ProductProofMetorialIntegrationV1[] = [{ ...integrations[0]!, auth: { mode } }];
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => catalog },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });

        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_read_v1"),
        });

        expect(response.status).toBe(303);
        expect(createBot.mock.calls[0]?.[0].integrations[0]?.auth).toEqual({ mode });
    });

    it("rejects a disabled write permission even when posted directly", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_write_v1"),
        });

        expect(response.status).toBe(422);
        expect(createBot).not.toHaveBeenCalled();
        expect(await response.text()).toContain("select at least one available integration permission");
    });

    it("rejects a tool permission forged from a different Metorial integration", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_slack_read_v1", actor.csrf_token, "integration_test_linear"),
        });

        expect(response.status).toBe(422);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("rejects an ambiguous organization integration catalog", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: {
                ...metorialContract,
                listIntegrations: async () => [integrations[0]!, { ...integrations[0]! }],
            },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });

        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_read_v1"),
        });

        expect(response.status).toBe(422);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("rejects an integration that still needs a connection", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const disconnected = [
            { ...integrations[0]!, connection_state: "needs_connection" as const },
            integrations[1],
        ].filter(value => value !== undefined);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => disconnected },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_read_v1"),
        });

        expect(response.status).toBe(422);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("checks CSRF before creating a Bot", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_read_v1", "wrong"),
        });

        expect(response.status).toBe(403);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("rejects a browser mutation without an exact same-origin header", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            body: form("policy_linear_read_v1"),
        });

        expect(response.status).toBe(403);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("rejects Bot creation by a non-owner actor", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => ({ ...actor, role: "member" }),
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });

        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_linear_read_v1"),
        });

        expect(response.status).toBe(403);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("does not create a confirmation when Metorial serialization identity is missing", async () => {
        const createConfirmation = vi.fn<ProductProofRepositoryV1["createConfirmation"]>(async () => {
            throw new Error("confirmation must not be created");
        });
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: {
                ...metorialContract,
                session_serialization_identity: "",
                listIntegrations: async () => integrations,
            },
            repository: {
                ...repository(async () => bot),
                listBots: async () => [bot],
                getBot: async () => bot,
                createConfirmation,
            },
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });

        const response = await app.request("https://openbot.invalid/actions/run-confirmations", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({
                _csrf: actor.csrf_token,
                bot_id: bot.bot_id,
                prompt: "List the open cases.",
            }),
        });

        expect(response.status).toBe(409);
        expect(await response.text()).toBe("App connection unavailable");
        expect(createConfirmation).not.toHaveBeenCalled();
    });

    it("stores detached authority snapshots when a confirmation is created", async () => {
        const createConfirmation = vi.fn<ProductProofRepositoryV1["createConfirmation"]>(async input => ({
            confirmation_id: "confirmation_test_snapshot",
            ...input,
            state: "pending",
        }));
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: {
                ...repository(async () => bot),
                getBot: async () => bot,
                createConfirmation,
            },
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
            now: () => 1_788_000_000_000,
        });

        const response = await app.request("https://openbot.invalid/actions/run-confirmations", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({
                _csrf: actor.csrf_token,
                bot_id: bot.bot_id,
                prompt: "List the open cases.",
            }),
        });

        expect(response.status).toBe(303);
        const input = createConfirmation.mock.calls[0]?.[0];
        expect(input?.metorial_authority_snapshot).not.toBe(bot.integrations);
        expect(input?.metorial_authority_snapshot[0]).not.toBe(bot.integrations[0]);
        expect(input?.permissions_snapshot[0]).not.toBe(integrations[0]?.permissions[0]);
        expect(Object.isFrozen(input?.metorial_authority_snapshot)).toBe(true);
        expect(Object.isFrozen(input?.metorial_authority_snapshot[0]?.permission_pins)).toBe(true);
        expect(Object.isFrozen(input?.permissions_snapshot)).toBe(true);
    });

    it("renders task results as escaped plain text", async () => {
        const run: ProductProofRunV1 = {
            run_id: "run_test_escaped",
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            confirmation_id: "confirmation_test_escaped",
            prompt: "Show the result.",
            result_text: "<strong>This stays plain text.</strong>",
            execution_state: "completed",
            cleanup_state: "not_required",
            evidence_state: "synthetic_test_only",
            metorial_tool_call_count: 0,
            created_at_ms: 1_788_000_000_000,
            completed_at_ms: 1_788_000_001_000,
        };
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: {
                ...repository(async () => bot),
                listBots: async () => [bot],
                getBot: async () => bot,
                getRun: async () => run,
            },
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });

        const response = await app.request("https://openbot.invalid/bots/bot_test_1/runs/run_test_escaped");
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain("\\u003cstrong>This stays plain text.\\u003c/strong>");
        expect(html).not.toContain("<strong>This stays plain text.</strong>");
    });

    it("executes at most once when the same confirmation is submitted concurrently", async () => {
        const confirmation: ProductProofConfirmationV1 = {
            confirmation_id: "confirmation_test_1",
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            prompt: "List the open cases.",
            metorial_session_intent: {
                intent_version: "openbot_metorial_session_intent_v1",
                connector_plugin_id: metorialContract.plugin_id,
                metorial_api_version: metorialContract.api_version,
                serialization_identity: metorialContract.session_serialization_identity,
                providers: [
                    {
                        provider_deployment_id: "pdp_test_linear",
                        provider_version_id: "pver_test_linear",
                        provider_specification_id: "pspec_test_linear",
                        auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
                        allowed_tool_keys: ["list_issues"],
                    },
                ],
            },
            metorial_authority_snapshot: bot.integrations,
            permissions_snapshot: integrations[0]?.permissions.slice(0, 1) ?? [],
            created_at_ms: 1_788_000_000_000,
            expires_at_ms: 1_788_000_300_000,
            state: "pending",
        };
        let claimed = false;
        let storedRun: ProductProofRunV1 | null = null;
        const raceRepository: ProductProofRepositoryV1 = {
            listBots: async () => [bot],
            createBot: async () => bot,
            getBot: async (accountId, botId) => (accountId === actor.account_id && botId === bot.bot_id ? bot : null),
            createConfirmation: async () => confirmation,
            // Deliberately return the same pending snapshot to both requests. The claim is the authority.
            getConfirmation: async () => confirmation,
            claimConfirmation: async input => {
                if (claimed || input.account_id !== actor.account_id) return null;
                claimed = true;
                storedRun = {
                    run_id: "run_test_1",
                    account_id: actor.account_id,
                    bot_id: bot.bot_id,
                    confirmation_id: confirmation.confirmation_id,
                    prompt: confirmation.prompt,
                    result_text: null,
                    execution_state: "running",
                    cleanup_state: "not_required",
                    evidence_state: "synthetic_test_only",
                    metorial_tool_call_count: 0,
                    created_at_ms: input.claimed_at_ms,
                    completed_at_ms: null,
                };
                return storedRun;
            },
            completeRun: async input => {
                if (storedRun === null || input.run_id !== storedRun.run_id) return null;
                storedRun = {
                    ...storedRun,
                    result_text: input.result_text,
                    execution_state: "completed",
                    completed_at_ms: input.completed_at_ms,
                };
                return storedRun;
            },
            getRun: async () => storedRun,
            ...routineRepositoryStubs,
        };
        const execute = vi.fn(async () => ({ result_text: "Three open cases." }));
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => integrations },
            repository: raceRepository,
            taskExecutor: { execute },
            now: () => 1_788_000_001_000,
        });
        const submit = async (): Promise<Response> =>
            await app.request("https://openbot.invalid/actions/runs", {
                method: "POST",
                headers: mutationHeaders,
                body: new URLSearchParams({
                    _csrf: actor.csrf_token,
                    confirmation_id: confirmation.confirmation_id,
                }),
            });

        const responses = await Promise.all([submit(), submit()]);

        expect(responses.map(response => response.status).sort()).toEqual([303, 409]);
        expect(execute).toHaveBeenCalledOnce();
    });

    it("does not execute after the organization revokes a previously confirmed permission", async () => {
        const confirmation: ProductProofConfirmationV1 = {
            confirmation_id: "confirmation_test_drift",
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            prompt: "List the open cases.",
            metorial_session_intent: {
                intent_version: "openbot_metorial_session_intent_v1",
                connector_plugin_id: metorialContract.plugin_id,
                metorial_api_version: metorialContract.api_version,
                serialization_identity: metorialContract.session_serialization_identity,
                providers: [
                    {
                        provider_deployment_id: "pdp_test_linear",
                        provider_version_id: "pver_test_linear",
                        provider_specification_id: "pspec_test_linear",
                        auth: { mode: "user_grant", connection_grant_id: "grant_test_linear_primary" },
                        allowed_tool_keys: ["list_issues"],
                    },
                ],
            },
            metorial_authority_snapshot: bot.integrations,
            permissions_snapshot: integrations[0]?.permissions.slice(0, 1) ?? [],
            created_at_ms: 1_788_000_000_000,
            expires_at_ms: 1_788_000_300_000,
            state: "pending",
        };
        const changedCatalog: readonly ProductProofMetorialIntegrationV1[] = [
            {
                ...integrations[0]!,
                permissions:
                    integrations[0]?.permissions.map(permission =>
                        permission.policy_id === "policy_linear_read_v1"
                            ? { ...permission, enabled: false }
                            : permission
                    ) ?? [],
            },
        ];
        const claimConfirmation = vi.fn(async () => null);
        const execute = vi.fn(async () => ({ result_text: "must not run" }));
        const app = createControlPlane({
            resolveActor: async () => actor,
            connector: { ...metorialContract, listIntegrations: async () => changedCatalog },
            repository: {
                listBots: async () => [bot],
                createBot: async () => bot,
                getBot: async () => bot,
                createConfirmation: async () => confirmation,
                getConfirmation: async () => confirmation,
                claimConfirmation,
                completeRun: async () => null,
                getRun: async () => null,
                ...routineRepositoryStubs,
            },
            taskExecutor: { execute },
            now: () => 1_788_000_001_000,
        });
        const response = await app.request("https://openbot.invalid/actions/runs", {
            method: "POST",
            headers: mutationHeaders,
            body: new URLSearchParams({
                _csrf: actor.csrf_token,
                confirmation_id: confirmation.confirmation_id,
            }),
        });

        expect(response.status).toBe(409);
        expect(claimConfirmation).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });
});
