import { cloudflareTest } from "@cloudflare/vitest-plugin";
import path from "node:path";
import { defineConfig } from "vitest/config";

process.env["WRANGLER_LOG_PATH"] ??= path.resolve(".wrangler/logs/vitest-sandbox.log");

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {
                configPath: "./apps/sandbox-runner/wrangler.jsonc",
                environment: "preview",
            },
        }),
    ],
    test: {
        include: ["tests/sandbox-workers/**/*.test.ts"],
        passWithNoTests: false,
        restoreMocks: true,
    },
});
