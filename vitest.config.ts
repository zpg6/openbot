import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["apps/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "tests/unit/**/*.test.ts"],
        exclude: [...configDefaults.exclude, "packages/*/tests/**/*.e2e.test.ts"],
        passWithNoTests: false,
        restoreMocks: true,
    },
});
