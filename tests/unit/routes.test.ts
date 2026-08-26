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
    const implementedProductProofRoutes = new Set([
        "GET /",
        "GET /login",
        "GET /bots",
        "GET /bots/new",
        "GET /bots/:botId",
        "GET /bots/:botId/runs/:runId",
        "GET /run-confirmations/:confirmationId",
        "POST /actions/bots",
        "POST /actions/run-confirmations",
        "POST /actions/runs",
    ]);

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

    it("keeps unimplemented planned routes unreachable", async () => {
        const app = createControlPlane();

        for (const route of coreRoutes) {
            if (implementedProductProofRoutes.has(routeKey(route))) continue;
            const response = await app.request(`https://openbot.invalid${route.path}`, {
                method: route.method,
            });
            expect(response.status, routeKey(route)).toBe(404);
        }
    });

    it("registers the signed-out product proof without exposing product data", async () => {
        const app = createControlPlane();
        const root = await app.request("https://openbot.invalid/");
        const login = await app.request("https://openbot.invalid/login");
        const bots = await app.request("https://openbot.invalid/bots");
        const create = await app.request("https://openbot.invalid/actions/bots", { method: "POST" });

        expect(root.status).toBe(302);
        expect(root.headers.get("location")).toBe("/login");
        expect(login.status).toBe(200);
        expect(bots.status).toBe(302);
        expect(create.status).toBe(503);
        expect(login.headers.get("content-security-policy")).toContain("default-src 'none'");
    });

    it("keeps the Drizzle client inside the D1 package", async () => {
        const source = await readFile(new URL("../../packages/db-d1/src/index.ts", import.meta.url), "utf8");

        expect(source).not.toMatch(/export\s+(?:type|const|class|function)\s+.*(?:drizzle|D1DatabaseClient)/iu);
    });
});

describe("Worker exposure defaults", () => {
    const workerConfigs = {
        "capability-gateway": "wrangler.d1.jsonc",
        "control-plane": "wrangler.d1.jsonc",
        orchestrator: "wrangler.d1.jsonc",
        runtime: "wrangler.d1.jsonc",
        "sandbox-runner": "wrangler.jsonc",
    } as const;

    for (const [worker, configFile] of Object.entries(workerConfigs)) {
        it(`${worker} disables platform URLs and logs`, async () => {
            const config = await readFile(new URL(`../../apps/${worker}/${configFile}`, import.meta.url), "utf8");

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

    it("gives execute and lifecycle callers disjoint Sandbox runner entrypoints", async () => {
        const gateway = await readFile(
            new URL("../../apps/capability-gateway/wrangler.d1.jsonc", import.meta.url),
            "utf8"
        );
        const orchestrator = await readFile(
            new URL("../../apps/orchestrator/wrangler.d1.jsonc", import.meta.url),
            "utf8"
        );
        const runtime = await readFile(new URL("../../apps/runtime/wrangler.d1.jsonc", import.meta.url), "utf8");

        expect(gateway).toContain('"binding": "SANDBOX_EXECUTION"');
        expect(gateway).toContain('"entrypoint": "SandboxExecutionService"');
        expect(gateway).not.toContain("SandboxLifecycleService");
        expect(gateway).not.toContain("SANDBOX_LIFECYCLE");

        expect(orchestrator).toContain('"binding": "SANDBOX_LIFECYCLE"');
        expect(orchestrator).toContain('"entrypoint": "SandboxLifecycleService"');
        expect(orchestrator).not.toContain("SandboxExecutionService");
        expect(orchestrator).not.toContain("SANDBOX_EXECUTION");

        expect(runtime).not.toContain("SandboxExecutionService");
        expect(runtime).not.toContain("SandboxLifecycleService");
    });
});
