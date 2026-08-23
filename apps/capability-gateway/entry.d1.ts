interface CapabilityGatewayBindings {
    readonly CONTROL_DB_FRESH: D1Database;
}

export default {
    fetch(_request, env): Response {
        void env.CONTROL_DB_FRESH;
        return new Response("Not found", {
            headers: { "Cache-Control": "no-store" },
            status: 404,
        });
    },
} satisfies ExportedHandler<CapabilityGatewayBindings>;
