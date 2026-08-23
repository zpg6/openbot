import { describe, expect, it } from "vitest";

import { SANDBOX_EXECUTION_HARD_LIMITS_V1 } from "./constants.js";
import {
    parseAndVerifyDestroySandboxRequestV1,
    parseAndVerifyExecuteJavaScriptRequestV1,
    parseAndVerifyKillSandboxProcessRequestV1,
} from "./requests.js";
import {
    createDestroyRequestFixtureV1,
    createExecuteJavaScriptRequestFixtureV1,
    createKillRequestFixtureV1,
} from "./test-fixtures.js";

const expectProtocolError = async (promise: Promise<unknown>, code: string): Promise<void> => {
    await expect(promise).rejects.toMatchObject({ code });
};

describe("execute_javascript_v1 requests", () => {
    it("accepts the exact fixed request contract", async () => {
        const request = await createExecuteJavaScriptRequestFixtureV1();
        await expect(parseAndVerifyExecuteJavaScriptRequestV1(request)).resolves.toEqual(request);
    });

    it.each(["argv", "env", "cwd", "image", "packages", "network", "language", "runtime"])(
        "rejects caller-controlled %s",
        async field => {
            const request = {
                ...(await createExecuteJavaScriptRequestFixtureV1()),
                [field]: field === "env" ? {} : [],
            };
            await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "invalid_request");
        }
    );

    it("rejects another operation or language", async () => {
        const request = { ...(await createExecuteJavaScriptRequestFixtureV1()), operation: "execute_python_v1" };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "invalid_request");
    });

    it.each(["short", "A".repeat(64), "g".repeat(64)])("rejects a noncanonical Sandbox ID: %s", async sandbox_id => {
        const request = { ...(await createExecuteJavaScriptRequestFixtureV1()), sandbox_id };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "invalid_request");
    });

    it.each(['{"b":1,"a":2}', '{"a": 1}', '{"a":1,"a":1}', "NaN"])(
        "rejects non-canonical input JSON: %s",
        async input_json => {
            const request = await createExecuteJavaScriptRequestFixtureV1({ input_json });
            await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "invalid_canonical_json");
        }
    );

    it.each(["source_digest", "input_digest", "request_digest"])("rejects a forged %s", async field => {
        const request = { ...(await createExecuteJavaScriptRequestFixtureV1()), [field]: "f".repeat(64) };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "digest_mismatch");
    });

    it.each([
        ["consumed_reservation_id", "reservation_999999"],
        ["run_attempt_fence", 6],
        ["manifest_digest", "e".repeat(64)],
        ["reviewed_runtime_profile_digest", "e".repeat(64)],
    ])("detects a changed reservation-bound %s", async (field, value) => {
        const request = { ...(await createExecuteJavaScriptRequestFixtureV1()), [field]: value };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "digest_mismatch");
    });

    it("rejects unpaired surrogates before execution", async () => {
        const request = await createExecuteJavaScriptRequestFixtureV1({ source: "\ud800" });
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(request), "invalid_utf8");
    });

    it("rejects source bytes and execution limits above the hard ceiling", async () => {
        const oversized = await createExecuteJavaScriptRequestFixtureV1({
            source: "x".repeat(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_source_bytes + 1),
        });
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(oversized), "invalid_request");

        const request = await createExecuteJavaScriptRequestFixtureV1();
        const excessiveLimits = {
            ...request,
            limits: {
                ...request.limits,
                execution_timeout_ms: SANDBOX_EXECUTION_HARD_LIMITS_V1.execution_timeout_ms + 1,
            },
        };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(excessiveLimits), "invalid_request");

        const excessiveProcesses = {
            ...request,
            limits: {
                ...request.limits,
                processes_unverified_target: SANDBOX_EXECUTION_HARD_LIMITS_V1.processes_unverified_target + 1,
            },
        };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(excessiveProcesses), "invalid_request");

        const excessiveFilesystem = {
            ...request,
            limits: {
                ...request.limits,
                filesystem_bytes_unverified_target:
                    SANDBOX_EXECUTION_HARD_LIMITS_V1.filesystem_bytes_unverified_target + 1,
            },
        };
        await expectProtocolError(parseAndVerifyExecuteJavaScriptRequestV1(excessiveFilesystem), "invalid_request");
    });

    it("accepts a digest-bound per-call narrowing of every variable limit", async () => {
        const request = await createExecuteJavaScriptRequestFixtureV1({
            limits: {
                ...SANDBOX_EXECUTION_HARD_LIMITS_V1,
                max_source_bytes: 1_024,
                max_input_bytes: 2_048,
                max_stdout_bytes: 1_024,
                max_stderr_bytes: 512,
                max_result_bytes: 2_048,
                max_output_bytes: 3_584,
                filesystem_bytes_unverified_target: 4_096,
                processes_unverified_target: 2,
                max_output_frames: 8,
                execution_timeout_ms: 250,
            },
        });

        await expect(parseAndVerifyExecuteJavaScriptRequestV1(request)).resolves.toEqual(request);
        await expectProtocolError(
            parseAndVerifyExecuteJavaScriptRequestV1({
                ...request,
                limits: { ...request.limits, processes_unverified_target: 3 },
            }),
            "digest_mismatch"
        );
    });
});

