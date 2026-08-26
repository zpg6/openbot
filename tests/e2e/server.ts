import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControlPlane } from "../../apps/control-plane/src/app.ts";
import type {
    ControlPlaneActorV1,
    ProductProofBotV1,
    ProductProofConfirmationV1,
    ProductProofMetorialIntegrationV1,
    ProductProofPermissionV1,
    ProductProofRepositoryV1,
    ProductProofRoutineProposalV1,
    ProductProofRoutineV1,
    ProductProofRunV1,
} from "../../apps/control-plane/src/product-proof.ts";

const actor: ControlPlaneActorV1 = Object.freeze({
    account_id: "account_e2e_owner",
    organization_name: "E2E Organization",
    user_id: "user_e2e_owner",
    display_name: "E2E Organization Owner",
    csrf_token: "csrf_e2e_product_flow_v1",
    role: "owner",
});
const expectedPrompt = "Summarize urgent Linear issues and list the Slack channels where I should post the update.";

const linearPolicyMetadata = Object.freeze({
    policy_revision: "linear_catalog_v1",
    policy_sha256: "a".repeat(64),
    input_schema_sha256: "b".repeat(64),
    output_schema_sha256: "c".repeat(64),
});
const slackPolicyMetadata = Object.freeze({
    policy_revision: "slack_catalog_v1",
    policy_sha256: "d".repeat(64),
    input_schema_sha256: "e".repeat(64),
    output_schema_sha256: "f".repeat(64),
});

