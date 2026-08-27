import { cloudflareTest } from "@cloudflare/vitest-plugin";
import path from "node:path";
import { defineConfig } from "vitest/config";

process.env["WRANGLER_LOG_PATH"] ??= path.resolve("../../.wrangler/logs/d1-probes-vitest.log");

export default defineConfig({
    root: import.meta.dirname,
    plugins: [
        cloudflareTest({
            miniflare: {
                d1Databases: {
                    PROBE_DB: "openbot-disposable-probe-test",
                },
            },
            wrangler: {
                configPath: path.resolve(import.meta.dirname, "wrangler.test.jsonc"),
            },
        }),
    ],
    test: {
        include: ["tests/**/*.worker.spec.ts"],
        passWithNoTests: false,
        restoreMocks: true,
        sequence: { concurrent: false },
    },
});
