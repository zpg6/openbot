import { chmod, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { afterEach, describe, expect, it } from "vitest";

import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1,
    compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
} from "./cloudflare-worker-canary-cleanup-obligation.js";
import { compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1 } from "./cloudflare-worker-canary-cleanup-grace.js";
import {
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const accountId = "d".repeat(32);
const operationId = "e".repeat(32);
const randomSuffix = "base000000000001";
const executionNonce = "1f".repeat(16);
const attemptTag = `openbot-canary-attempt-${executionNonce}`;
const notBefore = Date.parse("2026-08-24T20:00:00.000Z");
const planExpires = notBefore + 60_000;
let activePrefix: string | null = null;

const makePlan = async () => {
    const unsigned = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: accountId,
        commitment_key_id_digest: "a".repeat(64),
        operation_id: operationId,
        random_suffix: randomSuffix,
        script_name: `openbot-d1-probe-canary-${randomSuffix}`,
        markers: {
            ownership_tag: `openbot-canary-owner-${operationId}`,
            version_tag: `openbot-canary-version-${operationId}`,
            version_message: `openbot canary version ${operationId}`,
            deployment_message: `openbot canary deployment ${operationId}`,
        },
        compatibility_date: "2026-08-22" as const,
        not_before_ms: notBefore,
        expires_at_ms: planExpires,
        authoritative: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const planDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1",
        unsigned as CanonicalJsonValueV1
    );
    if (planDigest === null) throw new Error("plan digest unavailable");
    return { ...unsigned, plan_digest: planDigest };
};

const makeInputs = async () => {
    const plan = await makePlan();
    const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(plan, attemptTag, notBefore + 1);
    if (!prepared.success) throw new Error(prepared.code);
    const cleanup = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(plan, {
        worker_id: null,
        worker_id_commitment: null,
        attempt_tag_commitment: "b".repeat(64),
    });
    if (!cleanup.success) throw new Error(cleanup.code);
    return { operation: prepared.operation, grace: cleanup.command.cleanup_grace };
};

const makeObligation = async () => {
    const { operation, grace } = await makeInputs();
    const compiled = await compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(operation, grace);
    if (!compiled.success) throw new Error(compiled.code);
    activePrefix = `${compiled.obligation.plan_digest}.${compiled.obligation.execution_nonce_commitment}`;
    return compiled.obligation;
};

