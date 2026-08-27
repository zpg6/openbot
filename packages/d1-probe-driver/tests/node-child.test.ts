import {
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeWriterRoleV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it } from "vitest";

import type { D1ProbeGatewayChildAssignmentV1 } from "../src/child.js";
import {
    D1_PROBE_PARENT_CHILD_OUTPUT_LIMIT_BYTES_V1,
    createNodeD1ProbeGatewayParentDependenciesV1,
} from "../src/node-child.js";
import { executeD1ProbeGatewayParentV1, type D1ProbeGatewayParentAssignmentV1 } from "../src/parent.js";

const clientId = `${"b".repeat(32)}.access`;
const clientSecret = "c".repeat(64);
const hex = (character: string): string => character.repeat(64);

const childAssignment = async (writerRole: D1ProbeWriterRoleV1): Promise<D1ProbeGatewayChildAssignmentV1> => {
    const suffix = writerRole === "writer_a" ? "a" : "b";
    const gateway: UnsignedD1ProbeGatewayReservationRequestV1 = {
        schema_version: 1,
        operation: "reserve_gateway_call_v1",
        request_id: `gateway_request_000${suffix}`,
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
        ...gateway,
        request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(gateway),
    };
    const trial: UnsignedD1ProbeGatewayTrialRequestV1 = {
        schema_version: 1,
        operation: "run_gateway_trial_v1",
        request_id: `trial_request_000${suffix}`,
        probe_run_id: "probe_run_0000001",
        trial_id: "gateway_trial_0001",
        child_process_id: `child_process_000${suffix}`,
        writer_role: writerRole,
        expected_contender_count: 2,
        go_receipt_digest: hex(writerRole === "writer_a" ? "4" : "5"),
        barrier_timeout_ms: 2_000,
        barrier_poll_interval_ms: 25,
        gateway_request: gatewayRequest,
    };
    return {
        schema_version: 1,
        kind: "d1_probe_gateway_child_assignment",
        transport_config: {
            schema_version: 1,
            exact_trigger_url: `https://probe.example.test/openbot-d1-probe/${writerRole}/run-000000000001`,
            access_service_token_client_id: clientId,
            writer_role: writerRole,
            request_timeout_ms: 5_000,
        },
        trial: { ...trial, request_digest: await computeD1ProbeGatewayTrialRequestDigestV1(trial) },
    };
};

describe("D1 probe Node child adapter", () => {
    it("spawns two operating-system children and collects one bound result from each", async () => {
        expect(D1_PROBE_PARENT_CHILD_OUTPUT_LIMIT_BYTES_V1).toBe(131_072);
        const input: D1ProbeGatewayParentAssignmentV1 = {
            schema_version: 1,
            kind: "d1_probe_gateway_parent_assignment",
            parent_run_id: "parent_run_000001",
            children: [await childAssignment("writer_a"), await childAssignment("writer_b")],
        };
        const execution = await executeD1ProbeGatewayParentV1(
            input,
            { client_secret: clientSecret },
            createNodeD1ProbeGatewayParentDependenciesV1({
                entrypoint: new URL("./fixtures/parent-child.ts", import.meta.url),
            })
        );
        expect(execution).toMatchObject({
            success: true,
            result: {
                status: "completed",
                go_release_attempted: true,
                children: [
                    { writer_role: "writer_a", transport_result: { status: "outcome_unknown" } },
                    { writer_role: "writer_b", transport_result: { status: "outcome_unknown" } },
                ],
            },
        });
        expect(JSON.stringify(execution)).not.toContain(clientSecret);
    }, 20_000);
});
