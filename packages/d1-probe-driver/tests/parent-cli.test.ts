import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
import { canonicalD1ProbeGatewayParentAssignmentV1, type D1ProbeGatewayParentAssignmentV1 } from "../src/parent.js";

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

const assignment = async (): Promise<D1ProbeGatewayParentAssignmentV1> => ({
    schema_version: 1,
    kind: "d1_probe_gateway_parent_assignment",
    parent_run_id: "parent_run_000001",
    children: [await childAssignment("writer_a"), await childAssignment("writer_b")],
});

interface ParentRun {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

const runParent = async (options: {
    assignmentText?: string;
    secret?: string;
    extraArgument?: string;
}): Promise<ParentRun> =>
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "--import",
                "tsx",
                fileURLToPath(new URL("../src/parent-cli.ts", import.meta.url)),
                ...(options.extraArgument === undefined ? [] : [options.extraArgument]),
            ],
            {
                cwd: fileURLToPath(new URL("../", import.meta.url)),
                stdio: ["pipe", "pipe", "pipe", "pipe"],
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdin === null || child.stdout === null || child.stderr === null) {
            reject(new Error("missing parent standard stream"));
            return;
        }
        child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.stdin.on("error", () => undefined);
        child.once("error", reject);
        child.once("close", code =>
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            })
        );
        child.stdin.end(options.assignmentText ?? "{}");
        const secretStream = child.stdio[3];
        if (secretStream === undefined || secretStream === null || !("end" in secretStream)) {
            reject(new Error("missing parent service-token stream"));
            return;
        }
        // Early-denial cases intentionally close the credential descriptor
        // without reading it. Linux reports that peer close as ECONNRESET.
        secretStream.on("error", () => undefined);
        secretStream.end(options.secret ?? "");
    });

describe("D1 probe gateway parent command", () => {
    it("accepts no arguments", async () => {
        expect(await runParent({ extraArgument: "unexpected", secret: clientSecret })).toEqual({
            code: 1,
            stdout: "",
            stderr: "usage_error\n",
        });
    }, 20_000);

    it("rejects noncanonical parent input", async () => {
        const input = await assignment();
        expect(
            await runParent({ assignmentText: `${JSON.stringify(input, null, 2)}\n`, secret: clientSecret })
        ).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_assignment\n",
        });
    }, 20_000);

    it("closes an empty credential descriptor before spawning children", async () => {
        const input = await assignment();
        expect(await runParent({ assignmentText: await canonicalD1ProbeGatewayParentAssignmentV1(input) })).toEqual({
            code: 1,
            stdout: "",
            stderr: "service_token_unavailable\n",
        });
    }, 20_000);

    it("rejects 513 secret bytes without treating the last byte as an optional newline", async () => {
        const input = await assignment();
        expect(
            await runParent({
                assignmentText: await canonicalD1ProbeGatewayParentAssignmentV1(input),
                secret: "c".repeat(513),
            })
        ).toEqual({
            code: 1,
            stdout: "",
            stderr: "service_token_unavailable\n",
        });
    }, 20_000);
});
