import type { D1ProbeSinkServiceV1 } from "@openbot/d1-probe-rpc";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recordProbeReceiptV1 } from "./src/record.js";

interface Env {
    readonly PROBE_DB: D1Database;
    readonly VERSION_METADATA: { readonly id: string };
}

export class D1ProbeSinkService extends WorkerEntrypoint<Env> implements D1ProbeSinkServiceV1 {
    record(input: unknown) {
        return recordProbeReceiptV1(this.env.PROBE_DB, this.env.VERSION_METADATA.id, input);
    }
}

export default {
    fetch(): Response {
        return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    },
};
