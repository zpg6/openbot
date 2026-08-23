import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createControlPlane } from "../../apps/control-plane/src/app.ts";
import { coreRoutes, routeKey } from "../../apps/control-plane/src/routes.ts";

const fixtureUrl = new URL("../../apps/control-plane/fixtures/core-routes.json", import.meta.url);
const artifactDenyUrl = new URL("../../apps/control-plane/fixtures/artifact-prefix-deny.json", import.meta.url);

interface RouteFixture {
    readonly routes: ReadonlyArray<{
        readonly category: string;
        readonly method: string;
        readonly path: string;
    }>;
}

interface ArtifactDenyFixture {
    readonly denied_fragments: readonly string[];
    readonly denied_prefixes: readonly string[];
}

describe("control-plane route inventory", () => {
    it("matches the committed core route fixture", async () => {
        const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as RouteFixture;

        expect(coreRoutes).toEqual(fixture.routes);
        expect(new Set(coreRoutes.map(routeKey)).size).toBe(coreRoutes.length);
    });

    it("does not register deferred artifact routes", async () => {
        const fixture = JSON.parse(await readFile(artifactDenyUrl, "utf8")) as ArtifactDenyFixture;

        for (const route of coreRoutes) {
            expect(
                fixture.denied_prefixes.some(prefix => route.path.startsWith(prefix)),
                routeKey(route)
            ).toBe(false);
            expect(
                fixture.denied_fragments.some(fragment => route.path.includes(fragment)),
                routeKey(route)
            ).toBe(false);
        }
    });

    it("keeps planned routes unreachable until their handlers exist", async () => {
        const app = createControlPlane();

        for (const route of coreRoutes) {
            const response = await app.request(`https://openbot.invalid${route.path}`, {
                method: route.method,
            });
            expect(response.status, routeKey(route)).toBe(404);
        }
    });

    it("keeps the Drizzle client inside the D1 package", async () => {
        const source = await readFile(new URL("../../packages/db-d1/src/index.ts", import.meta.url), "utf8");

        expect(source).not.toMatch(/export\s+(?:type|const|class|function)\s+.*(?:drizzle|D1DatabaseClient)/iu);
    });
});

describe("Worker exposure defaults", () => {
    const workerNames = ["capability-gateway", "control-plane", "orchestrator", "runtime"] as const;

    for (const worker of workerNames) {
        it(`${worker} disables platform URLs and logs`, async () => {
            const config = await readFile(new URL(`../../apps/${worker}/wrangler.d1.jsonc`, import.meta.url), "utf8");

            expect(config).toMatch(/"workers_dev": false/u);
            expect(config).toMatch(/"preview_urls": false/u);
            expect(config).toMatch(/"observability": \{ "enabled": false \}/u);
            expect(config).not.toMatch(/"routes?":/u);
            expect(config).not.toMatch(/"queues":|"triggers":/u);
        });
    }

    it("keeps the runtime free of the control database", async () => {
        const config = await readFile(new URL("../../apps/runtime/wrangler.d1.jsonc", import.meta.url), "utf8");

        expect(config).toContain('"binding": "CAPABILITY_GATEWAY"');
        expect(config).not.toContain("CONTROL_DB_FRESH");
        expect(config).not.toContain("d1_databases");
    });
});
