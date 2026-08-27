import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
    D1_HERMETIC_PROBE_SCOPE_V1,
    runAuditAppendV1,
    runGatewayReservationV1,
    runGuardedCreateV1,
    runGrantRevocationV1,
    runSandboxCapacityReleaseV1,
    runSandboxCapacityReservationV1,
    runSandboxDestroyObservationV1,
} from "../src/protocol.ts";

describe("D1 probe authority boundary", () => {
    it("cannot attest or promote a hermetic observation", () => {
        expect(D1_HERMETIC_PROBE_SCOPE_V1).toEqual({
            schema_version: 1,
            evidence_scope: "hermetic_test_only",
            authoritative: false,
            eligible_for_attestation: false,
            eligible_for_gate_attestation: false,
            gate_promotion_allowed: false,
            proves_outbound_delivery: false,
            storage: "disposable_non_migration_d1_sql",
        });
        expect(JSON.stringify(D1_HERMETIC_PROBE_SCOPE_V1)).not.toContain('"passed"');
    });

    it("leaves every related recorded Item 2 gate open", async () => {
        const fixture = JSON.parse(
            await readFile(new URL("../../../docs/fixtures/item-2-gates.json", import.meta.url), "utf8")
        ) as { readonly gates: ReadonlyArray<{ readonly id: string; readonly status: string }> };
        const statuses = new Map(fixture.gates.map(gate => [gate.id, gate.status]));
        expect(statuses.get("d1_guarded_create")).toBe("not_run");
        expect(statuses.get("gateway_reservation")).toBe("not_run");
        expect(statuses.get("sandbox_execution")).not.toBe("passed");
    });

    it("rejects extra keys and SQL-shaped identifiers before touching D1", async () => {
        const base = {
            writer: "writer_a",
            call_kind: "model",
            sequence: 1,
            claim_id: "claim_bad",
            request_digest: `sha256:${"8".repeat(64)}`,
        };
        await expect(runGatewayReservationV1(null as never, { ...base, scenario: "bad;drop_table" })).rejects.toThrow(
            /scenario/u
        );
        await expect(
            runGatewayReservationV1(null as never, { ...base, scenario: "extra_keys", passed: true })
        ).rejects.toThrow(/unexpected keys/u);
    });

    it("never reclassifies an unknown database failure", async () => {
        const statement = { bind: () => statement };
        const unknownFailureDatabase = {
            prepare: () => statement,
            batch: async () => {
                throw new Error("transport timeout after unknown state");
            },
            withSession: () => {
                throw new Error("unexpected readback");
            },
        } as never;
        const sha = (value: string) => `sha256:${value.repeat(64)}`;
        const observations = await Promise.all([
            runGuardedCreateV1(unknownFailureDatabase, {
                scenario: "unknown_create",
                writer: "writer_a",
                run_id: "run_unknown",
                session_digest: sha("a"),
                manifest_digest: sha("b"),
            }),
            runGrantRevocationV1(unknownFailureDatabase, "unknown_revoke", "writer_b"),
            runGatewayReservationV1(unknownFailureDatabase, {
                scenario: "unknown_gateway",
                writer: "writer_a",
                claim_id: "claim_unknown",
                call_kind: "model",
                sequence: 1,
                request_digest: sha("c"),
            }),
            runSandboxCapacityReservationV1(unknownFailureDatabase, {
                scenario: "unknown_capacity",
                writer: "writer_a",
                lease_id: "lease_unknown",
                run_id: "run_unknown",
                run_attempt_fence: 1,
                sandbox_id: "sandbox_unknown",
            }),
            runSandboxDestroyObservationV1(unknownFailureDatabase, {
                scenario: "unknown_capacity",
                writer: "writer_a",
                observation_id: "observation_unknown",
                lease_id: "lease_unknown",
                run_id: "run_unknown",
                run_attempt_fence: 1,
                sandbox_id: "sandbox_unknown",
                platform_state: "destroyed",
                receipt_digest: sha("d"),
            }),
            runSandboxCapacityReleaseV1(unknownFailureDatabase, {
                scenario: "unknown_capacity",
                writer: "writer_a",
                lease_id: "lease_unknown",
                run_id: "run_unknown",
                run_attempt_fence: 1,
                sandbox_id: "sandbox_unknown",
                destroy_observation_id: "observation_unknown",
                release_claim_id: "release_unknown",
            }),
            runAuditAppendV1(unknownFailureDatabase, {
                scenario: "unknown_audit",
                writer: "writer_a",
                append_claim_id: "append_unknown",
                expected_sequence: 0,
                previous_hash: sha("e"),
                event_hash: sha("f"),
            }),
        ]);
        expect(observations.map(observation => observation.outcome)).toEqual(
            Array.from({ length: 7 }, () => "inconclusive")
        );
    });

    it("returns inconclusive when revocation commits but fresh first-primary reconciliation fails", async () => {
        const statement = { bind: () => statement };
        const database = {
            prepare: () => statement,
            batch: async () => [
                { success: true, results: [{ scenario: "readback_revoke" }] },
                { success: true, results: [{ confirmation_id: "confirmation_readback_revoke" }] },
                { success: true, results: [{ scenario: "readback_revoke" }] },
                { success: true, results: [] },
                { success: true, results: [] },
            ],
            withSession: () => {
                throw new Error("first-primary read failed after committed revocation");
            },
        } as never;

        await expect(runGrantRevocationV1(database, "readback_revoke", "writer_a")).resolves.toMatchObject({
            probe: "guarded_create",
            scenario: "readback_revoke",
            writer: "writer_a",
            operation_id: "revoke_readback_revoke",
            outcome: "inconclusive",
        });
    });

    it("returns inconclusive when recognized conflicts cannot be read from first-primary", async () => {
        const statement = { bind: () => statement };
        const failingReadbackDatabase = (message: string) =>
            ({
                prepare: () => statement,
                batch: async () => {
                    throw new Error(message);
                },
                withSession: () => {
                    throw new Error("first-primary read failed");
                },
            }) as never;
        const constraint = failingReadbackDatabase("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT");
        const trigger = failingReadbackDatabase("D1_ERROR: openbot_probe_audit_head_mismatch: SQLITE_CONSTRAINT");
        const sha = (value: string) => `sha256:${value.repeat(64)}`;
        const observations = await Promise.all([
            runGuardedCreateV1(constraint, {
                scenario: "readback_create",
                writer: "writer_a",
                run_id: "run_readback",
                session_digest: sha("a"),
                manifest_digest: sha("b"),
            }),
            runGatewayReservationV1(constraint, {
                scenario: "readback_gateway",
                writer: "writer_a",
                claim_id: "claim_readback",
                call_kind: "code",
                sequence: 1,
                request_digest: sha("c"),
            }),
            runSandboxCapacityReservationV1(constraint, {
                scenario: "readback_capacity",
                writer: "writer_a",
                lease_id: "lease_readback",
                run_id: "run_readback",
                run_attempt_fence: 1,
                sandbox_id: "sandbox_readback",
            }),
            runSandboxDestroyObservationV1(constraint, {
                scenario: "readback_capacity",
                writer: "writer_a",
                observation_id: "observation_readback",
                lease_id: "lease_readback",
                run_id: "run_readback",
                run_attempt_fence: 1,
                sandbox_id: "sandbox_readback",
                platform_state: "destroyed",
                receipt_digest: sha("d"),
            }),
            runSandboxCapacityReleaseV1(constraint, {
                scenario: "readback_capacity",
                writer: "writer_a",
                lease_id: "lease_readback",
                run_id: "run_readback",
                run_attempt_fence: 1,
                sandbox_id: "sandbox_readback",
                destroy_observation_id: "observation_readback",
                release_claim_id: "release_readback",
            }),
            runAuditAppendV1(trigger, {
                scenario: "readback_audit",
                writer: "writer_a",
                append_claim_id: "append_readback",
                expected_sequence: 0,
                previous_hash: sha("e"),
                event_hash: sha("f"),
            }),
        ]);
        expect(observations.map(observation => observation.outcome)).toEqual(
            Array.from({ length: 6 }, () => "inconclusive")
        );
    });
});
