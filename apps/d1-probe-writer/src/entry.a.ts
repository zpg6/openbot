import type {
    D1ProbeGatewayReservationResponseV1,
    D1ProbeGatewayTrialResponseV1,
    D1ProbeReceiptResponseV1,
    D1ProbeSinkServiceV1,
} from "@openbot/d1-probe-rpc";
import { WorkerEntrypoint } from "cloudflare:workers";

import { forwardProbeReceiptV1 } from "./forward.js";
import { reserveAndDispatchGatewayProbeV1 } from "./gateway.js";
import { createD1ProbeWriterHttpHandlerV1 } from "./http.js";
import { runGatewayTrialV1 } from "./trigger.js";

declare const __OPENBOT_D1_PROBE_WRITER_HTTP_CONFIG_V1__: unknown;

interface Env {
    readonly PROBE_DB: D1Database;
    readonly PROBE_SINK: D1ProbeSinkServiceV1;
    readonly VERSION_METADATA: WorkerVersionMetadata;
}

export class D1ProbeWriterAService extends WorkerEntrypoint<Env> {
    recordReceipt(input: unknown): Promise<D1ProbeReceiptResponseV1> {
        return forwardProbeReceiptV1(this.env.PROBE_SINK, "writer_a", input);
    }

    reserveGateway(input: unknown): Promise<D1ProbeGatewayReservationResponseV1> {
        return reserveAndDispatchGatewayProbeV1(this.env.PROBE_DB, this.env.PROBE_SINK, "writer_a", input);
    }

    runGatewayTrial(input: unknown): Promise<D1ProbeGatewayTrialResponseV1> {
        return runGatewayTrialV1(this.env.PROBE_DB, this.env.PROBE_SINK, "writer_a", input);
    }
}

export default {
    fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
        return createD1ProbeWriterHttpHandlerV1(
            __OPENBOT_D1_PROBE_WRITER_HTTP_CONFIG_V1__,
            { runGatewayTrial: input => runGatewayTrialV1(env.PROBE_DB, env.PROBE_SINK, "writer_a", input) },
            env.VERSION_METADATA
        )(request, context.access);
    },
};
