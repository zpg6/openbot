import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    out: "./packages/db-d1/migrations",
    schema: "./packages/db-d1/src/schema.ts",
});
