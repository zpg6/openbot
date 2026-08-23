import { describe, expect, it } from "vitest";

import {
    D1ProbeGatewayReservationResponseV1Schema,
    D1ProbeRpcError,
    computeD1ProbeGatewayReservationRequestDigestV1,
    gatewayReservationResponseV1,
    parseAndVerifyD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
} from "./index.js";

const hex = (character: string): string => character.repeat(64);

const unsigned = (): UnsignedD1ProbeGatewayReservationRequestV1 => ({
    schema_version: 1,
    operation: "reserve_gateway_call_v1",
    request_id: "request_0000000001",
    probe_run_id: "probe_run_0000001",
    scenario: "code_normal",
    writer_role: "writer_a",
    request_variant: "exact",
    call_kind: "code",
    logical_call_id: "logical_call_0001",
    attempt_id: "attempt_00000001",
    call_sequence: 1,
    reservation_id: "reservation_0001",
    dispatch_request_digest: hex("3"),
    fault_point: "none",
});

describe("deployed D1 gateway reservation protocol", () => {
    it("binds every request field into one deterministic digest", async () => {
        const request = unsigned();
        const digest = await computeD1ProbeGatewayReservationRequestDigestV1(request);
        await expect(
            parseAndVerifyD1ProbeGatewayReservationRequestV1({ ...request, request_digest: digest })
        ).resolves.toEqual({
            ...request,
            request_digest: digest,
        });
        expect(digest).toBe("b1982e64ba7aba85147a3b40ce7abcf803cd3d172ac264dc88dc72c7db503a0d");

        for (const substitution of [
            { writer_role: "writer_b" },
            { request_variant: "substituted" },
            { call_kind: "model" },
            { call_sequence: 2 },
            { reservation_id: "reservation_0002" },
            { dispatch_request_digest: hex("4") },
            { fault_point: "reserve_then_crash" },
        ]) {
            await expect(
                parseAndVerifyD1ProbeGatewayReservationRequestV1({
                    ...request,
                    ...substitution,
                    request_digest: digest,
                })
            ).rejects.toMatchObject({ code: "digest_mismatch" });
        }
    });

    it("rejects extras and hostile request objects without leaking exceptions", async () => {
        const request = unsigned();
        const requestDigest = await computeD1ProbeGatewayReservationRequestDigestV1(request);
        await expect(
            parseAndVerifyD1ProbeGatewayReservationRequestV1({
                ...request,
                request_digest: requestDigest,
                sql: "SELECT 1",
            })
        ).rejects.toBeInstanceOf(D1ProbeRpcError);
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile request");
                },
            }
        );
        await expect(parseAndVerifyD1ProbeGatewayReservationRequestV1(hostile)).rejects.toMatchObject({
            code: "invalid_request",
        });
    });

    it("keeps reservation terminal states and sink outcomes consistent", () => {
        const response = {
            schema_version: 1,
            operation: "reserve_gateway_call_v1",
            request_digest: hex("a"),
            writer_role: "writer_a",
            status: "reserved_without_dispatch",
            error_code: "sink_rejected",
            committed_batch: null,
            sink_response: {
                schema_version: 1,
                operation: "record_probe_receipt_v1",
                request_digest: hex("b"),
                status: "unavailable",
                error_code: "sink_unavailable",
                receipt_id: null,
                sink_runtime_version_id: null,
            },
            readback: null,
        };
        expect(D1ProbeGatewayReservationResponseV1Schema.safeParse(response).success).toBe(false);
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        expect(() => gatewayReservationResponseV1(hostile)).toThrow(TypeError);
    });
});