describe("sandbox lifecycle requests", () => {
    it("keeps cancellation and destruction distinct and digest-bound", async () => {
        const kill = await createKillRequestFixtureV1();
        const destroy = await createDestroyRequestFixtureV1();
        await expect(parseAndVerifyKillSandboxProcessRequestV1(kill)).resolves.toEqual(kill);
        await expect(parseAndVerifyDestroySandboxRequestV1(destroy)).resolves.toEqual(destroy);
        await expectProtocolError(parseAndVerifyDestroySandboxRequestV1(kill), "invalid_request");
        await expectProtocolError(parseAndVerifyKillSandboxProcessRequestV1(destroy), "invalid_request");
    });

    it("rejects extra lifecycle controls and forged digests", async () => {
        const kill = await createKillRequestFixtureV1();
        await expectProtocolError(
            parseAndVerifyKillSandboxProcessRequestV1({ ...kill, force: true }),
            "invalid_request"
        );
        await expectProtocolError(
            parseAndVerifyKillSandboxProcessRequestV1({ ...kill, request_digest: "f".repeat(64) }),
            "digest_mismatch"
        );
    });

    it("requires kill to name the exact process handle and a run-attempt fence", async () => {
        const kill = await createKillRequestFixtureV1();
        await expectProtocolError(
            parseAndVerifyKillSandboxProcessRequestV1({ ...kill, expected_process_handle_id: null }),
            "invalid_request"
        );
        await expectProtocolError(
            parseAndVerifyKillSandboxProcessRequestV1({ ...kill, fence_kind: "cleanup" }),
            "invalid_request"
        );
    });

    it("binds cleanup destroy to its exact obligation ID and fence", async () => {
        const destroy = await createDestroyRequestFixtureV1();
        await expectProtocolError(
            parseAndVerifyDestroySandboxRequestV1({ ...destroy, cleanup_obligation_id: null }),
            "invalid_request"
        );
        await expectProtocolError(
            parseAndVerifyDestroySandboxRequestV1({ ...destroy, cleanup_obligation_id: "cleanup_obligation_999999" }),
            "digest_mismatch"
        );
    });

    it.each([
        ["fence_value", 6],
        ["expected_process_handle_id", "process_stale_001"],
        ["consumed_reservation_id", "reservation_999999"],
    ])("rejects stale lifecycle %s tampering", async (field, value) => {
        const kill = { ...(await createKillRequestFixtureV1()), [field]: value };
        await expectProtocolError(parseAndVerifyKillSandboxProcessRequestV1(kill), "digest_mismatch");
    });
});
