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
    D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema,
    validateD1ProbeCloudflareWorkerCanaryCleanupGraceV1,
} from "./cloudflare-worker-canary-cleanup-grace.js";
import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    D1ProbeCloudflareWorkerCanaryOperationV1Schema,
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const SafeTimeV1Schema = z.number().int().safe().nonnegative();
const CleanupObligationIdentityV1Schema = z
    .object({
        plan_digest: DigestV1Schema,
        execution_nonce_commitment: DigestV1Schema,
    })
    .strict();
const MAX_OBLIGATION_BYTES_V1 = 128 * 1024;
const OBLIGATION_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-cleanup-obligation.v1";
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const buildRoot = resolve(repositoryRoot, ".build");

export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1 = resolve(
    buildRoot,
    "d1-probe-canary-cleanup-obligations"
);
export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_AUTHORITY_V1 = false as const;

const CleanupObligationUnsignedV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_cleanup_obligation"),
        plan_digest: DigestV1Schema,
        execution_nonce_commitment: DigestV1Schema,
        operation_revision: z.literal(0),
        operation_state: z.literal("prepared"),
        operation_record_digest: DigestV1Schema,
        operation: D1ProbeCloudflareWorkerCanaryOperationV1Schema,
        cleanup_grace: D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema,
        prepared_operation_at_ms: SafeTimeV1Schema,
        caller_constructible_local_record: z.literal(true),
        credentialed_runner_uses_record: z.literal(false),
        cleanup_execution_authorized: z.literal(false),
        caller_mutation_authority: z.literal(false),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict();

export const D1ProbeCloudflareWorkerCanaryCleanupObligationV1Schema = CleanupObligationUnsignedV1Schema.extend({
    obligation_digest: DigestV1Schema,
}).strict();

export type D1ProbeCloudflareWorkerCanaryCleanupObligationV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryCleanupObligationV1Schema
>;

export type D1ProbeCloudflareWorkerCanaryCleanupObligationDenialV1 =
    | "invalid_operation"
    | "invalid_cleanup_grace"
    | "invalid_obligation_time"
    | "obligation_digest_unavailable"
    | "invalid_obligation_identity"
    | "obligation_not_found"
    | "obligation_already_exists"
    | "obligation_unreconciled"
    | "obligation_corrupt"
    | "unsafe_obligation_path"
    | "unsafe_obligation_permissions"
    | "obligation_io_unavailable";

export type D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryCleanupObligationDenialV1 }
    | { readonly success: true; readonly obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1 };

export const matchesD1ProbeCloudflareWorkerCanaryCleanupObligationContextV1 = (
    obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    operation: z.infer<typeof D1ProbeCloudflareWorkerCanaryOperationV1Schema>,
    executionNonceCommitment: string
): boolean =>
    obligation.plan_digest === operation.plan.plan_digest &&
    obligation.execution_nonce_commitment === executionNonceCommitment &&
    obligation.operation.revision === 0 &&
    obligation.operation.state === "prepared" &&
    obligation.operation.plan.plan_digest === operation.plan.plan_digest &&
    obligation.operation.script_name === operation.script_name &&
    obligation.operation.ownership_tag === operation.ownership_tag &&
    obligation.operation.attempt_tag === operation.attempt_tag &&
    obligation.operation.execution_nonce === operation.execution_nonce &&
    obligation.cleanup_grace.plan_digest === operation.plan.plan_digest &&
    obligation.cleanup_grace.worker_id === null &&
    obligation.cleanup_grace.worker_id_commitment === null &&
    obligation.cleanup_execution_authorized === false &&
    obligation.caller_mutation_authority === false &&
    obligation.authoritative === false &&
    obligation.eligible_for_upload === false &&
    obligation.eligible_for_attestation === false &&
    obligation.lifecycle_advance_allowed === false &&
    obligation.gate_promotion_allowed === false;

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

type RootResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryCleanupObligationDenialV1 }
    | { readonly success: true; readonly root: string };

