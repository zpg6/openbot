import { spawn } from "node:child_process";

import {
    D1_PROBE_RUNTIME_VERSION_HEADER_V1,
    canonicalD1ProbeGatewayTrialHttpResponseV1,
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    gatewayTrialResponseV1,
    d1ProbeRuntimeVersionHeaderV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import {
    D1ProbeGatewayChildAssignmentV1Schema,
    D1ProbeGatewayChildResultV1Schema,
    canonicalD1ProbeGatewayChildAssignmentV1,
    canonicalD1ProbeGatewayChildResultV1,
    executeD1ProbeGatewayChildV1,
    readyForD1ProbeGatewayChildV1,
    type D1ProbeGatewayChildAssignmentV1,
    type D1ProbeGatewayChildGoV1,
} from "../src/child.js";

const exactUrl = "https://probe.example.test/openbot-d1-probe/writer-a/run-000000000001";
const clientId = `${"b".repeat(32)}.access`;
const clientSecret = "c".repeat(64);
const hex = (character: string): string => character.repeat(64);
const runtimeVersion = {
    id: "writer_a_version_001",
    tag: "probe-writer-a",
    timestamp: "2026-08-24T12:34:56.000Z",
} as const;

const trialRequest = async () => {
    const unsignedGateway: UnsignedD1ProbeGatewayReservationRequestV1 = {
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
    const gatewayRequest: D1ProbeGatewayReservationRequestV1 = {
        ...unsignedGateway,
        request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(unsignedGateway),
    };
    const unsignedTrial: UnsignedD1ProbeGatewayTrialRequestV1 = {
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
        gateway_request: gatewayRequest,
    };
    return {
        ...unsignedTrial,
        request_digest: await computeD1ProbeGatewayTrialRequestDigestV1(unsignedTrial),
    } satisfies D1ProbeGatewayTrialRequestV1;
};

const assignment = async (): Promise<D1ProbeGatewayChildAssignmentV1> => ({
    schema_version: 1,
    kind: "d1_probe_gateway_child_assignment",
    transport_config: {
        schema_version: 1,
        exact_trigger_url: exactUrl,
        access_service_token_client_id: clientId,
        writer_role: "writer_a",
        request_timeout_ms: 5_000,
    },
    trial: await trialRequest(),
});

const goFor = (input: D1ProbeGatewayChildAssignmentV1): D1ProbeGatewayChildGoV1 => ({
    schema_version: 1,
    kind: "d1_probe_gateway_child_go",
    child_process_id: input.trial.child_process_id,
    writer_role: input.trial.writer_role,
    request_digest: input.trial.request_digest,
    go_receipt_digest: input.trial.go_receipt_digest,
});

const writerResult = (trial: D1ProbeGatewayTrialRequestV1) =>
    gatewayTrialResponseV1({
        schema_version: 1,
        operation: "run_gateway_trial_v1",
        request_digest: trial.request_digest,
        writer_role: trial.writer_role,
        status: "outcome_unknown",
        error_code: "gateway_execution_unknown",
        readiness: null,
        barrier: null,
        readiness_denial_readback: null,
        gateway_response: null,
    });

const responseFrom = (body: string): Response =>
    new Response(body, {
        status: 503,
        headers: {
            "cache-control": "no-store",
            "content-length": String(new TextEncoder().encode(body).byteLength),
            "content-type": "application/json; charset=utf-8",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: d1ProbeRuntimeVersionHeaderV1(runtimeVersion),
        },
    });

interface ChildRun {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly messages: unknown[];
}

const runChild = async (options: {
    assignmentText?: string;
    go?: (ready: unknown) => unknown;
    secret?: string;
    ipc?: boolean;
}): Promise<ChildRun> =>
    await new Promise((resolve, reject) => {
        const useIpc = options.ipc !== false;
        const stdio: Array<"pipe" | "ignore" | "ipc"> = [
            "pipe",
            "pipe",
            "pipe",
            ...(useIpc ? (["ipc", "pipe"] as const) : []),
        ];
        const child = spawn(
            process.execPath,
            ["--import", "tsx", new URL("../src/child-cli.ts", import.meta.url).pathname],
            {
                cwd: new URL("../", import.meta.url).pathname,
                stdio,
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const messages: unknown[] = [];
        if (child.stdin === null || child.stdout === null || child.stderr === null) {
            reject(new Error("missing child standard stream"));
            return;
        }
        child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.stdin.on("error", () => undefined);
        child.on("message", message => {
            messages.push(message);
            if (options.go !== undefined && child.connected) child.send(options.go(message) as never);
        });
        child.once("error", reject);
        child.once("close", code =>
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
                messages,
            })
        );
        child.stdin.end(options.assignmentText ?? "{}");
        if (useIpc) {
            const secretStream = child.stdio[4];
            if (secretStream === undefined || secretStream === null || !("end" in secretStream)) {
                reject(new Error("missing child service-token stream"));
                return;
            }
            secretStream.on("error", () => undefined);
            secretStream.end(options.secret ?? "");
        }
    });

describe("D1 probe driver child", () => {
    it("binds READY, GO, one transport call, and one canonical result", async () => {
        const input = await assignment();
        const go = goFor(input);
        const body = canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(input.trial));
        const fetch = vi.fn<typeof globalThis.fetch>(async () => responseFrom(body));

        expect(readyForD1ProbeGatewayChildV1(input)).toEqual({
            schema_version: 1,
            kind: "d1_probe_gateway_child_ready",
            child_process_id: input.trial.child_process_id,
            writer_role: input.trial.writer_role,
            request_digest: input.trial.request_digest,
        });
        const execution = await executeD1ProbeGatewayChildV1(input, go, { client_secret: clientSecret }, { fetch });
        expect(execution).toMatchObject({
            success: true,
            result: {
                child_process_id: input.trial.child_process_id,
                request_digest: input.trial.request_digest,
                go_receipt_digest: input.trial.go_receipt_digest,
                transport_result: { status: "delivered" },
            },
        });
        expect(fetch).toHaveBeenCalledOnce();
        if (!execution.success) return;
        const canonical = canonicalD1ProbeGatewayChildResultV1(execution.result);
        expect(JSON.parse(canonical)).toEqual(execution.result);
        expect(canonical).not.toContain(clientSecret);
    });

    it("denies every GO substitution before transport", async () => {
        const input = await assignment();
        const go = goFor(input);
        const fetch = vi.fn<typeof globalThis.fetch>();
        const substitutions: D1ProbeGatewayChildGoV1[] = [
            { ...go, child_process_id: "child_process_0002" },
            { ...go, writer_role: "writer_b" },
            { ...go, request_digest: hex("5") },
            { ...go, go_receipt_digest: hex("6") },
        ];
        for (const substituted of substitutions) {
            expect(
                await executeD1ProbeGatewayChildV1(input, substituted, { client_secret: clientSecret }, { fetch })
            ).toEqual({ success: false, code: "invalid_go" });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects role drift, a forged trial digest, and a contradictory child result", async () => {
        const input = await assignment();
        expect(
            D1ProbeGatewayChildAssignmentV1Schema.safeParse({
                ...input,
                transport_config: { ...input.transport_config, writer_role: "writer_b" },
            }).success
        ).toBe(false);
        expect(
            await executeD1ProbeGatewayChildV1(
                { ...input, trial: { ...input.trial, request_digest: hex("7") } },
                goFor(input),
                { client_secret: clientSecret },
                { fetch: vi.fn() }
            )
        ).toEqual({ success: false, code: "invalid_assignment" });

        const body = canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(input.trial));
        const successful = await executeD1ProbeGatewayChildV1(
            input,
            goFor(input),
            { client_secret: clientSecret },
            {
                fetch: vi.fn(async () => responseFrom(body)),
            }
        );
        if (!successful.success) throw new Error(successful.code);
        expect(
            D1ProbeGatewayChildResultV1Schema.safeParse({
                ...successful.result,
                writer_role: "writer_b",
            }).success
        ).toBe(false);
        expect(
            D1ProbeGatewayChildResultV1Schema.safeParse({
                ...successful.result,
                transport_result: { ...successful.result.transport_result, http_status: 200 },
            }).success
        ).toBe(false);
    });

    it("uses exact canonical assignment bytes", async () => {
        const input = await assignment();
        const canonical = await canonicalD1ProbeGatewayChildAssignmentV1(input);
        expect(await canonicalD1ProbeGatewayChildAssignmentV1(JSON.parse(canonical))).toBe(canonical);
        await expect(canonicalD1ProbeGatewayChildAssignmentV1({ ...input, unknown: true })).rejects.toThrow(TypeError);
    });

    it("starts only with IPC and rejects noncanonical assignment bytes", async () => {
        expect(await runChild({ ipc: false })).toEqual({
            code: 1,
            stdout: "",
            stderr: "ipc_unavailable\n",
            messages: [],
        });
        const input = await assignment();
        const noncanonical = `${JSON.stringify(input, null, 2)}\n`;
        expect(await runChild({ assignmentText: noncanonical, secret: clientSecret })).toMatchObject({
            code: 1,
            stdout: "",
            stderr: "invalid_assignment\n",
            messages: [],
        });
    }, 20_000);

    it("emits READY, rejects a substituted GO, and never reads the network", async () => {
        const input = await assignment();
        const canonical = await canonicalD1ProbeGatewayChildAssignmentV1(input);
        const run = await runChild({
            assignmentText: canonical,
            secret: clientSecret,
            go: () => ({ ...goFor(input), request_digest: hex("8") }),
        });
        expect(run).toMatchObject({ code: 1, stdout: "", stderr: "go_invalid\n" });
        expect(run.messages).toEqual([
            {
                schema_version: 1,
                kind: "d1_probe_gateway_child_ready",
                child_process_id: input.trial.child_process_id,
                writer_role: input.trial.writer_role,
                request_digest: input.trial.request_digest,
            },
        ]);
    }, 20_000);

    it("reads the service token only after valid GO and fails closed when FD 4 is empty", async () => {
        const input = await assignment();
        const run = await runChild({
            assignmentText: await canonicalD1ProbeGatewayChildAssignmentV1(input),
            go: () => goFor(input),
        });
        expect(run).toMatchObject({ code: 1, stdout: "", stderr: "service_token_unavailable\n" });
        expect(run.messages).toHaveLength(1);
    }, 20_000);

    it("rejects 513 secret bytes without treating the last byte as an optional newline", async () => {
        const input = await assignment();
        const run = await runChild({
            assignmentText: await canonicalD1ProbeGatewayChildAssignmentV1(input),
            go: () => goFor(input),
            secret: "c".repeat(513),
        });
        expect(run).toMatchObject({ code: 1, stdout: "", stderr: "service_token_unavailable\n" });
        expect(run.messages).toHaveLength(1);
    }, 20_000);
});
