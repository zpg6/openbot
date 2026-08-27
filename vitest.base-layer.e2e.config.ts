import { defineConfig } from "vitest/config";

export default defineConfig({
    root: import.meta.dirname,
    test: {
        include: ["packages/d1-probe-operator/tests/cloudflare-worker-canary-base.e2e.test.ts"],
        fileParallelism: false,
        maxWorkers: 1,
        passWithNoTests: false,
        restoreMocks: true,
    },
});
