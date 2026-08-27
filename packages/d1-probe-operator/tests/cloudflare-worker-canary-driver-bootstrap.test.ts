import { describe, expect, it } from "vitest";

import { compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1 } from "../src/cloudflare-worker-canary-cleanup-grace.js";
import {
    compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    type D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
} from "../src/cloudflare-worker-canary-cleanup-obligation.js";
import {
    bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1,
} from "../src/cloudflare-worker-canary-driver-bootstrap.js";
import type {
    D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "../src/cloudflare-worker-canary-driver-lease.js";
import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
} from "../src/cloudflare-worker-canary-effect-journal.js";
import {
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "../src/cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "../src/cloudflare-worker-canary-plan.js";

const digest = (character: string): string => character.repeat(64);
const hmacKey = Buffer.from(new Uint8Array(32).fill(23)).toString("base64url");

interface FixtureV1 {
    readonly operation: D1ProbeCloudflareWorkerCanaryOperationV1;
    readonly cleanup_grace: unknown;
    readonly obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1;
    readonly lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1;
    readonly owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1;
}

const fixture = async (): Promise<FixtureV1> => {
    const now = Date.now();
    let draw = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "a".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => now,
            randomBytes: byteLength => {
                draw += 1;
                return new Uint8Array(byteLength).fill(draw + 7);
            },
        }
    );
    if (!generated.success) throw new Error(generated.code);
    const attemptTag = `openbot-canary-attempt-${"b".repeat(32)}`;
    const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(generated.command.plan, attemptTag, now);
    if (!prepared.success) throw new Error(prepared.code);
    const cleanup = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(generated.command.plan, {
        worker_id: null,
        worker_id_commitment: null,
        attempt_tag_commitment: digest("c"),
    });
    if (!cleanup.success) throw new Error(cleanup.code);
    const obligation = await compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(
        prepared.operation,
        cleanup.command.cleanup_grace
    );
    if (!obligation.success) throw new Error(obligation.code);
    const executionNonceCommitment = await commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(
        prepared.operation.execution_nonce
    );
    if (executionNonceCommitment === null) throw new Error("nonce commitment unavailable");
    const ownerNonce = Buffer.from(new Uint8Array(32).fill(29)).toString("base64url");
    const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
        transition: "acquired",
        state: "active",
        plan_digest: prepared.operation.plan.plan_digest,
        execution_nonce_commitment: executionNonceCommitment,
        generation: 0,
        previous_record_digest: null,
        owner_pid: 1234,
        owner_nonce_commitment: digest("d"),
        prior_owner_liveness: "not_checked",
        issued_at_ms: now,
        heartbeat_at_ms: now,
        expires_at_ms: now + 300_000,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        mutation_authority: false,
    };
    return {
        operation: prepared.operation,
        cleanup_grace: cleanup.command.cleanup_grace,
        obligation: obligation.obligation,
        lease,
        owner: {
            plan_digest: prepared.operation.plan.plan_digest,
            execution_nonce: prepared.operation.execution_nonce,
            generation: 0,
            owner_pid: 1234,
            owner_nonce: ownerNonce,
        },
    };
};

const dependencies = async (
    value: FixtureV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1> = {}
): Promise<{
    readonly dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1;
    readonly calls: string[];
    readonly stored: {
        operation: D1ProbeCloudflareWorkerCanaryOperationV1 | null;
        obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1 | null;
    };
}> => {
    const calls: string[] = [];
    const stored = {
        operation: null as D1ProbeCloudflareWorkerCanaryOperationV1 | null,
        obligation: null as D1ProbeCloudflareWorkerCanaryCleanupObligationV1 | null,
    };
    const defaults: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1 = {
        compile_cleanup_obligation: async (operation, cleanupGrace) => {
            calls.push("compile_obligation");
            return await compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(operation, cleanupGrace);
        },
        publish_cleanup_obligation: async obligation => {
            calls.push("publish_obligation");
            stored.obligation = obligation as D1ProbeCloudflareWorkerCanaryCleanupObligationV1;
            return { success: true, obligation: stored.obligation };
        },
        read_cleanup_obligation: async () => {
            calls.push("read_obligation");
            return stored.obligation === null
                ? { success: false, code: "obligation_not_found" }
                : { success: true, obligation: stored.obligation };
        },
        acquire_driver_lease: async () => {
            calls.push("acquire_lease");
            return { success: true, lease: value.lease, owner: value.owner };
        },
        assert_current_driver_lease: async () => {
            calls.push("assert_lease");
            return { success: true, lease: value.lease };
        },
        commit_execution_nonce: commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
        digest_operation: digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
        read_effect_journal: async () => {
            calls.push("read_journal");
            return { success: false, code: "journal_not_found" };
        },
        validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
        read_archive_inventory: async () => {
            calls.push("read_archive");
            return { success: false, code: "archive_not_found" };
        },
        create_state: async operation => {
            calls.push("create_state");
            stored.operation = operation as D1ProbeCloudflareWorkerCanaryOperationV1;
            return { success: true, operation: stored.operation };
        },
        read_state: async () => {
            calls.push("read_state");
            return stored.operation === null
                ? { success: false, code: "state_not_found" }
                : { success: true, operation: stored.operation };
        },
    };
    return { dependencies: { ...defaults, ...overrides }, calls, stored };
};

