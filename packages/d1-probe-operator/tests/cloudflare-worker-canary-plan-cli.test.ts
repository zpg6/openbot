import { spawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it } from "vitest";

import { D1ProbeCloudflareWorkerApiCanaryPlanV1Schema } from "../src/cloudflare-worker-interoperability-canary.js";

const accountId = "a".repeat(32);
const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const request = canonicalizeJsonV1({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
    account_id: accountId,
});

const runCli = async (
    input: string,
    keyInput?: string,
    extraArguments: string[] = [],
    environment: NodeJS.ProcessEnv = process.env,
    descriptorOverride?: number | "pipe"
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "--import",
                "tsx",
                new URL("../src/cloudflare-worker-canary-plan-cli.ts", import.meta.url).pathname,
                ...extraArguments,
            ],
            {
                cwd: new URL("../", import.meta.url).pathname,
                env: environment,
                stdio: ["pipe", "pipe", "pipe", descriptorOverride ?? "pipe"],
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdout === null || child.stderr === null || child.stdin === null) {
            reject(new Error("missing Worker API canary plan child stream"));
            return;
        }
        child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.stdin.on("error", () => undefined);
        child.once("error", reject);
        child.once("close", code => {
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
        child.stdin.end(input);
        if (descriptorOverride === undefined || descriptorOverride === "pipe") {
            const stream = child.stdio[3];
            if (stream === undefined || stream === null || !("end" in stream)) {
                reject(new Error("missing Worker API canary plan file descriptor 3"));
                return;
            }
            stream.on("error", () => undefined);
            stream.end(keyInput ?? "");
        }
    });

describe("Cloudflare Worker API canary plan CLI boundary", { timeout: 15_000 }, () => {
    it("emits one canonical command using cryptographic randomness and the current clock", async () => {
        const before = Date.now();
        const result = await runCli(`${request}\n`, `${key}\n`);
        const after = Date.now();
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout.endsWith("\n")).toBe(true);
        const output = result.stdout.slice(0, -1);
        const command = JSON.parse(output) as Record<string, unknown>;
        expect(canonicalizeJsonV1(command as CanonicalJsonValueV1)).toBe(output);
        expect(command["schema_version"]).toBe(1);
        expect(command["kind"]).toBe("d1_probe_cloudflare_worker_api_canary_command");
        const plan = D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.parse(command["plan"]);
        expect(plan.account_id).toBe(accountId);
        expect(plan.not_before_ms).toBeGreaterThanOrEqual(before);
        expect(plan.not_before_ms).toBeLessThanOrEqual(after);
        expect(plan.expires_at_ms).toBe(plan.not_before_ms + 300_000);
        expect(plan.operation_id).toMatch(/^[0-9a-f]{32}$/u);
        expect(plan.random_suffix).toMatch(/^[a-z0-9]{16}$/u);
        expect(result.stdout).not.toContain(key);
    });

    it("requires canonical bounded stdin and no arguments", async () => {
        expect(await runCli(`${JSON.stringify(JSON.parse(request), null, 2)}\n`, key)).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_canonical_json\n",
        });
        expect(await runCli(request, key, ["extra"])).toEqual({
            code: 1,
            stdout: "",
            stderr: "usage_error\n",
        });
        expect(await runCli(`"${"a".repeat(1024)}"`, key)).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_canonical_json\n",
        });
    });

    it("does not read a key from the environment or an absent descriptor", async () => {
        const result = await runCli(request, undefined, [], {
            ...process.env,
            D1_PROBE_COMMITMENT_KEY: key,
            HMAC_KEY: key,
        });
        expect(result).toEqual({ code: 1, stdout: "", stderr: "commitment_key_unavailable\n" });
        expect(`${result.stdout}${result.stderr}`).not.toContain(key);
        expect(`${result.stdout}${result.stderr}`).not.toContain(accountId);
    });

    it("rejects oversized, multiline, carriage-return, and malformed keys without echoing input", async () => {
        const cases = [
            ["k".repeat(129), "commitment_key_unavailable\n"],
            [`${key}\nextra`, "commitment_key_unavailable\n"],
            [`${key}\r`, "commitment_key_unavailable\n"],
            ["not-a-key", "invalid_commitment_key\n"],
        ] as const;
        for (const [keyInput, denial] of cases) {
            const result = await runCli(request, keyInput);
            expect(result).toEqual({ code: 1, stdout: "", stderr: denial });
            expect(`${result.stdout}${result.stderr}`).not.toContain(keyInput);
            expect(`${result.stdout}${result.stderr}`).not.toContain(accountId);
        }
    });

    it("rejects an ordinary file on descriptor 3", async () => {
        const directory = await mkdtemp(join(tmpdir(), "openbot-worker-canary-plan-cli-"));
        const keyPath = join(directory, "key");
        await writeFile(keyPath, key, { mode: 0o600 });
        const keyFile = await open(keyPath, "r");
        try {
            const result = await runCli(request, undefined, [], process.env, keyFile.fd);
            expect(result).toEqual({ code: 1, stdout: "", stderr: "commitment_key_unavailable\n" });
            expect(`${result.stdout}${result.stderr}`).not.toContain(key);
            expect(`${result.stdout}${result.stderr}`).not.toContain(accountId);
        } finally {
            await keyFile.close();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("returns fixed schema denials without echoing hostile request input", async () => {
        const hostileAccount = "b".repeat(32);
        const hostileRequest = canonicalizeJsonV1({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: hostileAccount,
            extra: true,
        });
        const result = await runCli(hostileRequest, key);
        expect(result).toEqual({ code: 1, stdout: "", stderr: "invalid_canary_plan_request\n" });
        expect(`${result.stdout}${result.stderr}`).not.toContain(hostileAccount);
        expect(`${result.stdout}${result.stderr}`).not.toContain(key);
    });
});
