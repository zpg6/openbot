import { constants } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { z } from "zod";

const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const ExecutionNonceV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const OwnerNonceV1Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const SafeTimeV1Schema = z.number().int().safe().nonnegative();
const OwnerPidV1Schema = z.number().int().positive().max(2_147_483_647);
const LeaseDurationV1Schema = z.number().int().positive().max(300_000);
const MAX_LEASE_BYTES_V1 = 16 * 1024;
const MAX_GENERATIONS_V1 = 1_024;
const EXECUTION_NONCE_COMMITMENT_DOMAIN_V1 =
    "openbot.d1-probe.cloudflare-worker-api-canary-execution-nonce-commitment.v1";
const OWNER_NONCE_COMMITMENT_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-canary.driver-owner-nonce.v1";
const LEASE_RECORD_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-canary.driver-lease-record.v1";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const buildRoot = resolve(repositoryRoot, ".build");

export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1 = resolve(
    buildRoot,
    "d1-probe-canary-driver-leases"
);

const LeaseRecordV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_driver_lease"),
        transition: z.enum(["acquired", "renewed", "taken_over", "released"]),
        state: z.enum(["active", "released"]),
        plan_digest: DigestV1Schema,
        execution_nonce_commitment: DigestV1Schema,
        generation: z
            .number()
            .int()
            .nonnegative()
            .max(MAX_GENERATIONS_V1 - 1),
        previous_record_digest: DigestV1Schema.nullable(),
        owner_pid: OwnerPidV1Schema,
        owner_nonce_commitment: DigestV1Schema,
        prior_owner_liveness: z.enum(["not_checked", "esrch"]),
        issued_at_ms: SafeTimeV1Schema,
        heartbeat_at_ms: SafeTimeV1Schema,
        expires_at_ms: SafeTimeV1Schema,
        caller_mutation_authority: z.literal(false),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
        mutation_authority: z.literal(false),
    })
    .strict();

export type D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = z.infer<typeof LeaseRecordV1Schema>;

const AcquireLeaseV1Schema = z
    .object({
        plan_digest: DigestV1Schema,
        execution_nonce: ExecutionNonceV1Schema,
        lease_duration_ms: LeaseDurationV1Schema,
    })
    .strict();

const TakeoverExpectedLeaseV1Schema = AcquireLeaseV1Schema.extend({
    expected_generation: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_GENERATIONS_V1 - 1),
    expected_record_digest: DigestV1Schema,
}).strict();

const OwnedLeaseV1Schema = z
    .object({
        plan_digest: DigestV1Schema,
        execution_nonce: ExecutionNonceV1Schema,
        generation: z
            .number()
            .int()
            .nonnegative()
            .max(MAX_GENERATIONS_V1 - 1),
        owner_pid: OwnerPidV1Schema,
        owner_nonce: OwnerNonceV1Schema,
    })
    .strict();

const RenewLeaseV1Schema = OwnedLeaseV1Schema.extend({
    lease_duration_ms: LeaseDurationV1Schema,
}).strict();

export type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 = z.infer<typeof OwnedLeaseV1Schema>;

export type D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 =
    | "invalid_lease_request"
    | "lease_not_found"
    | "lease_binding_mismatch"
    | "lease_already_held"
    | "lease_expired"
    | "lease_released"
    | "lease_owner_mismatch"
    | "lease_generation_mismatch"
    | "lease_clock_invalid"
    | "lease_randomness_unavailable"
    | "lease_pid_live"
    | "lease_pid_permission_denied"
    | "lease_pid_liveness_unknown"
    | "lease_generation_exhausted"
    | "unsafe_lease_path"
    | "unsafe_lease_permissions"
    | "lease_corrupt"
    | "concurrent_lease_write"
    | "lease_io_unavailable";

export type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 }
    | { readonly success: true; readonly lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 };

export type D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 }
    | { readonly success: true; readonly leases: readonly D1ProbeCloudflareWorkerCanaryDriverLeaseV1[] };

export type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 }
    | {
          readonly success: true;
          readonly lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1;
          readonly owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1;
      };

export type D1ProbeCloudflareWorkerCanaryPidLivenessV1 = "live" | "esrch" | "eperm" | "unknown";

export type D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1 = {
    readonly ownerPid: number;
    readonly now: () => number;
    readonly randomBytes: (byteLength: number) => Uint8Array;
    readonly checkPidLiveness: (pid: number) => Promise<D1ProbeCloudflareWorkerCanaryPidLivenessV1>;
};

const errorCode = (error: unknown): string | null =>
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : null;

const defaultCheckPidLiveness = async (pid: number): Promise<D1ProbeCloudflareWorkerCanaryPidLivenessV1> => {
    try {
        process.kill(pid, 0);
        return "live";
    } catch (error) {
        if (errorCode(error) === "ESRCH") return "esrch";
        if (errorCode(error) === "EPERM") return "eperm";
        return "unknown";
    }
};

const defaultDependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1 = {
    ownerPid: process.pid,
    now: Date.now,
    randomBytes: byteLength => randomBytes(byteLength),
    checkPidLiveness: defaultCheckPidLiveness,
};