const linearIcon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSJub25lIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PHBhdGggZmlsbD0iIzVFNkFEMiIgZD0iTTEuMjI1IDYxLjUyM2MtLjIyMi0uOTQ5LjkwOC0xLjU0NiAxLjU5Ny0uODU3bDM2LjUxMiAzNi41MTJjLjY5LjY5LjA5MiAxLjgyLS44NTcgMS41OTctMTguNDI1LTQuMzIzLTMyLjkzLTE4LjgyNy0zNy4yNTItMzcuMjUyWk0uMDAyIDQ2Ljg4OWEuOTkuOTkgMCAwIDAgLjI5Ljc2TDUyLjM1IDk5LjcxYy4yMDEuMi40NzguMzA3Ljc2LjI5IDIuMzctLjE0OSA0LjY5NS0uNDYgNi45NjMtLjkyNy43NjUtLjE1NyAxLjAzLTEuMDk2LjQ3OC0xLjY0OEwyLjU3NiAzOS40NDhjLS41NTItLjU1MS0xLjQ5MS0uMjg2LTEuNjQ4LjQ3OWE1MC4wNjcgNTAuMDY3IDAgMCAwLS45MjYgNi45NjJaTTQuMjEgMjkuNzA1YS45ODguOTg4IDAgMCAwIC4yMDggMS4xbDY0Ljc3NiA2NC43NzZjLjI4OS4yOS43MjYuMzc1IDEuMS4yMDhhNDkuOTA4IDQ5LjkwOCAwIDAgMCA1LjE4NS0yLjY4NC45ODEuOTgxIDAgMCAwIC4xODMtMS41NEw4LjQzNiAyNC4zMzZhLjk4MS45ODEgMCAwIDAtMS41NDEuMTgzIDQ5Ljg5NiA0OS44OTYgMCAwIDAtMi42ODQgNS4xODVabTguNDQ4LTExLjYzMWEuOTg2Ljk4NiAwIDAgMS0uMDQ1LTEuMzU0QzIxLjc4IDYuNDYgMzUuMTExIDAgNDkuOTUyIDAgNzcuNTkyIDAgMTAwIDIyLjQwNyAxMDAgNTAuMDQ4YzAgMTQuODQtNi40NiAyOC4xNzItMTYuNzIgMzcuMzM4YS45ODYuOTg2IDAgMCAxLTEuMzU0LS4wNDVMMTIuNjU5IDE4LjA3NFoiLz48L3N2Zz4=";
const slackIcon =
    "data:image/svg+xml;base64,PHN2ZwogIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgMCAwIDI0NDcuNiAyNDUyLjUiCiAgdmlld0JveD0iMCAwIDI0NDcuNiAyNDUyLjUiCiAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgo+CiAgPGcgY2xpcC1ydWxlPSJldmVub2RkIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPgogICAgPHBhdGgKICAgICAgZD0ibTg5Ny40IDBjLTEzNS4zLjEtMjQ0LjggMTA5LjktMjQ0LjcgMjQ1LjItLjEgMTM1LjMgMTA5LjUgMjQ1LjEgMjQ0LjggMjQ1LjJoMjQ0Ljh2LTI0NS4xYy4xLTEzNS4zLTEwOS41LTI0NS4xLTI0NC45LTI0NS4zLjEgMCAuMSAwIDAgMG0wIDY1NGgtNjUyLjZjLTEzNS4zLjEtMjQ0LjkgMTA5LjktMjQ0LjggMjQ1LjItLjIgMTM1LjMgMTA5LjQgMjQ1LjEgMjQ0LjcgMjQ1LjNoNjUyLjdjMTM1LjMtLjEgMjQ0LjktMTA5LjkgMjQ0LjgtMjQ1LjIuMS0xMzUuNC0xMDkuNS0yNDUuMi0yNDQuOC0yNDUuM3oiCiAgICAgIGZpbGw9IiMzNmM1ZjAiCiAgICAvPgogICAgPHBhdGgKICAgICAgZD0ibTI0NDcuNiA4OTkuMmMuMS0xMzUuMy0xMDkuNS0yNDUuMS0yNDQuOC0yNDUuMi0xMzUuMy4xLTI0NC45IDEwOS45LTI0NC44IDI0NS4ydjI0NS4zaDI0NC44YzEzNS4zLS4xIDI0NC45LTEwOS45IDI0NC44LTI0NS4zem0tNjUyLjcgMHYtNjU0Yy4xLTEzNS4yLTEwOS40LTI0NS0yNDQuNy0yNDUuMi0xMzUuMy4xLTI0NC45IDEwOS45LTI0NC44IDI0NS4ydjY1NGMtLjIgMTM1LjMgMTA5LjQgMjQ1LjEgMjQ0LjcgMjQ1LjMgMTM1LjMtLjEgMjQ0LjktMTA5LjkgMjQ0LjgtMjQ1LjN6IgogICAgICBmaWxsPSIjMmViNjdkIgogICAgLz4KICAgIDxwYXRoCiAgICAgIGQ9Im0xNTUwLjEgMjQ1Mi41YzEzNS4zLS4xIDI0NC45LTEwOS45IDI0NC44LTI0NS4yLjEtMTM1LjMtMTA5LjUtMjQ1LjEtMjQ0LjgtMjQ1LjJoLTI0NC44djI0NS4yYy0uMSAxMzUuMiAxMDkuNSAyNDUgMjQ0LjggMjQ1LjJ6bTAtNjU0LjFoNjUyLjdjMTM1LjMtLjEgMjQ0LjktMTA5LjkgMjQ0LjgtMjQ1LjIuMi0xMzUuMy0xMDkuNC0yNDUuMS0yNDQuNy0yNDUuM2gtNjUyLjdjLTEzNS4zLjEtMjQ0LjkgMTA5LjktMjQ0LjggMjQ1LjItLjEgMTM1LjQgMTA5LjQgMjQ1LjIgMjQ0LjcgMjQ1LjN6IgogICAgICBmaWxsPSIjZWNiMjJlIgogICAgLz4KICAgIDxwYXRoCiAgICAgIGQ9Im0wIDE1NTMuMmMtLjEgMTM1LjMgMTA5LjUgMjQ1LjEgMjQ0LjggMjQ1LjIgMTM1LjMtLjEgMjQ0LjktMTA5LjkgMjQ0LjgtMjQ1LjJ2LTI0NS4yaC0yNDQuOGMtMTM1LjMuMS0yNDQuOSAxMDkuOS0yNDQuOCAyNDUuMnptNjUyLjcgMHY2NTRjLS4yIDEzNS4zIDEwOS40IDI0NS4xIDI0NC43IDI0NS4zIDEzNS4zLS4xIDI0NC45LTEwOS45IDI0NC44LTI0NS4ydi02NTMuOWMuMi0xMzUuMy0xMDkuNC0yNDUuMS0yNDQuNy0yNDUuMy0xMzUuNCAwLTI0NC45IDEwOS44LTI0NC44IDI0NS4xIDAgMCAwIC4xIDAgMCIKICAgICAgZmlsbD0iI2UwMWU1YSIKICAgIC8+CiAgPC9nPgo8L3N2Zz4K";

