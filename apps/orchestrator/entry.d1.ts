interface OrchestratorBindings {
    readonly CONTROL_DB_FRESH: D1Database;
    readonly RUN_OBJECT: DurableObjectNamespace;
}

export default {
    fetch(_request, env): Response {
        void env.CONTROL_DB_FRESH;
        void env.RUN_OBJECT;
        return new Response("Not found", {
            headers: { "Cache-Control": "no-store" },
            status: 404,
        });
    },
} satisfies ExportedHandler<OrchestratorBindings>;
