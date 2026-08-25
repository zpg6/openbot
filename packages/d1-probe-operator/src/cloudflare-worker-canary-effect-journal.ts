import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { z } from "zod";

import {
    D1ProbeCloudflareWorkerCanaryOperationStateV1Schema,
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const CLAIM_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-effect-claim.v1";
const EXECUTION_NONCE_COMMITMENT_DOMAIN_V1 =
    "openbot.d1-probe.cloudflare-worker-api-canary-execution-nonce-commitment.v1";
const OPERATION_RECORD_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-operation-record.v1";
const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const SafeRevisionV1Schema = z.number().int().safe().nonnegative();
const LeaseGenerationV1Schema = z.number().int().nonnegative().max(1_023);
const TranscriptSequenceV1Schema = z.number().int().safe().positive();
const SafeTimeV1Schema = z.number().int().safe().nonnegative();
const ResponseStatusV1Schema = z.number().int().min(100).max(599).nullable();
const MAX_CLAIM_BYTES_V1 = 32 * 1024;
const MAX_JOURNAL_REVISIONS_V1 = 256;
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const buildRoot = resolve(repositoryRoot, ".build");

export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1 = resolve(
    buildRoot,
    "d1-probe-canary-effect-journal"
);
export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_AUTHORITY_V1 = false as const;

export const D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimPhaseV1Schema = z.enum([
    "dispatch_intent",
    "dispatch_started",
    "response_observed",
    "dispatch_ambiguous",
]);

export const D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestKindV1Schema = z.enum([
    "inspect_worker",
    "create_worker",
    "create_version",
    "create_deployment",
    "inspect_cleanup",
    "delete_worker",
]);

export const D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema = z.enum(["GET", "POST", "DELETE"]);

export const D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimWorkflowStepV1Schema = z.enum([
    "prepared_worker_list",
    "shell_create",
    "shell_dispatch_reconciliation",
    "shell_readback",
    "version_create",
    "version_dispatch_reconciliation",
    "version_readback",
    "deployment_create",
    "deployment_dispatch_reconciliation",
    "deployment_readback",
    "cleanup_worker_readback",
    "cleanup_worker_list",
    "delete_worker",
    "deleted_worker_readback",
    "deleted_worker_list",
]);

export const D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimAmbiguityV1Schema = z.enum([
    "none",
    "not_dispatched",
    "may_have_dispatched",
    "dispatch_outcome_unknown",
    "response_body_unavailable",
]);

const workflowBindings = {
    prepared_worker_list: { request_kind: "inspect_worker", request_method: "GET", operation_state: "prepared" },
    shell_create: { request_kind: "create_worker", request_method: "POST", operation_state: "shell_dispatching" },
    shell_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "shell_dispatching",
    },
    shell_readback: { request_kind: "inspect_worker", request_method: "GET", operation_state: "shell_identified" },
    version_create: {
        request_kind: "create_version",
        request_method: "POST",
        operation_state: "version_dispatching",
    },
    version_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "version_dispatching",
    },
    version_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "version_identified",
    },
    deployment_create: {
        request_kind: "create_deployment",
        request_method: "POST",
        operation_state: "deployment_dispatching",
    },
    deployment_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "deployment_dispatching",
    },
    deployment_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "deployment_identified",
    },
    cleanup_worker_readback: {
        request_kind: "inspect_cleanup",
        request_method: "GET",
        operation_state: "cleanup_reconciling",
    },
    cleanup_worker_list: {
        request_kind: "inspect_cleanup",
        request_method: "GET",
        operation_state: "cleanup_reconciling",
    },
    delete_worker: { request_kind: "delete_worker", request_method: "DELETE", operation_state: "delete_dispatching" },
    deleted_worker_readback: {
        request_kind: "inspect_cleanup",
        request_method: "GET",
        operation_state: "delete_dispatching",
    },
    deleted_worker_list: {
        request_kind: "inspect_cleanup",
        request_method: "GET",
        operation_state: "delete_dispatching",
    },
} as const;

