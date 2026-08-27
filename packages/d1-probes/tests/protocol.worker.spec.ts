import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { HermeticD1ProbeObservationV1 } from "../src/protocol.ts";

interface Writer {
    initialize(): Promise<void>;
    reset(): Promise<void>;
    seedGuardedCreate(input: unknown): Promise<void>;
    guardedCreate(input: unknown): Promise<HermeticD1ProbeObservationV1>;
    revoke(scenario: unknown): Promise<HermeticD1ProbeObservationV1>;
    guardedCreateState(scenario: unknown): Promise<Record<string, unknown>>;
    seedGateway(scenario: unknown): Promise<void>;
    reserveGateway(input: unknown): Promise<HermeticD1ProbeObservationV1>;
    gatewayState(scenario: unknown, kind: unknown): Promise<Record<string, unknown>>;
    seedCapacity(scenario: unknown): Promise<void>;
    reserveCapacity(input: unknown): Promise<HermeticD1ProbeObservationV1>;
    observeDestroy(input: unknown): Promise<HermeticD1ProbeObservationV1>;
    releaseCapacity(input: unknown): Promise<HermeticD1ProbeObservationV1>;
    capacityState(scenario: unknown): Promise<Record<string, unknown>>;
    seedAudit(scenario: unknown, genesisHash: unknown): Promise<void>;
    appendAudit(input: unknown): Promise<HermeticD1ProbeObservationV1>;
    auditState(scenario: unknown): Promise<Record<string, unknown>>;
}

const workerExports = exports as unknown as {
    readonly default: { fetch(request: Request): Promise<Response> | Response };
    readonly D1ProbeWriterA: Writer;
    readonly D1ProbeWriterB: Writer;
};
const writerA = workerExports.D1ProbeWriterA;
const writerB = workerExports.D1ProbeWriterB;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const createInput = (scenario: string) => ({
    scenario,
    run_id: `run_${scenario}`,
    session_digest: digest("a"),
    manifest_digest: digest("b"),
});

beforeAll(async () => {
    await writerA.initialize();
    await writerA.reset();
});

describe("disposable D1 guarded create", () => {
    it("keeps both create and revoke linearization histories legal", async () => {
        await writerA.seedGuardedCreate(createInput("create_first"));
        expect((await writerA.guardedCreate(createInput("create_first"))).outcome).toBe("created");
        expect((await writerB.revoke("create_first")).outcome).toBe("revoked_after_create");
        expect(await writerA.guardedCreateState("create_first")).toEqual({
            authority_state: "revoked",
            confirmation_state: "consumed",
            live_confirmation_id: null,
            active_run_id: "run_create_first",
            run_state: "cancellation_requested",
            run_guard_count: 1,
            outbox_count: 1,
        });

        await writerA.seedGuardedCreate(createInput("revoke_first"));
        expect((await writerB.revoke("revoke_first")).outcome).toBe("revoked_before_create");
        expect((await writerA.guardedCreate(createInput("revoke_first"))).outcome).toBe("gate_denied");
        expect(await writerA.guardedCreateState("revoke_first")).toEqual({
            authority_state: "revoked",
            confirmation_state: "discarded",
            live_confirmation_id: null,
            active_run_id: null,
            run_state: null,
            run_guard_count: 0,
            outbox_count: 0,
        });
    });

    it("serializes separate concurrent Writer RPC invocations", async () => {
        await writerA.seedGuardedCreate(createInput("concurrent_create"));
        await Promise.all([
            writerA.guardedCreate(createInput("concurrent_create")),
            writerB.revoke("concurrent_create"),
        ]);
        const state = await writerA.guardedCreateState("concurrent_create");
        expect([
            {
                authority_state: "revoked",
                confirmation_state: "discarded",
                live_confirmation_id: null,
                active_run_id: null,
                run_state: null,
                run_guard_count: 0,
                outbox_count: 0,
            },
            {
                authority_state: "revoked",
                confirmation_state: "consumed",
                live_confirmation_id: null,
                active_run_id: "run_concurrent_create",
                run_state: "cancellation_requested",
                run_guard_count: 1,
                outbox_count: 1,
            },
        ]).toContainEqual(state);
    });
});

