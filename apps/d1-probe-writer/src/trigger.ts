import {
    D1_PROBE_GATEWAY_BARRIER_MAX_POLLS_V1,
    D1_PROBE_GATEWAY_BARRIER_POLL_INTERVAL_MS_V1,
    D1_PROBE_RPC_VERSION_V1,
    D1ProbeGatewayBarrierReadbackV1Schema,
    D1ProbeGatewayReadinessCommitV1Schema,
    D1ProbeGatewayReadinessDenialReadbackV1Schema,
    D1ProbeRpcError,
    gatewayTrialResponseV1,
    parseAndVerifyD1ProbeGatewayTrialRequestV1,
    type D1ProbeGatewayBarrierReadbackV1,
    type D1ProbeGatewayReadinessCommitV1,
    type D1ProbeGatewayTrialResponseV1,
    type D1ProbeSinkServiceV1,
    type D1ProbeWriterRoleV1,
} from "@openbot/d1-probe-rpc";

import { d1ProbeMetadataFromV1, reserveAndDispatchGatewayProbeV1 } from "./gateway.js";

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
    fields: Omit<D1ProbeGatewayTrialResponseV1, "schema_version" | "operation" | "request_digest" | "writer_role">
): D1ProbeGatewayTrialResponseV1 =>
    gatewayTrialResponseV1({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "run_gateway_trial_v1",
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

const exactRow = (
    result: D1Result<Record<string, unknown>>,
    expected: Readonly<Record<string, string>>,
    name: string
) => {
    if (result.success !== true || result.results.length !== 1) throw new TypeError(`${name} result is invalid`);
    const row = ownDataRecord(result.results[0], `${name} row`);
    const keys = Object.keys(row).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (
        keys.length !== expectedKeys.length ||
        keys.some((key, index) => key !== expectedKeys[index]) ||
        expectedKeys.some(key => row[key] !== expected[key])
    ) {
        throw new TypeError(`${name} row is invalid`);
    }
    return { row: expected, metadata: d1ProbeMetadataFromV1(result.meta, true) };
};

const errorMessage = (error: unknown): string => {
    try {
        return error instanceof Error ? error.message : String(error);
    } catch {
        return "";
    }
};

const expectedReadinessConstraint = (error: unknown): boolean => {
    const message = errorMessage(error);
    return (
        /D1_(?:EXEC_)?ERROR|SQLITE_CONSTRAINT/iu.test(message) &&
        (/FOREIGN KEY constraint failed/iu.test(message) ||
            (/UNIQUE constraint failed/iu.test(message) &&
                (message.includes("_openbot_probe_external_trial_readiness") ||
                    message.includes("_openbot_probe_external_trial_readiness_guard.request_id"))))
    );
};

const readinessCommitFrom = (
    results: D1Result<Record<string, unknown>>[],
    bookmark: string | null,
    request: Awaited<ReturnType<typeof parseAndVerifyD1ProbeGatewayTrialRequestV1>>
): D1ProbeGatewayReadinessCommitV1 => {
    if (bookmark === null) throw new Error("readiness_bookmark_unavailable");
    if (results.length !== 2) throw new TypeError("Readiness batch result count is invalid");
    const readiness = exactRow(
        results[0] as D1Result<Record<string, unknown>>,
        {
            probe_run_id: request.probe_run_id,
            trial_id: request.trial_id,
            child_process_id: request.child_process_id,
            writer_role: request.writer_role,
            request_id: request.request_id,
        },
        "readiness"
    );
    const guard = exactRow(
        results[1] as D1Result<Record<string, unknown>>,
        { request_id: request.request_id },
        "readiness guard"
    );
    const parsed = D1ProbeGatewayReadinessCommitV1Schema.safeParse({
        row: readiness.row,
        insert_readiness_metadata: readiness.metadata,
        insert_guard_metadata: guard.metadata,
        bookmark,
    });
    if (!parsed.success) throw new TypeError("Readiness commit is invalid");
    return parsed.data;
};

type BarrierRow = {
    probe_run_id: string;
    trial_id: string;
    trial_state: string;
    expected_contender_count: number;
    assignment_count: number;
    assigned_writer_role_count: number;
    distinct_go_receipt_count: number;
    distinct_operation_request_count: number;
    ready_count: number;
    readiness_guard_count: number;
    ready_writer_role_count: number;
    ready_child_process_ids: string;
};

const readBarrier = async (
    database: D1Database,
    request: Awaited<ReturnType<typeof parseAndVerifyD1ProbeGatewayTrialRequestV1>>,
    pollAttempt: number
): Promise<D1ProbeGatewayBarrierReadbackV1> => {
    const session = database.withSession("first-primary");
    const result = await session
        .prepare(
            `SELECT trial.probe_run_id,
                    trial.trial_id,
                    trial.state AS trial_state,
                    trial.expected_contender_count,
                    (SELECT COUNT(*) FROM _openbot_probe_external_trial_assignment AS assignment
                     WHERE assignment.probe_run_id = trial.probe_run_id AND assignment.trial_id = trial.trial_id)
                        AS assignment_count,
                    (SELECT COUNT(DISTINCT assignment.writer_role)
                     FROM _openbot_probe_external_trial_assignment AS assignment
                     WHERE assignment.probe_run_id = trial.probe_run_id AND assignment.trial_id = trial.trial_id)
                        AS assigned_writer_role_count,
                    (SELECT COUNT(DISTINCT assignment.go_receipt_digest)
                     FROM _openbot_probe_external_trial_assignment AS assignment
                     WHERE assignment.probe_run_id = trial.probe_run_id AND assignment.trial_id = trial.trial_id)
                        AS distinct_go_receipt_count,
                    (SELECT COUNT(DISTINCT assignment.operation_request_digest)
                     FROM _openbot_probe_external_trial_assignment AS assignment
                     WHERE assignment.probe_run_id = trial.probe_run_id AND assignment.trial_id = trial.trial_id)
                        AS distinct_operation_request_count,
                    (SELECT COUNT(*) FROM _openbot_probe_external_trial_readiness AS readiness
                     WHERE readiness.probe_run_id = trial.probe_run_id AND readiness.trial_id = trial.trial_id)
                        AS ready_count,
                    (SELECT COUNT(*) FROM _openbot_probe_external_trial_readiness_guard AS guard
                     JOIN _openbot_probe_external_trial_readiness AS readiness ON readiness.request_id = guard.request_id
                     WHERE readiness.probe_run_id = trial.probe_run_id AND readiness.trial_id = trial.trial_id)
                        AS readiness_guard_count,
                    (SELECT COUNT(DISTINCT readiness.writer_role)
                     FROM _openbot_probe_external_trial_readiness AS readiness
                     WHERE readiness.probe_run_id = trial.probe_run_id AND readiness.trial_id = trial.trial_id)
                        AS ready_writer_role_count,
                    COALESCE((SELECT GROUP_CONCAT(readiness.child_process_id, ',')
                     FROM _openbot_probe_external_trial_readiness AS readiness
                     WHERE readiness.probe_run_id = trial.probe_run_id AND readiness.trial_id = trial.trial_id), '')
                        AS ready_child_process_ids
             FROM _openbot_probe_external_trial AS trial
             WHERE trial.probe_run_id = ? AND trial.trial_id = ?`
        )
        .bind(request.probe_run_id, request.trial_id)
        .all<BarrierRow>();
    if (result.success !== true || result.results.length !== 1) throw new TypeError("Barrier readback is invalid");
    const row = result.results[0];
    const readyChildProcessIds = row?.ready_child_process_ids.split(",").filter(Boolean).sort() ?? [];
    const parsed = D1ProbeGatewayBarrierReadbackV1Schema.safeParse({
        ...row,
        ready_child_process_ids: readyChildProcessIds,
        poll_attempt: pollAttempt,
        metadata: d1ProbeMetadataFromV1(result.meta, false),
    });
    if (!parsed.success) throw new TypeError("Barrier readback is invalid");
    return parsed.data;
};

type DenialRow = {
    probe_run_id: string;
    trial_id: string;
    trial_state: string;
    assignment_count: number;
    readiness_count: number;
    readiness_guard_count: number;
    stored_request_digest: string | null;
};

const readReadinessDenial = async (
    database: D1Database,
    request: Awaited<ReturnType<typeof parseAndVerifyD1ProbeGatewayTrialRequestV1>>
) => {
    const session = database.withSession("first-primary");
    const result = await session
        .prepare(
            `SELECT trial.probe_run_id,
                    trial.trial_id,
                    trial.state AS trial_state,
                    (SELECT COUNT(*) FROM _openbot_probe_external_trial_assignment AS assignment
                     WHERE assignment.probe_run_id = trial.probe_run_id
                       AND assignment.trial_id = trial.trial_id
                       AND assignment.child_process_id = ?) AS assignment_count,
                    (SELECT COUNT(*) FROM _openbot_probe_external_trial_readiness AS readiness
                     WHERE readiness.probe_run_id = trial.probe_run_id
                       AND readiness.trial_id = trial.trial_id
                       AND readiness.child_process_id = ?) AS readiness_count,
                    (SELECT COUNT(*) FROM _openbot_probe_external_trial_readiness_guard AS guard
                     JOIN _openbot_probe_external_trial_readiness AS readiness ON readiness.request_id = guard.request_id
                     WHERE readiness.probe_run_id = trial.probe_run_id
                       AND readiness.trial_id = trial.trial_id
                       AND readiness.child_process_id = ?) AS readiness_guard_count,
                    (SELECT readiness.request_digest FROM _openbot_probe_external_trial_readiness AS readiness
                     WHERE readiness.probe_run_id = trial.probe_run_id
                       AND readiness.trial_id = trial.trial_id
                       AND readiness.child_process_id = ?) AS stored_request_digest
             FROM _openbot_probe_external_trial AS trial
             WHERE trial.probe_run_id = ? AND trial.trial_id = ?`
        )
        .bind(
            request.child_process_id,
            request.child_process_id,
            request.child_process_id,
            request.child_process_id,
            request.probe_run_id,
            request.trial_id
        )
        .all<DenialRow>();
    if (result.success !== true || result.results.length !== 1) throw new TypeError("Readiness denial is invalid");
    const parsed = D1ProbeGatewayReadinessDenialReadbackV1Schema.safeParse({
        ...result.results[0],
        metadata: d1ProbeMetadataFromV1(result.meta, false),
    });
    if (!parsed.success) throw new TypeError("Readiness denial is invalid");
    return parsed.data;
};

const waitFor = (milliseconds: number): Promise<void> =>
    new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });

