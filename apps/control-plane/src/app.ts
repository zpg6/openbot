import { checkD1Readiness } from "@openbot/db-d1";
import { Hono } from "hono";

import { registerProductProofRoutesV1, type ControlPlaneProductProofDependenciesV1 } from "./product-proof.js";

export interface ControlPlaneBindings {
    readonly CONTROL_DB_FRESH: D1Database;
    readonly ORCHESTRATOR: Fetcher;
    readonly CAPABILITY_GATEWAY: Fetcher;
    readonly ASSETS: Fetcher;
}

export interface ControlPlaneRuntimeV1 {
    readonly authHandler?: ((request: Request) => Promise<Response>) | undefined;
}

export function createControlPlane(
    productProofDependencies?: ControlPlaneProductProofDependenciesV1,
    runtime: ControlPlaneRuntimeV1 = {}
): Hono<{ Bindings: ControlPlaneBindings }> {
    const app = new Hono<{ Bindings: ControlPlaneBindings }>();

    app.use("*", async (context, next) => {
        await next();
        context.header("Cache-Control", "no-store");
        context.header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; connect-src 'self'; img-src data: https://provider-logos.metorial-cdn.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        );
        context.header("Referrer-Policy", "same-origin");
        context.header("X-Content-Type-Options", "nosniff");
        context.header("X-Frame-Options", "DENY");
    });

    app.get("/assets/*", context => context.env.ASSETS.fetch(context.req.raw));

    app.on(["GET", "POST"], ["/api/auth/*"], async context => {
        if (runtime.authHandler === undefined) return context.text("Authentication unavailable", 503);
        return await runtime.authHandler(context.req.raw);
    });

    app.get("/healthz", async context => {
        await checkD1Readiness(context.env.CONTROL_DB_FRESH);
        return context.json({ profile: "d1", status: "ok" as const });
    });

    registerProductProofRoutesV1(app, productProofDependencies);

    return app;
}
