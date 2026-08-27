import {
    parseOpenBotExecutionRequestV1,
    type OpenBotExecutionRequestV1,
    type OpenBotExecutionResultV1,
} from "@openbot/contracts/internal";

interface RuntimeBindings {
    readonly CAPABILITY_GATEWAY: Fetcher;
    readonly OPENROUTER_API_KEY: string;
    readonly OPENROUTER_MODEL?: string | undefined;
}

interface PreparedTool {
    readonly name: string;
    readonly description: string;
    readonly input_schema: Record<string, unknown>;
}

interface PreparedSession {
    readonly session_id: string | null;
    readonly tools: readonly PreparedTool[];
}

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_MODEL_ROUNDS = 8;
const MAX_TOOL_CALLS = 32;
const jsonHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;
const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers: jsonHeaders });
const responseJson = async (response: Response): Promise<unknown> => {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("Internal execution response exceeded its byte limit");
    }
    return JSON.parse(text) as unknown;
};
const digest = async (value: string): Promise<string> => {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const parsePreparedSession = (value: unknown): PreparedSession => {
    if (!isRecord(value) || (value["session_id"] !== null && typeof value["session_id"] !== "string")) {
        throw new Error("Capability gateway returned an invalid session");
    }
    if (!Array.isArray(value["tools"]) || value["tools"].length > 4_096) {
        throw new Error("Capability gateway returned invalid tools");
    }
    const tools = value["tools"].map(tool => {
        if (
            !isRecord(tool) ||
            typeof tool["name"] !== "string" ||
            typeof tool["description"] !== "string" ||
            !isRecord(tool["input_schema"])
        ) {
            throw new Error("Capability gateway returned an invalid tool");
        }
        return { name: tool["name"], description: tool["description"], input_schema: tool["input_schema"] };
    });
    return { session_id: value["session_id"], tools };
};

const prepareSession = async (
    bindings: RuntimeBindings,
    input: OpenBotExecutionRequestV1
): Promise<PreparedSession> => {
    if (input.metorial_session_intent.providers.length === 0) return { session_id: null, tools: [] };
    const response = await bindings.CAPABILITY_GATEWAY.fetch("https://capability.internal/v1/metorial/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Capability session failed with status ${response.status}`);
    return parsePreparedSession(await responseJson(response));
};

const callTool = async (
    bindings: RuntimeBindings,
    input: OpenBotExecutionRequestV1,
    sessionId: string,
    toolName: string,
    toolInput: unknown
): Promise<unknown> => {
    if (!isRecord(toolInput)) throw new Error("Model supplied an invalid tool input");
    const response = await bindings.CAPABILITY_GATEWAY.fetch("https://capability.internal/v1/metorial/tool-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            account_id: input.account_id,
            run_id: input.run_id,
            session_id: sessionId,
            tool_name: toolName,
            input: toolInput,
        }),
    });
    const payload = await responseJson(response);
    if (!response.ok) throw new Error(`Capability call failed with status ${response.status}`);
    return payload;
};

const cleanupSession = async (
    bindings: RuntimeBindings,
    input: OpenBotExecutionRequestV1,
    sessionId: string | null
): Promise<"completed" | "not_required"> => {
    if (sessionId === null) return "not_required";
    const response = await bindings.CAPABILITY_GATEWAY.fetch(
        `https://capability.internal/v1/metorial/sessions/${encodeURIComponent(sessionId)}`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: input.account_id, run_id: input.run_id }),
        }
    );
    if (!response.ok) throw new Error(`Capability cleanup failed with status ${response.status}`);
    return "completed";
};