const ensureRoot = async (createIfMissing: boolean): Promise<RootResultV1> => {
    try {
        const repositoryStat = await lstat(repositoryRoot);
        if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_obligation_path" };
        }
        const realRepositoryRoot = await realpath(repositoryRoot);
        let buildStat = await lstatOrNull(buildRoot);
        if (buildStat === null) {
            if (!createIfMissing) return { success: false, code: "obligation_not_found" };
            await mkdir(buildRoot, { mode: 0o700 });
            buildStat = await lstat(buildRoot);
        }
        if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_obligation_path" };
        }
        let rootStat = await lstatOrNull(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1);
        if (rootStat === null) {
            if (!createIfMissing) return { success: false, code: "obligation_not_found" };
            await mkdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1, { mode: 0o700 });
            rootStat = await lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1);
        }
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_obligation_path" };
        }
        if ((rootStat.mode & 0o777) !== 0o700) {
            return { success: false, code: "unsafe_obligation_permissions" };
        }
        const realRoot = await realpath(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1);
        if (
            !isContainedPath(realRepositoryRoot, realRoot) ||
            realRoot !== resolve(realRepositoryRoot, ".build", "d1-probe-canary-cleanup-obligations")
        ) {
            return { success: false, code: "unsafe_obligation_path" };
        }
        return { success: true, root: realRoot };
    } catch {
        return { success: false, code: "obligation_io_unavailable" };
    }
};

const fileStem = (planDigest: string, executionNonceCommitment: string): string =>
    `${planDigest}.${executionNonceCommitment}`;

const obligationPath = (root: string, planDigest: string, executionNonceCommitment: string): string =>
    resolve(root, `${fileStem(planDigest, executionNonceCommitment)}.cleanup-obligation.json`);

const tempNamePattern = (stem: string): RegExp =>
    new RegExp(
        `^${stem}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.cleanup-obligation\.tmp$`,
        "u"
    );

const syncDirectory = async (path: string): Promise<void> => {
    const directory = await open(path, constants.O_RDONLY);
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
};

const validateObligation = async (input: unknown): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationV1 | null> => {
    try {
        const parsed = D1ProbeCloudflareWorkerCanaryCleanupObligationV1Schema.safeParse(input);
        if (!parsed.success) return null;
        const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(parsed.data.operation);
        if (
            operation === null ||
            operation.revision !== 0 ||
            operation.state !== "prepared" ||
            parsed.data.plan_digest !== operation.plan.plan_digest ||
            parsed.data.operation_revision !== operation.revision ||
            parsed.data.operation_state !== operation.state ||
            parsed.data.cleanup_grace.worker_id !== null ||
            parsed.data.cleanup_grace.worker_id_commitment !== null
        ) {
            return null;
        }
        const [operationDigest, nonceCommitment, cleanupGrace] = await Promise.all([
            digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
            commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
            validateD1ProbeCloudflareWorkerCanaryCleanupGraceV1(parsed.data.cleanup_grace, operation.plan),
        ]);
        if (
            operationDigest === null ||
            nonceCommitment === null ||
            cleanupGrace === null ||
            parsed.data.operation_record_digest !== operationDigest ||
            parsed.data.execution_nonce_commitment !== nonceCommitment ||
            parsed.data.prepared_operation_at_ms !== operation.updated_at_ms
        ) {
            return null;
        }
        const { obligation_digest: claimedDigest, ...unsigned } = parsed.data;
        const digest = await digestCanonicalJsonV1(OBLIGATION_DIGEST_DOMAIN_V1, unsigned as CanonicalJsonValueV1);
        return digest === claimedDigest ? parsed.data : null;
    } catch {
        return null;
    }
};