afterEach(async () => {
    if (activePrefix === null) return;
    const names = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1).catch(() => []);
    for (const name of names) {
        if (name.startsWith(`${activePrefix}.`)) {
            const path = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1}/${name}`;
            await chmod(path, 0o600).catch(() => undefined);
            await unlink(path).catch(() => undefined);
        }
    }
    activePrefix = null;
});

describe("Cloudflare Worker canary cleanup obligation", () => {
    it("binds the prepared operation and null-ID grace before any remote effect", async () => {
        const obligation = await makeObligation();
        expect(obligation).toMatchObject({
            plan_digest: obligation.operation.plan.plan_digest,
            execution_nonce_commitment: expect.stringMatching(/^[0-9a-f]{64}$/u),
            operation_revision: 0,
            operation_state: "prepared",
            operation_record_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
            cleanup_grace: {
                worker_id: null,
                worker_id_commitment: null,
                automatic_cleanup_not_before_ms: notBefore,
                automatic_cleanup_expires_at_ms: planExpires + 600_000,
            },
            caller_constructible_local_record: true,
            credentialed_runner_uses_record: false,
            cleanup_execution_authorized: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
    });

    it("publishes once and reads the exact canonical record without modifying it", async () => {
        const obligation = await makeObligation();
        await expect(publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(obligation)).resolves.toEqual({
            success: true,
            obligation,
        });
        const path = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1}/${activePrefix}.cleanup-obligation.json`;
        const beforeStat = await lstat(path);
        const beforeBytes = await readFile(path);
        await expect(
            readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1(
                obligation.plan_digest,
                obligation.execution_nonce_commitment
            )
        ).resolves.toEqual({ success: true, obligation });
        const afterStat = await lstat(path);
        expect(await readFile(path)).toEqual(beforeBytes);
        expect({ ino: afterStat.ino, size: afterStat.size, mtimeMs: afterStat.mtimeMs }).toEqual({
            ino: beforeStat.ino,
            size: beforeStat.size,
            mtimeMs: beforeStat.mtimeMs,
        });
    });

    it("denies duplicate publication without replacing the first record", async () => {
        const obligation = await makeObligation();
        expect((await publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(obligation)).success).toBe(true);
        await expect(publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(obligation)).resolves.toEqual({
            success: false,
            code: "obligation_already_exists",
        });
    });

    it("completes one exact pre-link publication residue", async () => {
        const obligation = await makeObligation();
        await mkdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1, {
            recursive: true,
            mode: 0o700,
        });
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1}/${activePrefix}.00000000-0000-4000-8000-000000000001.cleanup-obligation.tmp`;
        await writeFile(tempPath, canonicalizeJsonV1(obligation as CanonicalJsonValueV1), { mode: 0o600, flag: "wx" });
        const before = await lstat(tempPath);
        await expect(
            readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1(
                obligation.plan_digest,
                obligation.execution_nonce_commitment
            )
        ).resolves.toEqual({ success: false, code: "obligation_unreconciled" });
        expect((await lstat(tempPath)).ino).toBe(before.ino);
        await expect(publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(obligation)).resolves.toEqual({
            success: true,
            obligation,
        });
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("does not complete a substituted pre-link publication residue", async () => {
        const obligation = await makeObligation();
        await mkdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1, {
            recursive: true,
            mode: 0o700,
        });
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1}/${activePrefix}.00000000-0000-4000-8000-000000000002.cleanup-obligation.tmp`;
        const substituted = { ...obligation, obligation_digest: "f".repeat(64) };
        await writeFile(tempPath, canonicalizeJsonV1(substituted as CanonicalJsonValueV1), {
            mode: 0o600,
            flag: "wx",
        });
        await expect(publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(obligation)).resolves.toEqual({
            success: false,
            code: "obligation_unreconciled",
        });
        await expect(lstat(tempPath)).resolves.toMatchObject({ nlink: 1 });
    });

    it("rejects non-prepared operations and retained Worker identities", async () => {
        const { operation, grace } = await makeInputs();
        const shellDispatching = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            operation,
            "shell_dispatching",
            operation.updated_at_ms + 1
        );
        await expect(compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(shellDispatching, grace)).resolves.toEqual(
            { success: false, code: "invalid_operation" }
        );
        await expect(
            compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(operation, {
                ...grace,
                worker_id: "worker-id",
                worker_id_commitment: "c".repeat(64),
            })
        ).resolves.toEqual({ success: false, code: "invalid_cleanup_grace" });
    });

    it("rejects operation, grace, and obligation digest substitutions", async () => {
        const obligation = await makeObligation();
        for (const substituted of [
            { ...obligation, operation_record_digest: "c".repeat(64) },
            {
                ...obligation,
                cleanup_grace: { ...obligation.cleanup_grace, cleanup_grace_digest: "c".repeat(64) },
            },
            { ...obligation, obligation_digest: "c".repeat(64) },
        ]) {
            await expect(publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(substituted)).resolves.toEqual({
                success: false,
                code: "invalid_obligation_identity",
            });
        }
    });

    it("fails closed on permissive record permissions", async () => {
        const obligation = await makeObligation();
        expect((await publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1(obligation)).success).toBe(true);
        const path = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1}/${activePrefix}.cleanup-obligation.json`;
        await chmod(path, 0o644);
        await expect(
            readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1(
                obligation.plan_digest,
                obligation.execution_nonce_commitment
            )
        ).resolves.toEqual({ success: false, code: "unsafe_obligation_permissions" });
    });

    it("returns typed denials for hostile unknown inputs", async () => {
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        await expect(compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(hostile, hostile)).resolves.toEqual({
            success: false,
            code: "invalid_operation",
        });
        await expect(readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1(hostile, hostile)).resolves.toEqual({
            success: false,
            code: "invalid_obligation_identity",
        });
    });
});