const input = (value: FixtureV1) => ({
    operation: value.operation,
    cleanup_grace: value.cleanup_grace,
    lease_duration_ms: 300_000,
});

describe("Cloudflare Worker canary durable driver bootstrap", () => {
    it("publishes exact pre-dispatch records, acquires one lease, and grants no remote authority", async () => {
        const value = await fixture();
        const context = await dependencies(value);
        const result = await bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
            input(value),
            context.dependencies
        );
        expect(result).toMatchObject({
            success: true,
            session: {
                durable_pre_dispatch_records_ready: true,
                remote_dispatch_authorized: false,
                cleanup_authorized: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        });
        expect(context.calls.filter(call => call === "read_journal")).toHaveLength(3);
        expect(context.calls.filter(call => call === "read_archive")).toHaveLength(3);
        expect(context.calls.filter(call => call === "create_state")).toHaveLength(1);
        expect(context.calls.filter(call => call === "publish_obligation")).toHaveLength(1);
        expect(context.calls.filter(call => call === "acquire_lease")).toHaveLength(1);
        expect(context.calls.indexOf("create_state")).toBeLessThan(context.calls.indexOf("publish_obligation"));
        expect(context.calls.indexOf("publish_obligation")).toBeLessThan(context.calls.indexOf("acquire_lease"));
        expect(JSON.stringify(result)).not.toMatch(/api_token|hmac_key|response_body/iu);
    });

    it("reuses exact prepared state and cleanup obligation without republishing them", async () => {
        const value = await fixture();
        const context = await dependencies(value);
        context.stored.operation = value.operation;
        context.stored.obligation = value.obligation;
        const result = await bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
            input(value),
            context.dependencies
        );
        expect(result.success).toBe(true);
        expect(context.calls).not.toContain("create_state");
        expect(context.calls).not.toContain("publish_obligation");
    });

    it("accepts the archive reader's exact empty-inventory representation", async () => {
        const value = await fixture();
        const context = await dependencies(value, {
            read_archive_inventory: async () => ({
                success: true,
                inventory: {
                    schema_version: 1,
                    kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory",
                    plan_digest: value.operation.plan.plan_digest,
                    record_count: 0,
                    records: [],
                    cloudflare_origin_authenticated: false,
                    archive_key_possession_proven: false,
                    archive_decryptability_proven: false,
                    effect_claim_persistence_proven: false,
                    response_authenticated: false,
                    authoritative: false,
                    eligible_for_upload: false,
                    eligible_for_attestation: false,
                    lifecycle_advance_allowed: false,
                    gate_promotion_allowed: false,
                },
            }),
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(input(value), context.dependencies)
        ).resolves.toMatchObject({ success: true });
    });

    it("accepts exact concurrent state and obligation winners before the lease race", async () => {
        const value = await fixture();
        const context = await dependencies(value, {
            create_state: async () => {
                context.calls.push("create_state");
                context.stored.operation = value.operation;
                return { success: false, code: "concurrent_state_write" };
            },
            publish_cleanup_obligation: async () => {
                context.calls.push("publish_obligation");
                context.stored.obligation = value.obligation;
                return { success: false, code: "obligation_already_exists" };
            },
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(input(value), context.dependencies)
        ).resolves.toMatchObject({ success: true });
        expect(context.calls.filter(call => call === "read_state")).toHaveLength(3);
        expect(context.calls.filter(call => call === "read_obligation")).toHaveLength(3);
    });

    it("fails closed on operation and cleanup-obligation substitutions", async () => {
        const value = await fixture();
        const stateConflict = await dependencies(value);
        stateConflict.stored.operation = { ...value.operation, updated_at_ms: value.operation.updated_at_ms + 1 };
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
                input(value),
                stateConflict.dependencies
            )
        ).resolves.toEqual({ success: false, code: "operation_state_conflict" });

        const obligationConflict = await dependencies(value);
        obligationConflict.stored.operation = value.operation;
        obligationConflict.stored.obligation = { ...value.obligation, obligation_digest: digest("e") };
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
                input(value),
                obligationConflict.dependencies
            )
        ).resolves.toEqual({ success: false, code: "cleanup_obligation_conflict" });
    });

    it("does not write or lease when prior effect or archive history exists", async () => {
        const value = await fixture();
        for (const [override, code] of [
            [
                { read_effect_journal: async () => ({ success: true as const, claims: [] }) },
                "prior_effect_history_present",
            ],
            [
                {
                    read_archive_inventory: async () => ({
                        success: true as const,
                        inventory: {} as never,
                    }),
                },
                "prior_archive_history_present",
            ],
        ] as const) {
            const context = await dependencies(value, override);
            await expect(
                bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
                    input(value),
                    context.dependencies
                )
            ).resolves.toEqual({ success: false, code });
            expect(context.calls).not.toContain("create_state");
            expect(context.calls).not.toContain("publish_obligation");
            expect(context.calls).not.toContain("acquire_lease");
        }
    });

    it("stops when the lease cannot be acquired or its final assertion fails", async () => {
        const value = await fixture();
        const unavailable = await dependencies(value, {
            acquire_driver_lease: async () => ({ success: false, code: "lease_already_held" }),
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
                input(value),
                unavailable.dependencies
            )
        ).resolves.toEqual({ success: false, code: "driver_lease_unavailable" });

        const lost = await dependencies(value, {
            assert_current_driver_lease: async () => ({ success: false, code: "lease_generation_mismatch" }),
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(input(value), lost.dependencies)
        ).resolves.toEqual({ success: false, code: "final_driver_lease_reassertion_failed" });
    });

    it("detects effect history appearing after lease acquisition", async () => {
        const value = await fixture();
        let journalReads = 0;
        const context = await dependencies(value, {
            read_effect_journal: async () => {
                journalReads += 1;
                return journalReads < 3 ? { success: false, code: "journal_not_found" } : { success: true, claims: [] };
            },
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(input(value), context.dependencies)
        ).resolves.toEqual({ success: false, code: "final_history_reassertion_failed" });
    });

    it("distinguishes final state and cleanup-obligation substitution", async () => {
        const value = await fixture();
        let stateReads = 0;
        const changedState = await dependencies(value, {
            read_state: async () => {
                stateReads += 1;
                return stateReads === 1
                    ? { success: false, code: "state_not_found" }
                    : {
                          success: true,
                          operation: { ...value.operation, updated_at_ms: value.operation.updated_at_ms + 1 },
                      };
            },
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
                input(value),
                changedState.dependencies
            )
        ).resolves.toEqual({ success: false, code: "final_operation_state_reassertion_failed" });

        let obligationReads = 0;
        const changedObligation = await dependencies(value, {
            read_cleanup_obligation: async () => {
                obligationReads += 1;
                return obligationReads === 1
                    ? { success: false, code: "obligation_not_found" }
                    : {
                          success: true,
                          obligation: { ...value.obligation, obligation_digest: digest("f") },
                      };
            },
        });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(
                input(value),
                changedObligation.dependencies
            )
        ).resolves.toEqual({ success: false, code: "final_cleanup_obligation_reassertion_failed" });
    });

    it("returns fixed denials for malformed, extra-field, hostile, and throwing input", async () => {
        const value = await fixture();
        const context = await dependencies(value);
        for (const candidate of [
            null,
            {},
            { ...input(value), extra: true },
            { ...input(value), lease_duration_ms: 0 },
        ]) {
            await expect(
                bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(candidate, context.dependencies)
            ).resolves.toEqual({ success: false, code: "invalid_bootstrap_input" });
        }
        const hostile = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error("hostile");
                },
            }
        );
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(hostile, context.dependencies)
        ).resolves.toEqual({ success: false, code: "invalid_bootstrap_input" });
        await expect(
            bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1(input(value), {
                ...context.dependencies,
                validate_operation: async () => {
                    throw new Error("sentinel");
                },
            })
        ).resolves.toEqual({ success: false, code: "invalid_bootstrap_input" });
    });
});
