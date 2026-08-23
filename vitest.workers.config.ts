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
    },
});
