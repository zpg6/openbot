import { cloudflareTest } from "@cloudflare/vitest-plugin";
import path from "node:path";
import { defineConfig } from "vitest/config";

process.env["WRANGLER_LOG_PATH"] ??= path.resolve(".wrangler/logs/vitest.log");

export default defineConfig({
    plugins: [
        cloudflareTest({
            miniflare: {
                d1Databases: {
                    CONTROL_DB_FRESH: "openbot-test-control",
                },
                workers: [
                    {
                        name: "openbot-sandbox-runner-preview",
                        compatibilityDate: "2026-08-22",
                        modules: [
                            {
                                type: "ESModule",
                                path: "sandbox-runner-test-double.mjs",
                                contents: `
                                    import { WorkerEntrypoint } from "cloudflare:workers";
                                    export class SandboxExecutionService extends WorkerEntrypoint {
                                        execute() { return "execution-only"; }
                                    }
                                    export default { fetch() { return new Response("Not found", { status: 404 }); } };
                                `,
                            },
                        ],
                    },
                ],
            },
            wrangler: {
                configPath: "./apps/capability-gateway/wrangler.d1.jsonc",
                environment: "preview",
            },
        }),
    ],
    test: {
        include: ["tests/workers/**/*.test.ts"],
        passWithNoTests: false,
        restoreMocks: true,
        testTimeout: 30_000,
    },
});