const integrations: readonly ProductProofMetorialIntegrationV1[] = Object.freeze([
    Object.freeze({
        integration_id: "integration_linear_e2e",
        provider_deployment_id: "pdp_linear_e2e",
        provider_version_id: "pver_linear_e2e",
        provider_specification_id: "pspec_linear_e2e",
        auth: { mode: "user_grant" as const, connection_grant_id: "grant_linear_e2e_primary" },
        connected_account_label: "Linear · OpenBot workspace",
        display_name: "Linear",
        description: "Issues, projects, and team workflow.",
        icon_data_uri: linearIcon,
        connection_state: "connected" as const,
        permissions: Object.freeze([
            Object.freeze({
                integration_id: "integration_linear_e2e",
                policy_id: "policy_linear_list_issues_v1",
                display_name: "List issues",
                tool_key: "list_issues",
                effect: "read" as const,
                consequence_summary: "Issue titles, states, assignees, and labels may be returned.",
                resource_scope_summary: "All issues visible to the connected Linear account.",
                enabled: true,
                ...linearPolicyMetadata,
            }),
            Object.freeze({
                integration_id: "integration_linear_e2e",
                policy_id: "policy_linear_create_issue_v1",
                display_name: "Create issue",
                tool_key: "create_issue",
                effect: "write" as const,
                consequence_summary: "Creates a new issue in Linear.",
                resource_scope_summary: "Connected Linear workspace.",
                enabled: false,
                ...linearPolicyMetadata,
            }),
            Object.freeze({
                integration_id: "integration_linear_e2e",
                policy_id: "policy_linear_delete_issue_v1",
                display_name: "Delete issue",
                tool_key: "delete_issue",
                effect: "destructive" as const,
                consequence_summary: "Deletes an existing Linear issue.",
                resource_scope_summary: "Connected Linear workspace.",
                enabled: false,
                ...linearPolicyMetadata,
            }),
        ]),
    }),
    Object.freeze({
        integration_id: "integration_slack_e2e",
        provider_deployment_id: "pdp_slack_e2e",
        provider_version_id: "pver_slack_e2e",
        provider_specification_id: "pspec_slack_e2e",
        auth: { mode: "user_grant" as const, connection_grant_id: "grant_slack_e2e_primary" },
        connected_account_label: "Slack · OpenBot workspace",
        display_name: "Slack",
        description: "Channels and messages.",
        icon_data_uri: slackIcon,
        connection_state: "connected" as const,
        permissions: Object.freeze([
            Object.freeze({
                integration_id: "integration_slack_e2e",
                policy_id: "policy_slack_list_channels_v1",
                display_name: "List channels",
                tool_key: "list_channels",
                effect: "read" as const,
                consequence_summary: "Channel names and metadata may be returned.",
                resource_scope_summary: "Channels visible to the connected Slack account.",
                enabled: true,
                ...slackPolicyMetadata,
            }),
            Object.freeze({
                integration_id: "integration_slack_e2e",
                policy_id: "policy_slack_send_message_v1",
                display_name: "Send message",
                tool_key: "send_message",
                effect: "write" as const,
                consequence_summary: "Sends a message to a Slack channel.",
                resource_scope_summary: "Channels writable by the connected Slack account.",
                enabled: false,
                ...slackPolicyMetadata,
            }),
        ]),
    }),
]);

