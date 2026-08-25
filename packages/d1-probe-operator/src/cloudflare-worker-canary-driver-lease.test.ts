import { chmod, link, lstat, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { afterEach, describe, expect, it } from "vitest";

import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1,
    acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1,
    d1ProbeCloudflareWorkerCanaryDriverLeasePathV1,
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    readD1ProbeCloudflareWorkerCanaryDriverLeaseHistoryReadOnlyV1,
    readD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    releaseD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryPidLivenessV1,
} from "./cloudflare-worker-canary-driver-lease.js";

const cleanupPrefixes = new Set<string>();
const cleanupPaths = new Set<string>();
const executionNonce = "a".repeat(32);
let digestCounter = 0;

const planDigest = (): string => {
    digestCounter += 1;
    const entropy = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte =>
        byte.toString(16).padStart(2, "0")
    ).join("");
    const digest = `${digestCounter.toString(16).padStart(16, "0")}${entropy}`;
    cleanupPrefixes.add(`${digest}.`);
    return digest;
};

const dependencies = (
    ownerPid: number,
    now: number,
    nonceByte: number,
    liveness: D1ProbeCloudflareWorkerCanaryPidLivenessV1 = "unknown"
): D1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyDependenciesV1 => ({
    ownerPid,
    now: () => now,
    randomBytes: byteLength => new Uint8Array(byteLength).fill(nonceByte),
    checkPidLiveness: async () => liveness,
});

const acquire = async (
    digest: string,
    ownerPid: number,
    now: number,
    nonceByte: number,
    liveness: D1ProbeCloudflareWorkerCanaryPidLivenessV1 = "unknown"
) =>
    await createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(
        dependencies(ownerPid, now, nonceByte, liveness)
    ).acquire({
        plan_digest: digest,
        execution_nonce: executionNonce,
        lease_duration_ms: 100,
    });