export const compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1 = async (
    operationInput: unknown,
    cleanupGraceInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1> => {
    const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(operationInput);
    if (operation === null || operation.revision !== 0 || operation.state !== "prepared") {
        return { success: false, code: "invalid_operation" };
    }
    const cleanupGrace = await validateD1ProbeCloudflareWorkerCanaryCleanupGraceV1(cleanupGraceInput, operation.plan);
    if (cleanupGrace === null || cleanupGrace.worker_id !== null || cleanupGrace.worker_id_commitment !== null) {
        return { success: false, code: "invalid_cleanup_grace" };
    }
    const [operationDigest, nonceCommitment] = await Promise.all([
        digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
        commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
    ]);
    if (operationDigest === null || nonceCommitment === null) {
        return { success: false, code: "obligation_digest_unavailable" };
    }
    const unsigned = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_cleanup_obligation" as const,
        plan_digest: operation.plan.plan_digest,
        execution_nonce_commitment: nonceCommitment,
        operation_revision: 0 as const,
        operation_state: "prepared" as const,
        operation_record_digest: operationDigest,
        operation,
        cleanup_grace: cleanupGrace,
        prepared_operation_at_ms: operation.updated_at_ms,
        caller_constructible_local_record: true as const,
        credentialed_runner_uses_record: false as const,
        cleanup_execution_authorized: false as const,
        caller_mutation_authority: false as const,
        authoritative: false as const,
        eligible_for_upload: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const obligationDigest = await digestCanonicalJsonV1(OBLIGATION_DIGEST_DOMAIN_V1, unsigned as CanonicalJsonValueV1);
    if (obligationDigest === null) return { success: false, code: "obligation_digest_unavailable" };
    const obligation = await validateObligation({ ...unsigned, obligation_digest: obligationDigest });
    return obligation === null
        ? { success: false, code: "obligation_digest_unavailable" }
        : { success: true, obligation };
};

const readObligation = async (
    root: string,
    planDigest: string,
    executionNonceCommitment: string,
    reconcilePublication: boolean,
    afterInitialSnapshot?: () => void | Promise<void>
): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1> => {
    const stem = fileStem(planDigest, executionNonceCommitment);
    const finalPath = obligationPath(root, planDigest, executionNonceCommitment);
    try {
        const names = await readdir(root);
        const expectedName = `${stem}.cleanup-obligation.json`;
        const related = names.filter(name => name.startsWith(`${stem}.`));
        await afterInitialSnapshot?.();
        const allowedTempName = tempNamePattern(stem);
        if (related.some(name => name !== expectedName && !allowedTempName.test(name))) {
            return { success: false, code: "obligation_unreconciled" };
        }
        let pathStat = await lstatOrNull(finalPath);
        if (pathStat === null) {
            return related.length === 0
                ? { success: false, code: "obligation_not_found" }
                : { success: false, code: "obligation_unreconciled" };
        }
        if (pathStat.nlink === 2 && reconcilePublication) {
            const temps = related.filter(name => allowedTempName.test(name));
            if (temps.length === 1) {
                const tempPath = resolve(root, temps[0]!);
                const tempStat = await lstatOrNull(tempPath);
                if (
                    tempStat !== null &&
                    tempStat.isFile() &&
                    !tempStat.isSymbolicLink() &&
                    tempStat.dev === pathStat.dev &&
                    tempStat.ino === pathStat.ino &&
                    tempStat.nlink === 2 &&
                    (tempStat.mode & 0o777) === 0o600
                ) {
                    await unlink(tempPath);
                    await syncDirectory(root);
                    pathStat = await lstat(finalPath);
                }
            }
        }
        if (
            pathStat.isSymbolicLink() ||
            !pathStat.isFile() ||
            pathStat.nlink !== 1 ||
            related.some(name => name !== expectedName)
        ) {
            return { success: false, code: "obligation_unreconciled" };
        }
        if ((pathStat.mode & 0o777) !== 0o600) {
            return { success: false, code: "unsafe_obligation_permissions" };
        }
        const handle = await open(finalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const before = await handle.stat();
            if (
                !before.isFile() ||
                before.nlink !== 1 ||
                before.dev !== pathStat.dev ||
                before.ino !== pathStat.ino ||
                (before.mode & 0o777) !== 0o600 ||
                before.size <= 0 ||
                before.size > MAX_OBLIGATION_BYTES_V1
            ) {
                return { success: false, code: "obligation_corrupt" };
            }
            const bytes = await handle.readFile();
            const after = await handle.stat();
            if (
                before.dev !== after.dev ||
                before.ino !== after.ino ||
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs ||
                before.ctimeMs !== after.ctimeMs
            ) {
                return { success: false, code: "obligation_corrupt" };
            }
            const finalStat = await lstat(finalPath);
            if (
                finalStat.dev !== after.dev ||
                finalStat.ino !== after.ino ||
                finalStat.nlink !== 1 ||
                finalStat.size !== after.size ||
                finalStat.mtimeMs !== after.mtimeMs ||
                finalStat.ctimeMs !== after.ctimeMs
            ) {
                return { success: false, code: "obligation_corrupt" };
            }
            let text: string;
            let input: unknown;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                input = JSON.parse(text) as unknown;
            } catch {
                return { success: false, code: "obligation_corrupt" };
            }
            const obligation = await validateObligation(input);
            if (
                obligation === null ||
                obligation.plan_digest !== planDigest ||
                obligation.execution_nonce_commitment !== executionNonceCommitment ||
                canonicalizeJsonV1(obligation as CanonicalJsonValueV1) !== text
            ) {
                return { success: false, code: "obligation_corrupt" };
            }
            const finalNames = (await readdir(root)).filter(name => name.startsWith(`${stem}.`));
            const initialSnapshot = [...related].sort();
            const finalSnapshot = [...finalNames].sort();
            if (
                initialSnapshot.length !== finalSnapshot.length ||
                initialSnapshot.some((name, index) => name !== finalSnapshot[index])
            ) {
                return { success: false, code: "obligation_unreconciled" };
            }
            return { success: true, obligation };
        } finally {
            await handle.close();
        }
    } catch {
        return { success: false, code: "obligation_io_unavailable" };
    }
};