const copyBot = (bot: ProductProofBotV1): ProductProofBotV1 =>
    Object.freeze({
        ...bot,
        integrations: Object.freeze(
            bot.integrations.map(integration =>
                Object.freeze({
                    ...integration,
                    auth: Object.freeze({ ...integration.auth }),
                    permission_pins: Object.freeze(integration.permission_pins.map(pin => Object.freeze({ ...pin }))),
                })
            )
        ),
    });

const createMemoryRepository = (): ProductProofRepositoryV1 => {
    const bots = new Map<string, ProductProofBotV1>();
    const confirmations = new Map<string, ProductProofConfirmationV1>();
    const runs = new Map<string, ProductProofRunV1>();
    const routineProposals = new Map<string, ProductProofRoutineProposalV1>();
    const routines = new Map<string, ProductProofRoutineV1>();
    let botSequence = 0;
    let confirmationSequence = 0;
    let runSequence = 0;
    let routineProposalSequence = 0;
    let routineSequence = 0;

    const repository: ProductProofRepositoryV1 = {
        async listBots(accountId) {
            return [...bots.values()]
                .filter(bot => bot.account_id === accountId)
                .sort((left, right) => left.created_at_ms - right.created_at_ms)
                .map(copyBot);
        },
        async createBot(input) {
            botSequence += 1;
            const bot = copyBot({
                bot_id: `bot_e2e_${botSequence.toString().padStart(4, "0")}`,
                ...input,
            });
            bots.set(bot.bot_id, bot);
            return copyBot(bot);
        },
        async getBot(accountId, botId) {
            const bot = bots.get(botId);
            return bot !== undefined && bot.account_id === accountId ? copyBot(bot) : null;
        },
        async createConfirmation(input) {
            confirmationSequence += 1;
            const confirmation: ProductProofConfirmationV1 = Object.freeze({
                confirmation_id: `confirmation_e2e_${confirmationSequence.toString().padStart(4, "0")}`,
                ...input,
                state: "pending",
            });
            confirmations.set(confirmation.confirmation_id, confirmation);
            return confirmation;
        },
        async getConfirmation(accountId, confirmationId) {
            const confirmation = confirmations.get(confirmationId);
            return confirmation !== undefined && confirmation.account_id === accountId ? confirmation : null;
        },
        async claimConfirmation(input) {
            const confirmation = confirmations.get(input.confirmation_id);
            if (
                confirmation === undefined ||
                confirmation.account_id !== input.account_id ||
                confirmation.state !== "pending" ||
                confirmation.expires_at_ms <= input.claimed_at_ms
            ) {
                return null;
            }
            confirmations.set(confirmation.confirmation_id, Object.freeze({ ...confirmation, state: "started" }));
            runSequence += 1;
            const run: ProductProofRunV1 = Object.freeze({
                run_id: `run_e2e_${runSequence.toString().padStart(4, "0")}`,
                account_id: confirmation.account_id,
                bot_id: confirmation.bot_id,
                confirmation_id: confirmation.confirmation_id,
                prompt: confirmation.prompt,
                result_text: null,
                execution_state: "running",
                cleanup_state: "not_required",
                evidence_state: "synthetic_test_only",
                created_at_ms: input.claimed_at_ms,
                completed_at_ms: null,
            });
            runs.set(run.run_id, run);
            return run;
        },
        async completeRun(input) {
            const run = runs.get(input.run_id);
            if (run === undefined || run.account_id !== input.account_id || run.execution_state !== "running") {
                return null;
            }
            const completedRun: ProductProofRunV1 = Object.freeze({
                ...run,
                result_text: input.result_text,
                execution_state: "completed",
                completed_at_ms: input.completed_at_ms,
            });
            runs.set(completedRun.run_id, completedRun);
            return completedRun;
        },
        async getRun(accountId, botId, runId) {
            const run = runs.get(runId);
            return run !== undefined && run.account_id === accountId && run.bot_id === botId ? run : null;
        },
        async listRoutines(accountId, botId) {
            return [...routines.values()].filter(
                routine => routine.account_id === accountId && routine.bot_id === botId
            );
        },
        async getRoutine(accountId, botId, routineId) {
            const routine = routines.get(routineId);
            return routine !== undefined && routine.account_id === accountId && routine.bot_id === botId
                ? routine
                : null;
        },
        async createRoutineProposal(input) {
            routineProposalSequence += 1;
            const proposal: ProductProofRoutineProposalV1 = Object.freeze({
                proposal_id: `routine_proposal_e2e_${routineProposalSequence.toString().padStart(4, "0")}`,
                ...input,
                state: "pending",
            });
            routineProposals.set(proposal.proposal_id, proposal);
            return proposal;
        },
        async getRoutineProposal(accountId, proposalId) {
            const proposal = routineProposals.get(proposalId);
            return proposal !== undefined && proposal.account_id === accountId ? proposal : null;
        },
        async saveRoutineProposal(input) {
            const proposal = routineProposals.get(input.proposal_id);
            if (
                proposal === undefined ||
                proposal.account_id !== input.account_id ||
                proposal.state !== "pending" ||
                proposal.expires_at_ms <= input.saved_at_ms
            ) {
                return null;
            }
            routineProposals.set(proposal.proposal_id, Object.freeze({ ...proposal, state: "saved" }));
            routineSequence += 1;
            const routine: ProductProofRoutineV1 = Object.freeze({
                routine_id: `routine_e2e_${routineSequence.toString().padStart(4, "0")}`,
                account_id: proposal.account_id,
                bot_id: proposal.bot_id,
                name: proposal.name,
                prompt: proposal.prompt,
                schedule: proposal.schedule,
                revision: 1,
                metorial_session_intent: proposal.metorial_session_intent,
                metorial_authority_snapshot: proposal.metorial_authority_snapshot,
                permissions_snapshot: proposal.permissions_snapshot,
                created_at_ms: input.saved_at_ms,
                updated_at_ms: input.saved_at_ms,
            });
            routines.set(routine.routine_id, routine);
            return routine;
        },
        async updateRoutine(input) {
            const routine = routines.get(input.routine_id);
            if (
                routine === undefined ||
                routine.account_id !== input.account_id ||
                routine.bot_id !== input.bot_id ||
                routine.revision !== input.expected_revision
            ) {
                return null;
            }
            const updated: ProductProofRoutineV1 = Object.freeze({
                ...routine,
                name: input.name,
                prompt: input.prompt,
                schedule: input.schedule,
                revision: routine.revision + 1,
                metorial_session_intent: input.metorial_session_intent,
                metorial_authority_snapshot: input.metorial_authority_snapshot,
                permissions_snapshot: input.permissions_snapshot,
                updated_at_ms: input.updated_at_ms,
            });
            routines.set(updated.routine_id, updated);
            return updated;
        },
    };
    return Object.freeze(repository);
};

