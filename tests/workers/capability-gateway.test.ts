import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("capability gateway shell", () => {
    it("rejects every path at the handler", async () => {
        const workerExports = exports as unknown as {
            readonly default: { fetch(request: Request): Response | Promise<Response> };
        };
        const response = await workerExports.default.fetch(
            new Request("https://internal.invalid/v1/tool", { method: "POST" })
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
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