describe("disposable D1 gateway reservation", () => {
    for (const callKind of ["model", "provider_tool", "code"] as const) {
        it(`spends one ${callKind} reservation and writes one local sink receipt`, async () => {
            const scenario = `gateway_${callKind}`;
            await writerA.seedGateway(scenario);
            const base = { scenario, call_kind: callKind, sequence: 1, request_digest: digest("c") };
            const outcomes = await Promise.all([
                writerA.reserveGateway({ ...base, claim_id: `${callKind}_claim_a` }),
                writerB.reserveGateway({ ...base, claim_id: `${callKind}_claim_b` }),
            ]);
            expect(outcomes.map(value => value.outcome).sort()).toEqual(["reserved", "same_digest_replay"]);
            expect(await writerA.gatewayState(scenario, callKind)).toEqual({
                remaining: 0,
                call_kind: callKind,
                call_count: 1,
                sink_receipt_count: 1,
                guard_count: 1,
                request_digest: digest("c"),
            });
        });
    }

    it("rejects a changed digest and keeps one local receipt across repeated caller invocations", async () => {
        await writerA.seedGateway("gateway_repeated_caller");
        const base = { scenario: "gateway_repeated_caller", call_kind: "model", sequence: 1 };
        await writerA.reserveGateway({ ...base, claim_id: "repeat_claim_a", request_digest: digest("d") });
        expect(
            (await writerB.reserveGateway({ ...base, claim_id: "repeat_claim_b", request_digest: digest("d") })).outcome
        ).toBe("same_digest_replay");
        expect(
            (await writerB.reserveGateway({ ...base, claim_id: "repeat_claim_c", request_digest: digest("e") })).outcome
        ).toBe("different_digest_conflict");
        expect(await writerA.gatewayState("gateway_repeated_caller", "model")).toMatchObject({
            call_count: 1,
            sink_receipt_count: 1,
            guard_count: 1,
        });
    });
});

describe("disposable four-slot Sandbox capacity", () => {
    it("requires a matching terminal-state fixture before one-time release and reclaim", async () => {
        const scenario = "capacity_four";
        await writerA.seedCapacity(scenario);
        const reservation = (index: number) => ({
            scenario,
            lease_id: `lease_${index}`,
            run_id: `run_${index}`,
            run_attempt_fence: 1,
            sandbox_id: `sandbox_${index}`,
        });
        const results = await Promise.all(
            [0, 1, 2, 3, 4].map((index, position) =>
                (position % 2 === 0 ? writerA : writerB).reserveCapacity(reservation(index))
            )
        );
        expect(results.filter(result => result.outcome === "reserved")).toHaveLength(4);
        expect(results.filter(result => result.outcome === "capacity_denied")).toHaveLength(1);

        const release = {
            ...reservation(0),
            destroy_observation_id: "destroy_terminal",
            release_claim_id: "release_once",
        };
        expect((await writerA.releaseCapacity(release)).outcome).toBe("release_denied");
        await writerA.observeDestroy({
            ...reservation(0),
            observation_id: "destroy_requested",
            platform_state: "destroy_requested",
            receipt_digest: digest("f"),
        });
        expect(
            (
                await writerA.releaseCapacity({
                    ...release,
                    destroy_observation_id: "destroy_requested",
                })
            ).outcome
        ).toBe("release_denied");
        await writerB.observeDestroy({
            ...reservation(0),
            observation_id: "destroy_terminal",
            platform_state: "destroyed",
            receipt_digest: digest("1"),
        });
        expect((await writerA.releaseCapacity(release)).outcome).toBe("released");
        expect((await writerB.releaseCapacity(release)).outcome).toBe("release_replay");
        expect((await writerB.releaseCapacity({ ...release, release_claim_id: "release_twice" })).outcome).toBe(
            "stale_or_duplicate_release"
        );
        expect((await writerB.reserveCapacity(reservation(4))).outcome).toBe("reserved");
        expect(await writerA.capacityState(scenario)).toMatchObject({
            maximum: 4,
            reserved: 4,
            active_lease_count: 4,
            released_lease_count: 1,
            destroy_observation_count: 2,
        });
    });
});

