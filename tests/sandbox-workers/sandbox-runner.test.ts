import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { decodeSandboxFrameStreamV1 } from "../../packages/sandbox-protocol/src/frames.ts";
import { SandboxLifecycleAckV1Schema } from "../../packages/sandbox-protocol/src/lifecycle.ts";
import {
    createDestroyRequestFixtureV1,
    createExecuteJavaScriptRequestFixtureV1,
    createKillRequestFixtureV1,
} from "../../packages/sandbox-protocol/tests/test-fixtures.ts";
import { lifecyclePostCallOutcomeUnknownV1 } from "../../apps/sandbox-runner/src/services.ts";

interface SandboxRunnerExports {
    readonly default: { fetch(request: Request): Response | Promise<Response> };
    readonly SandboxExecutionService: { execute(request: unknown): Promise<ReadableStream<Uint8Array>> };
    readonly SandboxLifecycleService: {
        kill(request: unknown): Promise<unknown>;
        destroy(request: unknown): Promise<unknown>;
    };
}

const worker = exports as unknown as SandboxRunnerExports;

describe("private sandbox runner shell", () => {
    it("returns 404 for every fetch path", async () => {
        const response = await worker.default.fetch(
            new Request("https://sandbox.invalid/internal/execute", { method: "POST" })
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("validates execution requests but cannot execute before adapter adoption", async () => {
        const request = await createExecuteJavaScriptRequestFixtureV1();
        const stream = await worker.SandboxExecutionService.execute(request);
        await expect(
            decodeSandboxFrameStreamV1(
                stream,
                request.request_digest,
                request.reviewed_runtime_profile_digest,
                request.call_sequence,
                request.limits
            )
        ).resolves.toEqual([
            expect.objectContaining({
                frame_sequence: 0,
                call_sequence: request.call_sequence,
                request_digest: request.request_digest,
                status: "unavailable",
                error_code: "sandbox_unavailable",
                type: "terminal",
            }),
        ]);
    });

    it("rejects execution controls outside the mechanical contract", async () => {
        const request = { ...(await createExecuteJavaScriptRequestFixtureV1()), network: "allow-all" };
        const stream = await worker.SandboxExecutionService.execute(request);
        await expect(
            decodeSandboxFrameStreamV1(
                stream,
                request.request_digest,
                request.reviewed_runtime_profile_digest,
                request.call_sequence,
                request.limits
            )
        ).resolves.toEqual([
            expect.objectContaining({
                frame_sequence: 0,
                status: "failed",
                error_code: "invalid_request",
                type: "terminal",
            }),
        ]);
    });

    it("exposes lifecycle on a separate RPC service", async () => {
        const kill = await createKillRequestFixtureV1();
        const destroy = await createDestroyRequestFixtureV1();
        await expect(worker.SandboxLifecycleService.kill(kill)).resolves.toEqual({
            schema_version: 1,
            request_digest: kill.request_digest,
            operation: "kill_sandbox_process_v1",
            status: "unavailable",
            error_code: "sandbox_unavailable",
        });
        await expect(worker.SandboxLifecycleService.destroy(destroy)).resolves.toEqual({
            schema_version: 1,
            request_digest: destroy.request_digest,
            operation: "destroy_sandbox_v1",
            status: "unavailable",
            error_code: "sandbox_unavailable",
        });
    });

    it("maps a lifecycle exception after an SDK call to outcome unknown", async () => {
        const destroy = await createDestroyRequestFixtureV1();
        expect(
            SandboxLifecycleAckV1Schema.parse(
                lifecyclePostCallOutcomeUnknownV1(destroy.request_digest, "destroy_sandbox_v1")
            )
        ).toEqual({
            schema_version: 1,
            request_digest: destroy.request_digest,
            operation: "destroy_sandbox_v1",
            status: "outcome_unknown",
            error_code: "outcome_unknown",
        });
    });
});
