import { describe, expect, it } from "vitest";

import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "../src/cloudflare-worker-canary-plan.js";
import {
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    transitionD1ProbeCloudflareWorkerCanaryOperationV1,
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "../src/cloudflare-worker-canary-operation.js";

const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");

const plan = async () => {
    let batch = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "a".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => 1_000,
            randomBytes: byteLength => {
                batch += 1;
                return new Uint8Array(byteLength).map((_, index) => (index + batch * 41) % 252);
            },
        }
    );
    if (!generated.success) throw new Error(generated.code);
    return generated.command.plan;
};

const prepared = async (attemptHex = "b".repeat(32)) => {
    const result = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
        await plan(),
        `openbot-canary-attempt-${attemptHex}`,
        1_001
    );
    if (!result.success) throw new Error(result.code);
    return result.operation;
};

const advance = async (
    current: D1ProbeCloudflareWorkerCanaryOperationV1,
    state: Parameters<typeof buildNextD1ProbeCloudflareWorkerCanaryOperationV1>[1],
    identities: Parameters<typeof buildNextD1ProbeCloudflareWorkerCanaryOperationV1>[3] = {}
) => {
    const next = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
        current,
        state,
        current.updated_at_ms + 1,
        identities
    );
    const transitioned = await transitionD1ProbeCloudflareWorkerCanaryOperationV1(current, next);
    if (!transitioned.success) throw new Error(transitioned.code);
    return transitioned.operation;
};

describe("Cloudflare Worker canary operation contract", () => {
    it("accepts the exact pre-dispatch, identity, cleanup, and absence sequence", async () => {
        let operation = await prepared();
        operation = await advance(operation, "shell_dispatching");
        operation = await advance(operation, "shell_identified", { worker_id: "worker_1" });
        operation = await advance(operation, "version_dispatching");
        operation = await advance(operation, "version_identified", { version_id: "version_1" });
        operation = await advance(operation, "deployment_dispatching");
        operation = await advance(operation, "deployment_identified", { deployment_id: "deployment_1" });
        operation = await advance(operation, "cleanup_reconciling");
        operation = await advance(operation, "delete_dispatching");
        operation = await advance(operation, "absence_observed");

        expect(operation.state).toBe("absence_observed");
        expect(operation.revision).toBe(9);
        expect(operation.authoritative).toBe(false);
        expect(operation.lifecycle_advance_allowed).toBe(false);
    });

    it("keeps fresh execution identity separate from the plan operation ID", async () => {
        const canaryPlan = await plan();
        const first = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
            canaryPlan,
            `openbot-canary-attempt-${"1".repeat(32)}`,
            1_001
        );
        const second = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
            canaryPlan,
            `openbot-canary-attempt-${"2".repeat(32)}`,
            1_001
        );
        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        if (!first.success || !second.success) return;
        expect(first.operation.attempt_tag).not.toBe(second.operation.attempt_tag);
        expect(first.operation.execution_nonce).not.toBe(second.operation.execution_nonce);
        expect(first.operation.attempt_tag).not.toContain(canaryPlan.operation_id);
        await expect(
            prepareD1ProbeCloudflareWorkerCanaryOperationV1(
                canaryPlan,
                `openbot-canary-attempt-${canaryPlan.operation_id}`,
                1_001
            )
        ).resolves.toEqual({ success: false, code: "invalid_attempt_tag" });

        await expect(
            validateD1ProbeCloudflareWorkerCanaryOperationV1({
                ...first.operation,
                attempt_tag: second.operation.attempt_tag,
            })
        ).resolves.toBeNull();

        const substituted = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            first.operation,
            "shell_dispatching",
            1_002
        );
        const crossRecord = {
            ...substituted,
            attempt_tag: second.operation.attempt_tag,
            execution_nonce: second.operation.execution_nonce,
        };
        await expect(transitionD1ProbeCloudflareWorkerCanaryOperationV1(first.operation, crossRecord)).resolves.toEqual(
            { success: false, code: "operation_identity_changed" }
        );
    });

    it("rejects skipped phases, revision reuse, identity changes, and terminal advancement", async () => {
        const operation = await prepared();
        const skipped = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(operation, "shell_identified", 1_002, {
            worker_id: "worker_1",
        });
        await expect(transitionD1ProbeCloudflareWorkerCanaryOperationV1(operation, skipped)).resolves.toEqual({
            success: false,
            code: "operation_transition_not_allowed",
        });

        const reusedRevision = {
            ...buildNextD1ProbeCloudflareWorkerCanaryOperationV1(operation, "shell_dispatching", 1_002),
            revision: 0,
        };
        await expect(transitionD1ProbeCloudflareWorkerCanaryOperationV1(operation, reusedRevision)).resolves.toEqual({
            success: false,
            code: "invalid_next_operation",
        });

        const manual = await advance(operation, "manual_required");
        const afterManual = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            manual,
            "cleanup_reconciling",
            manual.updated_at_ms + 1
        );
        await expect(transitionD1ProbeCloudflareWorkerCanaryOperationV1(manual, afterManual)).resolves.toEqual({
            success: false,
            code: "operation_transition_not_allowed",
        });

        const cleanup = await advance(await advance(operation, "shell_dispatching"), "cleanup_reconciling");
        const deleteDispatch = await advance(cleanup, "delete_dispatching", { worker_id: "worker_2" });
        const replayPath = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            deleteDispatch,
            "cleanup_reconciling",
            deleteDispatch.updated_at_ms + 1
        );
        await expect(transitionD1ProbeCloudflareWorkerCanaryOperationV1(deleteDispatch, replayPath)).resolves.toEqual({
            success: false,
            code: "operation_transition_not_allowed",
        });
    });

    it("rejects secrets and undeclared fields", async () => {
        const operation = await prepared();
        await expect(
            validateD1ProbeCloudflareWorkerCanaryOperationV1({
                ...operation,
                api_token: "token-that-must-never-be-persisted",
            })
        ).resolves.toBeNull();
        await expect(
            validateD1ProbeCloudflareWorkerCanaryOperationV1({
                ...operation,
                hmac_key_base64url: hmacKey,
            })
        ).resolves.toBeNull();
    });
});
