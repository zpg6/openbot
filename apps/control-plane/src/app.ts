import { createD1ReadinessRepository } from "@openbot/db-d1";
import { Hono } from "hono";

export interface ControlPlaneBindings {
    readonly CONTROL_DB_FRESH: D1Database;
    readonly ORCHESTRATOR: Fetcher;
}

export function createControlPlane(): Hono<{ Bindings: ControlPlaneBindings }> {
    const app = new Hono<{ Bindings: ControlPlaneBindings }>();

    app.get("/healthz", async context => {
        const readiness = createD1ReadinessRepository(context.env.CONTROL_DB_FRESH);
        await readiness.check();
        return context.json({ profile: "d1", status: "ok" as const });
    });

    return app;
}
