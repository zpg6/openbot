import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "tests/unit/**/*.test.ts"],
        exclude: [...configDefaults.exclude, "packages/**/*.e2e.test.ts"],
        passWithNoTests: false,
        restoreMocks: true,
    },
});
