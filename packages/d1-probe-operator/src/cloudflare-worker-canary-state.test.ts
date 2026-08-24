import { chmod, link, lstat, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { afterEach, describe, expect, it } from "vitest";

import {
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1,
    createD1ProbeCloudflareWorkerCanaryStateV1,
    d1ProbeCloudflareWorkerCanaryStatePathV1,
    readD1ProbeCloudflareWorkerCanaryStateV1,
    readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1,
    transitionD1ProbeCloudflareWorkerCanaryStateV1,
} from "./cloudflare-worker-canary-state.js";

const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
const cleanupPaths = new Set<string>();
const cleanupPrefixes = new Set<string>();

afterEach(async () => {
    for (const path of cleanupPaths) await unlink(path).catch(() => undefined);
    const names = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1).catch(() => []);
    for (const prefix of cleanupPrefixes) {
        for (const name of names) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1}/${name}`).catch(() => undefined);
            }
        }
    }
    cleanupPaths.clear();
    cleanupPrefixes.clear();
});

const prepared = async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    let batch = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "c".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => 2_000,
            randomBytes: byteLength => {
                batch += 1;
                return new Uint8Array(byteLength).map(
                    (_, index) => ((entropy[index % entropy.length] ?? 0) + index + batch * 47) % 252
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
        2_001
    );
    if (!operation.success) throw new Error(operation.code);
    const path = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.operation.plan.plan_digest);
    if (path === null) throw new Error("state path unavailable");
    cleanupPaths.add(path);
    cleanupPrefixes.add(operation.operation.plan.plan_digest);
    return operation.operation;
};

describe("Cloudflare Worker canary durable state", () => {
    it("writes canonical 0600 state under a 0700 repository-local directory", async () => {
        const operation = await prepared();
        await expect(createD1ProbeCloudflareWorkerCanaryStateV1(operation)).resolves.toEqual({
            success: true,
            operation,
        });
        const path = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.plan.plan_digest);
        if (path === null) throw new Error("state path unavailable");
        const [directoryStat, fileStat, bytes, read] = await Promise.all([
            lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1),
            lstat(path),
            readFile(path, "utf8"),
            readD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest),
        ]);
        expect(directoryStat.mode & 0o777).toBe(0o700);
        expect(fileStat.mode & 0o777).toBe(0o600);
        expect(bytes).toBe(canonicalizeJsonV1(operation as CanonicalJsonValueV1));
        expect(read).toEqual({ success: true, operation });
        expect(bytes).not.toContain("api_token");
        expect(bytes).not.toContain("hmac_key_base64url");
    });

    it("uses revision comparison and exact transition checks for updates", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(operation, "shell_dispatching", 2_002);
        await expect(
            transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch)
        ).resolves.toEqual({ success: true, operation: shellDispatch });
        await expect(
            transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch)
        ).resolves.toEqual({ success: false, code: "state_revision_mismatch" });

        const skipped = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(shellDispatch, "version_dispatching", 2_003, {
            worker_id: "worker_1",
        });
        await expect(
            transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 1, skipped)
        ).resolves.toEqual({ success: false, code: "state_transition_denied" });
    });

    it("allows only one competing revision update", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(operation, "shell_dispatching", 2_002);
        const results = await Promise.all([
            transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch),
            transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch),
        ]);
        expect(results.filter(result => result.success)).toHaveLength(1);
        const denial = results.find(result => !result.success);
        expect(denial).toBeDefined();
        if (denial?.success === false) {
            expect(["concurrent_state_write", "state_revision_mismatch"]).toContain(denial.code);
        }
    });

    it("makes the delete dispatch fence durable and one-way", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(operation, "shell_dispatching", 2_002);
        const cleanup = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(shellDispatch, "cleanup_reconciling", 2_003);
        const deleteDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(cleanup, "delete_dispatching", 2_004, {
            worker_id: "worker_delete_fence",
        });
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 0, shellDispatch)
        ).toEqual({ success: true, operation: shellDispatch });
        expect(await transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 1, cleanup)).toEqual({
            success: true,
            operation: cleanup,
        });
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 2, deleteDispatch)
        ).toEqual({ success: true, operation: deleteDispatch });

        const replayPath = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            deleteDispatch,
            "cleanup_reconciling",
            2_005
        );
        await expect(
            transitionD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest, 3, replayPath)
        ).resolves.toEqual({ success: false, code: "state_transition_denied" });
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest)).resolves.toEqual({
            success: true,
            operation: deleteDispatch,
        });
    });

    it("denies symbolic links and permissive state files", async () => {
        const bootstrap = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(bootstrap)).success).toBe(true);

        const linked = await prepared();
        const linkedPath = d1ProbeCloudflareWorkerCanaryStatePathV1(linked.plan.plan_digest);
        if (linkedPath === null) throw new Error("state path unavailable");
        const targetPath = `${linkedPath}.target`;
        cleanupPaths.add(targetPath);
        await writeFile(targetPath, "{}", { mode: 0o600 });
        await symlink(targetPath, linkedPath);
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1(linked.plan.plan_digest)).resolves.toEqual({
            success: false,
            code: "unsafe_state_path",
        });

        const bootstrapPath = d1ProbeCloudflareWorkerCanaryStatePathV1(bootstrap.plan.plan_digest);
        if (bootstrapPath === null) throw new Error("state path unavailable");
        await chmod(bootstrapPath, 0o644);
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1(bootstrap.plan.plan_digest)).resolves.toEqual({
            success: false,
            code: "unsafe_state_permissions",
        });
    });

    it("denies traversal-like digests without touching disk", async () => {
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1("../state")).resolves.toEqual({
            success: false,
            code: "invalid_plan_digest",
        });
    });

    it("rejects a later revision without revision zero and cannot reset the operation", async () => {
        const operation = await prepared();
        const revisionZeroPath = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.plan.plan_digest);
        if (revisionZeroPath === null) throw new Error("state path unavailable");
        const revisionOnePath = revisionZeroPath.replace(".0.operation.json", ".1.operation.json");
        const revisionOne = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            operation,
            "shell_dispatching",
            operation.updated_at_ms + 1
        );
        await writeFile(revisionOnePath, canonicalizeJsonV1(revisionOne as CanonicalJsonValueV1), { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest)).resolves.toEqual({
            success: false,
            code: "state_corrupt",
        });
        await expect(createD1ProbeCloudflareWorkerCanaryStateV1(operation)).resolves.toEqual({
            success: false,
            code: "state_corrupt",
        });
    });

    it("validates every adjacent persisted revision", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const revisionZeroPath = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.plan.plan_digest);
        if (revisionZeroPath === null) throw new Error("state path unavailable");
        const revisionOnePath = revisionZeroPath.replace(".0.operation.json", ".1.operation.json");
        const skipped = {
            ...buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
                operation,
                "cleanup_reconciling",
                operation.updated_at_ms + 1,
                { worker_id: "worker_1" }
            ),
            state: "absence_observed" as const,
        };
        await writeFile(revisionOnePath, canonicalizeJsonV1(skipped as CanonicalJsonValueV1), { mode: 0o600 });
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest)).resolves.toEqual({
            success: false,
            code: "state_corrupt",
        });
    });

    it("reconciles the exact same-inode temp link left after revision publication", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const revisionPath = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.plan.plan_digest);
        if (revisionPath === null) throw new Error("state path unavailable");
        const tempPath = revisionPath.replace(
            ".0.operation.json",
            ".0.11111111-1111-4111-8111-111111111111.operation.tmp"
        );
        await link(revisionPath, tempPath);
        await expect(readD1ProbeCloudflareWorkerCanaryStateV1(operation.plan.plan_digest)).resolves.toEqual({
            success: true,
            operation,
        });
        await expect(lstat(revisionPath)).resolves.toMatchObject({ nlink: 1 });
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps read-only inspection from reconciling a published hard-link residue", async () => {
        const operation = await prepared();
        expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation)).success).toBe(true);
        const revisionPath = d1ProbeCloudflareWorkerCanaryStatePathV1(operation.plan.plan_digest);
        if (revisionPath === null) throw new Error("state path unavailable");
        const tempPath = revisionPath.replace(".0.operation.json", `.0.${crypto.randomUUID()}.operation.tmp`);
        cleanupPaths.add(tempPath);
        await link(revisionPath, tempPath);

        await expect(readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1(operation.plan.plan_digest)).resolves.toEqual({
            success: false,
            code: "unsafe_state_path",
        });
        await expect(lstat(revisionPath)).resolves.toMatchObject({ nlink: 2 });
        await expect(lstat(tempPath)).resolves.toMatchObject({ nlink: 2 });
    });
});
