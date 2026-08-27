import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const appUrl = new URL("../../apps/sandbox-runner/", import.meta.url);

describe("sandbox runner authority boundary", () => {
    it("has no public URL, route, logs, schedule, queue, or vendor binding", async () => {
        const config = await readFile(new URL("wrangler.jsonc", appUrl), "utf8");
        expect(config).toMatch(/"workers_dev": false/u);
        expect(config).toMatch(/"preview_urls": false/u);
        expect(config).toMatch(/"observability": \{ "enabled": false \}/u);
        expect(config).not.toMatch(/"routes?"\s*:/u);
        expect(config).not.toMatch(
            /"(?:d1_databases|r2_buckets|services|vars|secrets|queues|triggers|durable_objects)"\s*:/u
        );
        expect(config).not.toMatch(/METORIAL|OPENROUTER|API_KEY|TOKEN|SECRET/iu);
    });

    it("uses the reviewed dependency allowlist and remains pre-adoption", async () => {
        const manifest = JSON.parse(await readFile(new URL("package.json", appUrl), "utf8")) as {
            readonly dependencies?: Readonly<Record<string, string>>;
        };
        const dependencies = manifest.dependencies ?? {};
        const allowlist = new Set(["@cloudflare/sandbox", "@openbot/sandbox-protocol"]);
        expect(Object.keys(dependencies).filter(name => !allowlist.has(name))).toEqual([]);
        expect(dependencies["@openbot/sandbox-protocol"]).toBe("workspace:*");
        expect(dependencies["@cloudflare/sandbox"]).toBeUndefined();
    });

    it("keeps the pre-adoption shell free of a Sandbox SDK, database, or vendor client", async () => {
        const entrySource = await readFile(new URL("src/entry.ts", appUrl), "utf8");
        const serviceSource = await readFile(new URL("src/services.ts", appUrl), "utf8");
        expect(`${entrySource}\n${serviceSource}`).not.toMatch(/@cloudflare\/sandbox|drizzle|metorial|openrouter/iu);
        expect(serviceSource).not.toMatch(/fetch\s*\(/iu);
    });
});