type LeaseRootResultV1 =
    | {
          readonly success: false;
          readonly code: "lease_not_found" | "unsafe_lease_path" | "unsafe_lease_permissions" | "lease_io_unavailable";
      }
    | { readonly success: true; readonly root: string };

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

const ensureLeaseRoot = async (createIfMissing = true): Promise<LeaseRootResultV1> => {
    try {
        const repositoryStat = await lstat(repositoryRoot);
        if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_lease_path" };
        }
        const realRepositoryRoot = await realpath(repositoryRoot);
        let buildStat = await lstatOrNull(buildRoot);
        if (buildStat === null) {
            if (!createIfMissing) return { success: false, code: "lease_not_found" };
            await mkdir(buildRoot, { mode: 0o700 });
            buildStat = await lstat(buildRoot);
        }
        if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_lease_path" };
        }
        let leaseRootStat = await lstatOrNull(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1);
        if (leaseRootStat === null) {
            if (!createIfMissing) return { success: false, code: "lease_not_found" };
            await mkdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1, { mode: 0o700 });
            leaseRootStat = await lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1);
        }
        if (!leaseRootStat.isDirectory() || leaseRootStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_lease_path" };
        }
        if ((leaseRootStat.mode & 0o777) !== 0o700) {
            return { success: false, code: "unsafe_lease_permissions" };
        }
        const realLeaseRoot = await realpath(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1);
        if (
            !isContainedPath(realRepositoryRoot, realLeaseRoot) ||
            realLeaseRoot !== resolve(realRepositoryRoot, ".build", "d1-probe-canary-driver-leases")
        ) {
            return { success: false, code: "unsafe_lease_path" };
        }
        return { success: true, root: realLeaseRoot };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const generationPathFor = (root: string, planDigest: string, generation: number): string =>
    resolve(root, `${planDigest}.${generation}.driver-lease.json`);

const syncDirectory = async (path: string): Promise<void> => {
    const directory = await open(path, constants.O_RDONLY);
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
};

const reconcilePublishedGeneration = async (
    root: string,
    planDigest: string,
    generation: number,
    finalStat: Awaited<ReturnType<typeof lstat>>
): Promise<boolean> => {
    if (finalStat.nlink !== 2) return finalStat.nlink === 1;
    const pattern = new RegExp(
        `^${planDigest}\\.${generation}\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.driver-lease\\.tmp$`,
        "u"
    );
    const candidates = (await readdir(root)).filter(name => pattern.test(name));
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
            const reconciled = await lstat(generationPathFor(root, planDigest, generation));
            return reconciled.isFile() && !reconciled.isSymbolicLink() && reconciled.nlink === 1;
        }
    }
    return false;
};

