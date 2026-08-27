import { describe, expect, it } from "vitest";

import { SandboxLifecycleAckV1Schema } from "../src/lifecycle.js";

const digest = "a".repeat(64);
const ack = {
    schema_version: 1 as const,
    request_digest: digest,
    operation: "destroy_sandbox_v1" as const,
};

describe("sandbox lifecycle acknowledgements", () => {
    it.each([
        ["sdk_acknowledged", null],
        ["not_found", null],
        ["outcome_unknown", "outcome_unknown"],
        ["rejected", "invalid_request"],
        ["unavailable", "sandbox_unavailable"],
        ["unavailable", "runner_internal_error"],
    ] as const)("accepts %s with its exact error state", (status, error_code) => {
        expect(SandboxLifecycleAckV1Schema.safeParse({ ...ack, status, error_code }).success).toBe(true);
    });

    it.each([
        ["sdk_acknowledged", "sandbox_unavailable"],
        ["not_found", "outcome_unknown"],
        ["outcome_unknown", null],
        ["rejected", "runner_internal_error"],
        ["unavailable", null],
    ] as const)("rejects %s with a contradictory error", (status, error_code) => {
        expect(SandboxLifecycleAckV1Schema.safeParse({ ...ack, status, error_code }).success).toBe(false);
    });
});
