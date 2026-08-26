import { createServer } from "node:http";

import { createControlPlane } from "../../apps/control-plane/src/app.ts";
import type {
    ControlPlaneActorV1,
    ProductProofBotV1,
    ProductProofConfirmationV1,
    ProductProofPermissionV1,
    ProductProofRepositoryV1,
    ProductProofRunV1,
} from "../../apps/control-plane/src/product-proof.ts";

const actor: ControlPlaneActorV1 = Object.freeze({
    account_id: "account_e2e_owner",
    user_id: "user_e2e_owner",
    display_name: "E2E Organization Owner",
    csrf_token: "csrf_e2e_product_flow_v1",
});

const copyBot = (bot: ProductProofBotV1): ProductProofBotV1 =>
    Object.freeze({ ...bot, permission_policy_ids: Object.freeze([...bot.permission_policy_ids]) });

const createMemoryRepository = (): ProductProofRepositoryV1 => {
    const bots = new Map<string, ProductProofBotV1>();
    const confirmations = new Map<string, ProductProofConfirmationV1>();
    const runs = new Map<string, ProductProofRunV1>();
    let botSequence = 0;
    let confirmationSequence = 0;
    let runSequence = 0;

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
    };
    return Object.freeze(repository);
};

const app = createControlPlane({
    resolveActor: async () => actor,
    repository: createMemoryRepository(),
    taskExecutor: {
        async execute(input) {
            const selected = input.permissions.map((permission: ProductProofPermissionV1) => permission.tool_key);
            if (selected.length !== 1 || selected[0] !== "support.list_cases") {
                throw new Error("E2E executor received an unexpected permission selection");
            }
            return {
                result_text: `Found 3 open support cases for: ${input.prompt}\n<strong>This stays plain text.</strong>`,
            };
        },
    },
    now: () => 1_788_000_000_000,
});

const port = Number.parseInt(process.env["OPENBOT_APP_E2E_PORT"] ?? "4173", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) throw new Error("invalid E2E port");

const server = createServer(async (incoming, outgoing) => {
    try {
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