const readGeneration = async (
    root: string,
    planDigest: string,
    generation: number,
    reconcilePublishedLink = true
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const path = generationPathFor(root, planDigest, generation);
    try {
        let pathStat = await lstatOrNull(path);
        if (pathStat === null) return { success: false, code: "lease_not_found" };
        if (
            reconcilePublishedLink &&
            pathStat.nlink === 2 &&
            (await reconcilePublishedGeneration(root, planDigest, generation, pathStat))
        ) {
            pathStat = await lstat(path);
        }
        if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
            return { success: false, code: "unsafe_lease_path" };
        }
        if ((pathStat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_lease_permissions" };
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
                return { success: false, code: "unsafe_lease_path" };
            }
            if ((stat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_lease_permissions" };
            if (stat.size <= 0 || stat.size > MAX_LEASE_BYTES_V1) {
                return { success: false, code: "lease_corrupt" };
            }
            const bytes = await handle.readFile();
            let text: string;
            let input: unknown;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                input = JSON.parse(text) as unknown;
            } catch {
                return { success: false, code: "lease_corrupt" };
            }
            let parsed: ReturnType<typeof LeaseRecordV1Schema.safeParse>;
            try {
                parsed = LeaseRecordV1Schema.safeParse(input);
            } catch {
                return { success: false, code: "lease_corrupt" };
            }
            if (
                !parsed.success ||
                parsed.data.plan_digest !== planDigest ||
                parsed.data.generation !== generation ||
                canonicalizeJsonV1(parsed.data as CanonicalJsonValueV1) !== text
            ) {
                return { success: false, code: "lease_corrupt" };
            }
            return { success: true, lease: parsed.data };
        } finally {
            await handle.close();
        }
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const requiredDigest = async (domain: string, value: CanonicalJsonValueV1): Promise<string> => {
    const digest = await digestCanonicalJsonV1(domain, value);
    if (digest === null) throw new Error("lease digest unavailable");
    return digest;
};

const recordDigest = async (lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1): Promise<string> =>
    await requiredDigest(LEASE_RECORD_DIGEST_DOMAIN_V1, lease as CanonicalJsonValueV1);

export const digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1 = async (
    leaseInput: unknown
): Promise<string | null> => {
    try {
        const lease = safeParse(LeaseRecordV1Schema, leaseInput);
        return lease === null ? null : await recordDigest(lease);
    } catch {
        return null;
    }
};

const validInitialRecord = (lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1): boolean =>
    lease.generation === 0 &&
    lease.transition === "acquired" &&
    lease.state === "active" &&
    lease.previous_record_digest === null &&
    lease.prior_owner_liveness === "not_checked" &&
    lease.issued_at_ms === lease.heartbeat_at_ms &&
    lease.expires_at_ms > lease.heartbeat_at_ms;

const validTransition = async (
    previous: D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    next: D1ProbeCloudflareWorkerCanaryDriverLeaseV1
): Promise<boolean> => {
    if (
        previous.state !== "active" ||
        next.plan_digest !== previous.plan_digest ||
        next.execution_nonce_commitment !== previous.execution_nonce_commitment ||
        next.generation !== previous.generation + 1 ||
        next.previous_record_digest !== (await recordDigest(previous))
    ) {
        return false;
    }
    if (next.transition === "renewed") {
        return (
            next.state === "active" &&
            next.prior_owner_liveness === "not_checked" &&
            next.owner_pid === previous.owner_pid &&
            next.owner_nonce_commitment === previous.owner_nonce_commitment &&
            next.issued_at_ms === previous.issued_at_ms &&
            next.heartbeat_at_ms >= previous.heartbeat_at_ms &&
            next.expires_at_ms > previous.expires_at_ms &&
            next.expires_at_ms > next.heartbeat_at_ms
        );
    }
    if (next.transition === "released") {
        return (
            next.state === "released" &&
            next.prior_owner_liveness === "not_checked" &&
            next.owner_pid === previous.owner_pid &&
            next.owner_nonce_commitment === previous.owner_nonce_commitment &&
            next.issued_at_ms === previous.issued_at_ms &&
            next.heartbeat_at_ms >= previous.heartbeat_at_ms &&
            next.expires_at_ms === next.heartbeat_at_ms
        );
    }
    if (next.transition === "taken_over") {
        return (
            next.state === "active" &&
            next.prior_owner_liveness === "esrch" &&
            next.owner_pid !== previous.owner_pid &&
            next.owner_nonce_commitment !== previous.owner_nonce_commitment &&
            next.issued_at_ms === next.heartbeat_at_ms &&
            next.issued_at_ms >= previous.expires_at_ms &&
            next.expires_at_ms > next.heartbeat_at_ms
        );
    }
    return false;
};

type OrphanTempResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 }
    | { readonly success: true; readonly cleaned: boolean };

const reconcileOrphanTemp = async (
    root: string,
    planDigest: string,
    previous: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 | null
): Promise<OrphanTempResultV1> => {
    try {
        const prefix = `${planDigest}.`;
        const finalPattern = new RegExp(`^${planDigest}\\.\\d+\\.driver-lease\\.json$`, "u");
        const tempPattern = new RegExp(
            `^${planDigest}\\.(\\d+)\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.driver-lease\\.tmp$`,
            "u"
        );
        const pendingEntries = (await readdir(root)).filter(
            name => name.startsWith(prefix) && !finalPattern.test(name)
        );
        if (pendingEntries.length === 0) return { success: true, cleaned: false };
        if (pendingEntries.length !== 1) return { success: false, code: "lease_corrupt" };
        const name = pendingEntries[0];
        if (name === undefined) return { success: false, code: "lease_corrupt" };
        const match = tempPattern.exec(name);
        if (match === null) return { success: false, code: "lease_corrupt" };
        const generation = Number(match[1]);
        const expectedGeneration = previous === null ? 0 : previous.generation + 1;
        if (!Number.isSafeInteger(generation) || generation !== expectedGeneration) {
            return { success: false, code: "lease_corrupt" };
        }
        const finalPath = generationPathFor(root, planDigest, generation);
        if ((await lstatOrNull(finalPath)) !== null) return { success: false, code: "lease_corrupt" };

        const tempPath = resolve(root, name);
        const pathStat = await lstatOrNull(tempPath);
        if (pathStat === null) return { success: false, code: "concurrent_lease_write" };
        if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
            return { success: false, code: "unsafe_lease_path" };
        }
        if ((pathStat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_lease_permissions" };
        const handle = await open(tempPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1;
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
                return { success: false, code: "unsafe_lease_path" };
            }
            if ((stat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_lease_permissions" };
            if (stat.size <= 0 || stat.size > MAX_LEASE_BYTES_V1) {
                return { success: false, code: "lease_corrupt" };
            }
            const bytes = await handle.readFile();
            let text: string;
            let input: unknown;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                input = JSON.parse(text) as unknown;
            } catch {
                return { success: false, code: "lease_corrupt" };
            }
            const parsed = safeParse(LeaseRecordV1Schema, input);
            if (
                parsed === null ||
                parsed.plan_digest !== planDigest ||
                parsed.generation !== generation ||
                canonicalizeJsonV1(parsed as CanonicalJsonValueV1) !== text
            ) {
                return { success: false, code: "lease_corrupt" };
            }
            lease = parsed;
        } finally {
            await handle.close();
        }
        if (previous === null ? !validInitialRecord(lease) : !(await validTransition(previous, lease))) {
            return { success: false, code: "lease_corrupt" };
        }

        const finalStat = await lstatOrNull(finalPath);
        const currentTempStat = await lstatOrNull(tempPath);
        if (currentTempStat === null) return { success: false, code: "concurrent_lease_write" };
        if (finalStat !== null) {
            if (
                finalStat.isFile() &&
                !finalStat.isSymbolicLink() &&
                finalStat.dev === currentTempStat.dev &&
                finalStat.ino === currentTempStat.ino &&
                finalStat.nlink === 2 &&
                currentTempStat.nlink === 2 &&
                (currentTempStat.mode & 0o777) === 0o600 &&
                (await reconcilePublishedGeneration(root, planDigest, generation, finalStat))
            ) {
                return { success: true, cleaned: true };
            }
            return { success: false, code: "concurrent_lease_write" };
        }
        if (
            !currentTempStat.isFile() ||
            currentTempStat.isSymbolicLink() ||
            currentTempStat.nlink !== 1 ||
            currentTempStat.dev !== pathStat.dev ||
            currentTempStat.ino !== pathStat.ino ||
            (currentTempStat.mode & 0o777) !== 0o600
        ) {
            return { success: false, code: "unsafe_lease_path" };
        }
        await unlink(tempPath);
        await syncDirectory(root);
        return { success: true, cleaned: true };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const readLatest = async (
    root: string,
    planDigest: string,
    orphanCleanupAllowed = true
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    try {
        const prefix = `${planDigest}.`;
        const entries = (await readdir(root)).filter(name => name.startsWith(prefix)).sort();
        const finalPattern = new RegExp(`^${planDigest}\\.(\\d+)\\.driver-lease\\.json$`, "u");
        const initialHadPublicationResidue = entries.some(name => !finalPattern.test(name));
        const generations = entries
            .map(name => finalPattern.exec(name))
            .filter((match): match is RegExpExecArray => match !== null)
            .map(match => Number(match[1]))
            .filter(Number.isSafeInteger)
            .sort((left, right) => left - right);
        if (generations.length === 0) {
            if (entries.length === 0) return { success: false, code: "lease_not_found" };
            if (!orphanCleanupAllowed) return { success: false, code: "lease_corrupt" };
            const reconciled = await reconcileOrphanTemp(root, planDigest, null);
            if (!reconciled.success) return reconciled;
            return reconciled.cleaned
                ? await readLatest(root, planDigest, false)
                : { success: false, code: "lease_corrupt" };
        }
        if (generations.length > MAX_GENERATIONS_V1 || generations.some((generation, index) => generation !== index)) {
            return { success: false, code: "lease_corrupt" };
        }
        let latest: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 | null = null;
        for (const generation of generations) {
            const read = await readGeneration(root, planDigest, generation);
            if (!read.success) return read;
            if (latest === null) {
                if (!validInitialRecord(read.lease)) return { success: false, code: "lease_corrupt" };
            } else if (!(await validTransition(latest, read.lease))) {
                return { success: false, code: "lease_corrupt" };
            }
            latest = read.lease;
        }
        const remainingEntries = (await readdir(root)).filter(name => name.startsWith(prefix)).sort();
        if (remainingEntries.some(name => !finalPattern.test(name))) {
            if (!orphanCleanupAllowed || latest === null) return { success: false, code: "lease_corrupt" };
            const reconciled = await reconcileOrphanTemp(root, planDigest, latest);
            if (!reconciled.success) return reconciled;
            return reconciled.cleaned
                ? await readLatest(root, planDigest, false)
                : { success: false, code: "lease_corrupt" };
        }
        if (
            remainingEntries.length !== entries.length ||
            remainingEntries.some((name, index) => name !== entries[index])
        ) {
            return initialHadPublicationResidue
                ? await readLatest(root, planDigest, false)
                : { success: false, code: "concurrent_lease_write" };
        }
        return latest === null ? { success: false, code: "lease_not_found" } : { success: true, lease: latest };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const readHistoryReadOnly = async (
    root: string,
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1> => {
    try {
        const prefix = `${planDigest}.`;
        const entries = (await readdir(root)).filter(name => name.startsWith(prefix)).sort();
        const finalPattern = new RegExp(`^${planDigest}\\.(\\d+)\\.driver-lease\\.json$`, "u");
        if (entries.length === 0) return { success: false, code: "lease_not_found" };
        if (entries.some(name => !finalPattern.test(name))) return { success: false, code: "lease_corrupt" };
        const generations = entries
            .map(name => finalPattern.exec(name))
            .filter((match): match is RegExpExecArray => match !== null)
            .map(match => Number(match[1]))
            .sort((left, right) => left - right);
        if (
            generations.length === 0 ||
            generations.length > MAX_GENERATIONS_V1 ||
            generations.some((generation, index) => generation !== index)
        ) {
            return { success: false, code: "lease_corrupt" };
        }
        const leases: D1ProbeCloudflareWorkerCanaryDriverLeaseV1[] = [];
        for (const generation of generations) {
            const read = await readGeneration(root, planDigest, generation, false);
            if (!read.success) return read;
            const previous = leases.at(-1) ?? null;
            if (previous === null ? !validInitialRecord(read.lease) : !(await validTransition(previous, read.lease))) {
                return { success: false, code: "lease_corrupt" };
            }
            leases.push(read.lease);
        }
        const finalEntries = (await readdir(root)).filter(name => name.startsWith(prefix)).sort();
        if (finalEntries.length !== entries.length || finalEntries.some((name, index) => name !== entries[index])) {
            return { success: false, code: "concurrent_lease_write" };
        }
        return { success: true, leases: Object.freeze(leases) };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const readLatestReadOnly = async (
    root: string,
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const history = await readHistoryReadOnly(root, planDigest);
    if (!history.success) return history;
    const lease = history.leases.at(-1);
    return lease === undefined ? { success: false, code: "lease_corrupt" } : { success: true, lease };
};

const publishGeneration = async (
    root: string,
    lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const finalPath = generationPathFor(root, lease.plan_digest, lease.generation);
    const tempPath = resolve(root, `${lease.plan_digest}.${lease.generation}.${randomUUID()}.driver-lease.tmp`);
    let tempCreated = false;
    try {
        const handle = await open(tempPath, "wx", 0o600);
        tempCreated = true;
        try {
            await handle.chmod(0o600);
            await handle.writeFile(canonicalizeJsonV1(lease as CanonicalJsonValueV1));
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
        return { success: true, lease };
    } catch (error) {
        if (errorCode(error) === "EEXIST") return { success: false, code: "concurrent_lease_write" };
        return { success: false, code: "lease_io_unavailable" };
    } finally {
        if (tempCreated) await unlink(tempPath).catch(() => undefined);
    }
};

const safeParse = <T>(schema: z.ZodType<T>, input: unknown): T | null => {
    try {
        const parsed = schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const safeNow = (dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1): number | null => {
    try {
        const now = dependencies.now();
        return SafeTimeV1Schema.safeParse(now).success ? now : null;
    } catch {
        return null;
    }
};

const expiresAt = (now: number, duration: number): number | null => {
    const value = now + duration;
    return Number.isSafeInteger(value) && value > now ? value : null;
};

const encodeBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const makeOwnerNonce = (
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): { readonly encoded: string; readonly bytes: Uint8Array } | null => {
    try {
        const supplied = dependencies.randomBytes(32);
        if (!(supplied instanceof Uint8Array) || supplied.byteLength !== 32) return null;
        const bytes = Uint8Array.from(supplied);
        supplied.fill(0);
        const encoded = encodeBase64Url(bytes);
        return OwnerNonceV1Schema.safeParse(encoded).success ? { encoded, bytes } : null;
    } catch {
        return null;
    }
};

const commitment = async (domain: string, value: string): Promise<string> => await requiredDigest(domain, value);

const ownerFor = (
    lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    executionNonce: string,
    ownerNonce: string
): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 => ({
    plan_digest: lease.plan_digest,
    execution_nonce: executionNonce,
    generation: lease.generation,
    owner_pid: lease.owner_pid,
    owner_nonce: ownerNonce,
});

const exactOwner = async (
    lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    currentProcessPid: number
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 | null> => {
    if (lease.generation !== owner.generation) return "lease_generation_mismatch";
    if (lease.state === "released") return "lease_released";
    if (
        lease.execution_nonce_commitment !==
        (await commitment(EXECUTION_NONCE_COMMITMENT_DOMAIN_V1, owner.execution_nonce))
    ) {
        return "lease_binding_mismatch";
    }
    if (
        owner.owner_pid !== currentProcessPid ||
        lease.owner_pid !== owner.owner_pid ||
        lease.owner_nonce_commitment !== (await commitment(OWNER_NONCE_COMMITMENT_DOMAIN_V1, owner.owner_nonce))
    ) {
        return "lease_owner_mismatch";
    }
    return null;
};

const livenessDenial = (
    liveness: D1ProbeCloudflareWorkerCanaryPidLivenessV1
): D1ProbeCloudflareWorkerCanaryDriverLeaseDenialV1 | null => {
    if (liveness === "live") return "lease_pid_live";
    if (liveness === "eperm") return "lease_pid_permission_denied";
    if (liveness === "unknown") return "lease_pid_liveness_unknown";
    return null;
};

export const readD1ProbeCloudflareWorkerCanaryDriverLeaseV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const planDigest = safeParse(DigestV1Schema, planDigestInput);
    if (planDigest === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot();
        if (!leaseRoot.success) return leaseRoot;
        return await readLatest(leaseRoot.root, planDigest);
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

export const readD1ProbeCloudflareWorkerCanaryDriverLeaseHeadReadOnlyV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const planDigest = safeParse(DigestV1Schema, planDigestInput);
    if (planDigest === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot(false);
        if (!leaseRoot.success) return leaseRoot;
        return await readLatestReadOnly(leaseRoot.root, planDigest);
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

export const readD1ProbeCloudflareWorkerCanaryDriverLeaseHistoryReadOnlyV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1> => {
    const planDigest = safeParse(DigestV1Schema, planDigestInput);
    if (planDigest === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot(false);
        if (!leaseRoot.success) return leaseRoot;
        return await readHistoryReadOnly(leaseRoot.root, planDigest);
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const acquireWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> => {
    const request = safeParse(AcquireLeaseV1Schema, input);
    if (request === null) return { success: false, code: "invalid_lease_request" };
    const ownerPid = safeParse(OwnerPidV1Schema, dependencies.ownerPid);
    if (ownerPid === null) return { success: false, code: "invalid_lease_request" };
    try {
        const observedNow = safeNow(dependencies);
        if (observedNow === null) return { success: false, code: "lease_clock_invalid" };
        const executionNonceCommitment = await commitment(
            EXECUTION_NONCE_COMMITMENT_DOMAIN_V1,
            request.execution_nonce
        );
        const leaseRoot = await ensureLeaseRoot();
        if (!leaseRoot.success) return leaseRoot;
        const current = await readLatest(leaseRoot.root, request.plan_digest);
        let generation = 0;
        let previousRecordDigest: string | null = null;
        let transition: "acquired" | "taken_over" = "acquired";
        let priorOwnerLiveness: "not_checked" | "esrch" = "not_checked";
        if (current.success) {
            if (current.lease.execution_nonce_commitment !== executionNonceCommitment) {
                return { success: false, code: "lease_binding_mismatch" };
            }
            if (current.lease.state === "released") return { success: false, code: "lease_released" };
            if (observedNow < current.lease.expires_at_ms) return { success: false, code: "lease_already_held" };
            if (ownerPid === current.lease.owner_pid) return { success: false, code: "lease_pid_live" };
            let liveness: D1ProbeCloudflareWorkerCanaryPidLivenessV1;
            try {
                liveness = await dependencies.checkPidLiveness(current.lease.owner_pid);
            } catch {
                liveness = "unknown";
            }
            if (!(["live", "esrch", "eperm", "unknown"] as const).includes(liveness)) liveness = "unknown";
            const denial = livenessDenial(liveness);
            if (denial !== null) return { success: false, code: denial };
            const checked = await readLatest(leaseRoot.root, request.plan_digest);
            if (!checked.success) return checked;
            const currentDigest = await recordDigest(current.lease);
            if (
                checked.lease.generation !== current.lease.generation ||
                (await recordDigest(checked.lease)) !== currentDigest
            ) {
                return { success: false, code: "concurrent_lease_write" };
            }
            if (current.lease.generation >= MAX_GENERATIONS_V1 - 1) {
                return { success: false, code: "lease_generation_exhausted" };
            }
            generation = current.lease.generation + 1;
            previousRecordDigest = currentDigest;
            transition = "taken_over";
            priorOwnerLiveness = "esrch";
        } else if (current.code !== "lease_not_found") {
            return current;
        }
        const issuedAt = current.success ? safeNow(dependencies) : observedNow;
        const expiry = issuedAt === null ? null : expiresAt(issuedAt, request.lease_duration_ms);
        if (issuedAt === null || issuedAt < observedNow || expiry === null) {
            return { success: false, code: "lease_clock_invalid" };
        }
        const ownerNonce = makeOwnerNonce(dependencies);
        if (ownerNonce === null) return { success: false, code: "lease_randomness_unavailable" };
        try {
            const ownerNonceCommitment = await commitment(OWNER_NONCE_COMMITMENT_DOMAIN_V1, ownerNonce.encoded);
            if (current.success && ownerNonceCommitment === current.lease.owner_nonce_commitment) {
                return { success: false, code: "lease_randomness_unavailable" };
            }
            const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
                transition,
                state: "active",
                plan_digest: request.plan_digest,
                execution_nonce_commitment: executionNonceCommitment,
                generation,
                previous_record_digest: previousRecordDigest,
                owner_pid: ownerPid,
                owner_nonce_commitment: ownerNonceCommitment,
                prior_owner_liveness: priorOwnerLiveness,
                issued_at_ms: issuedAt,
                heartbeat_at_ms: issuedAt,
                expires_at_ms: expiry,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
                mutation_authority: false,
            };
            const published = await publishGeneration(leaseRoot.root, lease);
            if (!published.success) return published;
            return {
                success: true,
                lease,
                owner: ownerFor(lease, request.execution_nonce, ownerNonce.encoded),
            };
        } finally {
            ownerNonce.bytes.fill(0);
        }
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const takeoverExpectedWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> => {
    const request = safeParse(TakeoverExpectedLeaseV1Schema, input);
    if (request === null) return { success: false, code: "invalid_lease_request" };
    const ownerPid = safeParse(OwnerPidV1Schema, dependencies.ownerPid);
    if (ownerPid === null) return { success: false, code: "invalid_lease_request" };
    try {
        const observedNow = safeNow(dependencies);
        if (observedNow === null) return { success: false, code: "lease_clock_invalid" };
        const executionNonceCommitment = await commitment(
            EXECUTION_NONCE_COMMITMENT_DOMAIN_V1,
            request.execution_nonce
        );
        const leaseRoot = await ensureLeaseRoot(false);
        if (!leaseRoot.success) return leaseRoot;
        const current = await readLatestReadOnly(leaseRoot.root, request.plan_digest);
        if (!current.success) return current;
        const currentDigest = await recordDigest(current.lease);
        if (
            current.lease.generation !== request.expected_generation ||
            currentDigest !== request.expected_record_digest
        ) {
            return { success: false, code: "concurrent_lease_write" };
        }
        if (current.lease.execution_nonce_commitment !== executionNonceCommitment) {
            return { success: false, code: "lease_binding_mismatch" };
        }
        if (current.lease.state === "released") return { success: false, code: "lease_released" };
        if (observedNow < current.lease.expires_at_ms) return { success: false, code: "lease_already_held" };
        if (ownerPid === current.lease.owner_pid) return { success: false, code: "lease_pid_live" };
        let liveness: D1ProbeCloudflareWorkerCanaryPidLivenessV1;
        try {
            liveness = await dependencies.checkPidLiveness(current.lease.owner_pid);
        } catch {
            liveness = "unknown";
        }
        if (!(["live", "esrch", "eperm", "unknown"] as const).includes(liveness)) liveness = "unknown";
        const denial = livenessDenial(liveness);
        if (denial !== null) return { success: false, code: denial };
        const checked = await readLatestReadOnly(leaseRoot.root, request.plan_digest);
        if (!checked.success) return checked;
        if (
            checked.lease.generation !== request.expected_generation ||
            (await recordDigest(checked.lease)) !== request.expected_record_digest
        ) {
            return { success: false, code: "concurrent_lease_write" };
        }
        if (current.lease.generation >= MAX_GENERATIONS_V1 - 1) {
            return { success: false, code: "lease_generation_exhausted" };
        }
        const issuedAt = safeNow(dependencies);
        const expiry = issuedAt === null ? null : expiresAt(issuedAt, request.lease_duration_ms);
        if (issuedAt === null || issuedAt < observedNow || expiry === null) {
            return { success: false, code: "lease_clock_invalid" };
        }
        const ownerNonce = makeOwnerNonce(dependencies);
        if (ownerNonce === null) return { success: false, code: "lease_randomness_unavailable" };
        try {
            const ownerNonceCommitment = await commitment(OWNER_NONCE_COMMITMENT_DOMAIN_V1, ownerNonce.encoded);
            if (ownerNonceCommitment === current.lease.owner_nonce_commitment) {
                return { success: false, code: "lease_randomness_unavailable" };
            }
            const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
                transition: "taken_over",
                state: "active",
                plan_digest: request.plan_digest,
                execution_nonce_commitment: executionNonceCommitment,
                generation: current.lease.generation + 1,
                previous_record_digest: request.expected_record_digest,
                owner_pid: ownerPid,
                owner_nonce_commitment: ownerNonceCommitment,
                prior_owner_liveness: "esrch",
                issued_at_ms: issuedAt,
                heartbeat_at_ms: issuedAt,
                expires_at_ms: expiry,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
                mutation_authority: false,
            };
            const published = await publishGeneration(leaseRoot.root, lease);
            if (!published.success) return published;
            return {
                success: true,
                lease,
                owner: ownerFor(lease, request.execution_nonce, ownerNonce.encoded),
            };
        } finally {
            ownerNonce.bytes.fill(0);
        }
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const renewWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> => {
    const request = safeParse(RenewLeaseV1Schema, input);
    if (request === null) return { success: false, code: "invalid_lease_request" };
    const ownerPid = safeParse(OwnerPidV1Schema, dependencies.ownerPid);
    if (ownerPid === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot();
        if (!leaseRoot.success) return leaseRoot;
        const current = await readLatest(leaseRoot.root, request.plan_digest);
        if (!current.success) return current;
        const ownerDenial = await exactOwner(current.lease, request, ownerPid);
        if (ownerDenial !== null) return { success: false, code: ownerDenial };
        const now = safeNow(dependencies);
        const expiry = now === null ? null : expiresAt(now, request.lease_duration_ms);
        if (now === null || expiry === null || now < current.lease.heartbeat_at_ms) {
            return { success: false, code: "lease_clock_invalid" };
        }
        if (now >= current.lease.expires_at_ms) return { success: false, code: "lease_expired" };
        if (expiry <= current.lease.expires_at_ms) return { success: false, code: "lease_clock_invalid" };
        if (current.lease.generation >= MAX_GENERATIONS_V1 - 1) {
            return { success: false, code: "lease_generation_exhausted" };
        }
        const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
            ...current.lease,
            transition: "renewed",
            generation: current.lease.generation + 1,
            previous_record_digest: await recordDigest(current.lease),
            heartbeat_at_ms: now,
            expires_at_ms: expiry,
        };
        const published = await publishGeneration(leaseRoot.root, lease);
        if (!published.success) return published;
        return {
            success: true,
            lease,
            owner: ownerFor(lease, request.execution_nonce, request.owner_nonce),
        };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const releaseWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const request = safeParse(OwnedLeaseV1Schema, input);
    if (request === null) return { success: false, code: "invalid_lease_request" };
    const ownerPid = safeParse(OwnerPidV1Schema, dependencies.ownerPid);
    if (ownerPid === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot();
        if (!leaseRoot.success) return leaseRoot;
        const current = await readLatest(leaseRoot.root, request.plan_digest);
        if (!current.success) return current;
        const ownerDenial = await exactOwner(current.lease, request, ownerPid);
        if (ownerDenial !== null) return { success: false, code: ownerDenial };
        const now = safeNow(dependencies);
        if (now === null || now < current.lease.heartbeat_at_ms) {
            return { success: false, code: "lease_clock_invalid" };
        }
        if (current.lease.generation >= MAX_GENERATIONS_V1 - 1) {
            return { success: false, code: "lease_generation_exhausted" };
        }
        const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
            ...current.lease,
            transition: "released",
            state: "released",
            generation: current.lease.generation + 1,
            previous_record_digest: await recordDigest(current.lease),
            heartbeat_at_ms: now,
            expires_at_ms: now,
        };
        return await publishGeneration(leaseRoot.root, lease);
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const assertCurrentWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const request = safeParse(OwnedLeaseV1Schema, input);
    if (request === null) return { success: false, code: "invalid_lease_request" };
    const ownerPid = safeParse(OwnerPidV1Schema, dependencies.ownerPid);
    if (ownerPid === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot();
        if (!leaseRoot.success) return leaseRoot;
        const current = await readLatest(leaseRoot.root, request.plan_digest);
        if (!current.success) return current;
        const ownerDenial = await exactOwner(current.lease, request, ownerPid);
        if (ownerDenial !== null) return { success: false, code: ownerDenial };
        const now = safeNow(dependencies);
        if (now === null || now < current.lease.heartbeat_at_ms) {
            return { success: false, code: "lease_clock_invalid" };
        }
        if (now >= current.lease.expires_at_ms) return { success: false, code: "lease_expired" };
        return { success: true, lease: current.lease };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

const assertCurrentReadOnlyWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
    const request = safeParse(OwnedLeaseV1Schema, input);
    if (request === null) return { success: false, code: "invalid_lease_request" };
    const ownerPid = safeParse(OwnerPidV1Schema, dependencies.ownerPid);
    if (ownerPid === null) return { success: false, code: "invalid_lease_request" };
    try {
        const leaseRoot = await ensureLeaseRoot(false);
        if (!leaseRoot.success) return leaseRoot;
        const current = await readLatestReadOnly(leaseRoot.root, request.plan_digest);
        if (!current.success) return current;
        const ownerDenial = await exactOwner(current.lease, request, ownerPid);
        if (ownerDenial !== null) return { success: false, code: ownerDenial };
        const now = safeNow(dependencies);
        if (now === null || now < current.lease.heartbeat_at_ms) {
            return { success: false, code: "lease_clock_invalid" };
        }
        if (now >= current.lease.expires_at_ms) return { success: false, code: "lease_expired" };
        return { success: true, lease: current.lease };
    } catch {
        return { success: false, code: "lease_io_unavailable" };
    }
};

export const acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> =>
    await acquireWithDependencies(input, defaultDependencies);

export const takeoverExpectedD1ProbeCloudflareWorkerCanaryDriverLeaseV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> =>
    await takeoverExpectedWithDependencies(input, defaultDependencies);

export const renewD1ProbeCloudflareWorkerCanaryDriverLeaseV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> =>
    await renewWithDependencies(input, defaultDependencies);

export const releaseD1ProbeCloudflareWorkerCanaryDriverLeaseV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> =>
    await releaseWithDependencies(input, defaultDependencies);

export const assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> =>
    await assertCurrentWithDependencies(input, defaultDependencies);

export const assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseReadOnlyV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> =>
    await assertCurrentReadOnlyWithDependencies(input, defaultDependencies);

export type D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1 = {
    readonly acquire: (input: unknown) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1>;
    readonly takeoverExpected: (input: unknown) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1>;
    readonly renew: (input: unknown) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1>;
    readonly release: (input: unknown) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly assertCurrent: (input: unknown) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly assertCurrentReadOnly: (input: unknown) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
};

/** Test-only clock, randomness, PID, and liveness seam. Production callers must use the fixed public functions. */
export const createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1 = (
    dependencies: D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1
): D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1 => {
    const fixedDependencies = Object.freeze({ ...dependencies });
    return Object.freeze({
        acquire: async (input: unknown) => await acquireWithDependencies(input, fixedDependencies),
        takeoverExpected: async (input: unknown) => await takeoverExpectedWithDependencies(input, fixedDependencies),
        renew: async (input: unknown) => await renewWithDependencies(input, fixedDependencies),
        release: async (input: unknown) => await releaseWithDependencies(input, fixedDependencies),
        assertCurrent: async (input: unknown) => await assertCurrentWithDependencies(input, fixedDependencies),
        assertCurrentReadOnly: async (input: unknown) =>
            await assertCurrentReadOnlyWithDependencies(input, fixedDependencies),
    });
};

export const d1ProbeCloudflareWorkerCanaryDriverLeasePathV1 = (
    planDigest: string,
    generation: number
): string | null =>
    DigestV1Schema.safeParse(planDigest).success &&
    Number.isSafeInteger(generation) &&
    generation >= 0 &&
    generation < MAX_GENERATIONS_V1
        ? generationPathFor(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1, planDigest, generation)
        : null;
