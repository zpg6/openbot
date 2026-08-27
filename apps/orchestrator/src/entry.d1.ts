import { parseOpenBotExecutionRequestV1, type OpenBotExecutionRequestV1 } from "@openbot/contracts/internal";

interface OrchestratorBindings {
    readonly CONTROL_DB_FRESH: D1Database;
    readonly RUN_OBJECT: DurableObjectNamespace;
}

const MAX_REQUEST_BYTES = 512 * 1024;
const jsonHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;
const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers: jsonHeaders });
const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
};
const parseDocument = (value: string): Record<string, unknown> | null => {
    if (value.length > MAX_REQUEST_BYTES) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};

const verifyAuthority = async (database: D1Database, input: OpenBotExecutionRequestV1): Promise<boolean> => {
    const row = await database
        .prepare(
            "SELECT run.document_json AS run_json, confirmation.document_json AS confirmation_json, bot.document_json AS bot_json FROM openbot_run AS run INNER JOIN openbot_confirmation AS confirmation ON confirmation.confirmation_id = run.confirmation_id INNER JOIN openbot_bot AS bot ON bot.bot_id = run.bot_id WHERE run.organization_id = ?1 AND run.run_id = ?2 AND run.bot_id = ?3 AND run.execution_state = 'running'"
        )
        .bind(input.account_id, input.run_id, input.bot.bot_id)
        .first<{ run_json: string; confirmation_json: string; bot_json: string }>();
    if (row === null) return false;
    const run = parseDocument(row.run_json);
    const confirmation = parseDocument(row.confirmation_json);
    const bot = parseDocument(row.bot_json);
    if (run === null || confirmation === null || bot === null) return false;
    const storedPermissions = Array.isArray(confirmation["permissions_snapshot"])
        ? confirmation["permissions_snapshot"]
        : null;
    if (storedPermissions === null) return false;
    const reducedPermissions = storedPermissions.map(value => {
        const permission = value as Record<string, unknown>;
        return {
            integration_id: permission["integration_id"],
            policy_id: permission["policy_id"],
            display_name: permission["display_name"],
            tool_key: permission["tool_key"],
            effect: permission["effect"],
            enabled: permission["enabled"],
        };
    });
    return (
        run["account_id"] === input.account_id &&
        run["run_id"] === input.run_id &&
        run["bot_id"] === input.bot.bot_id &&
        run["prompt"] === input.prompt &&
        bot["account_id"] === input.account_id &&
        bot["bot_id"] === input.bot.bot_id &&
        bot["name"] === input.bot.name &&
        bot["purpose"] === input.bot.purpose &&
        bot["standing_instructions"] === input.bot.standing_instructions &&
        canonical(reducedPermissions) === canonical(input.permissions) &&
        canonical(confirmation["metorial_session_intent"]) === canonical(input.metorial_session_intent)
    );
};

export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);
        if (request.method !== "POST" || url.pathname !== "/v1/runs/execute") {
            return json({ error: "not_found" }, 404);
        }
        const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
        if (declaredLength > MAX_REQUEST_BYTES) return json({ error: "request_too_large" }, 413);
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
            return json({ error: "request_too_large" }, 413);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            return json({ error: "invalid_json" }, 400);
        }
        const input = parseOpenBotExecutionRequestV1(parsed);
        if (input === null) return json({ error: "invalid_execution_request" }, 422);
        if (!(await verifyAuthority(env.CONTROL_DB_FRESH, input))) {
            return json({ error: "execution_authority_mismatch" }, 409);
        }
        const objectId = env.RUN_OBJECT.idFromName(input.run_id);
        const response = await env.RUN_OBJECT.get(objectId).fetch("https://runtime.internal/v1/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        return new Response(response.body, { status: response.status, headers: jsonHeaders });
    },
} satisfies ExportedHandler<OrchestratorBindings>;