const executeModelLoop = async (
    bindings: RuntimeBindings,
    input: OpenBotExecutionRequestV1,
    prepared: PreparedSession
): Promise<{ readonly resultText: string; readonly toolCallCount: number }> => {
    if (bindings.OPENROUTER_API_KEY.length < 20) {
        throw new Error("OPENROUTER_API_KEY is not configured");
    }
    const messages: Record<string, unknown>[] = [
        {
            role: "system",
            content: `You are ${input.bot.name}.\nPurpose: ${input.bot.purpose}\nInstructions: ${input.bot.standing_instructions}\nUse only the supplied tools. Report what actually happened and do not claim an action succeeded unless its tool result says so.`,
        },
        { role: "user", content: input.prompt },
    ];
    const tools = prepared.tools.map(tool => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
    }));
    let toolCallCount = 0;
    for (let round = 0; round < MAX_MODEL_ROUNDS; round += 1) {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${bindings.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "X-Title": "OpenBot Runtime",
            },
            body: JSON.stringify({
                model: bindings.OPENROUTER_MODEL ?? "openai/gpt-5-mini",
                temperature: 0,
                messages,
                ...(tools.length === 0 ? {} : { tools, tool_choice: "auto" }),
            }),
        });
        if (!response.ok) throw new Error(`Model request failed with status ${response.status}`);
        const payload = await responseJson(response);
        if (!isRecord(payload) || !Array.isArray(payload["choices"])) throw new Error("Model returned invalid JSON");
        const choice = payload["choices"][0];
        if (!isRecord(choice) || !isRecord(choice["message"])) throw new Error("Model returned no message");
        const message = choice["message"];
        const toolCalls = Array.isArray(message["tool_calls"]) ? message["tool_calls"] : [];
        if (toolCalls.length === 0) {
            if (typeof message["content"] !== "string" || message["content"].trim().length === 0) {
                throw new Error("Model returned an empty result");
            }
            return { resultText: message["content"].trim(), toolCallCount };
        }
        messages.push(message);
        for (const call of toolCalls) {
            toolCallCount += 1;
            if (toolCallCount > MAX_TOOL_CALLS || !isRecord(call) || typeof call["id"] !== "string") {
                throw new Error("Model exceeded the tool-call limit");
            }
            const fn = call["function"];
            if (!isRecord(fn) || typeof fn["name"] !== "string" || typeof fn["arguments"] !== "string") {
                throw new Error("Model returned an invalid tool call");
            }
            let args: unknown;
            try {
                args = JSON.parse(fn["arguments"]);
            } catch {
                throw new Error("Model returned invalid tool arguments");
            }
            if (prepared.session_id === null) throw new Error("Model requested a tool without a session");
            const result = await callTool(bindings, input, prepared.session_id, fn["name"], args);
            messages.push({ role: "tool", tool_call_id: call["id"], content: JSON.stringify(result) });
        }
    }
    throw new Error("Model exceeded the execution round limit");
};

export class RunObject implements DurableObject {
    readonly #state: DurableObjectState;
    readonly #bindings: RuntimeBindings;

    constructor(state: DurableObjectState, bindings: RuntimeBindings) {
        this.#state = state;
        this.#bindings = bindings;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method !== "POST" || url.pathname !== "/v1/execute") return json({ error: "not_found" }, 404);
        let parsed: unknown;
        try {
            parsed = await request.json();
        } catch {
            return json({ error: "invalid_json" }, 400);
        }
        const input = parseOpenBotExecutionRequestV1(parsed);
        if (input === null) return json({ error: "invalid_execution_request" }, 422);
        const serialized = JSON.stringify(input);
        const requestDigest = await digest(serialized);
        const existingDigest = await this.#state.storage.get<string>("request_digest");
        const existingResult = await this.#state.storage.get<OpenBotExecutionResultV1>("result");
        const existingFailure = await this.#state.storage.get<boolean>("failed");
        if (existingDigest !== undefined && existingDigest !== requestDigest) {
            return json({ error: "run_request_conflict" }, 409);
        }
        if (existingResult !== undefined) return json(existingResult);
        if (existingFailure === true) return json({ error: "execution_failed" }, 502);
        if (existingDigest !== undefined) return json({ error: "run_in_progress" }, 409);
        await this.#state.storage.put("request_digest", requestDigest);
        let prepared: PreparedSession | null = null;
        try {
            prepared = await prepareSession(this.#bindings, input);
            const execution = await executeModelLoop(this.#bindings, input, prepared);
            const cleanupState = await cleanupSession(this.#bindings, input, prepared.session_id);
            const result: OpenBotExecutionResultV1 = {
                result_text: execution.resultText,
                metorial_tool_call_count: execution.toolCallCount,
                cleanup_state: cleanupState,
            };
            await this.#state.storage.put("result", result);
            return json(result);
        } catch (error) {
            if (prepared !== null) {
                try {
                    await cleanupSession(this.#bindings, input, prepared.session_id);
                } catch {
                    // The capability gateway records cleanup state for retry and audit.
                }
            }
            await this.#state.storage.put("failed", true);
            console.error("run execution failed", error instanceof Error ? error.name : "UnknownError");
            return json({ error: "execution_failed" }, 502);
        }
    }
}
