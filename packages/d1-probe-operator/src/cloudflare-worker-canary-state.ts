import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import {
    transitionD1ProbeCloudflareWorkerCanaryOperationV1,
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const MAX_STATE_BYTES_V1 = 64 * 1024;
const MAX_REVISIONS_V1 = 32;
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const buildRoot = resolve(repositoryRoot, ".build");

export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1 = resolve(buildRoot, "d1-probe-canary-operations");

export type D1ProbeCloudflareWorkerCanaryStateDenialV1 =
    | "invalid_plan_digest"
    | "invalid_operation"
    | "state_not_found"
    | "state_already_exists"
    | "unsafe_state_path"
    | "unsafe_state_permissions"
    | "concurrent_state_write"
    | "state_io_unavailable"
    | "state_corrupt"
    | "state_revision_mismatch"
    | "state_transition_denied";

export type D1ProbeCloudflareWorkerCanaryStateResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryStateDenialV1 }
    | { readonly success: true; readonly operation: D1ProbeCloudflareWorkerCanaryOperationV1 };

type StateRootResultV1 =
    | {
          readonly success: false;
          readonly code: "unsafe_state_path" | "unsafe_state_permissions" | "state_io_unavailable";
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

const ensureStateRoot = async (): Promise<StateRootResultV1> => {
    try {
        const repositoryStat = await lstat(repositoryRoot);
        if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_state_path" };
        }
        const realRepositoryRoot = await realpath(repositoryRoot);
        let buildStat = await lstatOrNull(buildRoot);
        if (buildStat === null) {
            await mkdir(buildRoot, { mode: 0o700 });
            buildStat = await lstat(buildRoot);
        }
        if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_state_path" };
        }
        let stateRootStat = await lstatOrNull(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1);
        if (stateRootStat === null) {
            await mkdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1, { mode: 0o700 });
            stateRootStat = await lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1);
        }
        if (!stateRootStat.isDirectory() || stateRootStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_state_path" };
        }
        if ((stateRootStat.mode & 0o777) !== 0o700) {
            return { success: false, code: "unsafe_state_permissions" };
        }
        const realStateRoot = await realpath(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1);
        if (
            !isContainedPath(realRepositoryRoot, realStateRoot) ||
            realStateRoot !== resolve(realRepositoryRoot, ".build", "d1-probe-canary-operations")
        ) {
            return { success: false, code: "unsafe_state_path" };
        }
        return { success: true, root: realStateRoot };
    } catch {
        return { success: false, code: "state_io_unavailable" };
    }
};

const revisionPathFor = (root: string, planDigest: string, revision: number): string =>
    resolve(root, `${planDigest}.${revision}.operation.json`);

