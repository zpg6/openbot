import { describe, expect, it } from "vitest";

import {
    D1ProbeRpcError,
    computeD1ProbeReceiptRequestDigestV1,
    parseAndVerifyD1ProbeReceiptRequestV1,
    receiptResponseV1,
    type UnsignedD1ProbeReceiptRequestV1,
} from "../src/protocol.js";

const hex = (character: string): string => character.repeat(64);

const unsigned = (kind: "private_rpc_probe" | "gateway_dispatch" | "destroy_observation") =>
    ({
        schema_version: 1,
        operation: "record_probe_receipt_v1",
        request_id: "request_0000000001",
        probe_run_id: "probe_run_0000001",
        writer_role: "writer_a",
        source_request_digest: hex("1"),
        payload:
            kind === "private_rpc_probe"
                ? { kind, setup_nonce_digest: hex("2") }
                : kind === "gateway_dispatch"
                  ? {
                        kind,
                        call_kind: "code",
                        logical_call_id: "logical_call_0001",
                        attempt_id: "attempt_00000001",
                        call_sequence: 1,
                        reservation_id: "reservation_0001",
                        dispatch_request_digest: hex("3"),
                    }
                  : {
                        kind,
                        installation_id_digest: hex("4"),
                        run_id: "run_000000000001",
                        run_attempt_fence: 1,
                        claim_id: "claim_0000000001",
                        sandbox_id_digest: hex("5"),
                        destroy_receipt_digest: hex("6"),
                    },
    }) as UnsignedD1ProbeReceiptRequestV1;

describe("D1 probe private receipt RPC", () => {
    it("binds every receipt kind to a deterministic request digest", async () => {
        for (const kind of ["private_rpc_probe", "gateway_dispatch", "destroy_observation"] as const) {
            const request = unsigned(kind);
            const requestDigest = await computeD1ProbeReceiptRequestDigestV1(request);
            await expect(
                parseAndVerifyD1ProbeReceiptRequestV1({ ...request, request_digest: requestDigest })
            ).resolves.toEqual({
                ...request,
                request_digest: requestDigest,
            });
        }
        expect(await computeD1ProbeReceiptRequestDigestV1(unsigned("private_rpc_probe"))).toBe(
            "8b9944464fe8fe0e36566015547613a808263e36f147b9114f128412d9b674a6"
        );
    });

    it("denies field substitution, extra fields, and hostile objects", async () => {
        const request = unsigned("gateway_dispatch");
        const requestDigest = await computeD1ProbeReceiptRequestDigestV1(request);
        await expect(
            parseAndVerifyD1ProbeReceiptRequestV1({
                ...request,
                writer_role: "writer_b",
                request_digest: requestDigest,
            })
        ).rejects.toMatchObject({ code: "digest_mismatch" });
        await expect(
            parseAndVerifyD1ProbeReceiptRequestV1({ ...request, request_digest: requestDigest, sql: "SELECT 1" })
        ).rejects.toBeInstanceOf(D1ProbeRpcError);
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile request");
                },
            }
        );
        await expect(parseAndVerifyD1ProbeReceiptRequestV1(hostile)).rejects.toMatchObject({
            code: "invalid_request",
        });
    });

    it("keeps terminal response states disjoint", () => {
        expect(() =>
            receiptResponseV1({
                schema_version: 1,
                operation: "record_probe_receipt_v1",
                request_digest: hex("a"),
                status: "recorded",
                error_code: null,
                receipt_id: null,
                sink_runtime_version_id: "version_00000001",
            })
        ).toThrow(TypeError);
        expect(
            receiptResponseV1({
                schema_version: 1,
                operation: "record_probe_receipt_v1",
                request_digest: hex("a"),
                status: "outcome_unknown",
                error_code: "d1_outcome_unknown",
                receipt_id: null,
                sink_runtime_version_id: null,
            }).status
        ).toBe("outcome_unknown");
    });
});
