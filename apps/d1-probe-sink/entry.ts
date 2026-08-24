import type { D1ProbeSinkServiceV1 } from "@openbot/d1-probe-rpc";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recordProbeReceiptV1 } from "./src/record.js";
import { createD1ProbeSinkReadbackHttpHandlerV1 } from "./src/readback.js";

declare const __OPENBOT_D1_PROBE_SINK_HTTP_CONFIG_V1__: unknown;

interface Env {
    readonly PROBE_DB: D1Database;
    readonly VERSION_METADATA: WorkerVersionMetadata;
}

export class D1ProbeSinkService extends WorkerEntrypoint<Env> implements D1ProbeSinkServiceV1 {
    record(input: unknown) {
        return recordProbeReceiptV1(this.env.PROBE_DB, this.env.VERSION_METADATA.id, input);
    }
}

export default {
    fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
        return createD1ProbeSinkReadbackHttpHandlerV1(
            __OPENBOT_D1_PROBE_SINK_HTTP_CONFIG_V1__,
            env.PROBE_DB,
            env.VERSION_METADATA
        )(request, context.access);
    },
};
