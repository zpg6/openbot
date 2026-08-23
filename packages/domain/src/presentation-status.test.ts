import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    PresentationStateV1Schema,
    PresentationStatusV1Schema,
    type PresentationStateV1,
} from "@openbot/contracts/internal";
import {
    derivePresentationStatusV1,
    PRESENTATION_STATUS_LABELS_V1,
    PRESENTATION_STATUS_RANK_V1,
} from "./presentation-status.js";

const ready: PresentationStateV1 = {
    account: "active",
    bot: "active",
    catalog: "usable",
    grant: "usable",
    confirmation: "none",
    execution: null,
    cleanup: "not_required",
    evidence: "complete",
};

describe("derivePresentationStatusV1", () => {
    it.each([
        [{ ...ready, execution: "outcome_unknown", cleanup: "manual_required" }, "outcome_unknown"],
        [{ ...ready, execution: "succeeded", cleanup: "manual_required" }, "cleanup_required"],
        [{ ...ready, execution: "succeeded", cleanup: "running" }, "cleaning_up"],
        [{ ...ready, execution: "cancellation_requested" }, "cancelling"],
        [{ ...ready, execution: "running", confirmation: "live" }, "running"],
        [{ ...ready, confirmation: "live", catalog: "unusable" }, "needs_confirmation"],
        [{ ...ready, catalog: "unusable", grant: "missing" }, "needs_configuration"],
        [{ ...ready, grant: "missing" }, "needs_access"],
        [{ ...ready, execution: "cancelled" }, "cancelled"],
        [{ ...ready, execution: "failed" }, "failed"],
        [{ ...ready, execution: "succeeded", evidence: "unavailable" }, "completed"],
        [ready, "ready"],
    ] as const)("maps %# by the documented precedence", (state, expected) => {
        expect(derivePresentationStatusV1(state)).toBe(expected);
    });

    it("maps every valid combination to a registered status", () => {
        const arbitrary = fc.record({
            account: fc.constantFrom("active", "disabled"),
            bot: fc.constantFrom("active", "disabled"),
            catalog: fc.constantFrom("usable", "unusable"),
            grant: fc.constantFrom("usable", "missing"),
            confirmation: fc.constantFrom("none", "live"),
            execution: fc.option(
                fc.constantFrom(
                    "requested",
                    "queued",
                    "provisioning",
                    "running",
                    "result_pending_import",
                    "result_imported",
                    "succeeded",
                    "failed",
                    "cancellation_requested",
                    "cancelled",
                    "cancelled_with_effect_unknown",
                    "outcome_unknown",
                    "result_lost_after_execution"
                ),
                { nil: null }
            ),
            cleanup: fc.constantFrom("not_required", "pending", "running", "complete", "manual_required"),
            evidence: fc.constantFrom("complete", "partial", "unavailable"),
        });

        fc.assert(
            fc.property(arbitrary, candidate => {
                const state = PresentationStateV1Schema.parse(candidate);
                expect(PresentationStatusV1Schema.safeParse(derivePresentationStatusV1(state)).success).toBe(true);
            })
        );
    });

    it("keeps labels and ranks exhaustive", () => {
        for (const status of PresentationStatusV1Schema.options) {
            expect(PRESENTATION_STATUS_LABELS_V1[status].length).toBeGreaterThan(0);
            expect(PRESENTATION_STATUS_RANK_V1[status]).toBeGreaterThanOrEqual(0);
        }
    });
});