const organizationPermissionOverrides = new Map<string, boolean>();
const currentOrganizationIntegrations = (): readonly ProductProofMetorialIntegrationV1[] =>
    integrations.map(integration => ({
        ...integration,
        permissions: integration.permissions.map(permission => ({
            ...permission,
            enabled: organizationPermissionOverrides.get(permission.policy_id) ?? permission.enabled,
        })),
    }));

const app = createControlPlane({
    resolveActor: async () => actor,
    listMetorialIntegrations: async (accountId, userId) =>
        accountId === actor.account_id && userId === actor.user_id ? currentOrganizationIntegrations() : [],
    setOrganizationPermissionEnabled: async input => {
        if (input.account_id !== actor.account_id || input.user_id !== actor.user_id) return false;
        const permission = integrations
            .find(integration => integration.integration_id === input.integration_id)
            ?.permissions.find(candidate => candidate.policy_id === input.policy_id);
        if (permission === undefined) return false;
        organizationPermissionOverrides.set(permission.policy_id, input.enabled);
        return true;
    },
    metorial_api_version: "2025-01-01",
    metorial_session_serialization_identity: "openbot-e2e-serializer@1",
    repository: createMemoryRepository(),
    taskExecutor: {
        async execute(input) {
            const selected = input.permissions.map((permission: ProductProofPermissionV1) => permission.tool_key);
            const expectedSessionIntent = {
                intent_version: "openbot_metorial_session_intent_v1",
                metorial_api_version: "2025-01-01",
                serialization_identity: "openbot-e2e-serializer@1",
                providers: [
                    {
                        provider_deployment_id: "pdp_linear_e2e",
                        provider_version_id: "pver_linear_e2e",
                        provider_specification_id: "pspec_linear_e2e",
                        auth: { mode: "user_grant", connection_grant_id: "grant_linear_e2e_primary" },
                        allowed_tool_keys: ["list_issues"],
                    },
                    {
                        provider_deployment_id: "pdp_slack_e2e",
                        provider_version_id: "pver_slack_e2e",
                        provider_specification_id: "pspec_slack_e2e",
                        auth: { mode: "user_grant", connection_grant_id: "grant_slack_e2e_primary" },
                        allowed_tool_keys: ["list_channels"],
                    },
                ],
            };
            const expectedPermissionPins = [
                [
                    "policy_linear_list_issues_v1",
                    "linear_catalog_v1",
                    "list_issues",
                    "read",
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                ],
                [
                    "policy_slack_list_channels_v1",
                    "slack_catalog_v1",
                    "list_channels",
                    "read",
                    "d".repeat(64),
                    "e".repeat(64),
                    "f".repeat(64),
                ],
            ];
            const actualPermissionPins = input.bot.integrations.map(integration => {
                const pin = integration.permission_pins[0]!;
                return [
                    pin.policy_id,
                    pin.policy_revision,
                    pin.tool_key,
                    pin.effect,
                    pin.policy_sha256,
                    pin.input_schema_sha256,
                    pin.output_schema_sha256,
                ];
            });
            if (
                input.account_id !== actor.account_id ||
                input.user_id !== actor.user_id ||
                input.run_id !== "run_e2e_0001" ||
                input.bot.bot_id !== "bot_e2e_0001" ||
                input.prompt !== expectedPrompt ||
                JSON.stringify(selected) !== JSON.stringify(["list_issues", "list_channels"]) ||
                JSON.stringify(input.metorial_session_intent) !== JSON.stringify(expectedSessionIntent) ||
                JSON.stringify(actualPermissionPins) !== JSON.stringify(expectedPermissionPins)
            ) {
                throw new Error("E2E executor received an unexpected authority envelope");
            }
            return {
                result_text: `Reviewed 3 urgent Linear issues and found 2 Slack channels for the update. Nothing was changed or sent.`,
            };
        },
    },
    now: () => 1_788_000_000_000,
});

const port = Number.parseInt(process.env["OPENBOT_APP_E2E_PORT"] ?? "4173", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) throw new Error("invalid E2E port");

const server = createServer(async (incoming, outgoing) => {
    try {
        const assetName = incoming.url === "/assets/openbot-client.js" ? "openbot-client.js" : null;
        if (assetName !== null) {
            const body = await readFile(resolve(process.cwd(), ".build/client/control-plane", assetName));
            outgoing.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Type": "text/javascript; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
            });
            outgoing.end(body);
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const method = incoming.method ?? "GET";
        const request = new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
            method,
            headers: incoming.headers as HeadersInit,
            ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
        });
        const response = await app.fetch(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
        outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        outgoing.end("E2E server failure");
    }
});

server.listen(port, "127.0.0.1");

const close = (): void => {
    server.close(error => {
        process.exitCode = error === undefined ? 0 : 1;
    });
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
