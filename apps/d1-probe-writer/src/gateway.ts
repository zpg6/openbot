import {
    D1_PROBE_RPC_VERSION_V1,
    D1ProbeGatewayCommittedBatchV1Schema,
    D1ProbeGatewayReadbackV1Schema,
    D1ProbeReceiptResponseV1Schema,
    D1ProbeRpcError,
    computeD1ProbeReceiptRequestDigestV1,
    gatewayReservationResponseV1,
    parseAndVerifyD1ProbeGatewayReservationRequestV1,
    type D1ProbeD1MetadataV1,
    type D1ProbeGatewayCommittedBatchV1,
    type D1ProbeGatewayReservationResponseV1,
    type D1ProbeGatewayWriterServiceV1,
    type D1ProbeReceiptResponseV1,
    type D1ProbeSinkServiceV1,
    type D1ProbeWriterRoleV1,
    type UnsignedD1ProbeReceiptRequestV1,
} from "@openbot/d1-probe-rpc";

const digestPattern = /^[0-9a-f]{64}$/u;

const requestDigestFrom = (input: unknown): string => {
    try {
        if (typeof input !== "object" || input === null || !("request_digest" in input)) return "0".repeat(64);
        const digest = input.request_digest;
        return typeof digest === "string" && digestPattern.test(digest) ? digest : "0".repeat(64);
    } catch {
        return "0".repeat(64);
    }
};

const terminal = (
    input: unknown,
    writerRole: D1ProbeWriterRoleV1,
    fields: Omit<D1ProbeGatewayReservationResponseV1, "schema_version" | "operation" | "request_digest" | "writer_role">
): D1ProbeGatewayReservationResponseV1 =>
    gatewayReservationResponseV1({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "reserve_gateway_call_v1",
        request_digest: requestDigestFrom(input),
        writer_role: writerRole,
        ...fields,
    });

const ownDataRecord = (value: unknown, name: string): Readonly<Record<string, unknown>> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
        if (!("value" in descriptor)) throw new TypeError(`${name} is invalid`);
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
};

const finiteNumber = (value: unknown, name: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} is invalid`);
    return value;
};

const safeInteger = (value: unknown, name: string): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${name} is invalid`);
    return value as number;
};

const nonemptyString = (value: unknown, name: string, maximum: number): string => {
    if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
        throw new TypeError(`${name} is invalid`);
    }
    return value;
};

const metadataFrom = (value: unknown, expectWrite: boolean): D1ProbeD1MetadataV1 => {
    const meta = ownDataRecord(value, "D1 metadata");
    const timings = ownDataRecord(meta["timings"], "D1 timings");
    const metadata = {
        changes: safeInteger(meta["changes"], "changes"),
        rows_read: safeInteger(meta["rows_read"], "rows_read"),
        rows_written: safeInteger(meta["rows_written"], "rows_written"),
        changed_db: meta["changed_db"],
        served_by_primary: meta["served_by_primary"],
        served_by: nonemptyString(meta["served_by"], "served_by", 128),
        served_by_region: nonemptyString(meta["served_by_region"], "served_by_region", 64),
        duration: finiteNumber(meta["duration"], "duration"),
        sql_duration_ms: finiteNumber(timings["sql_duration_ms"], "sql_duration_ms"),
        total_attempts: safeInteger(meta["total_attempts"], "total_attempts"),
        last_row_id: meta["last_row_id"] === null ? null : safeInteger(meta["last_row_id"], "last_row_id"),
        size_after: safeInteger(meta["size_after"], "size_after"),
    };
    if (metadata.served_by_primary !== true || metadata.total_attempts < 1) {
        throw new TypeError("D1 primary metadata is missing");
    }
    if (metadata.changed_db !== expectWrite) throw new TypeError("D1 mutation metadata is inconsistent");
    if (!expectWrite && (metadata.changes !== 0 || metadata.rows_written !== 0)) {
        throw new TypeError("D1 read metadata is inconsistent");
    }
    return metadataFromSchema(metadata);
};

const metadataFromSchema = (value: unknown): D1ProbeD1MetadataV1 => {
    const result = D1ProbeGatewayReadbackV1Schema.shape.metadata.safeParse(value);
    if (!result.success) throw new TypeError("D1 metadata is invalid");
    return result.data;
};

