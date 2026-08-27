import {
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeReceiptRequestDigestV1,
    receiptResponseV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeReceiptRequestV1,
    type D1ProbeSinkServiceV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import { reserveAndDispatchGatewayProbeV1 } from "../src/gateway.js";

type GatewayDatabase = Parameters<typeof reserveAndDispatchGatewayProbeV1>[0];

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

const makeRequest = async (
    overrides: Partial<UnsignedD1ProbeGatewayReservationRequestV1> = {}
): Promise<D1ProbeGatewayReservationRequestV1> => {
    const unsigned: UnsignedD1ProbeGatewayReservationRequestV1 = {
        schema_version: 1,
        operation: "reserve_gateway_call_v1",
        request_id: "request_0000000001",
        probe_run_id: "probe_run_0000001",
        scenario: "gateway_normal",
        writer_role: "writer_a",
        request_variant: "exact",
        call_kind: "code",
        logical_call_id: "logical_call_0001",
        attempt_id: "attempt_00000001",
        call_sequence: 1,
        reservation_id: "reservation_0001",
        dispatch_request_digest: hex("3"),
        fault_point: "none",
        ...overrides,
    };
    return { ...unsigned, request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(unsigned) };
};

const writeResults = (request: D1ProbeGatewayReservationRequestV1) => [
    {
        success: true as const,
        results: [
            {
                probe_run_id: request.probe_run_id,
                scenario: request.scenario,
                call_kind: request.call_kind,
                call_sequence: request.call_sequence,
                reservation_id: request.reservation_id,
            },
        ],
        meta: metadata(true),
    },
    {
        success: true as const,
        results: [{ reservation_id: request.reservation_id }],
        meta: metadata(true),
    },
    {
        success: true as const,
        results: [
            {
                probe_run_id: request.probe_run_id,
                scenario: request.scenario,
                call_kind: request.call_kind,
                remaining: 0,
            },
        ],
        meta: metadata(true),
    },
];

const statement = (all?: () => Promise<unknown>) => ({
    bind: () => statement(all),
    all: all ?? (() => Promise.reject(new Error("unexpected all"))),
});

const successfulDatabase = (request: D1ProbeGatewayReservationRequestV1, bookmark: string | null = "bookmark-1") =>
    ({
        withSession: () => ({
            prepare: () => statement(),
            batch: () => Promise.resolve(writeResults(request)),
            getBookmark: () => bookmark,
        }),
    }) as unknown as GatewayDatabase;

const readbackRow = (stored: D1ProbeGatewayReservationRequestV1) => ({
    remaining: 0,
    reservation_count: 1,
    guard_count: 1,
    sink_receipt_count: 1,
    stored_writer_role: stored.writer_role,
    stored_request_variant: stored.request_variant,
    stored_fault_point: stored.fault_point,
    stored_logical_call_id: stored.logical_call_id,
    stored_attempt_id: stored.attempt_id,
    stored_reservation_id: stored.reservation_id,
    stored_dispatch_request_digest: stored.dispatch_request_digest,
    stored_request_digest: stored.request_digest,
});

const constrainedDatabase = (stored: D1ProbeGatewayReservationRequestV1, readbackFailure: Error | null = null) => {
    let sessions = 0;
    return {
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
            return {
                prepare: () =>
                    statement(() =>
                        readbackFailure === null
                            ? Promise.resolve({
                                  success: true,
                                  results: [readbackRow(stored)],
                                  meta: metadata(false),
                              })
                            : Promise.reject(readbackFailure)
                    ),
                batch: () => Promise.reject(new Error("unexpected batch")),
                getBookmark: () => "readback-bookmark",
            };
        },
    } as unknown as GatewayDatabase;
};

const recordedSink = () => {
    const record = vi.fn(async (input: unknown) => {
        const request = input as D1ProbeReceiptRequestV1;
        expect(request.source_request_digest).toMatch(/^[0-9a-f]{64}$/u);
        expect(request.request_digest).toBe(
            await computeD1ProbeReceiptRequestDigestV1({
                schema_version: request.schema_version,
                operation: request.operation,
                request_id: request.request_id,
                probe_run_id: request.probe_run_id,
                writer_role: request.writer_role,
                source_request_digest: request.source_request_digest,
                payload: request.payload,
            })
        );
        return receiptResponseV1({
            schema_version: 1,
            operation: "record_probe_receipt_v1",
            request_digest: request.request_digest,
            status: "recorded",
            error_code: null,
            receipt_id: "receipt_0000000001",
            sink_runtime_version_id: "sink_version_0001",
        });
    });
    return { record } satisfies D1ProbeSinkServiceV1;
};