export const runGatewayTrialV1 = async (
    database: D1Database,
    sink: D1ProbeSinkServiceV1,
    expectedRole: D1ProbeWriterRoleV1,
    input: unknown,
    wait: (milliseconds: number) => Promise<void> = waitFor
): Promise<D1ProbeGatewayTrialResponseV1> => {
    let request;
    try {
        request = await parseAndVerifyD1ProbeGatewayTrialRequestV1(input);
    } catch (error) {
        return terminal(input, expectedRole, {
            status: error instanceof D1ProbeRpcError ? "rejected" : "outcome_unknown",
            error_code: error instanceof D1ProbeRpcError ? "invalid_request" : "readiness_d1_unknown",
            readiness: null,
            barrier: null,
            readiness_denial_readback: null,
            gateway_response: null,
        });
    }
    if (request.writer_role !== expectedRole) {
        return terminal(request, expectedRole, {
            status: "rejected",
            error_code: "invalid_request",
            readiness: null,
            barrier: null,
            readiness_denial_readback: null,
            gateway_response: null,
        });
    }

    let session: D1DatabaseSession;
    let batchStarted = false;
    let results: D1Result<Record<string, unknown>>[];
    try {
        session = database.withSession("first-primary");
        const statements = [
            session
                .prepare(
                    `INSERT INTO _openbot_probe_external_trial_readiness
                        (probe_run_id, trial_id, child_process_id, writer_role, go_receipt_digest,
                         operation_request_digest, request_id, request_digest)
                     SELECT assignment.probe_run_id, assignment.trial_id, assignment.child_process_id,
                            assignment.writer_role, assignment.go_receipt_digest,
                            assignment.operation_request_digest, ?, ?
                     FROM _openbot_probe_external_trial_assignment AS assignment
                     JOIN _openbot_probe_external_trial AS trial
                       ON trial.probe_run_id = assignment.probe_run_id AND trial.trial_id = assignment.trial_id
                     WHERE assignment.probe_run_id = ? AND assignment.trial_id = ?
                       AND assignment.child_process_id = ? AND assignment.writer_role = ?
                       AND assignment.go_receipt_digest = ? AND assignment.operation_request_digest = ?
                       AND trial.state = 'open' AND trial.trial_kind = 'gateway_reservation'
                       AND trial.expected_contender_count = ?
                     RETURNING probe_run_id, trial_id, child_process_id, writer_role, request_id`
                )
                .bind(
                    request.request_id,
                    request.request_digest,
                    request.probe_run_id,
                    request.trial_id,
                    request.child_process_id,
                    request.writer_role,
                    request.go_receipt_digest,
                    request.gateway_request.request_digest,
                    request.expected_contender_count
                ),
            session
                .prepare(
                    `INSERT INTO _openbot_probe_external_trial_readiness_guard (request_id)
                     VALUES (?) RETURNING request_id`
                )
                .bind(request.request_id),
        ];
        batchStarted = true;
        results = await session.batch<Record<string, unknown>>(statements);
    } catch (error) {
        if (batchStarted && expectedReadinessConstraint(error)) {
            try {
                const readback = await readReadinessDenial(database, request);
                const errorCode =
                    readback.trial_state === "closed"
                        ? "trial_closed"
                        : readback.assignment_count === 0
                          ? "assignment_mismatch"
                          : readback.stored_request_digest === request.request_digest
                            ? "readiness_replay"
                            : "readiness_changed";
                return terminal(request, expectedRole, {
                    status: "guarded_denial",
                    error_code: errorCode,
                    readiness: null,
                    barrier: null,
                    readiness_denial_readback: readback,
                    gateway_response: null,
                });
            } catch {
                return terminal(request, expectedRole, {
                    status: "outcome_unknown",
                    error_code: "barrier_read_unknown",
                    readiness: null,
                    barrier: null,
                    readiness_denial_readback: null,
                    gateway_response: null,
                });
            }
        }
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code: "readiness_d1_unknown",
            readiness: null,
            barrier: null,
            readiness_denial_readback: null,
            gateway_response: null,
        });
    }

    let readiness: D1ProbeGatewayReadinessCommitV1;
    try {
        readiness = readinessCommitFrom(results, session.getBookmark(), request);
    } catch (error) {
        return terminal(request, expectedRole, {
            status: "outcome_unknown",
            error_code:
                errorMessage(error) === "readiness_bookmark_unavailable"
                    ? "readiness_bookmark_unavailable"
                    : "readiness_d1_unknown",
            readiness: null,
            barrier: null,
            readiness_denial_readback: null,
            gateway_response: null,
        });
    }

    let lastBarrier: D1ProbeGatewayBarrierReadbackV1 | null = null;
    for (let attempt = 1; attempt <= D1_PROBE_GATEWAY_BARRIER_MAX_POLLS_V1; attempt += 1) {
        try {
            lastBarrier = await readBarrier(database, request, attempt);
        } catch {
            return terminal(request, expectedRole, {
                status: "outcome_unknown",
                error_code: "barrier_read_unknown",
                readiness,
                barrier: null,
                readiness_denial_readback: null,
                gateway_response: null,
            });
        }
        if (lastBarrier.ready_count === 2) {
            let gatewayResponse;
            try {
                gatewayResponse = await reserveAndDispatchGatewayProbeV1(
                    database,
                    sink,
                    expectedRole,
                    request.gateway_request
                );
            } catch {
                return terminal(request, expectedRole, {
                    status: "outcome_unknown",
                    error_code: "gateway_execution_unknown",
                    readiness,
                    barrier: { ...lastBarrier, ready_count: 2 },
                    readiness_denial_readback: null,
                    gateway_response: null,
                });
            }
            return terminal(request, expectedRole, {
                status: "executed",
                error_code: null,
                readiness,
                barrier: { ...lastBarrier, ready_count: 2 },
                readiness_denial_readback: null,
                gateway_response: gatewayResponse,
            });
        }
        if (attempt < D1_PROBE_GATEWAY_BARRIER_MAX_POLLS_V1) {
            try {
                await wait(D1_PROBE_GATEWAY_BARRIER_POLL_INTERVAL_MS_V1);
            } catch {
                return terminal(request, expectedRole, {
                    status: "outcome_unknown",
                    error_code: "barrier_read_unknown",
                    readiness,
                    barrier: lastBarrier,
                    readiness_denial_readback: null,
                    gateway_response: null,
                });
            }
        }
    }
    return terminal(request, expectedRole, {
        status: "barrier_timeout",
        error_code: "barrier_timeout",
        readiness,
        barrier: lastBarrier === null ? null : { ...lastBarrier, ready_count: 1 },
        readiness_denial_readback: null,
        gateway_response: null,
    });
};
