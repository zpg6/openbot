import type {
    D1ProbeGatewayReservationResponseV1,
    D1ProbeGatewayTrialResponseV1,
    D1ProbeReceiptResponseV1,
    D1ProbeSinkServiceV1,
    D1ProbeWriterRoleV1,
} from "@openbot/d1-probe-rpc";
import { WorkerEntrypoint } from "cloudflare:workers";

import { forwardProbeReceiptV1 } from "./forward.js";
import { reserveAndDispatchGatewayProbeV1 } from "./gateway.js";
import { runGatewayTrialV1 } from "./trigger.js";

interface Env {
    readonly PROBE_DB: D1Database;
    readonly PROBE_SINK: D1ProbeSinkServiceV1;
    readonly VERSION_METADATA: { readonly id: string };
}

abstract class D1ProbeWriterService extends WorkerEntrypoint<Env> {
    protected abstract readonly role: D1ProbeWriterRoleV1;

    recordReceipt(input: unknown): Promise<D1ProbeReceiptResponseV1> {
        return forwardProbeReceiptV1(this.env.PROBE_SINK, this.role, input);
    }

    reserveGateway(input: unknown): Promise<D1ProbeGatewayReservationResponseV1> {
        return reserveAndDispatchGatewayProbeV1(this.env.PROBE_DB, this.env.PROBE_SINK, this.role, input);
    }

    runGatewayTrial(input: unknown): Promise<D1ProbeGatewayTrialResponseV1> {
        return runGatewayTrialV1(this.env.PROBE_DB, this.env.PROBE_SINK, this.role, input);
    }
}

export class D1ProbeWriterAService extends D1ProbeWriterService {
    protected readonly role = "writer_a" as const;
}

export class D1ProbeWriterBService extends D1ProbeWriterService {
    protected readonly role = "writer_b" as const;
}

export default {
    fetch(): Response {
        return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    },
};