describe("deployed D1 gateway writer", () => {
    it.each(["model", "provider_tool", "code"] as const)(
        "reserves one %s call and dispatches exactly once after commit",
        async callKind => {
            const request = await makeRequest({ call_kind: callKind });
            const sink = recordedSink();
            const response = await reserveAndDispatchGatewayProbeV1(
                successfulDatabase(request),
                sink,
                "writer_a",
                request
            );
            expect(response.status).toBe("dispatched");
            expect(sink.record).toHaveBeenCalledTimes(1);
            const sinkRequest = sink.record.mock.calls[0]?.[0] as D1ProbeReceiptRequestV1;
            expect(sinkRequest.source_request_digest).toBe(request.request_digest);
            expect(sinkRequest.payload).toMatchObject({
                kind: "gateway_dispatch",
                call_kind: callKind,
                logical_call_id: request.logical_call_id,
                reservation_id: request.reservation_id,
            });
        }
    );

    it("classifies exact replay without a second sink dispatch", async () => {
        const request = await makeRequest();
        const sink = recordedSink();
        const response = await reserveAndDispatchGatewayProbeV1(
            constrainedDatabase(request),
            sink,
            "writer_a",
            request
        );
        expect(response).toMatchObject({ status: "guarded_denial", error_code: "same_digest_replay" });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("distinguishes a second writer envelope from a substituted dispatch digest", async () => {
        const exact = await makeRequest();
        const secondWriter = await makeRequest({
            request_id: "request_0000000002",
            writer_role: "writer_b",
        });
        const sink = recordedSink();
        const response = await reserveAndDispatchGatewayProbeV1(
            constrainedDatabase(exact),
            sink,
            "writer_b",
            secondWriter
        );
        expect(response).toMatchObject({ status: "guarded_denial", error_code: "duplicate_dispatch_denied" });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("denies a substituted digest even when every other logical binding matches", async () => {
        const exact = await makeRequest();
        const substituted = await makeRequest({
            request_variant: "substituted",
            dispatch_request_digest: hex("4"),
        });
        const sink = recordedSink();
        const response = await reserveAndDispatchGatewayProbeV1(
            constrainedDatabase(exact),
            sink,
            "writer_a",
            substituted
        );
        expect(response).toMatchObject({ status: "guarded_denial", error_code: "changed_digest_denied" });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("does not treat a changed fault program as the same exact dispatch", async () => {
        const exact = await makeRequest();
        const changedFault = await makeRequest({ fault_point: "reserve_then_crash" });
        const sink = recordedSink();
        const response = await reserveAndDispatchGatewayProbeV1(
            constrainedDatabase(exact),
            sink,
            "writer_a",
            changedFault
        );
        expect(response).toMatchObject({ status: "guarded_denial", error_code: "changed_digest_denied" });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("does not dispatch after the reserve-then-crash fault point", async () => {
        const request = await makeRequest({ fault_point: "reserve_then_crash" });
        const sink = recordedSink();
        const response = await reserveAndDispatchGatewayProbeV1(successfulDatabase(request), sink, "writer_a", request);
        expect(response).toMatchObject({ status: "outcome_unknown", error_code: "reserve_then_crash" });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("dispatches once but reports uncertainty when the response is deliberately lost", async () => {
        const request = await makeRequest({ fault_point: "dispatch_response_lost" });
        const sink = recordedSink();
        const response = await reserveAndDispatchGatewayProbeV1(successfulDatabase(request), sink, "writer_a", request);
        expect(response).toMatchObject({ status: "outcome_unknown", error_code: "dispatch_response_lost" });
        expect(sink.record).toHaveBeenCalledTimes(1);
    });

    it("never retries a thrown or malformed sink response", async () => {
        const request = await makeRequest();
        for (const record of [
            vi.fn(() => Promise.reject(new Error("transport lost"))),
            vi.fn(() => Promise.resolve({ status: "recorded" })),
        ]) {
            const response = await reserveAndDispatchGatewayProbeV1(
                successfulDatabase(request),
                { record } as unknown as D1ProbeSinkServiceV1,
                "writer_a",
                request
            );
            expect(response).toMatchObject({ status: "outcome_unknown", error_code: "sink_outcome_unknown" });
            expect(record).toHaveBeenCalledTimes(1);
        }
    });

    it("fails closed on ambiguous writes, missing bookmarks, and failed primary reconciliation", async () => {
        const request = await makeRequest();
        const sink = recordedSink();
        const ambiguous = {
            withSession: () => ({
                prepare: () => statement(),
                batch: () => Promise.reject(new Error("network reset")),
                getBookmark: () => null,
            }),
        } as unknown as GatewayDatabase;
        await expect(reserveAndDispatchGatewayProbeV1(ambiguous, sink, "writer_a", request)).resolves.toMatchObject({
            status: "outcome_unknown",
            error_code: "d1_outcome_unknown",
        });
        await expect(
            reserveAndDispatchGatewayProbeV1(successfulDatabase(request, null), sink, "writer_a", request)
        ).resolves.toMatchObject({ status: "outcome_unknown", error_code: "bookmark_unavailable" });
        await expect(
            reserveAndDispatchGatewayProbeV1(
                constrainedDatabase(request, new Error("primary unavailable")),
                sink,
                "writer_a",
                request
            )
        ).resolves.toMatchObject({ status: "inconclusive", error_code: "unexpected_d1_result" });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("returns a typed denial when the D1 session cannot be created", async () => {
        const request = await makeRequest();
        const sink = recordedSink();
        const database = {
            withSession: () => {
                throw new Error("binding unavailable");
            },
        } as unknown as GatewayDatabase;
        await expect(reserveAndDispatchGatewayProbeV1(database, sink, "writer_a", request)).resolves.toMatchObject({
            status: "inconclusive",
            error_code: "unexpected_d1_result",
        });
        expect(sink.record).not.toHaveBeenCalled();
    });

    it("rejects role substitution and hostile input before touching D1", async () => {
        const request = await makeRequest({ writer_role: "writer_b" });
        const withSession = vi.fn();
        const sink = recordedSink();
        await expect(
            reserveAndDispatchGatewayProbeV1({ withSession } as unknown as GatewayDatabase, sink, "writer_a", request)
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
            reserveAndDispatchGatewayProbeV1({ withSession } as unknown as GatewayDatabase, sink, "writer_a", hostile)
        ).resolves.toMatchObject({ status: "rejected", error_code: "invalid_request" });
        expect(withSession).not.toHaveBeenCalled();
        expect(sink.record).not.toHaveBeenCalled();
    });
});
