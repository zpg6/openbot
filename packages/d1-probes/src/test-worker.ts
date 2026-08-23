import { WorkerEntrypoint } from "cloudflare:workers";

import {
    initializeDisposableD1ProbeTablesV1,
    readAuditStateV1,
    readCapacityStateV1,
    readGatewayStateV1,
    readGuardedCreateStateV1,
    resetDisposableD1ProbeTablesV1,
    runAuditAppendV1,
    runGatewayReservationV1,
    runGrantRevocationV1,
    runGuardedCreateV1,
    runSandboxCapacityReleaseV1,
    runSandboxCapacityReservationV1,
    runSandboxDestroyObservationV1,
    seedAuditScenarioV1,
    seedCapacityScenarioV1,
    seedGatewayScenarioV1,
    seedGuardedCreateScenarioV1,
} from "./protocol.ts";

interface Env {
    readonly PROBE_DB: D1Database;
}

function withWriter(input: unknown, writer: "writer_a" | "writer_b"): unknown {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
    return { ...input, writer };
}

abstract class D1ProbeWriter extends WorkerEntrypoint<Env> {
    protected abstract readonly writer: "writer_a" | "writer_b";

    initialize(): Promise<void> {
        return initializeDisposableD1ProbeTablesV1(this.env.PROBE_DB);
    }

    reset(): Promise<void> {
        return resetDisposableD1ProbeTablesV1(this.env.PROBE_DB);
    }

    seedGuardedCreate(input: unknown): Promise<void> {
        return seedGuardedCreateScenarioV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    guardedCreate(input: unknown) {
        return runGuardedCreateV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    revoke(scenario: unknown) {
        return runGrantRevocationV1(this.env.PROBE_DB, scenario, this.writer);
    }

    guardedCreateState(scenario: unknown) {
        return readGuardedCreateStateV1(this.env.PROBE_DB, scenario);
    }

    seedGateway(scenario: unknown): Promise<void> {
        return seedGatewayScenarioV1(this.env.PROBE_DB, scenario);
    }

    reserveGateway(input: unknown) {
        return runGatewayReservationV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    gatewayState(scenario: unknown, callKind: unknown) {
        return readGatewayStateV1(this.env.PROBE_DB, scenario, callKind);
    }

    seedCapacity(scenario: unknown): Promise<void> {
        return seedCapacityScenarioV1(this.env.PROBE_DB, scenario);
    }

    reserveCapacity(input: unknown) {
        return runSandboxCapacityReservationV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    observeDestroy(input: unknown) {
        return runSandboxDestroyObservationV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    releaseCapacity(input: unknown) {
        return runSandboxCapacityReleaseV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    capacityState(scenario: unknown) {
        return readCapacityStateV1(this.env.PROBE_DB, scenario);
    }

    seedAudit(scenario: unknown, genesisHash: unknown): Promise<void> {
        return seedAuditScenarioV1(this.env.PROBE_DB, scenario, genesisHash);
    }

    appendAudit(input: unknown) {
        return runAuditAppendV1(this.env.PROBE_DB, withWriter(input, this.writer));
    }

    auditState(scenario: unknown) {
        return readAuditStateV1(this.env.PROBE_DB, scenario);
    }
}

export class D1ProbeWriterA extends D1ProbeWriter {
    protected readonly writer = "writer_a" as const;
}

export class D1ProbeWriterB extends D1ProbeWriter {
    protected readonly writer = "writer_b" as const;
}

export default {
    fetch(): Response {
        return new Response("Not found", {
            status: 404,
            headers: { "cache-control": "no-store" },
        });
    },
};
