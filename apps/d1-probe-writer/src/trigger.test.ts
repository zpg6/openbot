import {
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    computeD1ProbeReceiptRequestDigestV1,
    receiptResponseV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeReceiptRequestV1,
    type D1ProbeSinkServiceV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import { runGatewayTrialV1 } from "./trigger.js";

type TrialDatabase = Parameters<typeof runGatewayTrialV1>[0];
const hex = (character: string): string => character.repeat(64);

const metadata = (write: boolean) => ({
    changes: write ? 1 : 0,
    rows_read: write ? 0 : 1,
    rows_written: write ? 1 : 0,
    changed_db: write,
    served_by_primary: true,
    served_by: "miniflare.db",
    served_by_region: "WNAM",
    duration: 1,
    timings: { sql_duration_ms: 0.5 },
    total_attempts: 1,
    last_row_id: 1,
    size_after: 4096,
});

const request = async (): Promise<D1ProbeGatewayTrialRequestV1> => {
    const unsignedGateway: UnsignedD1ProbeGatewayReservationRequestV1 = {
        schema_version: 1,
        operation: "reserve_gateway_call_v1",
        request_id: "gateway_request_0001",
        probe_run_id: "probe_run_0000001",
        scenario: "gateway_trial_0001",
        writer_role: "writer_a",
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
        request_id: "trial_request_0001",
        probe_run_id: "probe_run_0000001",
        trial_id: "gateway_trial_0001",
        child_process_id: "child_process_0001",
        writer_role: "writer_a",
        expected_contender_count: 2,
        go_receipt_digest: hex("4"),
        barrier_timeout_ms: 2_000,
        barrier_poll_interval_ms: 25,
        gateway_request: gatewayRequest,
    };
    return { ...unsignedTrial, request_digest: await computeD1ProbeGatewayTrialRequestDigestV1(unsignedTrial) };
};

const statement = (all?: () => Promise<unknown>) => ({
    bind: () => statement(all),
    all: all ?? (() => Promise.reject(new Error("unexpected all"))),
});

const readinessResults = (trial: D1ProbeGatewayTrialRequestV1) => [
    {
        success: true as const,
        results: [
            {
                probe_run_id: trial.probe_run_id,
                trial_id: trial.trial_id,
                child_process_id: trial.child_process_id,
                writer_role: trial.writer_role,
                request_id: trial.request_id,
            },
        ],
        meta: metadata(true),
    },
    {
        success: true as const,
        results: [{ request_id: trial.request_id }],
        meta: metadata(true),
    },
];

const gatewayResults = (trial: D1ProbeGatewayTrialRequestV1) => {
    const gateway = trial.gateway_request;
    return [
        {
            success: true as const,
            results: [
                {
                    probe_run_id: gateway.probe_run_id,
                    scenario: gateway.scenario,
                    call_kind: gateway.call_kind,
                    call_sequence: gateway.call_sequence,
                    reservation_id: gateway.reservation_id,
                },
            ],
            meta: metadata(true),
        },
        {
            success: true as const,
            results: [{ reservation_id: gateway.reservation_id }],
            meta: metadata(true),
        },
        {
            success: true as const,
            results: [
                {
                    probe_run_id: gateway.probe_run_id,
                    scenario: gateway.scenario,
                    call_kind: gateway.call_kind,
                    remaining: 0,
                },
            ],
            meta: metadata(true),
        },
    ];
};

const barrierRow = (trial: D1ProbeGatewayTrialRequestV1, ready: 1 | 2) => ({
    probe_run_id: trial.probe_run_id,
    trial_id: trial.trial_id,
    trial_state: "open",
    expected_contender_count: 2,
    assignment_count: 2,
    assigned_writer_role_count: 2,
    distinct_go_receipt_count: 2,
    distinct_operation_request_count: 2,
    ready_count: ready,
    readiness_guard_count: ready,
    ready_writer_role_count: ready,
    ready_child_process_ids: ready === 1 ? trial.child_process_id : `${trial.child_process_id},child_process_0002`,
});

const sessionWithBatch = (results: unknown[], bookmark: string) => ({
    prepare: () => statement(),
    batch: () => Promise.resolve(results),
    getBookmark: () => bookmark,
});

const sessionWithRead = (row: unknown) => ({
    prepare: () => statement(() => Promise.resolve({ success: true, results: [row], meta: metadata(false) })),
    batch: () => Promise.reject(new Error("unexpected batch")),
    getBookmark: () => "read-bookmark",
});

const databaseFromSessions = (sessions: object[]) => {
    const queue = [...sessions];
    return {
        withSession: () => {
            const session = queue.shift();
            if (session === undefined) throw new Error("unexpected session");
            return session;
        },
    } as unknown as TrialDatabase;
};

const sink = () => {
    const record = vi.fn(async (input: unknown) => {
        const receipt = input as D1ProbeReceiptRequestV1;
        expect(receipt.request_digest).toBe(
            await computeD1ProbeReceiptRequestDigestV1({
                schema_version: receipt.schema_version,
                operation: receipt.operation,
                request_id: receipt.request_id,
                probe_run_id: receipt.probe_run_id,
                writer_role: receipt.writer_role,
                source_request_digest: receipt.source_request_digest,
                payload: receipt.payload,
            })
        );
        return receiptResponseV1({
            schema_version: 1,
            operation: "record_probe_receipt_v1",
            request_digest: receipt.request_digest,
            status: "recorded",
            error_code: null,
            receipt_id: "receipt_0000000001",
            sink_runtime_version_id: "sink_version_0001",
        });
    });
    return { record } satisfies D1ProbeSinkServiceV1;
};

describe("D1 probe gateway trial barrier", () => {
    it("records one readiness row, observes the exact ready set, then executes", async () => {
        const trial = await request();
        const database = databaseFromSessions([
            sessionWithBatch(readinessResults(trial), "ready-bookmark"),
            sessionWithRead(barrierRow(trial, 1)),
            sessionWithRead(barrierRow(trial, 2)),
            sessionWithBatch(gatewayResults(trial), "gateway-bookmark"),
        ]);
        const probeSink = sink();
        const wait = vi.fn(() => Promise.resolve());
        const response = await runGatewayTrialV1(database, probeSink, "writer_a", trial, wait);
        expect(response).toMatchObject({
            status: "executed",
            barrier: { ready_count: 2, poll_attempt: 2 },
            gateway_response: { status: "dispatched" },
        });
        expect(wait).toHaveBeenCalledOnce();
        expect(wait).toHaveBeenCalledWith(25);
        expect(probeSink.record).toHaveBeenCalledOnce();
    });

    it("times out without entering the gateway reservation", async () => {
        const trial = await request();
        const sessions = [
            sessionWithBatch(readinessResults(trial), "ready-bookmark"),
            ...Array.from({ length: 80 }, () => sessionWithRead(barrierRow(trial, 1))),
        ];
        const probeSink = sink();
        const response = await runGatewayTrialV1(databaseFromSessions(sessions), probeSink, "writer_a", trial, () =>
            Promise.resolve()
        );
        expect(response).toMatchObject({
            status: "barrier_timeout",
            error_code: "barrier_timeout",
            barrier: { ready_count: 1, poll_attempt: 80 },
        });
        expect(probeSink.record).not.toHaveBeenCalled();
    });

    it.each([
        ["open", 1, "readiness_replay", null],
        ["open", 1, "readiness_changed", hex("9")],
        ["open", 0, "assignment_mismatch", null],
        ["closed", 1, "trial_closed", null],
    ] as const)(
        "classifies a guarded readiness denial for %s",
        async (state, assignmentCount, expectedCode, storedOverride) => {
            const trial = await request();
            let sessions = 0;
            const database = {
                withSession: () => {
                    sessions += 1;
                    if (sessions === 1) {
                        return {
                            prepare: () => statement(),
                            batch: () =>
                                Promise.reject(
                                    new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY")
                                ),
                            getBookmark: () => null,
                        };
                    }
                    return sessionWithRead({
                        probe_run_id: trial.probe_run_id,
                        trial_id: trial.trial_id,
                        trial_state: state,
                        assignment_count: assignmentCount,
                        readiness_count: 1,
                        readiness_guard_count: 1,
                        stored_request_digest: storedOverride ?? trial.request_digest,
                    });
                },
            } as unknown as TrialDatabase;
            const probeSink = sink();
            const response = await runGatewayTrialV1(database, probeSink, "writer_a", trial, () => Promise.resolve());
            expect(response).toMatchObject({ status: "guarded_denial", error_code: expectedCode });
            expect(probeSink.record).not.toHaveBeenCalled();
        }
    );

    it("returns typed uncertainty for malformed reads and failed waits", async () => {
        const trial = await request();
        const probeSink = sink();
        const malformedRead = databaseFromSessions([
            sessionWithBatch(readinessResults(trial), "ready-bookmark"),
            sessionWithRead({ ready_count: 2 }),
        ]);
        await expect(
            runGatewayTrialV1(malformedRead, probeSink, "writer_a", trial, () => Promise.resolve())
        ).resolves.toMatchObject({ status: "outcome_unknown", error_code: "barrier_read_unknown" });

        const failedWait = databaseFromSessions([
            sessionWithBatch(readinessResults(trial), "ready-bookmark"),
            sessionWithRead(barrierRow(trial, 1)),
        ]);
        await expect(
            runGatewayTrialV1(failedWait, probeSink, "writer_a", trial, () => Promise.reject(new Error("wait failed")))
        ).resolves.toMatchObject({ status: "outcome_unknown", error_code: "barrier_read_unknown" });

        const missingBarrierGuard = databaseFromSessions([
            sessionWithBatch(readinessResults(trial), "ready-bookmark"),
            sessionWithRead({ ...barrierRow(trial, 2), readiness_guard_count: 1 }),
        ]);
        await expect(
            runGatewayTrialV1(missingBarrierGuard, probeSink, "writer_a", trial, () => Promise.resolve())
        ).resolves.toMatchObject({ status: "outcome_unknown", error_code: "barrier_read_unknown" });

        let denialSessions = 0;
        const missingDenialGuard = {
            withSession: () => {
                denialSessions += 1;
                if (denialSessions === 1) {
                    return {
                        prepare: () => statement(),
                        batch: () =>
                            Promise.reject(
                                new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY")
                            ),
                        getBookmark: () => null,
                    };
                }
                return sessionWithRead({
                    probe_run_id: trial.probe_run_id,
                    trial_id: trial.trial_id,
                    trial_state: "open",
                    assignment_count: 1,
                    readiness_count: 1,
                    readiness_guard_count: 0,
                    stored_request_digest: trial.request_digest,
                });
            },
        } as unknown as TrialDatabase;
        await expect(
            runGatewayTrialV1(missingDenialGuard, probeSink, "writer_a", trial, () => Promise.resolve())
        ).resolves.toMatchObject({ status: "outcome_unknown", error_code: "barrier_read_unknown" });
        expect(probeSink.record).not.toHaveBeenCalled();
    });

    it("rejects role substitution and hostile input before D1", async () => {
        const trial = await request();
        const withSession = vi.fn();
        const probeSink = sink();
        await expect(
            runGatewayTrialV1({ withSession } as unknown as TrialDatabase, probeSink, "writer_b", trial)
        ).resolves.toMatchObject({ status: "rejected", error_code: "invalid_request" });
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        await expect(
            runGatewayTrialV1({ withSession } as unknown as TrialDatabase, probeSink, "writer_a", hostile)
        ).resolves.toMatchObject({ status: "rejected", error_code: "invalid_request" });
        expect(withSession).not.toHaveBeenCalled();
        expect(probeSink.record).not.toHaveBeenCalled();
    });
});
