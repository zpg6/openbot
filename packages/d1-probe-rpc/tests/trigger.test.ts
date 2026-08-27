import { describe, expect, it } from "vitest";

import {
    D1ProbeGatewayBarrierReadbackV1Schema,
    D1ProbeGatewayReadinessDenialReadbackV1Schema,
    D1ProbeGatewayTrialResponseV1Schema,
    D1ProbeRpcError,
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    gatewayTrialResponseV1,
    parseAndVerifyD1ProbeGatewayTrialRequestV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "../src/index.js";

const hex = (character: string): string => character.repeat(64);

const metadata = {
    changes: 0,
    rows_read: 1,
    rows_written: 0,
    changed_db: false,
    served_by_primary: true,
    served_by: "d1-primary",
    served_by_region: "WNAM",
    duration: 1,
    timings: { sql_duration_ms: 0.5 },
    total_attempts: 1,
    last_row_id: 0,
    size_after: 4096,
};

const gatewayRequest = async () => {
    const unsigned: UnsignedD1ProbeGatewayReservationRequestV1 = {
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
    return { ...unsigned, request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(unsigned) };
};

const unsignedTrial = async (): Promise<UnsignedD1ProbeGatewayTrialRequestV1> => ({
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
    gateway_request: await gatewayRequest(),
});

describe("D1 probe gateway trigger protocol", () => {
    it("binds the child, GO receipt, barrier limits, and verified gateway request", async () => {
        const request = await unsignedTrial();
        const digest = await computeD1ProbeGatewayTrialRequestDigestV1(request);
        await expect(
            parseAndVerifyD1ProbeGatewayTrialRequestV1({ ...request, request_digest: digest })
        ).resolves.toEqual({
            ...request,
            request_digest: digest,
        });
        expect(digest).toBe("1f959fe23d86b1791f8940513d86df6475e21dec7835cab03dfb433f76869868");

        for (const substitution of [
            { child_process_id: "child_process_0002" },
            { writer_role: "writer_b" },
            { go_receipt_digest: hex("5") },
            { barrier_timeout_ms: 1_999 },
            { barrier_poll_interval_ms: 26 },
        ]) {
            await expect(
                parseAndVerifyD1ProbeGatewayTrialRequestV1({ ...request, ...substitution, request_digest: digest })
            ).rejects.toBeInstanceOf(D1ProbeRpcError);
        }
    });

    it("rejects a mismatched or forged nested gateway request", async () => {
        const request = await unsignedTrial();
        await expect(
            computeD1ProbeGatewayTrialRequestDigestV1({
                ...request,
                trial_id: "different_trial_01",
            })
        ).rejects.toMatchObject({ code: "invalid_request" });
        await expect(
            computeD1ProbeGatewayTrialRequestDigestV1({
                ...request,
                gateway_request: { ...request.gateway_request, request_digest: hex("f") },
            })
        ).rejects.toMatchObject({ code: "digest_mismatch" });
    });

    it("rejects extra fields, hostile objects, and contradictory terminal states", async () => {
        const request = await unsignedTrial();
        const digest = await computeD1ProbeGatewayTrialRequestDigestV1(request);
        await expect(
            parseAndVerifyD1ProbeGatewayTrialRequestV1({ ...request, request_digest: digest, sql: "SELECT 1" })
        ).rejects.toBeInstanceOf(D1ProbeRpcError);
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        await expect(parseAndVerifyD1ProbeGatewayTrialRequestV1(hostile)).rejects.toMatchObject({
            code: "invalid_request",
        });
        const contradiction = {
            schema_version: 1,
            operation: "run_gateway_trial_v1",
            request_digest: hex("a"),
            writer_role: "writer_a",
            status: "barrier_timeout",
            error_code: "barrier_timeout",
            readiness: null,
            barrier: null,
            readiness_denial_readback: null,
            gateway_response: null,
        };
        expect(D1ProbeGatewayTrialResponseV1Schema.safeParse(contradiction).success).toBe(false);
        expect(() => gatewayTrialResponseV1(hostile)).toThrow(TypeError);
    });

    it("requires each readiness row to have its matching guard", () => {
        expect(
            D1ProbeGatewayBarrierReadbackV1Schema.safeParse({
                probe_run_id: "probe_run_0000001",
                trial_id: "gateway_trial_0001",
                trial_state: "open",
                expected_contender_count: 2,
                assignment_count: 2,
                assigned_writer_role_count: 2,
                distinct_go_receipt_count: 2,
                distinct_operation_request_count: 2,
                ready_count: 2,
                readiness_guard_count: 1,
                ready_writer_role_count: 2,
                ready_child_process_ids: ["child_process_0001", "child_process_0002"],
                poll_attempt: 1,
                metadata,
            }).success
        ).toBe(false);
        expect(
            D1ProbeGatewayReadinessDenialReadbackV1Schema.safeParse({
                probe_run_id: "probe_run_0000001",
                trial_id: "gateway_trial_0001",
                trial_state: "open",
                assignment_count: 1,
                readiness_count: 1,
                readiness_guard_count: 0,
                stored_request_digest: hex("a"),
                metadata,
            }).success
        ).toBe(false);
    });
});
