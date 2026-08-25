import { link, lstat, readFile, readdir, unlink, writeFile } from "node:fs/promises";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { afterEach, describe, expect, it } from "vitest";

import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    readD1ProbeCloudflareWorkerCanaryConsistencyWithReadersTestOnlyV1,
} from "./cloudflare-worker-canary-consistency.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1,
    appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    d1ProbeCloudflareWorkerCanaryEffectJournalPathV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1,
    createD1ProbeCloudflareWorkerCanaryStateV1,
    d1ProbeCloudflareWorkerCanaryStatePathV1,
    transitionD1ProbeCloudflareWorkerCanaryStateV1,
} from "./cloudflare-worker-canary-state.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1,
    acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "./cloudflare-worker-canary-driver-lease.js";

const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(19)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
const cleanupStatePrefixes = new Set<string>();
const cleanupJournalPrefixes = new Set<string>();
const cleanupPaths = new Set<string>();
const leaseByPlan = new Map<string, D1ProbeCloudflareWorkerCanaryDriverLeaseV1>();

afterEach(async () => {
    for (const path of cleanupPaths) await unlink(path).catch(() => undefined);
    const stateNames = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1).catch(() => []);
    for (const prefix of cleanupStatePrefixes) {
        for (const name of stateNames) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1}/${name}`).catch(() => undefined);
            }
        }
    }
    const journalNames = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1).catch(() => []);
    for (const prefix of cleanupJournalPrefixes) {
        for (const name of journalNames) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1}/${name}`).catch(
                    () => undefined
                );
            }
        }
    }
    const leaseNames = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1).catch(() => []);
    for (const prefix of cleanupStatePrefixes) {
        for (const name of leaseNames) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${name}`).catch(
                    () => undefined
                );
            }
        }
    }
    cleanupStatePrefixes.clear();
    cleanupJournalPrefixes.clear();
    cleanupPaths.clear();
    leaseByPlan.clear();
});

const randomDigest = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");

const prepared = async (): Promise<D1ProbeCloudflareWorkerCanaryOperationV1> => {
    const startedAt = Date.now();
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    let batch = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "d".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => startedAt,
            randomBytes: byteLength => {
                batch += 1;
                return new Uint8Array(byteLength).map(
                    (_, index) => ((entropy[index % entropy.length] ?? 0) + index + batch * 31) % 251
                );
            },
        }
    );
    if (!generated.success) throw new Error(generated.code);
    const operation = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
        generated.command.plan,
        `openbot-canary-attempt-${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
            byte.toString(16).padStart(2, "0")
        ).join("")}`,
        startedAt + 1
    );
    if (!operation.success) throw new Error(operation.code);
    cleanupStatePrefixes.add(operation.operation.plan.plan_digest);
    cleanupJournalPrefixes.add(operation.operation.plan.plan_digest);
    const acquired = await acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1({
        plan_digest: operation.operation.plan.plan_digest,
        execution_nonce: operation.operation.execution_nonce,
        lease_duration_ms: 300_000,
    });
    if (!acquired.success) throw new Error(acquired.code);
    leaseByPlan.set(operation.operation.plan.plan_digest, acquired.lease);
    return operation.operation;
};

const claimFor = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1> = {}
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const [operationDigest, nonceCommitment] = await Promise.all([
        digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
        commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
    ]);
    if (operationDigest === null || nonceCommitment === null) throw new Error("commitment unavailable");
    const lease = leaseByPlan.get(operation.plan.plan_digest);
    const leaseRecordDigest =
        lease === undefined ? null : await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(lease);
    if (lease === undefined || leaseRecordDigest === null) throw new Error("lease commitment unavailable");
    const claim = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
        journal_revision: 0,
        previous_claim_digest: null,
        plan_digest: operation.plan.plan_digest,
        operation_revision: operation.revision,
        operation_state: operation.state,
        operation_record_digest: operationDigest,
        execution_nonce_commitment: nonceCommitment,
        lease_generation: lease.generation,
        lease_record_digest: leaseRecordDigest,
        workflow_step: "prepared_worker_list",
        request_kind: "inspect_worker",
        request_method: "GET",
        transcript_sequence: 1,
        effect_phase: "dispatch_intent",
        intent_observed_at_ms: Math.max(operation.updated_at_ms + 1, lease.heartbeat_at_ms),
        dispatch_started_at_ms: null,
        request_digest: randomDigest(),
        request_path_digest: randomDigest(),
        response_status: null,
        response_digest: null,
        ambiguity_classification: "not_dispatched",
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        ...overrides,
    });
    if (claim === null) throw new Error("claim did not validate");
    return claim;
};

const nextClaim = async (
    current: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1>
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const { claim_digest: _claimDigest, ...draft } = current;
    const claim = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        ...draft,
        journal_revision: current.journal_revision + 1,
        previous_claim_digest: current.claim_digest,
        ...(overrides.effect_phase === "dispatch_started" && overrides.dispatch_started_at_ms === undefined
            ? { dispatch_started_at_ms: current.intent_observed_at_ms + 1 }
            : {}),
        ...(overrides.effect_phase === "dispatch_intent"
            ? {
                  intent_observed_at_ms:
                      overrides.intent_observed_at_ms ??
                      (current.dispatch_started_at_ms ?? current.intent_observed_at_ms) + 1,
                  dispatch_started_at_ms: null,
              }
            : {}),
        ...overrides,
    });
    if (claim === null) throw new Error("next claim did not validate");
    return claim;
};

const terminalClaims = async (
    intent: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): Promise<readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[]> => {
    const started = await nextClaim(intent, {
        effect_phase: "dispatch_started",
        ambiguity_classification: "may_have_dispatched",
    });
    const observed = await nextClaim(started, {
        effect_phase: "response_observed",
        response_status: 200,
        response_digest: randomDigest(),
        ambiguity_classification: "none",
    });
    return [intent, started, observed];
};

const appendClaims = async (claims: readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[]) => {
    for (const claim of claims) {
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(claim)).success).toBe(true);
    }
};

describe("Cloudflare Worker canary read-only consistency", () => {
    it("classifies exact sync and exposes only redacted non-authoritative heads", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const claims = await terminalClaims(await claimFor(operation));
        await appendClaims(claims);

        const result = await readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest);
        const lease = leaseByPlan.get(operation.plan.plan_digest);
        const leaseRecordDigest = await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(lease);
        expect(result).toMatchObject({
            classification: "exact_sync",
            plan_digest: operation.plan.plan_digest,
            state_operation_revision: 0,
            state_operation_state: "prepared",
            driver_lease_generation: lease?.generation,
            driver_lease_record_digest: leaseRecordDigest,
            driver_lease_state: "active",
            claim_journal_revision: 2,
            claim_operation_revision: 0,
            claim_operation_state: "prepared",
            claim_workflow_step: "prepared_worker_list",
            claim_effect_phase: "response_observed",
            effect_claims_authenticated: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        expect(JSON.stringify(result)).not.toMatch(
            /api_token|execution_nonce"|attempt_tag|script_name|ownership_tag|worker_id|version_id|deployment_id/iu
        );
    });

    it("distinguishes claim-behind and ambiguous dispatch", async () => {
        const behind = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(behind)).success).toBe(true);
        const behindIntent = await claimFor(behind);
        await appendClaims([behindIntent]);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(behind.plan.plan_digest)).resolves.toMatchObject({
            classification: "claim_behind",
            claim_effect_phase: "dispatch_intent",
        });

        const ambiguous = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(ambiguous)).success).toBe(true);
        const ambiguousIntent = await claimFor(ambiguous);
        const started = await nextClaim(ambiguousIntent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        await appendClaims([ambiguousIntent, started]);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(ambiguous.plan.plan_digest)).resolves.toMatchObject(
            {
                classification: "ambiguous_dispatch",
                claim_effect_phase: "dispatch_started",
            }
        );
    });

    it("distinguishes one-step state ahead and missing prepared state", async () => {
        const stateAhead = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(stateAhead)).success).toBe(true);
        await appendClaims(await terminalClaims(await claimFor(stateAhead)));
        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            stateAhead,
            "shell_dispatching",
            stateAhead.updated_at_ms + 1
        );
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(stateAhead.plan.plan_digest, 0, shellDispatch)
        ).toEqual({ success: true, operation: shellDispatch });
        await expect(
            readD1ProbeCloudflareWorkerCanaryConsistencyV1(stateAhead.plan.plan_digest)
        ).resolves.toMatchObject({ classification: "state_ahead", state_operation_revision: 1 });

        const missingJournal = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(missingJournal)).success).toBe(true);
        await expect(
            readD1ProbeCloudflareWorkerCanaryConsistencyV1(missingJournal.plan.plan_digest)
        ).resolves.toMatchObject({ classification: "missing", missing_component: "effect_journal" });
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(randomDigest())).resolves.toMatchObject({
            classification: "missing",
            missing_component: "multiple",
        });
    });

    it("treats journal-ahead, ambiguous missing-operation, and multi-step state-ahead as corrupt", async () => {
        const journalAhead = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(journalAhead)).success).toBe(true);
        const preparedClaims = await terminalClaims(await claimFor(journalAhead));
        await appendClaims(preparedClaims);
        const preparedHead = preparedClaims.at(-1);
        if (preparedHead === undefined) throw new Error("head unavailable");
        const shellOperation = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            journalAhead,
            "shell_dispatching",
            journalAhead.updated_at_ms + 1
        );
        const shellDigest = await digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(shellOperation);
        if (shellDigest === null) throw new Error("digest unavailable");
        const shellIntent = await nextClaim(preparedHead, {
            operation_revision: 1,
            operation_state: "shell_dispatching",
            operation_record_digest: shellDigest,
            workflow_step: "shell_create",
            request_kind: "create_worker",
            request_method: "POST",
            transcript_sequence: 2,
            effect_phase: "dispatch_intent",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        const shellStarted = await nextClaim(shellIntent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        await appendClaims([shellIntent, shellStarted]);
        await expect(
            readD1ProbeCloudflareWorkerCanaryConsistencyV1(journalAhead.plan.plan_digest)
        ).resolves.toMatchObject({ classification: "corrupt", corrupt_component: "bindings" });

        const tooFarAhead = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(tooFarAhead)).success).toBe(true);
        await appendClaims(await terminalClaims(await claimFor(tooFarAhead)));
        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            tooFarAhead,
            "shell_dispatching",
            tooFarAhead.updated_at_ms + 1
        );
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(tooFarAhead.plan.plan_digest, 0, shellDispatch)
        ).toEqual({ success: true, operation: shellDispatch });
        const cleanup = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            shellDispatch,
            "cleanup_reconciling",
            shellDispatch.updated_at_ms + 1
        );
        expect(await transitionD1ProbeCloudflareWorkerCanaryStateV1(tooFarAhead.plan.plan_digest, 1, cleanup)).toEqual({
            success: true,
            operation: cleanup,
        });
        await expect(
            readD1ProbeCloudflareWorkerCanaryConsistencyV1(tooFarAhead.plan.plan_digest)
        ).resolves.toMatchObject({ classification: "corrupt", corrupt_component: "bindings" });

        const noJournal = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(noJournal)).success).toBe(true);
        const noJournalDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            noJournal,
            "shell_dispatching",
            noJournal.updated_at_ms + 1
        );
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(noJournal.plan.plan_digest, 0, noJournalDispatch)
        ).toEqual({ success: true, operation: noJournalDispatch });
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(noJournal.plan.plan_digest)).resolves.toMatchObject(
            { classification: "corrupt", corrupt_component: "bindings" }
        );
    });

    it("rejects state-ahead when the latest claim is not terminal", async () => {
        for (const phase of ["dispatch_intent", "dispatch_started"] as const) {
            const operation = await prepared();
            expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
            const intent = await claimFor(operation);
            const claims = [intent];
            if (phase === "dispatch_started") {
                claims.push(
                    await nextClaim(intent, {
                        effect_phase: "dispatch_started",
                        ambiguity_classification: "may_have_dispatched",
                    })
                );
            }
            await appendClaims(claims);
            const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
                operation,
                "shell_dispatching",
                operation.updated_at_ms + 1
            );
            expect(
                await transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch)
            ).toEqual({ success: true, operation: shellDispatch });
            await expect(
                readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest)
            ).resolves.toMatchObject({
                classification: "corrupt",
                corrupt_component: "bindings",
                claim_effect_phase: phase,
            });
        }
    });

    it("rejects forged historical operation, nonce, and lease bindings", async () => {
        for (const mismatch of ["operation_digest", "nonce_commitment", "lease_digest", "lease_generation"] as const) {
            const operation = await prepared();
            expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
            const intent = await claimFor(operation, {
                ...(mismatch === "operation_digest" ? { operation_record_digest: randomDigest() } : {}),
                ...(mismatch === "nonce_commitment" ? { execution_nonce_commitment: randomDigest() } : {}),
                ...(mismatch === "lease_digest" ? { lease_record_digest: randomDigest() } : {}),
                ...(mismatch === "lease_generation" ? { lease_generation: 1 } : {}),
            });
            await appendClaims(await terminalClaims(intent));
            await expect(
                readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest)
            ).resolves.toMatchObject({ classification: "corrupt", corrupt_component: "bindings" });
        }
    });

    it("rejects a forged historical claim even when the latest claim matches state", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const preparedClaims = await terminalClaims(await claimFor(operation));
        await appendClaims(preparedClaims);
        const preparedHead = preparedClaims.at(-1);
        if (preparedHead === undefined) throw new Error("head unavailable");

        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            operation,
            "shell_dispatching",
            operation.updated_at_ms + 1
        );
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch)
        ).toEqual({ success: true, operation: shellDispatch });
        const forgedShellIntent = await nextClaim(preparedHead, {
            operation_revision: 1,
            operation_state: "shell_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "shell_create",
            request_kind: "create_worker",
            request_method: "POST",
            transcript_sequence: 2,
            effect_phase: "dispatch_intent",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        const forgedShellClaims = await terminalClaims(forgedShellIntent);
        await appendClaims(forgedShellClaims);
        const forgedHead = forgedShellClaims.at(-1);
        if (forgedHead === undefined) throw new Error("head unavailable");

        const shellIdentified = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            shellDispatch,
            "shell_identified",
            shellDispatch.updated_at_ms + 1,
            { worker_id: "worker_history" }
        );
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 1, shellIdentified)
        ).toEqual({ success: true, operation: shellIdentified });
        const identifiedDigest = await digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(shellIdentified);
        if (identifiedDigest === null) throw new Error("digest unavailable");
        const validReadback = await nextClaim(forgedHead, {
            operation_revision: 2,
            operation_state: "shell_identified",
            operation_record_digest: identifiedDigest,
            workflow_step: "shell_readback",
            request_kind: "inspect_worker",
            request_method: "GET",
            transcript_sequence: 3,
            effect_phase: "dispatch_intent",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        await appendClaims(await terminalClaims(validReadback));
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest)).resolves.toMatchObject(
            {
                classification: "corrupt",
                corrupt_component: "bindings",
                state_operation_revision: 2,
                claim_operation_revision: 2,
            }
        );
    });

    it("rejects cross-plan records and revision gaps", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const bootstrap = await prepared();
        await appendClaims([await claimFor(bootstrap)]);
        const foreign = await claimFor(bootstrap);
        const crossPlanPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(operation.plan.plan_digest, 0);
        if (crossPlanPath === null) throw new Error("path unavailable");
        await writeFile(crossPlanPath, canonicalizeJsonV1(foreign as CanonicalJsonValueV1), { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest)).resolves.toMatchObject(
            {
                classification: "corrupt",
                corrupt_component: "effect_journal",
            }
        );

        const gapOperation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(gapOperation)).success).toBe(true);
        const gap = await claimFor(gapOperation, {
            journal_revision: 1,
            previous_claim_digest: randomDigest(),
        });
        const gapPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(gapOperation.plan.plan_digest, 1);
        if (gapPath === null) throw new Error("path unavailable");
        await writeFile(gapPath, canonicalizeJsonV1(gap as CanonicalJsonValueV1), { mode: 0o600 });
        await expect(
            readD1ProbeCloudflareWorkerCanaryConsistencyV1(gapOperation.plan.plan_digest)
        ).resolves.toMatchObject({ classification: "corrupt", corrupt_component: "effect_journal" });
    });

    it("fails closed on journal hard links and leaves publication residue unchanged", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        await appendClaims([await claimFor(operation)]);
        const finalPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(operation.plan.plan_digest, 0);
        if (finalPath === null) throw new Error("path unavailable");
        const tempPath = finalPath.replace(
            ".0.effect-claim.json",
            ".0.11111111-1111-4111-8111-111111111111.effect-claim.tmp"
        );
        cleanupPaths.add(tempPath);
        await link(finalPath, tempPath);
        const before = await Promise.all([lstat(finalPath), lstat(tempPath), readFile(finalPath)]);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest)).resolves.toMatchObject(
            {
                classification: "corrupt",
                corrupt_component: "effect_journal",
            }
        );
        const after = await Promise.all([lstat(finalPath), lstat(tempPath), readFile(finalPath)]);
        expect(after[0].nlink).toBe(before[0].nlink);
        expect(after[1].nlink).toBe(before[1].nlink);
        expect(after[0].mtimeMs).toBe(before[0].mtimeMs);
        expect(after[2]).toEqual(before[2]);
    });

    it("rejects temp-only and head-plus-temp journal entries without writing", async () => {
        const bootstrap = await prepared();
        await appendClaims([await claimFor(bootstrap)]);

        const tempOnly = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(tempOnly)).success).toBe(true);
        const tempOnlyPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1}/${tempOnly.plan.plan_digest}.0.11111111-1111-4111-8111-111111111111.effect-claim.tmp`;
        cleanupPaths.add(tempOnlyPath);
        await writeFile(tempOnlyPath, "{}", { mode: 0o600 });
        const tempOnlyBefore = await lstat(tempOnlyPath);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(tempOnly.plan.plan_digest)).resolves.toMatchObject({
            classification: "corrupt",
            corrupt_component: "effect_journal",
        });
        await expect(lstat(tempOnlyPath)).resolves.toMatchObject({
            size: tempOnlyBefore.size,
            mtimeMs: tempOnlyBefore.mtimeMs,
        });

        const withHead = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(withHead)).success).toBe(true);
        await appendClaims([await claimFor(withHead)]);
        const orphanPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1}/${withHead.plan.plan_digest}.1.11111111-1111-4111-8111-111111111111.effect-claim.tmp`;
        cleanupPaths.add(orphanPath);
        await writeFile(orphanPath, "{}", { mode: 0o600 });
        const orphanBefore = await lstat(orphanPath);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(withHead.plan.plan_digest)).resolves.toMatchObject({
            classification: "corrupt",
            corrupt_component: "effect_journal",
        });
        await expect(lstat(orphanPath)).resolves.toMatchObject({
            size: orphanBefore.size,
            mtimeMs: orphanBefore.mtimeMs,
        });
    });

    it("rejects temp-only and head-plus-temp state entries without writing", async () => {
        const bootstrap = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(bootstrap)).success).toBe(true);

        const tempOnly = await prepared();
        const tempOnlyPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1}/${tempOnly.plan.plan_digest}.0.11111111-1111-4111-8111-111111111111.operation.tmp`;
        cleanupPaths.add(tempOnlyPath);
        await writeFile(tempOnlyPath, "{}", { mode: 0o600 });
        const tempOnlyBefore = await lstat(tempOnlyPath);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(tempOnly.plan.plan_digest)).resolves.toMatchObject({
            classification: "corrupt",
            corrupt_component: "state",
        });
        await expect(lstat(tempOnlyPath)).resolves.toMatchObject({
            size: tempOnlyBefore.size,
            mtimeMs: tempOnlyBefore.mtimeMs,
        });

        const withHead = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(withHead)).success).toBe(true);
        const orphanPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1}/${withHead.plan.plan_digest}.1.11111111-1111-4111-8111-111111111111.operation.tmp`;
        cleanupPaths.add(orphanPath);
        await writeFile(orphanPath, "{}", { mode: 0o600 });
        const orphanBefore = await lstat(orphanPath);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(withHead.plan.plan_digest)).resolves.toMatchObject({
            classification: "corrupt",
            corrupt_component: "state",
        });
        await expect(lstat(orphanPath)).resolves.toMatchObject({
            size: orphanBefore.size,
            mtimeMs: orphanBefore.mtimeMs,
        });
    });

    it("rejects state publication hard links without reconciling them", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const finalPath = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.plan.plan_digest);
        if (finalPath === null) throw new Error("path unavailable");
        const tempPath = finalPath.replace(
            ".0.operation.json",
            ".0.11111111-1111-4111-8111-111111111111.operation.tmp"
        );
        cleanupPaths.add(tempPath);
        await link(finalPath, tempPath);
        const before = await Promise.all([lstat(finalPath), lstat(tempPath), readFile(finalPath)]);
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(operation.plan.plan_digest)).resolves.toMatchObject(
            {
                classification: "corrupt",
                corrupt_component: "state",
            }
        );
        const after = await Promise.all([lstat(finalPath), lstat(tempPath), readFile(finalPath)]);
        expect(after[0].nlink).toBe(before[0].nlink);
        expect(after[1].nlink).toBe(before[1].nlink);
        expect(after[0].mtimeMs).toBe(before[0].mtimeMs);
        expect(after[2]).toEqual(before[2]);
    });

    it("returns unstable when either read-only head changes between reads", async () => {
        const operation = await prepared();
        const intent = await claimFor(operation);
        const claims = await terminalClaims(intent);
        let journalRead = 0;
        await expect(
            readD1ProbeCloudflareWorkerCanaryConsistencyWithReadersTestOnlyV1(operation.plan.plan_digest, {
                read_state_history: async () => ({ success: true, operations: [operation] }),
                read_effect_journal: async () => {
                    journalRead += 1;
                    return { success: true, claims: journalRead === 1 ? [intent] : claims };
                },
                read_driver_lease_history: async () => ({
                    success: true,
                    leases: [leaseByPlan.get(operation.plan.plan_digest)!],
                }),
            })
        ).resolves.toMatchObject({ classification: "unstable" });
    });

    it("rejects hostile Proxy input without invoking traps", async () => {
        let traps = 0;
        const input = new Proxy(
            {},
            {
                get: () => {
                    traps += 1;
                    throw new Error("trap");
                },
            }
        );
        await expect(readD1ProbeCloudflareWorkerCanaryConsistencyV1(input)).resolves.toMatchObject({
            classification: "corrupt",
            corrupt_component: "input",
            plan_digest: null,
        });
        expect(traps).toBe(0);
    });
});
