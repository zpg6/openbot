import { spawn } from "node:child_process";
import { link, lstat, readFile, readdir, unlink } from "node:fs/promises";

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
    transitionD1ProbeCloudflareWorkerCanaryStateV1,
} from "./cloudflare-worker-canary-state.js";

const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(12)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
const cleanupPrefixes = new Set<string>();
const cleanupPaths = new Set<string>();

afterEach(async () => {
    const names = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1).catch(() => []);
    for (const prefix of cleanupPrefixes) {
        for (const name of names) {
            if (name.startsWith(prefix)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1}/${name}`).catch(() => undefined);
            }
        }
    }
    for (const path of cleanupPaths) await unlink(path).catch(() => undefined);
    cleanupPrefixes.clear();
    cleanupPaths.clear();
});

const prepareState = async () => {
    const now = Date.now();
    let batch = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "d".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => now,
            randomBytes: byteLength => new Uint8Array(byteLength).fill(40 + batch++),
        }
    );
    if (!generated.success) throw new Error(generated.code);
    const operation = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
        generated.command.plan,
        `openbot-canary-attempt-${"ab".repeat(16)}`,
        now
    );
    if (!operation.success) throw new Error(operation.code);
    cleanupPrefixes.add(operation.operation.plan.plan_digest);
    expect((await createD1ProbeCloudflareWorkerCanaryStateV1(operation.operation)).success).toBe(true);
    return operation.operation;
};

const requestFor = (planDigest: string): string =>
    canonicalizeJsonV1({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_recovery_inspection_request",
        plan_digest: planDigest,
    });

const runCli = async (
    input: string,
    extraArguments: readonly string[] = [],
    environment: NodeJS.ProcessEnv = process.env
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "--import",
                "tsx",
                new URL("./cloudflare-worker-canary-recovery-inspect-cli.ts", import.meta.url).pathname,
                ...extraArguments,
            ],
            {
                cwd: new URL("../", import.meta.url).pathname,
                env: environment,
                stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdin === null || child.stdout === null || child.stderr === null) {
            reject(new Error("missing recovery inspector child stream"));
            return;
        }
        child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.once("error", reject);
        child.once("close", code => {
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
        child.stdin.end(input);
        for (const descriptor of [3, 4] as const) {
            const stream = child.stdio[descriptor];
            if (stream !== null && stream !== undefined && "end" in stream) stream.end(`fd-${descriptor}-sentinel`);
        }
    });

describe("Cloudflare Worker canary recovery inspector CLI", () => {
    it("emits one canonical redacted inspection without changing durable state", async () => {
        const prepared = await prepareState();
        const shellDispatch = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            prepared,
            "shell_dispatching",
            prepared.updated_at_ms + 1
        );
        const shellIdentified = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
            shellDispatch,
            "shell_identified",
            prepared.updated_at_ms + 2,
            { worker_id: "raw-worker-id-sentinel" }
        );
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(prepared.plan.plan_digest, 0, shellDispatch)
        ).toMatchObject({ success: true });
        expect(
            await transitionD1ProbeCloudflareWorkerCanaryStateV1(prepared.plan.plan_digest, 1, shellIdentified)
        ).toMatchObject({ success: true });
        const namesBefore = (await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1)).filter(name =>
            name.startsWith(prepared.plan.plan_digest)
        );
        const path = d1ProbeCloudflareWorkerCanaryStatePathV1(prepared.plan.plan_digest);
        if (path === null) throw new Error("state path unavailable");
        const bytesBefore = await readFile(path);
        const statBefore = await lstat(path);

        const result = await runCli(`${requestFor(prepared.plan.plan_digest)}\n`, [], {
            ...process.env,
            CLOUDFLARE_API_TOKEN: "environment-token-sentinel",
            D1_PROBE_COMMITMENT_KEY: "environment-key-sentinel",
        });
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        const output = result.stdout.slice(0, -1);
        const parsed = JSON.parse(output) as Record<string, unknown>;
        expect(canonicalizeJsonV1(parsed as CanonicalJsonValueV1)).toBe(output);
        expect(parsed).toMatchObject({
            kind: "untrusted_d1_probe_cloudflare_worker_api_canary_recovery_inspection",
            plan_digest: prepared.plan.plan_digest,
            revision: 2,
            state: "shell_identified",
            worker_identity_retained: true,
            version_identity_retained: false,
            deployment_identity_retained: false,
            recovery_status: "credentialed_runner_not_durably_integrated",
            delete_replay_allowed: false,
            manual_cleanup_executable: false,
            secure_secret_fd_launcher_available: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        const combined = `${result.stdout}${result.stderr}`;
        for (const sentinel of [
            "raw-worker-id-sentinel",
            prepared.script_name,
            prepared.ownership_tag,
            prepared.attempt_tag,
            hmacKey,
            "environment-token-sentinel",
            "environment-key-sentinel",
            "fd-3-sentinel",
            "fd-4-sentinel",
        ]) {
            expect(combined).not.toContain(sentinel);
        }
        expect(
            (await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1)).filter(name =>
                name.startsWith(prepared.plan.plan_digest)
            )
        ).toEqual(namesBefore);
        expect(await readFile(path)).toEqual(bytesBefore);
        expect((await lstat(path)).mtimeMs).toBe(statBefore.mtimeMs);
    });

    it("rejects arguments, noncanonical input, oversized input, and unknown state with fixed denials", async () => {
        const missingDigest = "f".repeat(64);
        expect(await runCli(requestFor(missingDigest), ["extra"])).toEqual({
            code: 1,
            stdout: "",
            stderr: "usage_error\n",
        });
        expect(await runCli(`${JSON.stringify(JSON.parse(requestFor(missingDigest)), null, 2)}\n`)).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_recovery_inspection_request\n",
        });
        expect(await runCli(`"${"x".repeat(512)}"`)).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_recovery_inspection_request\n",
        });
        expect(await runCli(requestFor(missingDigest))).toEqual({
            code: 1,
            stdout: "",
            stderr: "recovery_state_not_found\n",
        });
    });

    it("does not reconcile or remove a same-inode publication residue", async () => {
        const prepared = await prepareState();
        const path = d1ProbeCloudflareWorkerCanaryStatePathV1(prepared.plan.plan_digest);
        if (path === null) throw new Error("state path unavailable");
        const tempPath = path.replace(".0.operation.json", `.0.${crypto.randomUUID()}.operation.tmp`);
        cleanupPaths.add(tempPath);
        await link(path, tempPath);

        expect(await runCli(requestFor(prepared.plan.plan_digest))).toEqual({
            code: 1,
            stdout: "",
            stderr: "recovery_state_unavailable\n",
        });
        await expect(lstat(path)).resolves.toMatchObject({ nlink: 2 });
        await expect(lstat(tempPath)).resolves.toMatchObject({ nlink: 2 });
    });
});