const finalRevisions = async (root: string, planDigest: string): Promise<number[]> =>
    (await readdir(root))
        .map(name => new RegExp(`^${planDigest}\\.(\\d+)\\.operation\\.json$`, "u").exec(name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(match => Number(match[1]))
        .filter(Number.isSafeInteger)
        .sort((left, right) => left - right);

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
    const prefix = `${planDigest}.${revision}.`;
    const candidates = (await readdir(root)).filter(name => name.startsWith(prefix) && name.endsWith(".operation.tmp"));
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

const readRevision = async (
    root: string,
    planDigest: string,
    revision: number
): Promise<D1ProbeCloudflareWorkerCanaryStateResultV1> => {
    const path = revisionPathFor(root, planDigest, revision);
    try {
        let pathStat = await lstatOrNull(path);
        if (pathStat === null) return { success: false, code: "state_not_found" };
        if (pathStat.nlink === 2 && (await reconcilePublishedRevision(root, planDigest, revision, pathStat))) {
            pathStat = await lstat(path);
        }
        if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
            return { success: false, code: "unsafe_state_path" };
        }
        if ((pathStat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_state_permissions" };
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1) return { success: false, code: "unsafe_state_path" };
            if ((stat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_state_permissions" };
            if (stat.size <= 0 || stat.size > MAX_STATE_BYTES_V1) return { success: false, code: "state_corrupt" };
            const bytes = await handle.readFile();
            let text: string;
            let input: unknown;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                input = JSON.parse(text) as unknown;
            } catch {
                return { success: false, code: "state_corrupt" };
            }
            const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(input);
            if (
                operation === null ||
                operation.plan.plan_digest !== planDigest ||
                operation.revision !== revision ||
                canonicalizeJsonV1(operation as CanonicalJsonValueV1) !== text
            ) {
                return { success: false, code: "state_corrupt" };
            }
            return { success: true, operation };
        } finally {
            await handle.close();
        }
    } catch {
        return { success: false, code: "state_io_unavailable" };
    }
};

const readLatest = async (root: string, planDigest: string): Promise<D1ProbeCloudflareWorkerCanaryStateResultV1> => {
    let latest = await readRevision(root, planDigest, 0);
    if (!latest.success) {
        if (latest.code !== "state_not_found") return latest;
        return (await finalRevisions(root, planDigest)).length === 0
            ? latest
            : { success: false, code: "state_corrupt" };
    }
    for (let revision = 1; revision <= MAX_REVISIONS_V1; revision += 1) {
        const candidate = await readRevision(root, planDigest, revision);
        if (!candidate.success) {
            if (candidate.code !== "state_not_found") return candidate;
            const unexpectedLaterRevision = (await finalRevisions(root, planDigest)).some(value => value > revision);
            return unexpectedLaterRevision ? { success: false, code: "state_corrupt" } : latest;
        }
        const transitioned = await transitionD1ProbeCloudflareWorkerCanaryOperationV1(
            latest.operation,
            candidate.operation
        );
        if (!transitioned.success) return { success: false, code: "state_corrupt" };
        latest = candidate;
    }
    return { success: false, code: "state_corrupt" };
};

const publishRevision = async (
    root: string,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    existingCode: "state_already_exists" | "concurrent_state_write"
): Promise<D1ProbeCloudflareWorkerCanaryStateResultV1> => {
    const planDigest = operation.plan.plan_digest;
    const finalPath = revisionPathFor(root, planDigest, operation.revision);
    const tempPath = resolve(root, `${planDigest}.${operation.revision}.${randomUUID()}.operation.tmp`);
    let tempCreated = false;
    try {
        const handle = await open(tempPath, "wx", 0o600);
        tempCreated = true;
        try {
            await handle.chmod(0o600);
            await handle.writeFile(canonicalizeJsonV1(operation as CanonicalJsonValueV1));
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
        return { success: true, operation };
    } catch (error) {
        if (errorCode(error) === "EEXIST") return { success: false, code: existingCode };
        return { success: false, code: "state_io_unavailable" };
    } finally {
        if (tempCreated) await unlink(tempPath).catch(() => undefined);
    }
};

export const createD1ProbeCloudflareWorkerCanaryStateV1 = async (
    operationInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryStateResultV1> => {
    const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(operationInput);
    if (operation === null || operation.state !== "prepared" || operation.revision !== 0) {
        return { success: false, code: "invalid_operation" };
    }
    try {
        const stateRoot = await ensureStateRoot();
        if (!stateRoot.success) return stateRoot;
        const existingRevisions = await finalRevisions(stateRoot.root, operation.plan.plan_digest);
        if (existingRevisions.length > 0) {
            return { success: false, code: existingRevisions.includes(0) ? "state_already_exists" : "state_corrupt" };
        }
        return await publishRevision(stateRoot.root, operation, "state_already_exists");
    } catch {
        return { success: false, code: "state_io_unavailable" };
    }
};

export const readD1ProbeCloudflareWorkerCanaryStateV1 = async (
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryStateResultV1> => {
    if (!DigestV1.test(planDigest)) return { success: false, code: "invalid_plan_digest" };
    try {
        const stateRoot = await ensureStateRoot();
        if (!stateRoot.success) return stateRoot;
        return await readLatest(stateRoot.root, planDigest);
    } catch {
        return { success: false, code: "state_io_unavailable" };
    }
};

export const transitionD1ProbeCloudflareWorkerCanaryStateV1 = async (
    planDigest: string,
    expectedRevision: number,
    nextOperationInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryStateResultV1> => {
    if (!DigestV1.test(planDigest)) return { success: false, code: "invalid_plan_digest" };
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return { success: false, code: "state_revision_mismatch" };
    }
    try {
        const stateRoot = await ensureStateRoot();
        if (!stateRoot.success) return stateRoot;
        const current = await readLatest(stateRoot.root, planDigest);
        if (!current.success) return current;
        if (current.operation.revision !== expectedRevision) {
            return { success: false, code: "state_revision_mismatch" };
        }
        const transitioned = await transitionD1ProbeCloudflareWorkerCanaryOperationV1(
            current.operation,
            nextOperationInput
        );
        if (!transitioned.success) return { success: false, code: "state_transition_denied" };
        return await publishRevision(stateRoot.root, transitioned.operation, "concurrent_state_write");
    } catch {
        return { success: false, code: "state_io_unavailable" };
    }
};

export const d1ProbeCloudflareWorkerCanaryStatePathV1 = (planDigest: string): string | null =>
    DigestV1.test(planDigest) ? revisionPathFor(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1, planDigest, 0) : null;

export const d1ProbeCloudflareWorkerCanaryStateDirectoryV1 = dirname(
    revisionPathFor(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1, "0".repeat(64), 0)
);
