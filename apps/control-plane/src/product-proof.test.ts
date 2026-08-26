import { describe, expect, it, vi } from "vitest";

import { createControlPlane } from "./app.ts";
import type {
    ControlPlaneActorV1,
    ProductProofBotV1,
    ProductProofConfirmationV1,
    ProductProofRepositoryV1,
    ProductProofRunV1,
} from "./product-proof.ts";

const actor: ControlPlaneActorV1 = {
    account_id: "account_test",
    user_id: "user_test",
    display_name: "Test Owner",
    csrf_token: "csrf_test",
};

const bot: ProductProofBotV1 = {
    bot_id: "bot_test_1",
    account_id: actor.account_id,
    owner_user_id: actor.user_id,
    name: "Support reader",
    short_description: "Reads support cases.",
    palette_color_id: "blue",
    purpose: "Review cases.",
    standing_instructions: "Do not guess.",
    permission_policy_ids: ["policy_support_cases_read_v1"],
    created_at_ms: 1_788_000_000_000,
};

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
});

const form = (permission: string, csrf = actor.csrf_token): URLSearchParams =>
    new URLSearchParams({
        _csrf: csrf,
        name: bot.name,
        short_description: bot.short_description,
        palette_color_id: bot.palette_color_id,
        purpose: bot.purpose,
        standing_instructions: bot.standing_instructions,
        permission,
    });

const mutationHeaders = { Origin: "https://openbot.invalid" } as const;

describe("control-plane product proof", () => {
    it("creates a Bot only with an enabled server-reviewed read permission", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_support_cases_read_v1"),
        });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/bots/bot_test_1");
        expect(createBot).toHaveBeenCalledOnce();
        expect(createBot.mock.calls[0]?.[0].permission_policy_ids).toEqual(["policy_support_cases_read_v1"]);
    });

    it("rejects a disabled write permission even when posted directly", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_support_case_update_v1"),
        });

        expect(response.status).toBe(422);
        expect(createBot).not.toHaveBeenCalled();
        expect(await response.text()).toContain("select at least one available read permission");
    });

    it("checks CSRF before creating a Bot", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            headers: mutationHeaders,
            body: form("policy_support_cases_read_v1", "wrong"),
        });

        expect(response.status).toBe(403);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("rejects a browser mutation without an exact same-origin header", async () => {
        const createBot = vi.fn<ProductProofRepositoryV1["createBot"]>(async () => bot);
        const app = createControlPlane({
            resolveActor: async () => actor,
            repository: repository(createBot),
            taskExecutor: { execute: async () => ({ result_text: "unused" }) },
        });
        const response = await app.request("https://openbot.invalid/actions/bots", {
            method: "POST",
            body: form("policy_support_cases_read_v1"),
        });

        expect(response.status).toBe(403);
        expect(createBot).not.toHaveBeenCalled();
    });

    it("executes at most once when the same confirmation is submitted concurrently", async () => {
        const confirmation: ProductProofConfirmationV1 = {
            confirmation_id: "confirmation_test_1",
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            prompt: "List the open cases.",
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
        };
        const execute = vi.fn(async () => ({ result_text: "Three open cases." }));
        const app = createControlPlane({
            resolveActor: async () => actor,
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
});
