import { createD1ReadinessRepository } from "@openbot/db-d1";
import { Hono } from "hono";

import { registerProductProofRoutesV1, type ControlPlaneProductProofDependenciesV1 } from "./product-proof.js";

export interface ControlPlaneBindings {
    readonly CONTROL_DB_FRESH: D1Database;
    readonly ORCHESTRATOR: Fetcher;
}

export function createControlPlane(
    productProofDependencies?: ControlPlaneProductProofDependenciesV1
): Hono<{ Bindings: ControlPlaneBindings }> {
    const app = new Hono<{ Bindings: ControlPlaneBindings }>();

    app.use("*", async (context, next) => {
        await next();
        context.header("Cache-Control", "no-store");
        context.header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        );
        context.header("Referrer-Policy", "same-origin");
        context.header("X-Content-Type-Options", "nosniff");
        context.header("X-Frame-Options", "DENY");
    });

    app.get("/healthz", async context => {
        const readiness = createD1ReadinessRepository(context.env.CONTROL_DB_FRESH);
        await readiness.check();
        return context.json({ profile: "d1", status: "ok" as const });
    });

    registerProductProofRoutesV1(app, productProofDependencies);

    return app;
}
