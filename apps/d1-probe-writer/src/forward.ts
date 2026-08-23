import {
    D1_PROBE_RPC_VERSION_V1,
    D1ProbeRpcError,
    D1ProbeReceiptResponseV1Schema,
    parseAndVerifyD1ProbeReceiptRequestV1,
    receiptResponseV1,
    type D1ProbeReceiptResponseV1,
    type D1ProbeSinkServiceV1,
    type D1ProbeWriterRoleV1,
} from "@openbot/d1-probe-rpc";

const digestFrom = (input: unknown): string => {
    try {
        if (typeof input !== "object" || input === null || !("request_digest" in input)) return "0".repeat(64);
        const value = input.request_digest;
        return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : "0".repeat(64);
    } catch {
        return "0".repeat(64);
    }
};

const rejected = (input: unknown): D1ProbeReceiptResponseV1 =>
    receiptResponseV1({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "record_probe_receipt_v1",
        request_digest: digestFrom(input),
        status: "rejected",
        error_code: "invalid_request",
        receipt_id: null,
        sink_runtime_version_id: null,
    });

const writerUnavailable = (input: unknown): D1ProbeReceiptResponseV1 =>
    receiptResponseV1({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "record_probe_receipt_v1",
        request_digest: digestFrom(input),
        status: "unavailable",
        error_code: "writer_unavailable",
        receipt_id: null,
        sink_runtime_version_id: null,
    });

export const forwardProbeReceiptV1 = async (
    sink: D1ProbeSinkServiceV1,
    expectedRole: D1ProbeWriterRoleV1,
    input: unknown
): Promise<D1ProbeReceiptResponseV1> => {
    let request;
    try {
        request = await parseAndVerifyD1ProbeReceiptRequestV1(input);
    } catch (error) {
        return error instanceof D1ProbeRpcError ? rejected(input) : writerUnavailable(input);
    }
    if (request.writer_role !== expectedRole) return rejected(input);
    try {
        const response = await sink.record(request);
        const parsed = D1ProbeReceiptResponseV1Schema.safeParse(response);
        if (!parsed.success || parsed.data.request_digest !== request.request_digest)
            throw new Error("invalid sink response");
        return parsed.data;
    } catch {
        return receiptResponseV1({
            schema_version: D1_PROBE_RPC_VERSION_V1,
            operation: "record_probe_receipt_v1",
            request_digest: request.request_digest,
            status: "outcome_unknown",
            error_code: "d1_outcome_unknown",
            receipt_id: null,
            sink_runtime_version_id: null,
        });
    }
};
