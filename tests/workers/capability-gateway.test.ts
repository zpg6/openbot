import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("capability gateway Worker", () => {
    it("exposes only the versioned Metorial routes and validates every body before external work", async () => {
        const workerExports = exports as unknown as {
            readonly default: { fetch(request: Request): Response | Promise<Response> };
        };
        const request = (path: string, method = "POST") =>
            workerExports.default.fetch(
                new Request(`https://internal.invalid${path}`, {
                    method,
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({}),
                })
            );

        const responses = await Promise.all([
            request("/v1/metorial/sessions"),
            request("/v1/metorial/tool-calls"),
            request("/v1/metorial/connections"),
            request("/v1/metorial/connections/complete"),
            request("/v1/metorial/sessions/session_test", "DELETE"),
        ]);
        expect(responses.map(response => response.status)).toEqual([422, 422, 422, 422, 422]);
        expect(await Promise.all(responses.map(response => response.json()))).toEqual([
            { error: "invalid_execution_request" },
            { error: "invalid_tool_call" },
            { error: "invalid_connection_request" },
            { error: "invalid_connection_completion" },
            { error: "invalid_cleanup_request" },
        ]);

        const unknown = await request("/v1/tool");
        expect(unknown.status).toBe(404);
        expect(unknown.headers.get("cache-control")).toBe("no-store");
        await expect(unknown.json()).resolves.toEqual({ error: "not_found" });
    });

    it("binds only the Sandbox execution entrypoint", async () => {
        const bindings = env as unknown as {
            SANDBOX_EXECUTION: {
                execute(): Promise<string>;
            };
        };
        const execution = bindings.SANDBOX_EXECUTION;

        await expect(execution.execute()).resolves.toBe("execution-only");
    });
});