afterEach(async () => {
    await chmod(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1, 0o700).catch(() => undefined);
    const names = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1).catch(() => []);
    for (const prefix of cleanupPrefixes) {
        for (const name of names) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${name}`).catch(
                    () => undefined
                );
            }
        }
    }
    for (const path of cleanupPaths) await unlink(path).catch(() => undefined);
    cleanupPrefixes.clear();
    cleanupPaths.clear();
});

describe("Cloudflare Worker canary driver lease", () => {
    it("reads a stable lease history without reconciling or writing", async () => {
        const digest = planDigest();
        const acquired = await acquire(digest, 40_001, 1_000, 9);
        if (!acquired.success) throw new Error(acquired.code);
        const path = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(digest, 0);
        if (path === null) throw new Error("lease path unavailable");
        const before = await Promise.all([lstat(path), readFile(path)]);
        const history = await readD1ProbeCloudflareWorkerCanaryDriverLeaseHistoryReadOnlyV1(digest);
        expect(history).toEqual({ success: true, leases: [acquired.lease] });
        await expect(digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(acquired.lease)).resolves.toMatch(
            /^[0-9a-f]{64}$/u
        );
        const after = await Promise.all([lstat(path), readFile(path)]);
        expect(after[0].mtimeMs).toBe(before[0].mtimeMs);
        expect(after[0].nlink).toBe(1);
        expect(after[1]).toEqual(before[1]);
    });

    it("derives the production owner PID and checks it again before use", async () => {
        await expect(
            acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1({
                plan_digest: planDigest(),
                execution_nonce: executionNonce,
                owner_pid: process.pid,
                lease_duration_ms: 10_000,
            })
        ).resolves.toEqual({ success: false, code: "invalid_lease_request" });

        const digest = planDigest();
        const acquired = await acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1({
            plan_digest: digest,
            execution_nonce: executionNonce,
            lease_duration_ms: 10_000,
        });
        expect(acquired.success).toBe(true);
        if (!acquired.success) return;
        expect(acquired.lease.owner_pid).toBe(process.pid);
        await expect(assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1(acquired.owner)).resolves.toEqual({
            success: true,
            lease: acquired.lease,
        });
        await expect(releaseD1ProbeCloudflareWorkerCanaryDriverLeaseV1(acquired.owner)).resolves.toMatchObject({
            success: true,
            lease: { state: "released", owner_pid: process.pid },
        });
    });

    it("stores a canonical private record with commitments and no authority", async () => {
        const digest = planDigest();
        const acquired = await acquire(digest, 20_001, 1_000, 7);
        expect(acquired.success).toBe(true);
        if (!acquired.success) return;

        const path = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(digest, 0);
        if (path === null) throw new Error("lease path unavailable");
        const [rootStat, fileStat, text, read] = await Promise.all([
            lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1),
            lstat(path),
            readFile(path, "utf8"),
            readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest),
        ]);

        expect(rootStat.mode & 0o777).toBe(0o700);
        expect(fileStat.mode & 0o777).toBe(0o600);
        expect(fileStat.nlink).toBe(1);
        expect(text).toBe(canonicalizeJsonV1(acquired.lease as CanonicalJsonValueV1));
        expect(read).toEqual({ success: true, lease: acquired.lease });
        expect(acquired.lease).toMatchObject({
            plan_digest: digest,
            generation: 0,
            transition: "acquired",
            state: "active",
            owner_pid: 20_001,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
            mutation_authority: false,
        });
        expect(acquired.lease.execution_nonce_commitment).toMatch(/^[0-9a-f]{64}$/u);
        expect(acquired.lease.owner_nonce_commitment).toMatch(/^[0-9a-f]{64}$/u);
        expect(text).not.toContain(executionNonce);
        expect(text).not.toContain(acquired.owner.owner_nonce);
    });

    it("gives exactly one initial contender the generation-zero CAS", async () => {
        const digest = planDigest();
        const contenders = await Promise.all([acquire(digest, 20_011, 1_000, 11), acquire(digest, 20_012, 1_000, 12)]);
        expect(contenders.filter(result => result.success)).toHaveLength(1);
        expect(contenders.filter(result => !result.success)).toHaveLength(1);
        const read = await readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest);
        expect(read.success).toBe(true);
        if (read.success) {
            expect([20_011, 20_012]).toContain(read.lease.owner_pid);
            expect(read.lease.generation).toBe(0);
        }
    });

    it("requires the exact owner and generation for renewal and release", async () => {
        const digest = planDigest();
        const acquired = await acquire(digest, 20_021, 1_000, 21);
        if (!acquired.success) throw new Error(acquired.code);

        const renewalStore = createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(
            dependencies(20_021, 1_050, 99)
        );
        await expect(
            renewalStore.renew({ ...acquired.owner, owner_nonce: "B".repeat(43), lease_duration_ms: 100 })
        ).resolves.toEqual({ success: false, code: "lease_owner_mismatch" });

        const renewed = await renewalStore.renew({ ...acquired.owner, lease_duration_ms: 100 });
        expect(renewed.success).toBe(true);
        if (!renewed.success) return;
        expect(renewed.lease).toMatchObject({ generation: 1, transition: "renewed", expires_at_ms: 1_150 });
        await expect(renewalStore.assertCurrent(renewed.owner)).resolves.toEqual({
            success: true,
            lease: renewed.lease,
        });
        await expect(
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(
                dependencies(20_999, 1_050, 99)
            ).assertCurrent(renewed.owner)
        ).resolves.toEqual({ success: false, code: "lease_owner_mismatch" });

        const releaseStore = createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(
            dependencies(20_021, 1_060, 99)
        );
        await expect(releaseStore.release(acquired.owner)).resolves.toEqual({
            success: false,
            code: "lease_generation_mismatch",
        });

        const released = await releaseStore.release(renewed.owner);
        expect(released.success).toBe(true);
        if (released.success) {
            expect(released.lease).toMatchObject({
                generation: 2,
                transition: "released",
                state: "released",
                heartbeat_at_ms: 1_060,
                expires_at_ms: 1_060,
            });
        }
        await expect(releaseStore.assertCurrent(renewed.owner)).resolves.toEqual({
            success: false,
            code: "lease_generation_mismatch",
        });
        await expect(acquire(digest, 20_022, 2_000, 22, "esrch")).resolves.toEqual({
            success: false,
            code: "lease_released",
        });
    });

    it("denies takeover without an expired lease and an ESRCH observation", async () => {
        const notExpiredDigest = planDigest();
        const notExpired = await acquire(notExpiredDigest, 20_031, 1_000, 31);
        if (!notExpired.success) throw new Error(notExpired.code);
        let livenessChecks = 0;
        const early = await createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
            ...dependencies(20_032, 1_099, 32, "esrch"),
            checkPidLiveness: async () => {
                livenessChecks += 1;
                return "esrch";
            },
        }).acquire({
            plan_digest: notExpiredDigest,
            execution_nonce: executionNonce,
            lease_duration_ms: 100,
        });
        expect(early).toEqual({ success: false, code: "lease_already_held" });
        expect(livenessChecks).toBe(0);

        for (const [liveness, code] of [
            ["live", "lease_pid_live"],
            ["eperm", "lease_pid_permission_denied"],
            ["unknown", "lease_pid_liveness_unknown"],
        ] as const) {
            const digest = planDigest();
            const held = await acquire(digest, 20_040, 1_000, 40);
            if (!held.success) throw new Error(held.code);
            await expect(acquire(digest, 20_041, 1_100, 41, liveness)).resolves.toEqual({
                success: false,
                code,
            });
        }

        const reusedDigest = planDigest();
        const reused = await acquire(reusedDigest, 20_050, 1_000, 50);
        if (!reused.success) throw new Error(reused.code);
        let reusedCheck = 0;
        const samePid = await createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
            ...dependencies(20_050, 1_100, 51, "esrch"),
            checkPidLiveness: async () => {
                reusedCheck += 1;
                return "esrch";
            },
        }).acquire({
            plan_digest: reusedDigest,
            execution_nonce: executionNonce,
            lease_duration_ms: 100,
        });
        expect(samePid).toEqual({ success: false, code: "lease_pid_live" });
        expect(reusedCheck).toBe(0);
    });

    it("allows one ESRCH takeover winner after both contenders inspect the same generation", async () => {
        const digest = planDigest();
        const held = await acquire(digest, 20_061, 1_000, 61);
        if (!held.success) throw new Error(held.code);

        let checked = 0;
        let releaseChecks: (() => void) | undefined;
        const bothChecked = new Promise<void>(resolve => {
            releaseChecks = resolve;
        });
        const checkPidLiveness = async (): Promise<"esrch"> => {
            checked += 1;
            if (checked === 2) releaseChecks?.();
            await bothChecked;
            return "esrch";
        };
        const request = () => ({
            plan_digest: digest,
            execution_nonce: executionNonce,
            lease_duration_ms: 100,
        });
        const contenders = await Promise.all([
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
                ...dependencies(20_062, 1_100, 62),
                checkPidLiveness,
            }).acquire(request()),
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
                ...dependencies(20_063, 1_100, 63),
                checkPidLiveness,
            }).acquire(request()),
        ]);

        expect(contenders.filter(result => result.success)).toHaveLength(1);
        expect(contenders.filter(result => !result.success)).toHaveLength(1);
        const latest = await readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest);
        expect(latest.success).toBe(true);
        if (latest.success) {
            expect(latest.lease).toMatchObject({
                generation: 1,
                transition: "taken_over",
                prior_owner_liveness: "esrch",
            });
            expect([20_062, 20_063]).toContain(latest.lease.owner_pid);
        }
    });

    it("denies takeover when the latest generation changes during the PID check", async () => {
        const digest = planDigest();
        const held = await acquire(digest, 20_071, 1_000, 71);
        if (!held.success) throw new Error(held.code);

        let replacementOwner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 | null = null;
        const raced = await createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
            ...dependencies(20_072, 1_100, 72),
            checkPidLiveness: async () => {
                const replacement = await acquire(digest, 20_073, 1_100, 73, "esrch");
                if (!replacement.success) throw new Error(replacement.code);
                replacementOwner = replacement.owner;
                return "esrch";
            },
        }).acquire({
            plan_digest: digest,
            execution_nonce: executionNonce,
            lease_duration_ms: 100,
        });

        expect(replacementOwner).not.toBeNull();
        expect(raced).toEqual({ success: false, code: "concurrent_lease_write" });
        const latest = await readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest);
        expect(latest.success && latest.lease.owner_pid).toBe(20_073);
    });

    it("denies replay, clock rollback, binding changes, and malformed dependencies without throwing", async () => {
        const digest = planDigest();
        const held = await acquire(digest, 20_081, 1_000, 81);
        if (!held.success) throw new Error(held.code);

        await expect(
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(dependencies(20_081, 999, 82)).renew({
                ...held.owner,
                lease_duration_ms: 100,
            })
        ).resolves.toEqual({ success: false, code: "lease_clock_invalid" });
        await expect(
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(dependencies(20_081, 1_100, 82)).renew({
                ...held.owner,
                lease_duration_ms: 100,
            })
        ).resolves.toEqual({ success: false, code: "lease_expired" });
        await expect(
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(
                dependencies(20_082, 1_100, 82, "esrch")
            ).acquire({
                plan_digest: digest,
                execution_nonce: "b".repeat(32),
                lease_duration_ms: 100,
            })
        ).resolves.toEqual({ success: false, code: "lease_binding_mismatch" });
        await expect(
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
                ...dependencies(20_083, 1_000, 83),
                now: () => Number.NaN,
            }).acquire({
                plan_digest: planDigest(),
                execution_nonce: executionNonce,
                lease_duration_ms: 100,
            })
        ).resolves.toEqual({ success: false, code: "lease_clock_invalid" });
        await expect(
            createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1({
                ...dependencies(20_084, 1_000, 84),
                randomBytes: () => new Uint8Array(31),
            }).acquire({
                plan_digest: planDigest(),
                execution_nonce: executionNonce,
                lease_duration_ms: 100,
            })
        ).resolves.toEqual({ success: false, code: "lease_randomness_unavailable" });
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1("../lease")).resolves.toEqual({
            success: false,
            code: "invalid_lease_request",
        });
    });

    it("reconciles only exact same-inode publication residue", async () => {
        const digest = planDigest();
        const acquired = await acquire(digest, 20_091, 1_000, 91);
        if (!acquired.success) throw new Error(acquired.code);
        const finalPath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(digest, 0);
        if (finalPath === null) throw new Error("lease path unavailable");
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${digest}.0.11111111-1111-4111-8111-111111111111.driver-lease.tmp`;
        cleanupPaths.add(tempPath);
        await link(finalPath, tempPath);

        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseHistoryReadOnlyV1(digest)).resolves.toEqual({
            success: false,
            code: "lease_corrupt",
        });
        await expect(Promise.all([lstat(finalPath), lstat(tempPath)])).resolves.toEqual([
            expect.objectContaining({ nlink: 2 }),
            expect.objectContaining({ nlink: 2 }),
        ]);

        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest)).resolves.toEqual({
            success: true,
            lease: acquired.lease,
        });
        await expect(lstat(finalPath)).resolves.toMatchObject({ nlink: 1 });
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("removes one canonical unpublished generation-zero crash temp", async () => {
        const sourceDigest = planDigest();
        const source = await acquire(sourceDigest, 20_095, 1_000, 95);
        if (!source.success) throw new Error(source.code);
        const digest = planDigest();
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${digest}.0.22222222-2222-4222-8222-222222222222.driver-lease.tmp`;
        const orphan = { ...source.lease, plan_digest: digest };
        await writeFile(tempPath, canonicalizeJsonV1(orphan as CanonicalJsonValueV1), { mode: 0o600 });

        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest)).resolves.toEqual({
            success: false,
            code: "lease_not_found",
        });
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("removes one canonical unpublished later-generation crash temp and keeps the last final", async () => {
        const digest = planDigest();
        const acquired = await acquire(digest, 20_096, 1_000, 96);
        if (!acquired.success) throw new Error(acquired.code);
        const renewed = await createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1(
            dependencies(20_096, 1_050, 97)
        ).renew({ ...acquired.owner, lease_duration_ms: 100 });
        if (!renewed.success) throw new Error(renewed.code);
        const generationOnePath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(digest, 1);
        if (generationOnePath === null) throw new Error("lease path unavailable");
        const generationOneText = await readFile(generationOnePath, "utf8");
        await unlink(generationOnePath);
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${digest}.1.33333333-3333-4333-8333-333333333333.driver-lease.tmp`;
        await writeFile(tempPath, generationOneText, { mode: 0o600 });

        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest)).resolves.toEqual({
            success: true,
            lease: acquired.lease,
        });
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(lstat(generationOnePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps multiple or malformed unpublished temps and fails closed", async () => {
        const sourceDigest = planDigest();
        const source = await acquire(sourceDigest, 20_097, 1_000, 97);
        if (!source.success) throw new Error(source.code);

        const multipleDigest = planDigest();
        const multipleRecord = { ...source.lease, plan_digest: multipleDigest };
        const multiplePaths = [
            `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${multipleDigest}.0.44444444-4444-4444-8444-444444444444.driver-lease.tmp`,
            `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${multipleDigest}.0.55555555-5555-4555-8555-555555555555.driver-lease.tmp`,
        ];
        for (const path of multiplePaths) {
            await writeFile(path, canonicalizeJsonV1(multipleRecord as CanonicalJsonValueV1), { mode: 0o600 });
        }
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(multipleDigest)).resolves.toEqual({
            success: false,
            code: "lease_corrupt",
        });
        for (const path of multiplePaths) await expect(lstat(path)).resolves.toMatchObject({ nlink: 1 });

        const malformedDigest = planDigest();
        const malformedPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${malformedDigest}.0.66666666-6666-4666-8666-666666666666.driver-lease.tmp`;
        await writeFile(malformedPath, "{}", { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(malformedDigest)).resolves.toEqual({
            success: false,
            code: "lease_corrupt",
        });
        await expect(lstat(malformedPath)).resolves.toMatchObject({ nlink: 1 });
    });

    it("does not clean permissive or hard-linked unpublished temps", async () => {
        const sourceDigest = planDigest();
        const source = await acquire(sourceDigest, 20_098, 1_000, 98);
        if (!source.success) throw new Error(source.code);

        const permissiveDigest = planDigest();
        const permissivePath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${permissiveDigest}.0.77777777-7777-4777-8777-777777777777.driver-lease.tmp`;
        await writeFile(
            permissivePath,
            canonicalizeJsonV1({ ...source.lease, plan_digest: permissiveDigest } as CanonicalJsonValueV1),
            { mode: 0o644 }
        );
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(permissiveDigest)).resolves.toEqual({
            success: false,
            code: "unsafe_lease_permissions",
        });
        await expect(lstat(permissivePath)).resolves.toMatchObject({ nlink: 1 });

        const hardLinkDigest = planDigest();
        const hardLinkPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${hardLinkDigest}.0.88888888-8888-4888-8888-888888888888.driver-lease.tmp`;
        const secondLink = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/orphan-hardlink-${hardLinkDigest}`;
        cleanupPaths.add(secondLink);
        await writeFile(
            hardLinkPath,
            canonicalizeJsonV1({ ...source.lease, plan_digest: hardLinkDigest } as CanonicalJsonValueV1),
            { mode: 0o600 }
        );
        await link(hardLinkPath, secondLink);
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(hardLinkDigest)).resolves.toEqual({
            success: false,
            code: "unsafe_lease_path",
        });
        await expect(lstat(hardLinkPath)).resolves.toMatchObject({ nlink: 2 });
    });

    it("fails closed for symlink, permissive, unrelated hard-link, gap, and corrupt records", async () => {
        const symbolicDigest = planDigest();
        const symbolicPath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(symbolicDigest, 0);
        if (symbolicPath === null) throw new Error("lease path unavailable");
        const targetPath = `${symbolicPath}.target`;
        cleanupPaths.add(targetPath);
        await writeFile(targetPath, "{}", { mode: 0o600 });
        await symlink(targetPath, symbolicPath);
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(symbolicDigest)).resolves.toEqual({
            success: false,
            code: "unsafe_lease_path",
        });

        const permissiveDigest = planDigest();
        const permissive = await acquire(permissiveDigest, 20_101, 1_000, 101);
        if (!permissive.success) throw new Error(permissive.code);
        const permissivePath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(permissiveDigest, 0);
        if (permissivePath === null) throw new Error("lease path unavailable");
        await chmod(permissivePath, 0o644);
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(permissiveDigest)).resolves.toEqual({
            success: false,
            code: "unsafe_lease_permissions",
        });

        const hardLinkDigest = planDigest();
        const hardLinked = await acquire(hardLinkDigest, 20_102, 1_000, 102);
        if (!hardLinked.success) throw new Error(hardLinked.code);
        const hardLinkPath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(hardLinkDigest, 0);
        if (hardLinkPath === null) throw new Error("lease path unavailable");
        const unrelatedPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1}/${hardLinkDigest}.unrelated`;
        cleanupPaths.add(unrelatedPath);
        await link(hardLinkPath, unrelatedPath);
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(hardLinkDigest)).resolves.toEqual({
            success: false,
            code: "unsafe_lease_path",
        });

        const gapDigest = planDigest();
        const gap = await acquire(planDigest(), 20_103, 1_000, 103);
        if (!gap.success) throw new Error(gap.code);
        const gapPath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(gapDigest, 1);
        if (gapPath === null) throw new Error("lease path unavailable");
        await writeFile(
            gapPath,
            canonicalizeJsonV1({ ...gap.lease, plan_digest: gapDigest, generation: 1 } as CanonicalJsonValueV1),
            { mode: 0o600 }
        );
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(gapDigest)).resolves.toEqual({
            success: false,
            code: "lease_corrupt",
        });

        const corruptDigest = planDigest();
        const corruptPath = d1ProbeCloudflareWorkerCanaryDriverLeasePathV1(corruptDigest, 0);
        if (corruptPath === null) throw new Error("lease path unavailable");
        await writeFile(corruptPath, "{}", { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(corruptDigest)).resolves.toEqual({
            success: false,
            code: "lease_corrupt",
        });
    });

    it("fails closed when the lease directory becomes permissive", async () => {
        const digest = planDigest();
        const held = await acquire(digest, 20_111, 1_000, 111);
        if (!held.success) throw new Error(held.code);
        await chmod(D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1, 0o755);
        await expect(readD1ProbeCloudflareWorkerCanaryDriverLeaseV1(digest)).resolves.toEqual({
            success: false,
            code: "unsafe_lease_permissions",
        });
    });
});
