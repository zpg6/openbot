import {
    D1_PROBE_RPC_VERSION_V1,
    D1ProbeRpcError,
    parseAndVerifyD1ProbeReceiptRequestV1,
    receiptResponseV1,
    type D1ProbeReceiptResponseV1,
} from "@openbot/d1-probe-rpc";

interface ProbeDatabaseV1 {
    prepare(query: string): {
        bind(...values: unknown[]): {
            all<T>(): Promise<{ success: boolean; results?: T[] }>;
        };
    };
}

const digestPattern = /^[0-9a-f]{64}$/u;
const opaqueIdPattern = /^[A-Za-z0-9._~-]{16,128}$/u;

export const requestDigestFromV1 = (input: unknown): string => {
    try {
        if (typeof input !== "object" || input === null || !("request_digest" in input)) return "0".repeat(64);
        const digest = input.request_digest;
        return typeof digest === "string" && digestPattern.test(digest) ? digest : "0".repeat(64);
    } catch {
        return "0".repeat(64);
    }
};

const unavailable = (requestDigest: string, runtimeVersionId: string | null): D1ProbeReceiptResponseV1 =>
    receiptResponseV1({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "record_probe_receipt_v1",
        request_digest: requestDigest,
        status: "unavailable",
        error_code: "sink_unavailable",
        receipt_id: null,
        sink_runtime_version_id: runtimeVersionId,
    });

export const recordProbeReceiptV1 = async (
    database: ProbeDatabaseV1,
    runtimeVersionId: string | null,
    input: unknown,
    randomUuid: () => string = () => globalThis.crypto.randomUUID()
): Promise<D1ProbeReceiptResponseV1> => {
    const normalizedRuntimeVersionId =
        runtimeVersionId !== null && opaqueIdPattern.test(runtimeVersionId) ? runtimeVersionId : null;
    let request;
    try {
        request = await parseAndVerifyD1ProbeReceiptRequestV1(input);
    } catch (error) {
        if (!(error instanceof D1ProbeRpcError)) {
            return unavailable(requestDigestFromV1(input), normalizedRuntimeVersionId);
        }
        return receiptResponseV1({
            schema_version: D1_PROBE_RPC_VERSION_V1,
            operation: "record_probe_receipt_v1",
            request_digest: requestDigestFromV1(input),
            status: "rejected",
            error_code: "invalid_request",
            receipt_id: null,
            sink_runtime_version_id: null,
        });
    }
    if (normalizedRuntimeVersionId === null) return unavailable(request.request_digest, null);

    const receiptId = randomUuid();
    let d1CallStarted = false;
    try {
        const statement = database
            .prepare(
                `INSERT INTO _openbot_probe_external_sink_receipt
                    (receipt_id, probe_run_id, writer_role, receipt_kind, source_request_digest, receipt_request_digest)
                 VALUES (?, ?, ?, ?, ?, ?)
                 RETURNING receipt_id`
            )
            .bind(
                receiptId,
                request.probe_run_id,
                request.writer_role,
                request.payload.kind,
                request.source_request_digest,
                request.request_digest
            );
        d1CallStarted = true;
        const result = await statement.all<{ receipt_id: string }>();
        if (result.success !== true || result.results?.length !== 1 || result.results[0]?.receipt_id !== receiptId) {
            throw new Error("unexpected D1 receipt result");
        }
        return receiptResponseV1({
            schema_version: D1_PROBE_RPC_VERSION_V1,
            operation: "record_probe_receipt_v1",
            request_digest: request.request_digest,
            status: "recorded",
            error_code: null,
            receipt_id: receiptId,
            sink_runtime_version_id: normalizedRuntimeVersionId,
        });
    } catch {
        return d1CallStarted
            ? receiptResponseV1({
                  schema_version: D1_PROBE_RPC_VERSION_V1,
                  operation: "record_probe_receipt_v1",
                  request_digest: request.request_digest,
                  status: "outcome_unknown",
                  error_code: "d1_outcome_unknown",
                  receipt_id: null,
                  sink_runtime_version_id: normalizedRuntimeVersionId,
              })
            : unavailable(request.request_digest, normalizedRuntimeVersionId);
    }
};