const exactRow = <T extends Readonly<Record<string, string | number>>>(
    result: D1Result<Record<string, unknown>>,
    expected: T,
    name: string
): { readonly row: T; readonly metadata: D1ProbeD1MetadataV1 } => {
    if (result.success !== true || result.results.length !== 1) throw new TypeError(`${name} result is invalid`);
    const row = ownDataRecord(result.results[0], `${name} row`);
    const keys = Object.keys(row).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (
        keys.length !== expectedKeys.length ||
        keys.some((key, index) => key !== expectedKeys[index]) ||
        expectedKeys.some(key => row[key] !== expected[key])
    ) {
        throw new TypeError(`${name} RETURNING row is invalid`);
    }
    return { row: expected, metadata: metadataFrom(result.meta, true) };
};

const committedBatchFrom = (
    results: D1Result<Record<string, unknown>>[],
    bookmark: string | null,
    request: Awaited<ReturnType<typeof parseAndVerifyD1ProbeGatewayReservationRequestV1>>
): D1ProbeGatewayCommittedBatchV1 => {
    if (bookmark === null) throw new Error("bookmark_unavailable");
    if (results.length !== 3) throw new TypeError("D1 batch result count is invalid");
    const insertReservation = exactRow(
        results[0] as D1Result<Record<string, unknown>>,
        {
            probe_run_id: request.probe_run_id,
            scenario: request.scenario,
            call_kind: request.call_kind,
            call_sequence: request.call_sequence,
            reservation_id: request.reservation_id,
        },
        "reservation"
    );
    const insertGuard = exactRow(
        results[1] as D1Result<Record<string, unknown>>,
        { reservation_id: request.reservation_id },
        "reservation guard"
    );
    const decrementBudget = exactRow(
        results[2] as D1Result<Record<string, unknown>>,
        {
            probe_run_id: request.probe_run_id,
            scenario: request.scenario,
            call_kind: request.call_kind,
            remaining: 0,
        },
        "gateway budget"
    );
    const parsed = D1ProbeGatewayCommittedBatchV1Schema.safeParse({
        insert_reservation: insertReservation,
        insert_guard: insertGuard,
        decrement_budget: decrementBudget,
        bookmark,
    });
    if (!parsed.success) throw new TypeError("D1 committed batch is invalid");
    return parsed.data;
};

const errorMessage = (error: unknown): string => {
    try {
        return error instanceof Error ? error.message : String(error);
    } catch {
        return "";
    }
};

const isExpectedReservationConstraint = (error: unknown): boolean => {
    const message = errorMessage(error);
    return (
        /D1_(?:EXEC_)?ERROR|SQLITE_CONSTRAINT/iu.test(message) &&
        (/FOREIGN KEY constraint failed/iu.test(message) ||
            (/UNIQUE constraint failed/iu.test(message) &&
                (message.includes("_openbot_probe_external_gateway_guard.reservation_id") ||
                    message.includes("_openbot_probe_external_gateway_reservation"))))
    );
};

type GatewayReadbackRow = {
    remaining: number;
    reservation_count: number;
    guard_count: number;
    sink_receipt_count: number;
    stored_writer_role: string;
    stored_request_variant: string;
    stored_fault_point: string;
    stored_logical_call_id: string;
    stored_attempt_id: string;
    stored_reservation_id: string;
    stored_dispatch_request_digest: string;
    stored_request_digest: string;
};

const readbackAfterConstraint = async (
    database: D1Database,
    request: Awaited<ReturnType<typeof parseAndVerifyD1ProbeGatewayReservationRequestV1>>
) => {
    const session = database.withSession("first-primary");
    const result = await session
        .prepare(
            `SELECT budget.remaining,
                    COUNT(DISTINCT reservation.reservation_id) AS reservation_count,
                    COUNT(DISTINCT guard.reservation_id) AS guard_count,
                    COUNT(DISTINCT receipt.receipt_id) AS sink_receipt_count,
                    reservation.writer_role AS stored_writer_role,
                    reservation.request_variant AS stored_request_variant,
                    reservation.fault_point AS stored_fault_point,
                    reservation.logical_call_id AS stored_logical_call_id,
                    reservation.attempt_id AS stored_attempt_id,
                    reservation.reservation_id AS stored_reservation_id,
                    reservation.dispatch_request_digest AS stored_dispatch_request_digest,
                    reservation.request_digest AS stored_request_digest
             FROM _openbot_probe_external_gateway_budget AS budget
             JOIN _openbot_probe_external_gateway_reservation AS reservation
               ON reservation.probe_run_id = budget.probe_run_id
              AND reservation.scenario = budget.scenario
              AND reservation.call_kind = budget.call_kind
              AND reservation.call_sequence = ?
             JOIN _openbot_probe_external_gateway_guard AS guard
               ON guard.reservation_id = reservation.reservation_id
             LEFT JOIN _openbot_probe_external_sink_receipt AS receipt
               ON receipt.probe_run_id = reservation.probe_run_id
              AND receipt.source_request_digest = reservation.request_digest
              AND receipt.receipt_kind = 'gateway_dispatch'
             WHERE budget.probe_run_id = ? AND budget.scenario = ? AND budget.call_kind = ?`
        )
        .bind(request.call_sequence, request.probe_run_id, request.scenario, request.call_kind)
        .all<GatewayReadbackRow>();
    if (result.success !== true || result.results.length !== 1) throw new TypeError("D1 readback is invalid");
    const row = result.results[0];
    const parsed = D1ProbeGatewayReadbackV1Schema.safeParse({
        ...row,
        metadata: metadataFrom(result.meta, false),
    });
    if (!parsed.success) throw new TypeError("D1 readback is invalid");
    return parsed.data;
};

