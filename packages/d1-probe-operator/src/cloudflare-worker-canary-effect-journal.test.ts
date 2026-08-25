import { chmod, link, lstat, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { afterEach, describe, expect, it } from "vitest";

import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1,
    appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    d1ProbeCloudflareWorkerCanaryEffectJournalPathV1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";

const cleanupPrefixes = new Set<string>();
const cleanupPaths = new Set<string>();

afterEach(async () => {
    for (const path of cleanupPaths) await unlink(path).catch(() => undefined);
    const names = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1).catch(() => []);
    for (const prefix of cleanupPrefixes) {
        for (const name of names) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1}/${name}`).catch(
                    () => undefined
                );
            }
        }
    }
    cleanupPrefixes.clear();
    cleanupPaths.clear();
});

const randomDigest = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");

const draft = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1> = {}
): D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
    journal_revision: 0,
    previous_claim_digest: null,
    plan_digest: randomDigest(),
    operation_revision: 0,
    operation_state: "prepared",
    operation_record_digest: randomDigest(),
    execution_nonce_commitment: randomDigest(),
    lease_generation: 0,
    lease_record_digest: randomDigest(),
    cleanup_obligation_digest: null,
    workflow_step: "prepared_worker_list",
    request_kind: "inspect_worker",
    request_method: "GET",
    transcript_sequence: 1,
    effect_phase: "dispatch_intent",
    intent_observed_at_ms: 1_000,
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

const record = async (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1> = {}
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const built = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(draft(overrides));
    if (built === null) throw new Error("test effect claim did not validate");
    cleanupPrefixes.add(built.plan_digest);
    return built;
};

const draftFromClaim = (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 => {
    const { claim_digest: _claimDigest, ...claimDraft } = claim;
    return claimDraft;
};

const nextRecord = async (
    current: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1>
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> =>
    await record({
        ...draftFromClaim(current),
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
        ...([
            "cleanup_worker_readback",
            "cleanup_worker_list",
            "delete_worker",
            "deleted_worker_readback",
            "deleted_worker_list",
        ].includes(overrides.workflow_step ?? current.workflow_step) &&
        overrides.cleanup_obligation_digest === undefined
            ? { cleanup_obligation_digest: current.cleanup_obligation_digest ?? randomDigest() }
            : {}),
        ...overrides,
    } as Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1>);

const appendTerminalRequest = async (
    intent: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const started = await nextRecord(intent, {
        effect_phase: "dispatch_started",
        ambiguity_classification: "may_have_dispatched",
    });
    const observed = await nextRecord(started, {
        effect_phase: "response_observed",
        response_status: 200,
        response_digest: randomDigest(),
        ambiguity_classification: "none",
    });
    for (const claim of [intent, started, observed]) {
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(claim)).success).toBe(true);
    }
    return observed;
};

const nextIntent = async (
    current: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1>
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> =>
    await nextRecord(current, {
        transcript_sequence: current.transcript_sequence + 1,
        effect_phase: "dispatch_intent",
        intent_observed_at_ms: (current.dispatch_started_at_ms ?? current.intent_observed_at_ms) + 1,
        dispatch_started_at_ms: null,
        request_digest: randomDigest(),
        request_path_digest: randomDigest(),
        response_status: null,
        response_digest: null,
        ambiguity_classification: "not_dispatched",
        ...overrides,
    });

describe("Cloudflare Worker canary untrusted effect journal", () => {
    it("publishes canonical redacted claims with private filesystem modes", async () => {
        const initial = await record();
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(initial)).resolves.toEqual({
            success: true,
            claim: initial,
        });
        const path = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(initial.plan_digest, 0);
        if (path === null) throw new Error("journal path unavailable");
        const [rootStat, fileStat, bytes] = await Promise.all([
            lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1),
            lstat(path),
            readFile(path, "utf8"),
        ]);
        expect(rootStat.mode & 0o777).toBe(0o700);
        expect(fileStat.mode & 0o777).toBe(0o600);
        expect(bytes).toBe(canonicalizeJsonV1(initial as CanonicalJsonValueV1));
        expect(bytes).not.toMatch(
            /"(?:api[_-]?token|execution_nonce|attempt_tag|script_name|worker_id|version_id|deployment_id|module|secret)"\s*:/iu
        );
        expect(initial).toMatchObject({
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
    });

    it("records a bounded request lifecycle and advances only after a terminal phase", async () => {
        const intent = await record();
        const started = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        const observed = await nextRecord(started, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: randomDigest(),
            ambiguity_classification: "none",
        });
        const nextIntent = await nextRecord(observed, {
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
        for (const entry of [intent, started, observed, nextIntent]) {
            await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(entry)).resolves.toEqual({
                success: true,
                claim: entry,
            });
        }
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(intent.plan_digest)).resolves.toEqual({
            success: true,
            claims: [intent, started, observed, nextIntent],
        });
    });

    it("rejects malformed phases and extra fields without throwing", async () => {
        const malformed = {
            ...draft({
                effect_phase: "response_observed",
                ambiguity_classification: "none",
            }),
            api_token: "must-not-persist",
        };
        await expect(buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(malformed)).resolves.toBeNull();
        await expect(validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(malformed)).resolves.toBeNull();
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(malformed)).resolves.toEqual({
            success: false,
            code: "invalid_untrusted_effect_claim",
        });
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1("../journal")).resolves.toEqual({
            success: false,
            code: "invalid_plan_digest",
        });
        await expect(
            commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1({ toString: () => "secret" })
        ).resolves.toBeNull();
        await expect(digestD1ProbeCloudflareWorkerCanaryOperationRecordV1({ state: "prepared" })).resolves.toBeNull();
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                draft({ request_kind: "create_version", operation_state: "shell_dispatching" })
            )
        ).resolves.toBeNull();
        const withoutIntentTime = { ...draft() } as Record<string, unknown>;
        delete withoutIntentTime["intent_observed_at_ms"];
        await expect(buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(withoutIntentTime)).resolves.toBeNull();
        const withoutDispatchTime = { ...draft() } as Record<string, unknown>;
        delete withoutDispatchTime["dispatch_started_at_ms"];
        await expect(buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(withoutDispatchTime)).resolves.toBeNull();
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(draft({ dispatch_started_at_ms: 1_001 }))
        ).resolves.toBeNull();
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                draft({
                    effect_phase: "dispatch_started",
                    dispatch_started_at_ms: null,
                    ambiguity_classification: "may_have_dispatched",
                })
            )
        ).resolves.toBeNull();
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                draft({
                    effect_phase: "dispatch_started",
                    dispatch_started_at_ms: 999,
                    ambiguity_classification: "may_have_dispatched",
                })
            )
        ).resolves.toBeNull();
    });

    it("binds cleanup workflow claims to exactly one non-null cleanup obligation digest", async () => {
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                draft({ cleanup_obligation_digest: randomDigest() })
            )
        ).resolves.toBeNull();
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                draft({
                    operation_state: "cleanup_reconciling",
                    workflow_step: "cleanup_worker_readback",
                    request_kind: "inspect_cleanup",
                    cleanup_obligation_digest: null,
                })
            )
        ).resolves.toBeNull();
        await expect(
            buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                draft({
                    operation_state: "cleanup_reconciling",
                    workflow_step: "cleanup_worker_readback",
                    request_kind: "inspect_cleanup",
                    cleanup_obligation_digest: randomDigest(),
                })
            )
        ).resolves.not.toBeNull();
    });

    it("commits the execution nonce without retaining the nonce", async () => {
        const nonce = "12".repeat(16);
        const first = await commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(nonce);
        const second = await commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(nonce);
        expect(first).toMatch(/^[0-9a-f]{64}$/u);
        expect(first).toBe(second);
        expect(first).not.toContain(nonce);
    });

    it("rejects chain substitution, replay, request changes, and sequence gaps", async () => {
        const intent = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(intent)).success).toBe(true);

        const wrongChain = await nextRecord(intent, {
            previous_claim_digest: randomDigest(),
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: 1_001,
            ambiguity_classification: "may_have_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(wrongChain)).resolves.toEqual({
            success: false,
            code: "journal_chain_mismatch",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(intent)).resolves.toEqual({
            success: false,
            code: "journal_revision_mismatch",
        });

        const changedRequest = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
            request_digest: randomDigest(),
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(changedRequest)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const changedIntentTime = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            intent_observed_at_ms: intent.intent_observed_at_ms + 1,
            ambiguity_classification: "may_have_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(changedIntentTime)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const changedLeaseEpoch = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: 1_001,
            lease_record_digest: randomDigest(),
            ambiguity_classification: "may_have_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(changedLeaseEpoch)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const skippedSequence = await nextRecord(intent, {
            operation_revision: 3,
            operation_state: "version_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "version_create",
            request_kind: "create_version",
            request_method: "POST",
            transcript_sequence: 3,
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(skippedSequence)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
    });

    it("rejects operation rollback and a new request before a terminal claim", async () => {
        const preparedIntent = await record();
        const preparedStarted = await nextRecord(preparedIntent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        const preparedObserved = await nextRecord(preparedStarted, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: randomDigest(),
            ambiguity_classification: "none",
        });
        for (const claim of [preparedIntent, preparedStarted, preparedObserved]) {
            expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(claim)).success).toBe(true);
        }
        const intent = await nextRecord(preparedObserved, {
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
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(intent)).success).toBe(true);
        const rollback = await nextRecord(intent, {
            operation_revision: 0,
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(rollback)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
        const earlyNext = await nextRecord(intent, {
            operation_revision: 2,
            operation_state: "cleanup_reconciling",
            operation_record_digest: randomDigest(),
            workflow_step: "cleanup_worker_readback",
            transcript_sequence: 3,
            request_kind: "inspect_cleanup",
            request_method: "GET",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(earlyNext)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
    });

    it("keeps dispatch timing immutable and monotonic", async () => {
        const intent = await record();
        const started = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: 1_005,
            ambiguity_classification: "may_have_dispatched",
        });
        for (const claim of [intent, started]) {
            expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(claim)).success).toBe(true);
        }
        const driftedTerminal = await nextRecord(started, {
            effect_phase: "response_observed",
            dispatch_started_at_ms: 1_006,
            response_status: 200,
            response_digest: randomDigest(),
            ambiguity_classification: "none",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(driftedTerminal)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
        const observed = await nextRecord(started, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: randomDigest(),
            ambiguity_classification: "none",
        });
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(observed)).success).toBe(true);
        const clockRollback = await nextRecord(observed, {
            transcript_sequence: 2,
            effect_phase: "dispatch_intent",
            intent_observed_at_ms: 1_004,
            dispatch_started_at_ms: null,
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(clockRollback)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
    });

    it("rejects operation snapshot substitution and revision skips", async () => {
        const intent = await record();
        const started = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        const observed = await nextRecord(started, {
            effect_phase: "response_observed",
            response_status: 201,
            response_digest: randomDigest(),
            ambiguity_classification: "none",
        });
        for (const claim of [intent, started, observed]) {
            expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(claim)).success).toBe(true);
        }

        const substitutedDigest = await nextRecord(observed, {
            workflow_step: "prepared_worker_list",
            request_kind: "inspect_worker",
            request_method: "GET",
            transcript_sequence: 2,
            operation_record_digest: randomDigest(),
            effect_phase: "dispatch_intent",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(substitutedDigest)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const substitutedState = await nextRecord(observed, {
            workflow_step: "shell_create",
            request_kind: "create_worker",
            request_method: "POST",
            transcript_sequence: 2,
            operation_state: "shell_dispatching",
            effect_phase: "dispatch_intent",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(substitutedState)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const skippedRevision = await nextRecord(observed, {
            operation_revision: 3,
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
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(skippedRevision)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
    });

    it("allows the fixed read sequence and denies mutation retries or cleanup jumps", async () => {
        const prepared = await appendTerminalRequest(await record());
        const shellCreate = await nextIntent(prepared, {
            operation_revision: 1,
            operation_state: "shell_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "shell_create",
            request_kind: "create_worker",
            request_method: "POST",
        });
        const shellCreated = await appendTerminalRequest(shellCreate);

        const repeatedShellCreate = await nextIntent(shellCreated, {
            workflow_step: "shell_create",
            request_kind: "create_worker",
            request_method: "POST",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(repeatedShellCreate)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
        const deleteJump = await nextIntent(shellCreated, {
            operation_revision: 2,
            operation_state: "delete_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "delete_worker",
            request_kind: "delete_worker",
            request_method: "DELETE",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(deleteJump)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const shellReadback = await nextIntent(shellCreated, {
            operation_revision: 2,
            operation_state: "shell_identified",
            operation_record_digest: randomDigest(),
            workflow_step: "shell_readback",
            request_kind: "inspect_worker",
            request_method: "GET",
        });
        const shellRead = await appendTerminalRequest(shellReadback);
        const secondShellReadback = await nextIntent(shellRead, {
            workflow_step: "shell_readback",
            request_kind: "inspect_worker",
            request_method: "GET",
        });
        const shellReadAgain = await appendTerminalRequest(secondShellReadback);

        const versionCreate = await nextIntent(shellReadAgain, {
            operation_revision: 3,
            operation_state: "version_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "version_create",
            request_kind: "create_version",
            request_method: "POST",
        });
        const versionCreated = await appendTerminalRequest(versionCreate);
        const repeatedVersionCreate = await nextIntent(versionCreated, {
            workflow_step: "version_create",
            request_kind: "create_version",
            request_method: "POST",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(repeatedVersionCreate)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const versionReadback = await nextIntent(versionCreated, {
            operation_revision: 4,
            operation_state: "version_identified",
            operation_record_digest: randomDigest(),
            workflow_step: "version_readback",
            request_kind: "inspect_worker",
            request_method: "GET",
        });
        const versionRead = await appendTerminalRequest(versionReadback);
        const deploymentCreate = await nextIntent(versionRead, {
            operation_revision: 5,
            operation_state: "deployment_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "deployment_create",
            request_kind: "create_deployment",
            request_method: "POST",
        });
        const deploymentCreated = await appendTerminalRequest(deploymentCreate);
        const repeatedDeploymentCreate = await nextIntent(deploymentCreated, {
            workflow_step: "deployment_create",
            request_kind: "create_deployment",
            request_method: "POST",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(repeatedDeploymentCreate)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });

        const deploymentReadback = await nextIntent(deploymentCreated, {
            operation_revision: 6,
            operation_state: "deployment_identified",
            operation_record_digest: randomDigest(),
            workflow_step: "deployment_readback",
            request_kind: "inspect_worker",
            request_method: "GET",
        });
        const deploymentRead = await appendTerminalRequest(deploymentReadback);
        const cleanupReadback = await nextIntent(deploymentRead, {
            operation_revision: 7,
            operation_state: "cleanup_reconciling",
            operation_record_digest: randomDigest(),
            workflow_step: "cleanup_worker_readback",
            request_kind: "inspect_cleanup",
            request_method: "GET",
        });
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(cleanupReadback)).success).toBe(true);
        const substitutedCleanupObligation = await nextRecord(cleanupReadback, {
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: cleanupReadback.intent_observed_at_ms + 1,
            cleanup_obligation_digest: randomDigest(),
            ambiguity_classification: "may_have_dispatched",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(substitutedCleanupObligation)).resolves.toEqual(
            { success: false, code: "journal_transition_denied" }
        );
        const cleanupStarted = await nextRecord(cleanupReadback, {
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: cleanupReadback.intent_observed_at_ms + 1,
            ambiguity_classification: "may_have_dispatched",
        });
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(cleanupStarted)).success).toBe(true);
        const cleanupRead = await nextRecord(cleanupStarted, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: randomDigest(),
            ambiguity_classification: "none",
        });
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(cleanupRead)).success).toBe(true);
        const deleteWorker = await nextIntent(cleanupRead, {
            operation_revision: 8,
            operation_state: "delete_dispatching",
            operation_record_digest: randomDigest(),
            workflow_step: "delete_worker",
            request_kind: "delete_worker",
            request_method: "DELETE",
        });
        const deleted = await appendTerminalRequest(deleteWorker);
        const repeatedDelete = await nextIntent(deleted, {
            workflow_step: "delete_worker",
            request_kind: "delete_worker",
            request_method: "DELETE",
        });
        await expect(appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(repeatedDelete)).resolves.toEqual({
            success: false,
            code: "journal_transition_denied",
        });
    }, 15_000);

    it("detects a missing first revision and an on-disk digest-chain substitution", async () => {
        const bootstrap = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(bootstrap)).success).toBe(true);

        const gapPlan = randomDigest();
        cleanupPrefixes.add(gapPlan);
        const gap = await record({
            plan_digest: gapPlan,
            journal_revision: 1,
            previous_claim_digest: randomDigest(),
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: 1_001,
            ambiguity_classification: "may_have_dispatched",
        });
        const gapPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(gapPlan, 1);
        if (gapPath === null) throw new Error("journal path unavailable");
        await writeFile(gapPath, canonicalizeJsonV1(gap as CanonicalJsonValueV1), { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(gapPlan)).resolves.toEqual({
            success: false,
            code: "journal_corrupt",
        });

        const started = await nextRecord(bootstrap, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        const substituted = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
            ...draftFromClaim(started),
            previous_claim_digest: randomDigest(),
        });
        if (substituted === null) throw new Error("substituted record did not validate");
        const substitutedPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(bootstrap.plan_digest, 1);
        if (substitutedPath === null) throw new Error("journal path unavailable");
        await writeFile(substitutedPath, canonicalizeJsonV1(substituted as CanonicalJsonValueV1), { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(bootstrap.plan_digest)).resolves.toEqual({
            success: false,
            code: "journal_corrupt",
        });
    });

    it("denies symbolic links, permissive files, and unrelated hard links", async () => {
        const bootstrap = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(bootstrap)).success).toBe(true);

        const linked = await record();
        const linkedPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(linked.plan_digest, 0);
        if (linkedPath === null) throw new Error("journal path unavailable");
        const targetPath = `${linkedPath}.target`;
        cleanupPaths.add(targetPath);
        await writeFile(targetPath, "{}", { mode: 0o600 });
        await symlink(targetPath, linkedPath);
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(linked.plan_digest)).resolves.toEqual({
            success: false,
            code: "unsafe_journal_path",
        });

        const bootstrapPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(bootstrap.plan_digest, 0);
        if (bootstrapPath === null) throw new Error("journal path unavailable");
        await chmod(bootstrapPath, 0o644);
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(bootstrap.plan_digest)).resolves.toEqual({
            success: false,
            code: "unsafe_journal_permissions",
        });

        const hardLinked = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(hardLinked)).success).toBe(true);
        const hardLinkedPath = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(hardLinked.plan_digest, 0);
        if (hardLinkedPath === null) throw new Error("journal path unavailable");
        const unrelatedPath = hardLinkedPath.replace(
            ".0.effect-claim.json",
            ".0.not-a-publication-uuid.effect-claim.tmp"
        );
        cleanupPaths.add(unrelatedPath);
        await link(hardLinkedPath, unrelatedPath);
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(hardLinked.plan_digest)).resolves.toEqual({
            success: false,
            code: "unsafe_journal_path",
        });
    });

    it("recovers only the exact same-inode publication residue", async () => {
        const initial = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(initial)).success).toBe(true);
        const path = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(initial.plan_digest, 0);
        if (path === null) throw new Error("journal path unavailable");
        const tempPath = path.replace(
            ".0.effect-claim.json",
            ".0.11111111-1111-4111-8111-111111111111.effect-claim.tmp"
        );
        await link(path, tempPath);
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalV1(initial.plan_digest)).resolves.toEqual({
            success: true,
            claims: [initial],
        });
        await expect(lstat(path)).resolves.toMatchObject({ nlink: 1 });
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps read-only inspection from reconciling publication residue", async () => {
        const initial = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(initial)).success).toBe(true);
        const path = d1ProbeCloudflareWorkerCanaryEffectJournalPathV1(initial.plan_digest, 0);
        if (path === null) throw new Error("journal path unavailable");
        const tempPath = path.replace(
            ".0.effect-claim.json",
            ".0.11111111-1111-4111-8111-111111111111.effect-claim.tmp"
        );
        cleanupPaths.add(tempPath);
        await link(path, tempPath);
        await expect(readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1(initial.plan_digest)).resolves.toEqual({
            success: false,
            code: "journal_unreconciled",
        });
        await expect(lstat(path)).resolves.toMatchObject({ nlink: 2 });
        await expect(lstat(tempPath)).resolves.toMatchObject({ nlink: 2 });
    });

    it("allows only one competing publication for a revision", async () => {
        const intent = await record();
        expect((await appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(intent)).success).toBe(true);
        const startedA = await nextRecord(intent, {
            effect_phase: "dispatch_started",
            ambiguity_classification: "may_have_dispatched",
        });
        const startedB = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
            ...draftFromClaim(startedA),
        });
        if (startedB === null) throw new Error("competing record did not validate");
        const results = await Promise.all([
            appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(startedA),
            appendD1ProbeCloudflareWorkerCanaryEffectJournalV1(startedB),
        ]);
        expect(results.filter(result => result.success)).toHaveLength(1);
        const denial = results.find(result => !result.success);
        expect(denial).toBeDefined();
        if (denial?.success === false) {
            expect(["concurrent_journal_write", "journal_revision_mismatch"]).toContain(denial.code);
        }
    });
});
