import type {
    ProductProofBotV1,
    ProductProofConfirmationV1,
    ProductProofRepositoryV1,
    ProductProofRoutineProposalV1,
    ProductProofRoutineV1,
    ProductProofRunV1,
} from "./product-proof.js";

type StoredDocument =
    | ProductProofBotV1
    | ProductProofConfirmationV1
    | ProductProofRunV1
    | ProductProofRoutineProposalV1
    | ProductProofRoutineV1;

const createId = (prefix: string): string => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

const parseDocument = <T extends StoredDocument>(value: unknown, kind: string): T => {
    if (typeof value !== "string" || value.length > 512 * 1024) {
        throw new Error(`Invalid ${kind} document in D1`);
    }
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid ${kind} document in D1`);
    }
    return parsed as T;
};

const json = (value: StoredDocument): string => JSON.stringify(value);

const changes = (result: D1Result): number => result.meta.changes ?? 0;

export const createD1ProductRepositoryV1 = (database: D1Database): ProductProofRepositoryV1 => ({
    async listBots(accountId) {
        const result = await database
            .prepare(
                "SELECT document_json FROM openbot_bot WHERE organization_id = ?1 ORDER BY created_at_ms ASC, bot_id ASC"
            )
            .bind(accountId)
            .all<{ document_json: string }>();
        return result.results.map(row => parseDocument<ProductProofBotV1>(row.document_json, "bot"));
    },

    async createBot(input) {
        const bot: ProductProofBotV1 = { bot_id: createId("bot"), ...input };
        await database
            .prepare(
                "INSERT INTO openbot_bot (bot_id, organization_id, owner_user_id, created_at_ms, document_json) VALUES (?1, ?2, ?3, ?4, ?5)"
            )
            .bind(bot.bot_id, bot.account_id, bot.owner_user_id, bot.created_at_ms, json(bot))
            .run();
        return bot;
    },

    async getBot(accountId, botId) {
        const row = await database
            .prepare("SELECT document_json FROM openbot_bot WHERE organization_id = ?1 AND bot_id = ?2")
            .bind(accountId, botId)
            .first<{ document_json: string }>();
        return row === null ? null : parseDocument<ProductProofBotV1>(row.document_json, "bot");
    },

    async createConfirmation(input) {
        const confirmation: ProductProofConfirmationV1 = {
            confirmation_id: createId("confirmation"),
            ...input,
            state: "pending",
        };
        await database
            .prepare(
                "INSERT INTO openbot_confirmation (confirmation_id, organization_id, bot_id, state, expires_at_ms, created_at_ms, document_json) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6)"
            )
            .bind(
                confirmation.confirmation_id,
                confirmation.account_id,
                confirmation.bot_id,
                confirmation.expires_at_ms,
                confirmation.created_at_ms,
                json(confirmation)
            )
            .run();
        return confirmation;
    },

    async getConfirmation(accountId, confirmationId) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_confirmation WHERE organization_id = ?1 AND confirmation_id = ?2"
            )
            .bind(accountId, confirmationId)
            .first<{ document_json: string }>();
        return row === null ? null : parseDocument<ProductProofConfirmationV1>(row.document_json, "confirmation");
    },

    async claimConfirmation(input) {
        const confirmationRow = await database
            .prepare(
                "SELECT document_json FROM openbot_confirmation WHERE organization_id = ?1 AND confirmation_id = ?2 AND state = 'pending' AND expires_at_ms > ?3"
            )
            .bind(input.account_id, input.confirmation_id, input.claimed_at_ms)
            .first<{ document_json: string }>();
        if (confirmationRow === null) return null;

        const confirmation = parseDocument<ProductProofConfirmationV1>(confirmationRow.document_json, "confirmation");
        const started: ProductProofConfirmationV1 = { ...confirmation, state: "started" };
        const claimed = await database
            .prepare(
                "UPDATE openbot_confirmation SET state = 'started', document_json = ?1 WHERE organization_id = ?2 AND confirmation_id = ?3 AND state = 'pending' AND expires_at_ms > ?4"
            )
            .bind(json(started), input.account_id, input.confirmation_id, input.claimed_at_ms)
            .run();
        if (changes(claimed) !== 1) return null;

        const run: ProductProofRunV1 = {
            run_id: createId("run"),
            account_id: confirmation.account_id,
            bot_id: confirmation.bot_id,
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
        await database
            .prepare(
                "INSERT INTO openbot_run (run_id, organization_id, bot_id, confirmation_id, execution_state, created_at_ms, document_json) VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6)"
            )
            .bind(run.run_id, run.account_id, run.bot_id, run.confirmation_id, run.created_at_ms, json(run))
            .run();
        return run;
    },

    async completeRun(input) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_run WHERE organization_id = ?1 AND run_id = ?2 AND execution_state = 'running'"
            )
            .bind(input.account_id, input.run_id)
            .first<{ document_json: string }>();
        if (row === null) return null;
        const running = parseDocument<ProductProofRunV1>(row.document_json, "run");
        const completed: ProductProofRunV1 = {
            ...running,
            result_text: input.result_text,
            execution_state: "completed",
            cleanup_state: input.cleanup_state,
            evidence_state: input.evidence_state,
            metorial_tool_call_count: input.metorial_tool_call_count,
            completed_at_ms: input.completed_at_ms,
        };
        const updated = await database
            .prepare(
                "UPDATE openbot_run SET execution_state = 'completed', document_json = ?1 WHERE organization_id = ?2 AND run_id = ?3 AND execution_state = 'running'"
            )
            .bind(json(completed), input.account_id, input.run_id)
            .run();
        return changes(updated) === 1 ? completed : null;
    },

    async failRun(input) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_run WHERE organization_id = ?1 AND run_id = ?2 AND execution_state = 'running'"
            )
            .bind(input.account_id, input.run_id)
            .first<{ document_json: string }>();
        if (row === null) return null;
        const running = parseDocument<ProductProofRunV1>(row.document_json, "run");
        const failed: ProductProofRunV1 = {
            ...running,
            execution_state: "failed",
            completed_at_ms: input.completed_at_ms,
        };
        const updated = await database
            .prepare(
                "UPDATE openbot_run SET execution_state = 'failed', document_json = ?1 WHERE organization_id = ?2 AND run_id = ?3 AND execution_state = 'running'"
            )
            .bind(json(failed), input.account_id, input.run_id)
            .run();
        return changes(updated) === 1 ? failed : null;
    },

    async getRun(accountId, botId, runId) {
        const row = await database
            .prepare("SELECT document_json FROM openbot_run WHERE organization_id = ?1 AND bot_id = ?2 AND run_id = ?3")
            .bind(accountId, botId, runId)
            .first<{ document_json: string }>();
        return row === null ? null : parseDocument<ProductProofRunV1>(row.document_json, "run");
    },

    async listRoutines(accountId, botId) {
        const result = await database
            .prepare(
                "SELECT document_json FROM openbot_routine WHERE organization_id = ?1 AND bot_id = ?2 ORDER BY created_at_ms ASC, routine_id ASC"
            )
            .bind(accountId, botId)
            .all<{ document_json: string }>();
        return result.results.map(row => parseDocument<ProductProofRoutineV1>(row.document_json, "routine"));
    },

    async getRoutine(accountId, botId, routineId) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_routine WHERE organization_id = ?1 AND bot_id = ?2 AND routine_id = ?3"
            )
            .bind(accountId, botId, routineId)
            .first<{ document_json: string }>();
        return row === null ? null : parseDocument<ProductProofRoutineV1>(row.document_json, "routine");
    },

    async createRoutineProposal(input) {
        const proposal: ProductProofRoutineProposalV1 = {
            proposal_id: createId("routine_proposal"),
            ...input,
            state: "pending",
        };
        await database
            .prepare(
                "INSERT INTO openbot_routine_proposal (proposal_id, organization_id, bot_id, state, expires_at_ms, created_at_ms, document_json) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6)"
            )
            .bind(
                proposal.proposal_id,
                proposal.account_id,
                proposal.bot_id,
                proposal.expires_at_ms,
                proposal.created_at_ms,
                json(proposal)
            )
            .run();
        return proposal;
    },

    async getRoutineProposal(accountId, proposalId) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_routine_proposal WHERE organization_id = ?1 AND proposal_id = ?2"
            )
            .bind(accountId, proposalId)
            .first<{ document_json: string }>();
        return row === null
            ? null
            : parseDocument<ProductProofRoutineProposalV1>(row.document_json, "routine proposal");
    },

    async saveRoutineProposal(input) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_routine_proposal WHERE organization_id = ?1 AND proposal_id = ?2 AND state = 'pending' AND expires_at_ms > ?3"
            )
            .bind(input.account_id, input.proposal_id, input.saved_at_ms)
            .first<{ document_json: string }>();
        if (row === null) return null;
        const proposal = parseDocument<ProductProofRoutineProposalV1>(row.document_json, "routine proposal");
        const saved: ProductProofRoutineProposalV1 = { ...proposal, state: "saved" };
        const updated = await database
            .prepare(
                "UPDATE openbot_routine_proposal SET state = 'saved', document_json = ?1 WHERE organization_id = ?2 AND proposal_id = ?3 AND state = 'pending' AND expires_at_ms > ?4"
            )
            .bind(json(saved), input.account_id, input.proposal_id, input.saved_at_ms)
            .run();
        if (changes(updated) !== 1) return null;

        const routine: ProductProofRoutineV1 = {
            routine_id: createId("routine"),
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
        };
        await database
            .prepare(
                "INSERT INTO openbot_routine (routine_id, organization_id, bot_id, revision, created_at_ms, updated_at_ms, document_json) VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5)"
            )
            .bind(routine.routine_id, routine.account_id, routine.bot_id, routine.created_at_ms, json(routine))
            .run();
        return routine;
    },

    async updateRoutine(input) {
        const row = await database
            .prepare(
                "SELECT document_json FROM openbot_routine WHERE organization_id = ?1 AND bot_id = ?2 AND routine_id = ?3 AND revision = ?4"
            )
            .bind(input.account_id, input.bot_id, input.routine_id, input.expected_revision)
            .first<{ document_json: string }>();
        if (row === null) return null;
        const current = parseDocument<ProductProofRoutineV1>(row.document_json, "routine");
        const updated: ProductProofRoutineV1 = {
            ...current,
            name: input.name,
            prompt: input.prompt,
            schedule: input.schedule,
            revision: input.expected_revision + 1,
            metorial_session_intent: input.metorial_session_intent,
            metorial_authority_snapshot: input.metorial_authority_snapshot,
            permissions_snapshot: input.permissions_snapshot,
            updated_at_ms: input.updated_at_ms,
        };
        const result = await database
            .prepare(
                "UPDATE openbot_routine SET revision = ?1, updated_at_ms = ?2, document_json = ?3 WHERE organization_id = ?4 AND bot_id = ?5 AND routine_id = ?6 AND revision = ?7"
            )
            .bind(
                updated.revision,
                updated.updated_at_ms,
                json(updated),
                input.account_id,
                input.bot_id,
                input.routine_id,
                input.expected_revision
            )
            .run();
        return changes(result) === 1 ? updated : null;
    },
});