const workflowTransitions = {
    prepared_worker_list: ["prepared_worker_list", "shell_create"],
    shell_create: ["shell_dispatch_reconciliation", "shell_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    shell_dispatch_reconciliation: [
        "shell_dispatch_reconciliation",
        "shell_readback",
        "cleanup_worker_list",
        "cleanup_worker_readback",
    ],
    shell_readback: ["shell_readback", "version_create", "cleanup_worker_list", "cleanup_worker_readback"],
    version_create: [
        "version_dispatch_reconciliation",
        "version_readback",
        "cleanup_worker_list",
        "cleanup_worker_readback",
    ],
    version_dispatch_reconciliation: [
        "version_dispatch_reconciliation",
        "version_readback",
        "cleanup_worker_list",
        "cleanup_worker_readback",
    ],
    version_readback: ["version_readback", "deployment_create", "cleanup_worker_list", "cleanup_worker_readback"],
    deployment_create: [
        "deployment_dispatch_reconciliation",
        "deployment_readback",
        "cleanup_worker_list",
        "cleanup_worker_readback",
    ],
    deployment_dispatch_reconciliation: [
        "deployment_dispatch_reconciliation",
        "deployment_readback",
        "cleanup_worker_list",
        "cleanup_worker_readback",
    ],
    deployment_readback: ["deployment_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    cleanup_worker_list: ["cleanup_worker_list", "cleanup_worker_readback"],
    cleanup_worker_readback: ["delete_worker"],
    delete_worker: ["deleted_worker_readback"],
    deleted_worker_readback: ["deleted_worker_list"],
    deleted_worker_list: ["deleted_worker_list"],
} as const;

const operationStateTransitions = {
    prepared: ["shell_dispatching", "cleanup_reconciling"],
    shell_dispatching: ["shell_identified", "cleanup_reconciling"],
    shell_identified: ["version_dispatching", "cleanup_reconciling"],
    version_dispatching: ["version_identified", "cleanup_reconciling"],
    version_identified: ["deployment_dispatching", "cleanup_reconciling"],
    deployment_dispatching: ["deployment_identified", "cleanup_reconciling"],
    deployment_identified: ["cleanup_reconciling"],
    cleanup_reconciling: ["delete_dispatching"],
    delete_dispatching: [],
    absence_observed: [],
    manual_required: [],
} as const;

const cleanupWorkflowSteps = new Set<string>([
    "cleanup_worker_readback",
    "cleanup_worker_list",
    "delete_worker",
    "deleted_worker_readback",
    "deleted_worker_list",
]);

const UntrustedEffectClaimDraftV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim"),
        journal_revision: SafeRevisionV1Schema,
        previous_claim_digest: DigestV1Schema.nullable(),
        plan_digest: DigestV1Schema,
        operation_revision: SafeRevisionV1Schema,
        operation_state: D1ProbeCloudflareWorkerCanaryOperationStateV1Schema,
        operation_record_digest: DigestV1Schema,
        execution_nonce_commitment: DigestV1Schema,
        lease_generation: LeaseGenerationV1Schema,
        lease_record_digest: DigestV1Schema,
        cleanup_obligation_digest: DigestV1Schema.nullable(),
        workflow_step: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimWorkflowStepV1Schema,
        request_kind: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestKindV1Schema,
        request_method: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema,
        transcript_sequence: TranscriptSequenceV1Schema,
        effect_phase: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimPhaseV1Schema,
        intent_observed_at_ms: SafeTimeV1Schema,
        dispatch_started_at_ms: SafeTimeV1Schema.nullable(),
        request_digest: DigestV1Schema,
        request_path_digest: DigestV1Schema,
        response_status: ResponseStatusV1Schema,
        response_digest: DigestV1Schema.nullable(),
        ambiguity_classification: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimAmbiguityV1Schema,
        caller_mutation_authority: z.literal(false),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict()
    .superRefine((claim, context) => {
        const binding = workflowBindings[claim.workflow_step];
        if (
            claim.request_kind !== binding.request_kind ||
            claim.request_method !== binding.request_method ||
            claim.operation_state !== binding.operation_state
        ) {
            context.addIssue({ code: "custom", message: "workflow step binding does not match" });
        }
        if (cleanupWorkflowSteps.has(claim.workflow_step) !== (claim.cleanup_obligation_digest !== null)) {
            context.addIssue({ code: "custom", message: "cleanup workflow must bind one cleanup obligation" });
        }
        if (claim.journal_revision === 0 && claim.previous_claim_digest !== null) {
            context.addIssue({ code: "custom", message: "revision zero must start the digest chain" });
        }
        if (claim.journal_revision > 0 && claim.previous_claim_digest === null) {
            context.addIssue({ code: "custom", message: "later revisions must continue the digest chain" });
        }
        if (claim.response_digest !== null && claim.response_status === null) {
            context.addIssue({ code: "custom", message: "response digest requires response status" });
        }
        if (
            claim.effect_phase === "dispatch_intent" &&
            (claim.dispatch_started_at_ms !== null ||
                claim.response_status !== null ||
                claim.response_digest !== null ||
                claim.ambiguity_classification !== "not_dispatched")
        ) {
            context.addIssue({ code: "custom", message: "dispatch intent must be a pre-effect claim" });
        }
        if (
            claim.effect_phase !== "dispatch_intent" &&
            (claim.dispatch_started_at_ms === null || claim.dispatch_started_at_ms < claim.intent_observed_at_ms)
        ) {
            context.addIssue({ code: "custom", message: "post-intent claims require ordered dispatch timing" });
        }
        if (
            claim.effect_phase === "dispatch_started" &&
            (claim.response_status !== null ||
                claim.response_digest !== null ||
                claim.ambiguity_classification !== "may_have_dispatched")
        ) {
            context.addIssue({ code: "custom", message: "dispatch start must retain effect ambiguity" });
        }
        if (
            claim.effect_phase === "response_observed" &&
            (claim.response_status === null ||
                claim.response_digest === null ||
                claim.ambiguity_classification !== "none")
        ) {
            context.addIssue({ code: "custom", message: "observed response must bind status and digest" });
        }
        if (
            claim.effect_phase === "dispatch_ambiguous" &&
            !["dispatch_outcome_unknown", "response_body_unavailable"].includes(claim.ambiguity_classification)
        ) {
            context.addIssue({ code: "custom", message: "ambiguous dispatch must classify the uncertainty" });
        }
        if (
            claim.effect_phase === "dispatch_ambiguous" &&
            claim.ambiguity_classification === "dispatch_outcome_unknown" &&
            (claim.response_status !== null || claim.response_digest !== null)
        ) {
            context.addIssue({ code: "custom", message: "unknown dispatch outcome cannot claim a response" });
        }
        if (
            claim.effect_phase === "dispatch_ambiguous" &&
            claim.ambiguity_classification === "response_body_unavailable" &&
            (claim.response_status === null || claim.response_digest !== null)
        ) {
            context.addIssue({ code: "custom", message: "unavailable response body must retain only status" });
        }
    });

export const D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1Schema = UntrustedEffectClaimDraftV1Schema.extend({
    claim_digest: DigestV1Schema,
}).strict();

export type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 = z.infer<
    typeof UntrustedEffectClaimDraftV1Schema
>;
export type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1Schema
>;

export type D1ProbeCloudflareWorkerCanaryEffectJournalDenialV1 =
    | "invalid_plan_digest"
    | "invalid_untrusted_effect_claim"
    | "journal_not_found"
    | "unsafe_journal_path"
    | "unsafe_journal_permissions"
    | "journal_io_unavailable"
    | "journal_corrupt"
    | "journal_unreconciled"
    | "journal_full"
    | "journal_revision_mismatch"
    | "journal_chain_mismatch"
    | "journal_transition_denied"
    | "concurrent_journal_write";

export type D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryEffectJournalDenialV1 }
    | { readonly success: true; readonly claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 };

