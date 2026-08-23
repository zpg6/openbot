import { describe, expect, it } from "vitest";
import {
    CleanupStateV1Schema,
    ProviderEvidenceStateV1Schema,
    RunExecutionStateV1Schema,
} from "@openbot/contracts/internal";
import {
    canTransitionCleanupV1,
    canTransitionProviderEvidenceV1,
    canTransitionRunExecutionV1,
    canTransitionSandboxCommandV1,
    canTransitionSandboxExecutionV1,
    canRetrySandboxCleanupV1,
    isTerminalRunExecutionV1,
} from "./run-transitions.js";

describe("run execution transitions", () => {
    it.each([
        ["requested", "queued"],
        ["queued", "provisioning"],
        ["provisioning", "running"],
        ["running", "result_pending_import"],
        ["result_pending_import", "result_imported"],
        ["result_imported", "succeeded"],
        ["running", "cancellation_requested"],
        ["cancellation_requested", "cancelled_with_effect_unknown"],
    ] as const)("permits %s -> %s", (from, to) => {
        expect(canTransitionRunExecutionV1(from, to)).toBe(true);
    });

    it.each([
        ["requested", "running"],
        ["queued", "succeeded"],
        ["result_pending_import", "succeeded"],
        ["succeeded", "running"],
        ["outcome_unknown", "queued"],
        ["cancelled", "succeeded"],
    ] as const)("rejects %s -> %s", (from, to) => {
        expect(canTransitionRunExecutionV1(from, to)).toBe(false);
    });

    it("treats an exact repeat as an idempotent no-op", () => {
        for (const state of RunExecutionStateV1Schema.options) {
            expect(canTransitionRunExecutionV1(state, state)).toBe(true);
        }
    });

    it("marks only states with no outgoing transition as terminal", () => {
        expect(RunExecutionStateV1Schema.options.filter(isTerminalRunExecutionV1)).toEqual([
            "succeeded",
            "failed",
            "cancelled",
            "cancelled_with_effect_unknown",
            "outcome_unknown",
            "result_lost_after_execution",
        ]);
    });
});

describe("sandbox transitions", () => {
    it("requires explicit destruction and never resumes an uncertain command", () => {
        expect(canTransitionSandboxExecutionV1("requested", "provisioning")).toBe(true);
        expect(canTransitionSandboxExecutionV1("executing", "destroy_requested")).toBe(true);
        expect(canTransitionSandboxExecutionV1("destroy_unverified", "destroy_requested")).toBe(false);
        expect(canTransitionSandboxExecutionV1("destroyed", "ready")).toBe(false);
        expect(canTransitionSandboxCommandV1("reserved", "dispatched")).toBe(true);
        expect(canTransitionSandboxCommandV1("dispatched", "outcome_unknown")).toBe(true);
        expect(canTransitionSandboxCommandV1("outcome_unknown", "dispatched")).toBe(false);
    });
});

describe("cleanup transitions", () => {
    it("requires current adoption evidence and the exact cleanup fence for retry", () => {
        expect(canTransitionCleanupV1("manual_required", "pending")).toBe(false);
        expect(canTransitionCleanupV1("manual_required", "complete")).toBe(false);
        const retry = {
            profile_enabled: true,
            profile_active: true,
            repeat_destroy_safe_evidence: true,
            evidence_valid_until: 20,
            now: 10,
            cleanup_obligation_id: "cleanup_1",
            expected_cleanup_obligation_id: "cleanup_1",
            cleanup_fence: 2,
            expected_cleanup_fence: 2,
            retry_window_ends_at: 20,
        } as const;
        expect(canRetrySandboxCleanupV1(retry)).toBe(true);
        expect(canRetrySandboxCleanupV1({ ...retry, expected_cleanup_fence: 3 })).toBe(false);
        expect(canRetrySandboxCleanupV1({ ...retry, repeat_destroy_safe_evidence: false })).toBe(false);
    });

    it("does not reopen observed completion", () => {
        for (const state of CleanupStateV1Schema.options) {
            expect(canTransitionCleanupV1("complete", state)).toBe(state === "complete");
        }
    });
});

describe("provider evidence transitions", () => {
    it("can become more complete but never regress", () => {
        expect(canTransitionProviderEvidenceV1("unavailable", "partial")).toBe(true);
        expect(canTransitionProviderEvidenceV1("partial", "complete")).toBe(true);
        expect(canTransitionProviderEvidenceV1("complete", "partial")).toBe(false);
        expect(canTransitionProviderEvidenceV1("partial", "unavailable")).toBe(false);

        for (const state of ProviderEvidenceStateV1Schema.options) {
            expect(canTransitionProviderEvidenceV1(state, state)).toBe(true);
        }
    });
});
