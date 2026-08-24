import {
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeWriterRoleV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import {
    type D1ProbeGatewayChildAssignmentV1,
    type D1ProbeGatewayChildGoV1,
    type D1ProbeGatewayChildReadyV1,
    type D1ProbeGatewayChildResultV1,
} from "./child.js";
import {
    D1ProbeGatewayParentAssignmentV1Schema,
    canonicalD1ProbeGatewayParentAssignmentV1,
    canonicalD1ProbeGatewayParentResultV1,
    executeD1ProbeGatewayParentV1,
    type D1ProbeGatewayParentAssignmentV1,
    type D1ProbeGatewayParentChildHandleV1,
} from "./parent.js";

const clientId = `${"b".repeat(32)}.access`;
const clientSecret = "c".repeat(64);
const hex = (character: string): string => character.repeat(64);

const trialRequest = async (writerRole: D1ProbeWriterRoleV1): Promise<D1ProbeGatewayTrialRequestV1> => {
    const suffix = writerRole === "writer_a" ? "a" : "b";
    const unsignedGateway: UnsignedD1ProbeGatewayReservationRequestV1 = {
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
        ...unsignedGateway,
        request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(unsignedGateway),
    };
    const unsignedTrial: UnsignedD1ProbeGatewayTrialRequestV1 = {
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
        ...unsignedTrial,
        request_digest: await computeD1ProbeGatewayTrialRequestDigestV1(unsignedTrial),
    };
};

const assignment = async (writerRole: D1ProbeWriterRoleV1): Promise<D1ProbeGatewayChildAssignmentV1> => ({
    schema_version: 1,
    kind: "d1_probe_gateway_child_assignment",
    transport_config: {
        schema_version: 1,
        exact_trigger_url: `https://probe.example.test/openbot-d1-probe/${writerRole}/run-000000000001`,
        access_service_token_client_id: clientId,
        writer_role: writerRole,
        request_timeout_ms: 5_000,
    },
    trial: await trialRequest(writerRole),
});

const parentAssignment = async (): Promise<D1ProbeGatewayParentAssignmentV1> => ({
    schema_version: 1,
    kind: "d1_probe_gateway_parent_assignment",
    parent_run_id: "parent_run_000001",
    children: [await assignment("writer_a"), await assignment("writer_b")],
});

const readyFor = (child: D1ProbeGatewayChildAssignmentV1): D1ProbeGatewayChildReadyV1 => ({
    schema_version: 1,
    kind: "d1_probe_gateway_child_ready",
    child_process_id: child.trial.child_process_id,
    writer_role: child.trial.writer_role,
    request_digest: child.trial.request_digest,
});

const resultFor = (child: D1ProbeGatewayChildAssignmentV1): D1ProbeGatewayChildResultV1 => ({
    schema_version: 1,
    kind: "d1_probe_gateway_child_result",
    child_process_id: child.trial.child_process_id,
    writer_role: child.trial.writer_role,
    request_digest: child.trial.request_digest,
    go_receipt_digest: child.trial.go_receipt_digest,
    transport_result: {
        status: "outcome_unknown",
        request_digest: child.trial.request_digest,
        writer_role: child.trial.writer_role,
        error_code: "network_error",
    },
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const handleFor = (
    child: D1ProbeGatewayChildAssignmentV1,
    ready: Promise<D1ProbeGatewayChildReadyV1> = Promise.resolve(readyFor(child))
) => {
    const release = vi.fn(async (_go: D1ProbeGatewayChildGoV1) => resultFor(child));
    const terminate = vi.fn(async () => undefined);
    return { handle: { ready, release, terminate } satisfies D1ProbeGatewayParentChildHandleV1, release, terminate };
};

describe("D1 probe gateway parent", () => {
    it("waits for both exact READY messages before releasing either child", async () => {
        const input = await parentAssignment();
        const secondReady = deferred<D1ProbeGatewayChildReadyV1>();
        const first = handleFor(input.children[0]);
        const second = handleFor(input.children[1], secondReady.promise);
        const spawnChild = vi.fn().mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);

        const executionPromise = executeD1ProbeGatewayParentV1(input, { client_secret: clientSecret }, { spawnChild });
        await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));
        expect(first.release).not.toHaveBeenCalled();
        expect(second.release).not.toHaveBeenCalled();
        secondReady.resolve(readyFor(input.children[1]));

        const execution = await executionPromise;
        expect(execution).toMatchObject({
            success: true,
            result: { status: "completed", go_release_attempted: true, authoritative: false },
        });
        expect(first.release).toHaveBeenCalledOnce();
        expect(second.release).toHaveBeenCalledOnce();
        if (!execution.success) return;
        expect(JSON.parse(canonicalD1ProbeGatewayParentResultV1(execution.result))).toEqual(execution.result);
    });

    it("rejects cross-trial, duplicate, forged, and hostile assignments before spawn", async () => {
        const input = await parentAssignment();
        const spawnChild = vi.fn();
        const cases: unknown[] = [
            { ...input, children: [input.children[1], input.children[0]] },
            {
                ...input,
                children: [
                    input.children[0],
                    { ...input.children[1], trial: { ...input.children[1].trial, trial_id: "other_trial_0001" } },
                ],
            },
            {
                ...input,
                children: [
                    input.children[0],
                    {
                        ...input.children[1],
                        trial: {
                            ...input.children[1].trial,
                            child_process_id: input.children[0].trial.child_process_id,
                        },
                    },
                ],
            },
            {
                ...input,
                children: [
                    input.children[0],
                    {
                        ...input.children[1],
                        transport_config: { ...input.children[1].transport_config, request_timeout_ms: 4_000 },
                    },
                ],
            },
            {
                ...input,
                children: [
                    input.children[0],
                    {
                        ...input.children[1],
                        transport_config: {
                            ...input.children[1].transport_config,
                            exact_trigger_url:
                                "https://other-probe.example.test/openbot-d1-probe/writer_b/run-000000000001",
                        },
                    },
                ],
            },
            {
                ...input,
                children: [
                    input.children[0],
                    {
                        ...input.children[1],
                        trial: {
                            ...input.children[1].trial,
                            gateway_request: {
                                ...input.children[1].trial.gateway_request,
                                attempt_id: "attempt_00000002",
                            },
                        },
                    },
                ],
            },
            {
                ...input,
                children: [
                    input.children[0],
                    { ...input.children[1], trial: { ...input.children[1].trial, request_digest: hex("9") } },
                ],
            },
            new Proxy(
                {},
                {
                    ownKeys: () => {
                        throw new Error("hostile parent");
                    },
                }
            ),
        ];
        for (const candidate of cases) {
            expect(
                await executeD1ProbeGatewayParentV1(candidate, { client_secret: clientSecret }, { spawnChild })
            ).toEqual({ success: false, code: "invalid_assignment" });
        }
        expect(spawnChild).not.toHaveBeenCalled();
    });

    it("rejects an unavailable service token before spawn", async () => {
        const spawnChild = vi.fn();
        expect(await executeD1ProbeGatewayParentV1(await parentAssignment(), {}, { spawnChild })).toEqual({
            success: false,
            code: "service_token_unavailable",
        });
        expect(spawnChild).not.toHaveBeenCalled();
    });

    it("terminates every spawned child when the second spawn fails", async () => {
        const input = await parentAssignment();
        const first = handleFor(input.children[0]);
        const spawnChild = vi.fn().mockResolvedValueOnce(first.handle).mockRejectedValueOnce(new Error("spawn"));
        expect(
            await executeD1ProbeGatewayParentV1(input, { client_secret: clientSecret }, { spawnChild })
        ).toMatchObject({
            success: true,
            result: { status: "inconclusive", error_code: "child_spawn_failed", go_release_attempted: false },
        });
        expect(first.terminate).toHaveBeenCalledOnce();
        expect(first.release).not.toHaveBeenCalled();
    });

    it("reports failed child termination instead of hiding cleanup ambiguity", async () => {
        const input = await parentAssignment();
        const first = handleFor(input.children[0]);
        first.terminate.mockRejectedValueOnce(new Error("termination failed"));
        const spawnChild = vi.fn().mockResolvedValueOnce(first.handle).mockRejectedValueOnce(new Error("spawn"));
        expect(
            await executeD1ProbeGatewayParentV1(input, { client_secret: clientSecret }, { spawnChild })
        ).toMatchObject({
            success: true,
            result: { status: "inconclusive", error_code: "child_termination_failed" },
        });
    });

    it("waits for every termination attempt when another termination fails", async () => {
        const input = await parentAssignment();
        const rejectedReady = Promise.reject<D1ProbeGatewayChildReadyV1>(new Error("ready failed"));
        void rejectedReady.catch(() => undefined);
        const first = handleFor(input.children[0], rejectedReady);
        const second = handleFor(input.children[1]);
        const secondTermination = deferred<undefined>();
        first.terminate.mockRejectedValueOnce(new Error("termination failed"));
        second.terminate.mockImplementationOnce(async () => await secondTermination.promise);
        let settled = false;
        const executionPromise = executeD1ProbeGatewayParentV1(
            input,
            { client_secret: clientSecret },
            {
                spawnChild: vi.fn().mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle),
            }
        ).finally(() => {
            settled = true;
        });
        await vi.waitFor(() => {
            expect(first.terminate).toHaveBeenCalledOnce();
            expect(second.terminate).toHaveBeenCalledOnce();
        });
        expect(settled).toBe(false);
        secondTermination.resolve(undefined);
        expect(await executionPromise).toMatchObject({
            success: true,
            result: { status: "inconclusive", error_code: "child_termination_failed" },
        });
    });

    it("does not release GO when either READY fails or is substituted", async () => {
        const input = await parentAssignment();
        for (const readyFactory of [
            () => {
                const value = Promise.reject<D1ProbeGatewayChildReadyV1>(new Error("ready failed"));
                void value.catch(() => undefined);
                return value;
            },
            () => Promise.resolve({ ...readyFor(input.children[1]), request_digest: hex("8") }),
        ]) {
            const first = handleFor(input.children[0]);
            const second = handleFor(input.children[1], readyFactory());
            const spawnChild = vi.fn().mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);
            expect(
                await executeD1ProbeGatewayParentV1(input, { client_secret: clientSecret }, { spawnChild })
            ).toMatchObject({
                success: true,
                result: { status: "inconclusive", error_code: "child_ready_failed", go_release_attempted: false },
            });
            expect(first.release).not.toHaveBeenCalled();
            expect(second.release).not.toHaveBeenCalled();
            expect(first.terminate).toHaveBeenCalledOnce();
            expect(second.terminate).toHaveBeenCalledOnce();
        }
    });

    it("terminates both children when the parent is interrupted before GO", async () => {
        const input = await parentAssignment();
        const controller = new AbortController();
        const secondReady = deferred<D1ProbeGatewayChildReadyV1>();
        const first = handleFor(input.children[0]);
        const second = handleFor(input.children[1], secondReady.promise);
        const spawnChild = vi.fn().mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);
        const executionPromise = executeD1ProbeGatewayParentV1(
            input,
            { client_secret: clientSecret },
            {
                signal: controller.signal,
                spawnChild,
            }
        );
        await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));
        controller.abort();
        expect(await executionPromise).toMatchObject({
            success: true,
            result: {
                status: "inconclusive",
                error_code: "parent_interrupted",
                go_release_attempted: false,
            },
        });
        expect(first.release).not.toHaveBeenCalled();
        expect(second.release).not.toHaveBeenCalled();
        expect(first.terminate).toHaveBeenCalledOnce();
        expect(second.terminate).toHaveBeenCalledOnce();
    });

    it("does not spawn a child when the parent signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const spawnChild = vi.fn();
        expect(
            await executeD1ProbeGatewayParentV1(
                await parentAssignment(),
                { client_secret: clientSecret },
                {
                    signal: controller.signal,
                    spawnChild,
                }
            )
        ).toMatchObject({
            success: true,
            result: {
                status: "inconclusive",
                error_code: "parent_interrupted",
                go_release_attempted: false,
            },
        });
        expect(spawnChild).not.toHaveBeenCalled();
    });

    it("terminates both children when the parent is interrupted after GO", async () => {
        const input = await parentAssignment();
        const controller = new AbortController();
        const firstResult = deferred<D1ProbeGatewayChildResultV1>();
        const secondResult = deferred<D1ProbeGatewayChildResultV1>();
        const first = handleFor(input.children[0]);
        const second = handleFor(input.children[1]);
        first.release.mockImplementationOnce(async () => await firstResult.promise);
        second.release.mockImplementationOnce(async () => await secondResult.promise);
        const executionPromise = executeD1ProbeGatewayParentV1(
            input,
            { client_secret: clientSecret },
            {
                signal: controller.signal,
                spawnChild: vi.fn().mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle),
            }
        );
        await vi.waitFor(() => {
            expect(first.release).toHaveBeenCalledOnce();
            expect(second.release).toHaveBeenCalledOnce();
        });
        controller.abort();
        expect(await executionPromise).toMatchObject({
            success: true,
            result: {
                status: "inconclusive",
                error_code: "parent_interrupted",
                go_release_attempted: true,
            },
        });
        expect(first.terminate).toHaveBeenCalledOnce();
        expect(second.terminate).toHaveBeenCalledOnce();
    });

    it("marks release failure and substituted results inconclusive without retry", async () => {
        const input = await parentAssignment();
        const first = handleFor(input.children[0]);
        const second = handleFor(input.children[1]);
        second.release.mockRejectedValueOnce(new Error("release failed"));
        const spawnChild = vi.fn().mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);
        expect(
            await executeD1ProbeGatewayParentV1(input, { client_secret: clientSecret }, { spawnChild })
        ).toMatchObject({
            success: true,
            result: { status: "inconclusive", error_code: "child_result_failed", go_release_attempted: true },
        });
        expect(first.release).toHaveBeenCalledOnce();
        expect(second.release).toHaveBeenCalledOnce();

        const alteredFirst = handleFor(input.children[0]);
        alteredFirst.release.mockResolvedValueOnce({ ...resultFor(input.children[0]), request_digest: hex("7") });
        const cleanSecond = handleFor(input.children[1]);
        expect(
            await executeD1ProbeGatewayParentV1(
                input,
                { client_secret: clientSecret },
                {
                    spawnChild: vi
                        .fn()
                        .mockResolvedValueOnce(alteredFirst.handle)
                        .mockResolvedValueOnce(cleanSecond.handle),
                }
            )
        ).toMatchObject({
            success: true,
            result: { status: "inconclusive", error_code: "child_result_failed", go_release_attempted: true },
        });
        expect(alteredFirst.release).toHaveBeenCalledOnce();
        expect(cleanSecond.release).toHaveBeenCalledOnce();

        const locallyRejected = handleFor(input.children[0]);
        locallyRejected.release.mockResolvedValueOnce({
            ...resultFor(input.children[0]),
            transport_result: {
                status: "local_rejected",
                request_digest: null,
                writer_role: "writer_a",
                error_code: "invalid_request",
            },
        });
        const finalSecond = handleFor(input.children[1]);
        expect(
            await executeD1ProbeGatewayParentV1(
                input,
                { client_secret: clientSecret },
                {
                    spawnChild: vi
                        .fn()
                        .mockResolvedValueOnce(locallyRejected.handle)
                        .mockResolvedValueOnce(finalSecond.handle),
                }
            )
        ).toMatchObject({
            success: true,
            result: { status: "inconclusive", error_code: "child_result_failed" },
        });
    });

    it("uses one canonical parent assignment and never serializes the service token", async () => {
        const input = await parentAssignment();
        const canonical = await canonicalD1ProbeGatewayParentAssignmentV1(input);
        expect(await canonicalD1ProbeGatewayParentAssignmentV1(JSON.parse(canonical))).toBe(canonical);
        expect(canonical).not.toContain(clientSecret);
        expect(D1ProbeGatewayParentAssignmentV1Schema.safeParse(JSON.parse(canonical)).success).toBe(true);
    });
});
