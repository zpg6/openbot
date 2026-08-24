import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
    D1_PROBE_RUNTIME_VERSION_HEADER_V1,
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeGatewayTrialResponseV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "../../packages/d1-probe-rpc/src/index.js";

interface GatewayTrialService {
    runGatewayTrial(input: unknown): Promise<D1ProbeGatewayTrialResponseV1>;
}

const workerExports = exports as unknown as {
    D1ProbeWriterAService: GatewayTrialService;
    D1ProbeWriterBService?: GatewayTrialService;
    default: Fetcher;
};
const probeEnv = env as unknown as {
    PROBE_DB: D1Database;
    WRITER_B: GatewayTrialService;
    WRITER_B_FETCH: Fetcher;
    WRITER_B_HAS_WRITER_A_EXPORT: boolean;
};
const hex = (character: string): string => character.repeat(64);

const ddl = [
    `CREATE TABLE _openbot_probe_external_sink_receipt (
        receipt_id TEXT PRIMARY KEY, probe_run_id TEXT NOT NULL, writer_role TEXT NOT NULL,
        receipt_kind TEXT NOT NULL, source_request_digest TEXT NOT NULL, receipt_request_digest TEXT NOT NULL
    )`,
    `CREATE TABLE _openbot_probe_external_trial (
        probe_run_id TEXT NOT NULL, trial_id TEXT NOT NULL, trial_kind TEXT NOT NULL,
        state TEXT NOT NULL, expected_contender_count INTEGER NOT NULL, PRIMARY KEY (probe_run_id, trial_id)
    )`,
    `CREATE TABLE _openbot_probe_external_trial_assignment (
        probe_run_id TEXT NOT NULL, trial_id TEXT NOT NULL, child_process_id TEXT NOT NULL,
        writer_role TEXT NOT NULL, go_receipt_digest TEXT NOT NULL, operation_request_digest TEXT NOT NULL,
        PRIMARY KEY (probe_run_id, trial_id, child_process_id),
        UNIQUE (probe_run_id, trial_id, child_process_id, writer_role, go_receipt_digest, operation_request_digest),
        UNIQUE (probe_run_id, trial_id, go_receipt_digest),
        UNIQUE (probe_run_id, trial_id, operation_request_digest),
        FOREIGN KEY (probe_run_id, trial_id) REFERENCES _openbot_probe_external_trial(probe_run_id, trial_id)
    )`,
    `CREATE TABLE _openbot_probe_external_trial_readiness (
        probe_run_id TEXT NOT NULL, trial_id TEXT NOT NULL, child_process_id TEXT NOT NULL,
        writer_role TEXT NOT NULL, go_receipt_digest TEXT NOT NULL, operation_request_digest TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
        PRIMARY KEY (probe_run_id, trial_id, child_process_id),
        FOREIGN KEY (probe_run_id, trial_id, child_process_id, writer_role, go_receipt_digest, operation_request_digest)
            REFERENCES _openbot_probe_external_trial_assignment(
                probe_run_id, trial_id, child_process_id, writer_role, go_receipt_digest, operation_request_digest
            )
    )`,
    `CREATE TABLE _openbot_probe_external_trial_readiness_guard (
        request_id TEXT PRIMARY KEY REFERENCES _openbot_probe_external_trial_readiness(request_id)
    )`,
    `CREATE TABLE _openbot_probe_external_gateway_budget (
        probe_run_id TEXT NOT NULL, scenario TEXT NOT NULL, call_kind TEXT NOT NULL, remaining INTEGER NOT NULL,
        PRIMARY KEY (probe_run_id, scenario, call_kind)
    )`,
    `CREATE TABLE _openbot_probe_external_gateway_reservation (
        probe_run_id TEXT NOT NULL, scenario TEXT NOT NULL, call_kind TEXT NOT NULL, call_sequence INTEGER NOT NULL,
        request_id TEXT NOT NULL UNIQUE, writer_role TEXT NOT NULL, request_variant TEXT NOT NULL, fault_point TEXT NOT NULL,
        logical_call_id TEXT NOT NULL, attempt_id TEXT NOT NULL UNIQUE, reservation_id TEXT NOT NULL UNIQUE,
        dispatch_request_digest TEXT NOT NULL, request_digest TEXT NOT NULL,
        PRIMARY KEY (probe_run_id, scenario, call_kind, call_sequence),
        UNIQUE (probe_run_id, call_kind, logical_call_id),
        FOREIGN KEY (probe_run_id, scenario, call_kind)
            REFERENCES _openbot_probe_external_gateway_budget(probe_run_id, scenario, call_kind)
    )`,
    `CREATE TABLE _openbot_probe_external_gateway_guard (
        reservation_id TEXT PRIMARY KEY REFERENCES _openbot_probe_external_gateway_reservation(reservation_id)
    )`,
] as const;