const sinkRequestFor = async (
    request: Awaited<ReturnType<typeof parseAndVerifyD1ProbeGatewayReservationRequestV1>>
) => {
    const unsigned: UnsignedD1ProbeReceiptRequestV1 = {
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "record_probe_receipt_v1",
        request_id: `receipt_${request.request_digest.slice(0, 32)}`,
        probe_run_id: request.probe_run_id,
        writer_role: request.writer_role,
        source_request_digest: request.request_digest,
        payload: {
            kind: "gateway_dispatch",
            call_kind: request.call_kind,
            logical_call_id: request.logical_call_id,
            attempt_id: request.attempt_id,
            call_sequence: request.call_sequence,
            reservation_id: request.reservation_id,
            dispatch_request_digest: request.dispatch_request_digest,
        },
    };
    return { ...unsigned, request_digest: await computeD1ProbeReceiptRequestDigestV1(unsigned) };
};

const validateSinkResponse = (value: unknown, expectedDigest: string): D1ProbeReceiptResponseV1 => {
    const parsed = D1ProbeReceiptResponseV1Schema.safeParse(value);
    if (!parsed.success || parsed.data.request_digest !== expectedDigest)
        throw new TypeError("Sink response is invalid");
    return parsed.data;
};

export const reserveAndDispatchGatewayProbeV1 = async (
    database: D1Database,
    sink: D1ProbeSinkServiceV1,
    expectedRole: D1ProbeWriterRoleV1,
    input: unknown
): Promise<D1ProbeGatewayReservationResponseV1> => {
    let request;
    try {
        request = await parseAndVerifyD1ProbeGatewayReservationRequestV1(input);
    } catch (error) {
        if (!(error instanceof D1ProbeRpcError)) {
            return terminal(input, expectedRole, {
                status: "inconclusive",
                error_code: "unexpected_d1_result",
                committed_batch: null,
                sink_response: null,
                readback: null,
            });
        }
        return terminal(input, expectedRole, {
            status: "rejected",
            error_code: "invalid_request",
            committed_batch: null,
            sink_response: null,
            readback: null,
        });
    }
    if (request.writer_role !== expectedRole) {
        return terminal(request, expectedRole, {
            status: "rejected",
            error_code: "invalid_request",
            committed_batch: null,
            sink_response: null,
            readback: null,
        });
    }

    let session: D1DatabaseSession;
    let batchCallStarted = false;
    let batchResults: D1Result<Record<string, unknown>>[];
    try {
        session = database.withSession("first-primary");
        const statements = [
            session
                .prepare(
                    `INSERT INTO _openbot_probe_external_gateway_reservation
                        (probe_run_id, scenario, call_kind, call_sequence, request_id, writer_role, request_variant,
                         fault_point, logical_call_id, attempt_id, reservation_id, dispatch_request_digest, request_digest)
                     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                     FROM _openbot_probe_external_gateway_budget
                     WHERE probe_run_id = ? AND scenario = ? AND call_kind = ? AND remaining = 1
                     RETURNING probe_run_id, scenario, call_kind, call_sequence, reservation_id`
                )
                .bind(
                    request.probe_run_id,
                    request.scenario,
                    request.call_kind,
                    request.call_sequence,
                    request.request_id,
                    request.writer_role,
                    request.request_variant,
                    request.fault_point,
                    request.logical_call_id,
                    request.attempt_id,
                    request.reservation_id,
                    request.dispatch_request_digest,
                    request.request_digest,
                    request.probe_run_id,
                    request.scenario,
                    request.call_kind
                ),
            session
                .prepare(
                    "INSERT INTO _openbot_probe_external_gateway_guard (reservation_id) VALUES (?) RETURNING reservation_id"
                )
                .bind(request.reservation_id),
            session
                .prepare(
                    `UPDATE _openbot_probe_external_gateway_budget
                     SET remaining = remaining - 1
                     WHERE probe_run_id = ? AND scenario = ? AND call_kind = ? AND remaining = 1
                     RETURNING probe_run_id, scenario, call_kind, remaining`
                )
                .bind(request.probe_run_id, request.scenario, request.call_kind),
        ];
        batchCallStarted = true;
        batchResults = await session.batch<Record<string, unknown>>(statements);
    } catch (error) {
        if (!batchCallStarted) {
            return terminal(request, expectedRole, {
                status: "inconclusive",
                error_code: "unexpected_d1_result",
                committed_batch: null,
                sink_response: null,
                readback: null,
            });
        }
        if (!isExpectedReservationConstraint(error)) {
            return terminal(request, expectedRole, {
                status: "outcome_unknown",
                error_code: "d1_outcome_unknown",
                committed_batch: null,
                sink_response: null,
                readback: null,
            });
        }
        try {
            const readback = await readbackAfterConstraint(database, request);
            const sameDigest =
                readback.stored_request_digest === request.request_digest &&
                readback.stored_writer_role === request.writer_role &&
                readback.stored_request_variant === request.request_variant &&
                readback.stored_fault_point === request.fault_point &&
                readback.stored_logical_call_id === request.logical_call_id &&
                readback.stored_attempt_id === request.attempt_id &&
                readback.stored_reservation_id === request.reservation_id &&
                readback.stored_dispatch_request_digest === request.dispatch_request_digest;
            const duplicateDispatch =
                readback.stored_request_variant === "exact" &&
                request.request_variant === "exact" &&
                readback.stored_fault_point === request.fault_point &&
                readback.stored_logical_call_id === request.logical_call_id &&
                readback.stored_attempt_id === request.attempt_id &&
                readback.stored_reservation_id === request.reservation_id &&
                readback.stored_dispatch_request_digest === request.dispatch_request_digest;
            return terminal(request, expectedRole, {
                status: "guarded_denial",
                error_code: sameDigest
                    ? "same_digest_replay"
                    : duplicateDispatch
                      ? "duplicate_dispatch_denied"
                      : "changed_digest_denied",
                committed_batch: null,
                sink_response: null,
                readback,
            });
        } catch {
            return terminal(request, expectedRole, {
                status: "inconclusive",
                error_code: "unexpected_d1_result",
                committed_batch: null,
                sink_response: null,
                readback: null,
            });
        }
    }

    let committedBatch: D1ProbeGatewayCommittedBatchV1;
    try {
        committedBatch = committedBatchFrom(batchResults, session.getBookmark(), request);
    } catch (error) {
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code: errorMessage(error) === "bookmark_unavailable" ? "bookmark_unavailable" : "d1_outcome_unknown",
            committed_batch: null,
            sink_response: null,
            readback: null,
        });
    }

    if (request.fault_point === "reserve_then_crash") {
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code: "reserve_then_crash",
            committed_batch: committedBatch,
            sink_response: null,
            readback: null,
        });
    }

    let sinkRequest;
    try {
        sinkRequest = await sinkRequestFor(request);
    } catch {
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code: "dispatch_preparation_failed",
            committed_batch: committedBatch,
            sink_response: null,
            readback: null,
        });
    }
    let sinkResponse: D1ProbeReceiptResponseV1;
    try {
        sinkResponse = validateSinkResponse(await sink.record(sinkRequest), sinkRequest.request_digest);
    } catch {
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code:
                request.fault_point === "dispatch_response_lost" ? "dispatch_response_lost" : "sink_outcome_unknown",
            committed_batch: committedBatch,
            sink_response: null,
            readback: null,
        });
    }
    if (request.fault_point === "dispatch_response_lost") {
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code: "dispatch_response_lost",
            committed_batch: committedBatch,
            sink_response: null,
            readback: null,
        });
    }
    if (sinkResponse.status === "recorded") {
        return terminal(request, expectedRole, {
            status: "dispatched",
            error_code: null,
            committed_batch: committedBatch,
            sink_response: sinkResponse,
            readback: null,
        });
    }
    if (sinkResponse.status === "rejected" || sinkResponse.status === "unavailable") {
        return terminal(request, expectedRole, {
            status: "reserved_without_dispatch",
            error_code: sinkResponse.status === "rejected" ? "sink_rejected" : "sink_unavailable",
            committed_batch: committedBatch,
            sink_response: sinkResponse,
            readback: null,
        });
    }
    return terminal(request, expectedRole, {
        status: "outcome_unknown",
        error_code: "sink_outcome_unknown",
        committed_batch: committedBatch,
        sink_response: null,
        readback: null,
    });
};

export type D1ProbeGatewayServiceV1 = D1ProbeGatewayWriterServiceV1;