describe("disposable D1 audit trigger", () => {
    it("atomically accepts one competing append", async () => {
        const scenario = "audit_race";
        await writerA.seedAudit(scenario, digest("2"));
        const base = { scenario, expected_sequence: 0, previous_hash: digest("2") };
        const results = await Promise.all([
            writerA.appendAudit({ ...base, append_claim_id: "audit_a", event_hash: digest("3") }),
            writerB.appendAudit({ ...base, append_claim_id: "audit_b", event_hash: digest("4") }),
        ]);
        expect(results.filter(result => result.outcome === "appended")).toHaveLength(1);
        expect(results.filter(result => result.outcome === "head_contention_lost")).toHaveLength(1);
        const winner = await writerA.auditState(scenario);
        expect(winner).toMatchObject({ sequence: 1, event_count: 1, guard_count: 1 });
        expect(
            (
                await writerA.appendAudit({
                    scenario,
                    append_claim_id: "audit_followup",
                    expected_sequence: 1,
                    previous_hash: winner["head_hash"],
                    event_hash: digest("5"),
                })
            ).outcome
        ).toBe("appended");
        expect(await writerA.auditState(scenario)).toEqual({
            sequence: 2,
            head_hash: digest("5"),
            event_count: 2,
            guard_count: 2,
        });
    });

    it("rejects stale sequence, gaps, and wrong previous hashes without partial rows", async () => {
        await writerA.seedAudit("audit_stale", digest("5"));
        await writerA.appendAudit({
            scenario: "audit_stale",
            append_claim_id: "audit_stale_first",
            expected_sequence: 0,
            previous_hash: digest("5"),
            event_hash: digest("6"),
        });
        expect(
            (
                await writerB.appendAudit({
                    scenario: "audit_stale",
                    append_claim_id: "audit_stale_claim",
                    expected_sequence: 0,
                    previous_hash: digest("5"),
                    event_hash: digest("7"),
                })
            ).outcome
        ).toBe("head_contention_lost");
        expect(await writerA.auditState("audit_stale")).toMatchObject({
            sequence: 1,
            event_count: 1,
            guard_count: 1,
        });

        for (const [scenario, expectedSequence, previousHash] of [
            ["audit_gap", 4, digest("5")],
            ["audit_wrong_hash", 0, digest("6")],
        ] as const) {
            await writerA.seedAudit(scenario, digest("5"));
            const operation = await writerB.appendAudit({
                scenario,
                append_claim_id: `${scenario}_claim`,
                expected_sequence: expectedSequence,
                previous_hash: previousHash,
                event_hash: digest("7"),
            });
            expect(operation.outcome).toBe("head_precondition_denied");
            expect(await writerA.auditState(scenario)).toEqual({
                sequence: 0,
                head_hash: digest("5"),
                event_count: 0,
                guard_count: 0,
            });
        }
    });
});

describe("probe trust boundary", () => {
    it("returns only non-authoritative observations", async () => {
        await writerA.seedGateway("scope_record");
        const observation = await writerA.reserveGateway({
            scenario: "scope_record",
            call_kind: "code",
            sequence: 1,
            claim_id: "scope_claim",
            request_digest: digest("9"),
        });
        expect(observation).toMatchObject({
            evidence_scope: "hermetic_test_only",
            authoritative: false,
            eligible_for_attestation: false,
            eligible_for_gate_attestation: false,
            gate_promotion_allowed: false,
            proves_outbound_delivery: false,
        });
        expect(observation).not.toHaveProperty("passed");
    });
});