const trialRequest = async (
    writerRole: "writer_a" | "writer_b",
    childIndex: 1 | 2
): Promise<D1ProbeGatewayTrialRequestV1> => {
    const unsignedGateway: UnsignedD1ProbeGatewayReservationRequestV1 = {
        schema_version: 1,
        operation: "reserve_gateway_call_v1",
        request_id: `gateway_request_000${childIndex}`,
        probe_run_id: "probe_run_0000001",
        scenario: "gateway_trial_0001",
        writer_role: writerRole,
        request_variant: "exact",
        call_kind: "model",
        logical_call_id: "logical_call_0001",
        attempt_id: "attempt_00000001",
        call_sequence: 1,
        reservation_id: "reservation_0001",
        dispatch_request_digest: hex("3"),
        fault_point: "none",
    };
    const gatewayRequest: D1ProbeGatewayReservationRequestV1 = {
        ...unsignedGateway,
        request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(unsignedGateway),
    };
    const unsignedTrial: UnsignedD1ProbeGatewayTrialRequestV1 = {
        schema_version: 1,
        operation: "run_gateway_trial_v1",
        request_id: `trial_request_000${childIndex}`,
        probe_run_id: "probe_run_0000001",
        trial_id: "gateway_trial_0001",
        child_process_id: `child_process_000${childIndex}`,
        writer_role: writerRole,
        expected_contender_count: 2,
        go_receipt_digest: hex(childIndex === 1 ? "4" : "5"),
        barrier_timeout_ms: 2_000,
        barrier_poll_interval_ms: 25,
        gateway_request: gatewayRequest,
    };
    return { ...unsignedTrial, request_digest: await computeD1ProbeGatewayTrialRequestDigestV1(unsignedTrial) };
};

beforeAll(async () => {
    await probeEnv.PROBE_DB.exec("PRAGMA foreign_keys = ON");
    for (const statement of ddl) await probeEnv.PROBE_DB.exec(statement.replace(/\s+/gu, " "));
});

