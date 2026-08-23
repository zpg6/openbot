export { RunObject } from "./src/run-object.ts";

export default {
    fetch(): Response {
        return new Response("Not found", {
            headers: { "Cache-Control": "no-store" },
            status: 404,
        });
    },
} satisfies ExportedHandler;