export type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryEffectJournalDenialV1 }
    | { readonly success: true; readonly claims: readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[] };

type JournalRootResultV1 =
    | {
          readonly success: false;
          readonly code:
              "journal_not_found" | "unsafe_journal_path" | "unsafe_journal_permissions" | "journal_io_unavailable";
      }
    | { readonly success: true; readonly root: string };

const errorCode = (error: unknown): string | null =>
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : null;

const lstatOrNull = async (path: string) => {
    try {
        return await lstat(path);
    } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
    }
};

const isContainedPath = (parent: string, child: string): boolean => {
    const pathFromParent = relative(parent, child);
    return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`);
};

const makeDirectory = async (path: string): Promise<void> => {
    try {
        await mkdir(path, { mode: 0o700 });
    } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
    }
};

const ensureJournalRoot = async (createIfMissing: boolean): Promise<JournalRootResultV1> => {
    try {
        const repositoryStat = await lstat(repositoryRoot);
        if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_journal_path" };
        }
        const realRepositoryRoot = await realpath(repositoryRoot);
        let buildStat = await lstatOrNull(buildRoot);
        if (buildStat === null) {
            if (!createIfMissing) return { success: false, code: "journal_not_found" };
            await makeDirectory(buildRoot);
            buildStat = await lstat(buildRoot);
        }
        if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_journal_path" };
        }
        let journalStat = await lstatOrNull(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1);
        if (journalStat === null) {
            if (!createIfMissing) return { success: false, code: "journal_not_found" };
            await makeDirectory(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1);
            journalStat = await lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1);
        }
        if (!journalStat.isDirectory() || journalStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_journal_path" };
        }
        if ((journalStat.mode & 0o777) !== 0o700) {
            return { success: false, code: "unsafe_journal_permissions" };
        }
        const realJournalRoot = await realpath(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1);
        if (
            !isContainedPath(realRepositoryRoot, realJournalRoot) ||
            realJournalRoot !== resolve(realRepositoryRoot, ".build", "d1-probe-canary-effect-journal")
        ) {
            return { success: false, code: "unsafe_journal_path" };
        }
        return { success: true, root: realJournalRoot };
    } catch {
        return { success: false, code: "journal_io_unavailable" };
    }
};

const revisionPathFor = (root: string, planDigest: string, revision: number): string =>
    resolve(root, `${planDigest}.${revision}.effect-claim.json`);

const finalRevisions = async (root: string, planDigest: string): Promise<number[]> =>
    (await readdir(root))
        .map(name => new RegExp(`^${planDigest}\\.(\\d+)\\.effect-claim\\.json$`, "u").exec(name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(match => Number(match[1]))
        .filter(Number.isSafeInteger)
        .sort((left, right) => left - right);

const hasUnexpectedPlanEntries = async (root: string, planDigest: string): Promise<boolean> => {
    const finalName = new RegExp(`^${planDigest}\\.\\d+\\.effect-claim\\.json$`, "u");
    return (await readdir(root)).some(name => name.startsWith(`${planDigest}.`) && !finalName.test(name));
};

const syncDirectory = async (path: string): Promise<void> => {
    const directory = await open(path, constants.O_RDONLY);
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
};

const reconcilePublishedRevision = async (
    root: string,
    planDigest: string,
    revision: number,
    finalStat: Awaited<ReturnType<typeof lstat>>
): Promise<boolean> => {
    if (finalStat.nlink !== 2) return finalStat.nlink === 1;
    const tempName = new RegExp(
        `^${planDigest}\\.${revision}\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.effect-claim\\.tmp$`,
        "u"
    );
    const candidates = (await readdir(root)).filter(name => tempName.test(name));
    for (const name of candidates) {
        const tempPath = resolve(root, name);
        const tempStat = await lstatOrNull(tempPath);
        if (
            tempStat !== null &&
            tempStat.isFile() &&
            !tempStat.isSymbolicLink() &&
            tempStat.dev === finalStat.dev &&
            tempStat.ino === finalStat.ino &&
            tempStat.nlink === 2 &&
            (tempStat.mode & 0o777) === 0o600
        ) {
            await unlink(tempPath);
            await syncDirectory(root);
            const reconciled = await lstat(revisionPathFor(root, planDigest, revision));
            return reconciled.isFile() && !reconciled.isSymbolicLink() && reconciled.nlink === 1;
        }
    }
    return false;
};

const digestUntrustedEffectClaimDraft = async (
    draft: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1
): Promise<string | null> => await digestCanonicalJsonV1(CLAIM_DIGEST_DOMAIN_V1, draft as CanonicalJsonValueV1);

export const commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1 = async (
    executionNonceInput: unknown
): Promise<string | null> => {
    if (typeof executionNonceInput !== "string" || !/^[0-9a-f]{32}$/u.test(executionNonceInput)) return null;
    try {
        return await digestCanonicalJsonV1(
            EXECUTION_NONCE_COMMITMENT_DOMAIN_V1,
            executionNonceInput as CanonicalJsonValueV1
        );
    } catch {
        return null;
    }
};

export const digestD1ProbeCloudflareWorkerCanaryOperationRecordV1 = async (
    operationInput: unknown
): Promise<string | null> => {
    try {
        const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(operationInput);
        if (operation === null) return null;
        return await digestCanonicalJsonV1(OPERATION_RECORD_DIGEST_DOMAIN_V1, operation as CanonicalJsonValueV1);
    } catch {
        return null;
    }
};

export const buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 = async (
    draftInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null> => {
    try {
        const draft = UntrustedEffectClaimDraftV1Schema.safeParse(draftInput);
        if (!draft.success) return null;
        const recordDigest = await digestUntrustedEffectClaimDraft(draft.data);
        if (recordDigest === null) return null;
        return D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1Schema.parse({
            ...draft.data,
            claim_digest: recordDigest,
        });
    } catch {
        return null;
    }
};

export const validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 = async (
    recordInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null> => {
    try {
        const parsed = D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1Schema.safeParse(recordInput);
        if (!parsed.success) return null;
        const { claim_digest: claimedDigest, ...draft } = parsed.data;
        const recordDigest = await digestUntrustedEffectClaimDraft(draft);
        return recordDigest !== null && recordDigest === claimedDigest ? parsed.data : null;
    } catch {
        return null;
    }
};

const readRevision = async (
    root: string,
    planDigest: string,
    revision: number,
    reconcilePublishedLink = true
): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1> => {
    const path = revisionPathFor(root, planDigest, revision);
    try {
        let pathStat = await lstatOrNull(path);
        if (pathStat === null) return { success: false, code: "journal_not_found" };
        if (
            reconcilePublishedLink &&
            pathStat.nlink === 2 &&
            (await reconcilePublishedRevision(root, planDigest, revision, pathStat))
        ) {
            pathStat = await lstat(path);
        }
        if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
            return { success: false, code: "unsafe_journal_path" };
        }
        if ((pathStat.mode & 0o777) !== 0o600) {
            return { success: false, code: "unsafe_journal_permissions" };
        }
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1) return { success: false, code: "unsafe_journal_path" };
            if ((stat.mode & 0o777) !== 0o600) {
                return { success: false, code: "unsafe_journal_permissions" };
            }
            if (stat.size <= 0 || stat.size > MAX_CLAIM_BYTES_V1) {
                return { success: false, code: "journal_corrupt" };
            }
            const bytes = await handle.readFile();
            let text: string;
            let input: unknown;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                input = JSON.parse(text) as unknown;
            } catch {
                return { success: false, code: "journal_corrupt" };
            }
            const claim = await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(input);
            if (
                claim === null ||
                claim.plan_digest !== planDigest ||
                claim.journal_revision !== revision ||
                canonicalizeJsonV1(claim as CanonicalJsonValueV1) !== text
            ) {
                return { success: false, code: "journal_corrupt" };
            }
            return { success: true, claim };
        } finally {
            await handle.close();
        }
    } catch {
        return { success: false, code: "journal_io_unavailable" };
    }
};

const sameRequest = (
    left: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    right: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): boolean =>
    left.request_kind === right.request_kind &&
    left.request_method === right.request_method &&
    left.workflow_step === right.workflow_step &&
    left.intent_observed_at_ms === right.intent_observed_at_ms &&
    left.request_digest === right.request_digest &&
    left.request_path_digest === right.request_path_digest &&
    left.operation_revision === right.operation_revision &&
    left.operation_state === right.operation_state &&
    left.operation_record_digest === right.operation_record_digest &&
    left.lease_generation === right.lease_generation &&
    left.lease_record_digest === right.lease_record_digest &&
    left.cleanup_obligation_digest === right.cleanup_obligation_digest;

const terminalPhase = (phase: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["effect_phase"]): boolean =>
    phase === "response_observed" || phase === "dispatch_ambiguous";

const validPhaseAdvance = (
    current: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["effect_phase"],
    next: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["effect_phase"]
): boolean =>
    (current === "dispatch_intent" && next === "dispatch_started") ||
    (current === "dispatch_started" && (next === "response_observed" || next === "dispatch_ambiguous"));

const transitionCode = (
    current: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    next: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): D1ProbeCloudflareWorkerCanaryEffectJournalDenialV1 | null => {
    if (next.journal_revision !== current.journal_revision + 1) return "journal_revision_mismatch";
    if (next.previous_claim_digest !== current.claim_digest) return "journal_chain_mismatch";
    if (
        next.plan_digest !== current.plan_digest ||
        next.execution_nonce_commitment !== current.execution_nonce_commitment ||
        (current.cleanup_obligation_digest !== null &&
            next.cleanup_obligation_digest !== current.cleanup_obligation_digest) ||
        next.lease_generation < current.lease_generation ||
        (next.lease_generation === current.lease_generation &&
            next.lease_record_digest !== current.lease_record_digest) ||
        (next.lease_generation > current.lease_generation && next.lease_record_digest === current.lease_record_digest)
    ) {
        return "journal_transition_denied";
    }
    if (next.transcript_sequence === current.transcript_sequence) {
        if (!sameRequest(current, next) || !validPhaseAdvance(current.effect_phase, next.effect_phase)) {
            return "journal_transition_denied";
        }
        if (current.dispatch_started_at_ms !== null && next.dispatch_started_at_ms !== current.dispatch_started_at_ms) {
            return "journal_transition_denied";
        }
        return null;
    }
    if (
        next.transcript_sequence !== current.transcript_sequence + 1 ||
        !terminalPhase(current.effect_phase) ||
        next.effect_phase !== "dispatch_intent"
    ) {
        return "journal_transition_denied";
    }
    if (current.dispatch_started_at_ms === null || next.intent_observed_at_ms < current.dispatch_started_at_ms) {
        return "journal_transition_denied";
    }
    if (!(workflowTransitions[current.workflow_step] as readonly string[]).includes(next.workflow_step)) {
        return "journal_transition_denied";
    }
    if (next.operation_state === current.operation_state) {
        if (
            next.operation_revision !== current.operation_revision ||
            next.operation_record_digest !== current.operation_record_digest
        ) {
            return "journal_transition_denied";
        }
    } else if (
        !(operationStateTransitions[current.operation_state] as readonly string[]).includes(next.operation_state) ||
        next.operation_revision !== current.operation_revision + 1 ||
        next.operation_record_digest === current.operation_record_digest
    ) {
        return "journal_transition_denied";
    }
    return null;
};

const readJournalFromRoot = async (
    root: string,
    planDigest: string,
    reconcilePublishedLinks = true
): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1> => {
    if (!reconcilePublishedLinks && (await hasUnexpectedPlanEntries(root, planDigest))) {
        return { success: false, code: "journal_unreconciled" };
    }
    const revisions = await finalRevisions(root, planDigest);
    if (revisions.length === 0) return { success: false, code: "journal_not_found" };
    if (revisions.length > MAX_JOURNAL_REVISIONS_V1) return { success: false, code: "journal_full" };
    if (revisions.some((revision, index) => revision !== index)) {
        return { success: false, code: "journal_corrupt" };
    }
    const claims: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[] = [];
    for (const revision of revisions) {
        const read = await readRevision(root, planDigest, revision, reconcilePublishedLinks);
        if (!read.success) return read;
        if (revision === 0) {
            if (
                read.claim.previous_claim_digest !== null ||
                read.claim.transcript_sequence !== 1 ||
                read.claim.effect_phase !== "dispatch_intent" ||
                read.claim.workflow_step !== "prepared_worker_list" ||
                read.claim.operation_revision !== 0 ||
                read.claim.operation_state !== "prepared"
            ) {
                return { success: false, code: "journal_corrupt" };
            }
        } else {
            const previous = claims[revision - 1];
            if (previous === undefined || transitionCode(previous, read.claim) !== null) {
                return { success: false, code: "journal_corrupt" };
            }
        }
        claims.push(read.claim);
    }
    return { success: true, claims };
};

const publishRevision = async (
    root: string,
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1> => {
    const finalPath = revisionPathFor(root, claim.plan_digest, claim.journal_revision);
    const tempPath = resolve(root, `${claim.plan_digest}.${claim.journal_revision}.${randomUUID()}.effect-claim.tmp`);
    let tempCreated = false;
    try {
        const handle = await open(tempPath, "wx", 0o600);
        tempCreated = true;
        try {
            await handle.chmod(0o600);
            await handle.writeFile(canonicalizeJsonV1(claim as CanonicalJsonValueV1));
            await handle.sync();
        } finally {
            await handle.close();
        }
        await link(tempPath, finalPath);
        await unlink(tempPath).catch(error => {
            if (errorCode(error) !== "ENOENT") throw error;
        });
        tempCreated = false;
        await syncDirectory(root);
        return { success: true, claim };
    } catch (error) {
        if (errorCode(error) === "EEXIST") return { success: false, code: "concurrent_journal_write" };
        return { success: false, code: "journal_io_unavailable" };
    } finally {
        if (tempCreated) await unlink(tempPath).catch(() => undefined);
    }
};

export const readD1ProbeCloudflareWorkerCanaryEffectJournalV1 = async (
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1> => {
    if (!DigestV1Schema.safeParse(planDigest).success) return { success: false, code: "invalid_plan_digest" };
    try {
        const journalRoot = await ensureJournalRoot(false);
        if (!journalRoot.success) return journalRoot;
        return await readJournalFromRoot(journalRoot.root, planDigest);
    } catch {
        return { success: false, code: "journal_io_unavailable" };
    }
};

export const readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1 = async (
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1> => {
    if (!DigestV1Schema.safeParse(planDigest).success) return { success: false, code: "invalid_plan_digest" };
    try {
        const journalRoot = await ensureJournalRoot(false);
        if (!journalRoot.success) return journalRoot;
        return await readJournalFromRoot(journalRoot.root, planDigest, false);
    } catch {
        return { success: false, code: "journal_io_unavailable" };
    }
};

export const appendD1ProbeCloudflareWorkerCanaryEffectJournalV1 = async (
    claimInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1> => {
    const claim = await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(claimInput);
    if (claim === null) return { success: false, code: "invalid_untrusted_effect_claim" };
    try {
        const journalRoot = await ensureJournalRoot(true);
        if (!journalRoot.success) return journalRoot;
        const existing = await readJournalFromRoot(journalRoot.root, claim.plan_digest);
        if (!existing.success) {
            if (existing.code !== "journal_not_found") return existing;
            if (
                claim.journal_revision !== 0 ||
                claim.previous_claim_digest !== null ||
                claim.transcript_sequence !== 1 ||
                claim.effect_phase !== "dispatch_intent" ||
                claim.workflow_step !== "prepared_worker_list" ||
                claim.operation_revision !== 0 ||
                claim.operation_state !== "prepared"
            ) {
                return { success: false, code: "journal_revision_mismatch" };
            }
            return await publishRevision(journalRoot.root, claim);
        }
        if (existing.claims.length >= MAX_JOURNAL_REVISIONS_V1) {
            return { success: false, code: "journal_full" };
        }
        const current = existing.claims.at(-1);
        if (current === undefined) return { success: false, code: "journal_corrupt" };
        const denial = transitionCode(current, claim);
        if (denial !== null) return { success: false, code: denial };
        return await publishRevision(journalRoot.root, claim);
    } catch {
        return { success: false, code: "journal_io_unavailable" };
    }
};

export const d1ProbeCloudflareWorkerCanaryEffectJournalPathV1 = (
    planDigest: string,
    revision: number
): string | null =>
    DigestV1Schema.safeParse(planDigest).success && SafeRevisionV1Schema.safeParse(revision).success
        ? revisionPathFor(D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1, planDigest, revision)
        : null;