const completeExactOrphanPublication = async (
    root: string,
    obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1
): Promise<boolean> => {
    const stem = fileStem(obligation.plan_digest, obligation.execution_nonce_commitment);
    const finalPath = obligationPath(root, obligation.plan_digest, obligation.execution_nonce_commitment);
    const names = await readdir(root);
    const related = names.filter(name => name.startsWith(`${stem}.`));
    const temps = related.filter(name => tempNamePattern(stem).test(name));
    if (related.length !== 1 || temps.length !== 1 || (await lstatOrNull(finalPath)) !== null) return false;
    const tempPath = resolve(root, temps[0]!);
    const pathStat = await lstatOrNull(tempPath);
    if (
        pathStat === null ||
        !pathStat.isFile() ||
        pathStat.isSymbolicLink() ||
        pathStat.nlink !== 1 ||
        (pathStat.mode & 0o777) !== 0o600 ||
        pathStat.size <= 0 ||
        pathStat.size > MAX_OBLIGATION_BYTES_V1
    ) {
        return false;
    }
    const handle = await open(tempPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat();
        if (
            before.dev !== pathStat.dev ||
            before.ino !== pathStat.ino ||
            before.nlink !== 1 ||
            (before.mode & 0o777) !== 0o600
        ) {
            return false;
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
        ) {
            return false;
        }
        let text: string;
        let parsed: unknown;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            parsed = JSON.parse(text) as unknown;
        } catch {
            return false;
        }
        const recovered = await validateObligation(parsed);
        if (
            recovered === null ||
            canonicalizeJsonV1(recovered as CanonicalJsonValueV1) !== text ||
            text !== canonicalizeJsonV1(obligation as CanonicalJsonValueV1)
        ) {
            return false;
        }
    } finally {
        await handle.close();
    }
    if ((await lstatOrNull(finalPath)) !== null) return false;
    const stableTemp = await lstatOrNull(tempPath);
    if (
        stableTemp === null ||
        stableTemp.dev !== pathStat.dev ||
        stableTemp.ino !== pathStat.ino ||
        stableTemp.nlink !== 1 ||
        (stableTemp.mode & 0o777) !== 0o600
    ) {
        return false;
    }
    await link(tempPath, finalPath);
    const published = await lstat(finalPath);
    if (published.dev !== stableTemp.dev || published.ino !== stableTemp.ino || published.nlink !== 2) {
        return false;
    }
    await unlink(tempPath);
    await syncDirectory(root);
    return true;
};