describe("local Workerd D1 gateway trial", () => {
    it("keeps the role-specific module exports disjoint", async () => {
        expect(workerExports.D1ProbeWriterAService).toBeDefined();
        expect(workerExports.D1ProbeWriterBService).toBeUndefined();
        expect(probeEnv.WRITER_B_HAS_WRITER_A_EXPORT).toBe(false);
        await expect(probeEnv.WRITER_B.runGatewayTrial({})).resolves.toMatchObject({ writer_role: "writer_b" });
    });

    it("denies unauthenticated default fetches without exposing runtime metadata", async () => {
        for (const [fetcher, url] of [
            [workerExports.default, "https://probe.example.test/_openbot-d1-probe/writer-a/run-000000000001"],
            [probeEnv.WRITER_B_FETCH, "https://probe.example.test/_openbot-d1-probe/writer-b/run-000000000001"],
        ] as const) {
            const response = await fetcher.fetch(
                new Request(url, {
                    method: "POST",
                    headers: { "content-length": "2", "content-type": "application/json" },
                    body: "{}",
                })
            );
            expect(response.status).toBe(403);
            expect(response.headers.get(D1_PROBE_RUNTIME_VERSION_HEADER_V1)).toBeNull();
            expect(await response.json()).toMatchObject({ code: "access_required" });
        }
    });

    it("records two role-pinned readiness rows but stops on missing deployed-primary metadata", async () => {
        const requestA = await trialRequest("writer_a", 1);
        const requestB = await trialRequest("writer_b", 2);
        await probeEnv.PROBE_DB.batch([
            probeEnv.PROBE_DB.prepare(
                "INSERT INTO _openbot_probe_external_trial (probe_run_id, trial_id, trial_kind, state, expected_contender_count) VALUES (?, ?, 'gateway_reservation', 'open', 2)"
            ).bind(requestA.probe_run_id, requestA.trial_id),
            probeEnv.PROBE_DB.prepare(
                "INSERT INTO _openbot_probe_external_gateway_budget (probe_run_id, scenario, call_kind, remaining) VALUES (?, ?, 'model', 1)"
            ).bind(requestA.probe_run_id, requestA.trial_id),
            ...[requestA, requestB].map(request =>
                probeEnv.PROBE_DB.prepare(
                    "INSERT INTO _openbot_probe_external_trial_assignment (probe_run_id, trial_id, child_process_id, writer_role, go_receipt_digest, operation_request_digest) VALUES (?, ?, ?, ?, ?, ?)"
                ).bind(
                    request.probe_run_id,
                    request.trial_id,
                    request.child_process_id,
                    request.writer_role,
                    request.go_receipt_digest,
                    request.gateway_request.request_digest
                )
            ),
        ]);
        const responses = await Promise.all([
            workerExports.D1ProbeWriterAService.runGatewayTrial(requestA),
            probeEnv.WRITER_B.runGatewayTrial(requestB),
        ]);
        expect(responses).toMatchObject([
            { status: "outcome_unknown", error_code: "readiness_d1_unknown" },
            { status: "outcome_unknown", error_code: "readiness_d1_unknown" },
        ]);
        const readback = await probeEnv.PROBE_DB.withSession("first-primary")
            .prepare(
                `SELECT
                (SELECT COUNT(*) FROM _openbot_probe_external_trial_readiness) AS readiness_count,
                (SELECT COUNT(DISTINCT writer_role) FROM _openbot_probe_external_trial_readiness)
                    AS ready_writer_role_count,
                (SELECT COUNT(DISTINCT go_receipt_digest) FROM _openbot_probe_external_trial_readiness)
                    AS distinct_go_receipt_count,
                (SELECT COUNT(DISTINCT operation_request_digest) FROM _openbot_probe_external_trial_readiness)
                    AS distinct_operation_request_count,
                (SELECT COUNT(*) FROM _openbot_probe_external_trial_readiness_guard) AS readiness_guard_count,
                (SELECT COUNT(*) FROM _openbot_probe_external_gateway_reservation) AS reservation_count,
                (SELECT COUNT(*) FROM _openbot_probe_external_gateway_guard) AS guard_count,
                (SELECT COUNT(*) FROM _openbot_probe_external_sink_receipt) AS sink_receipt_count`
            )
            .all<{
                readiness_count: number;
                ready_writer_role_count: number;
                distinct_go_receipt_count: number;
                distinct_operation_request_count: number;
                readiness_guard_count: number;
                reservation_count: number;
                guard_count: number;
                sink_receipt_count: number;
            }>();
        expect(readback.results).toEqual([
            {
                readiness_count: 2,
                ready_writer_role_count: 2,
                distinct_go_receipt_count: 2,
                distinct_operation_request_count: 2,
                readiness_guard_count: 2,
                reservation_count: 0,
                guard_count: 0,
                sink_receipt_count: 0,
            },
        ]);
    });
});