export const publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1 = async (
    obligationInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1> => {
    const obligation = await validateObligation(obligationInput);
    if (obligation === null) return { success: false, code: "invalid_obligation_identity" };
    const root = await ensureRoot(true);
    if (!root.success) return root;
    const existing = await readObligation(
        root.root,
        obligation.plan_digest,
        obligation.execution_nonce_commitment,
        true
    );
    if (!existing.success && existing.code === "obligation_unreconciled") {
        try {
            if (await completeExactOrphanPublication(root.root, obligation)) {
                return await readObligation(
                    root.root,
                    obligation.plan_digest,
                    obligation.execution_nonce_commitment,
                    true
                );
            }
        } catch (error) {
            if (errorCode(error) === "EEXIST") {
                const concurrent = await readObligation(
                    root.root,
                    obligation.plan_digest,
                    obligation.execution_nonce_commitment,
                    true
                );
                return concurrent.success ? { success: false, code: "obligation_already_exists" } : concurrent;
            }
            return { success: false, code: "obligation_io_unavailable" };
        }
    }
    if (existing.success || existing.code !== "obligation_not_found") {
        return existing.success ? { success: false, code: "obligation_already_exists" } : existing;
    }
    const finalPath = obligationPath(root.root, obligation.plan_digest, obligation.execution_nonce_commitment);
    const tempPath = resolve(
        root.root,
        `${fileStem(obligation.plan_digest, obligation.execution_nonce_commitment)}.${randomUUID()}.cleanup-obligation.tmp`
    );
    let tempCreated = false;
    try {
        const handle = await open(tempPath, "wx", 0o600);
        tempCreated = true;
        try {
            await handle.chmod(0o600);
            await handle.writeFile(canonicalizeJsonV1(obligation as CanonicalJsonValueV1));
            await handle.sync();
        } finally {
            await handle.close();
        }
        await link(tempPath, finalPath);
        await unlink(tempPath);
        tempCreated = false;
        await syncDirectory(root.root);
        return { success: true, obligation };
    } catch (error) {
        if (errorCode(error) === "EEXIST") return { success: false, code: "obligation_already_exists" };
        return { success: false, code: "obligation_io_unavailable" };
    } finally {
        if (tempCreated) await unlink(tempPath).catch(() => undefined);
    }
};

export const readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1 = async (
    planDigestInput: unknown,
    executionNonceCommitmentInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1> => {
    try {
        const parsed = CleanupObligationIdentityV1Schema.safeParse({
            plan_digest: planDigestInput,
            execution_nonce_commitment: executionNonceCommitmentInput,
        });
        if (!parsed.success) return { success: false, code: "invalid_obligation_identity" };
        const root = await ensureRoot(false);
        if (!root.success) return root;
        return await readObligation(root.root, parsed.data.plan_digest, parsed.data.execution_nonce_commitment, false);
    } catch {
        return { success: false, code: "obligation_io_unavailable" };
    }
};

/** Test-only race seam. Production callers use the fixed read-only function. */
export const readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyTestOnlyV1 = async (
    planDigestInput: unknown,
    executionNonceCommitmentInput: unknown,
    afterInitialSnapshot: () => void | Promise<void>
): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1> => {
    try {
        const parsed = CleanupObligationIdentityV1Schema.safeParse({
            plan_digest: planDigestInput,
            execution_nonce_commitment: executionNonceCommitmentInput,
        });
        if (!parsed.success) return { success: false, code: "invalid_obligation_identity" };
        const root = await ensureRoot(false);
        if (!root.success) return root;
        return await readObligation(
            root.root,
            parsed.data.plan_digest,
            parsed.data.execution_nonce_commitment,
            false,
            afterInitialSnapshot
        );
    } catch {
        return { success: false, code: "obligation_io_unavailable" };
    }
};
