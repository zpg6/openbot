import { spawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const token = "x".repeat(32);

const runCli = async (
    input: string,
    keyInput?: string,
    tokenInput?: string,
    extraArguments: string[] = [],
    environment: NodeJS.ProcessEnv = process.env,
    descriptorOverrides?: readonly [number | "pipe", number | "pipe"]
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "--import",
                "tsx",
                new URL("./cloudflare-worker-canary-cli.ts", import.meta.url).pathname,
                ...extraArguments,
            ],
            {
                cwd: new URL("../", import.meta.url).pathname,
                env: environment,
                stdio: ["pipe", "pipe", "pipe", descriptorOverrides?.[0] ?? "pipe", descriptorOverrides?.[1] ?? "pipe"],
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdout === null || child.stderr === null || child.stdin === null) {
            reject(new Error("missing Worker API canary child stream"));
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
        for (const descriptor of [3, 4] as const) {
            if (descriptorOverrides?.[descriptor - 3] !== undefined && descriptorOverrides[descriptor - 3] !== "pipe") {
                continue;
            }
            const stream = child.stdio[descriptor];
            if (stream === undefined || stream === null || !("end" in stream)) {
                reject(new Error(`missing Worker API canary file descriptor ${descriptor}`));
                return;
            }
            stream.on("error", () => undefined);
            stream.end(descriptor === 3 ? (keyInput ?? "") : (tokenInput ?? ""));
        }
    });

describe("Cloudflare Worker API canary CLI boundary", () => {
    it("requires canonical bounded stdin and no arguments", async () => {
        expect(await runCli("{\n}\n", key, token)).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_canonical_json\n",
        });
        expect(await runCli("{}", key, token, ["extra"])).toEqual({
            code: 1,
            stdout: "",
            stderr: "usage_error\n",
        });
        expect(await runCli(`"${"a".repeat(64 * 1024)}"`, key, token)).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_canonical_json\n",
        });
    });

    it("reads no credential from the environment or an absent descriptor", async () => {
        expect(await runCli("{}", undefined, token)).toEqual({
            code: 1,
            stdout: "",
            stderr: "commitment_key_unavailable\n",
        });
        expect(
            await runCli("{}", undefined, undefined, [], {
                ...process.env,
                D1_PROBE_COMMITMENT_KEY: key,
                CLOUDFLARE_API_TOKEN: token,
            })
        ).toEqual({ code: 1, stdout: "", stderr: "commitment_key_unavailable\n" });
        expect(await runCli("{}", key, undefined)).toEqual({
            code: 1,
            stdout: "",
            stderr: "api_token_unavailable\n",
        });
    });

    it("rejects oversized, multiline, and carriage-return secrets without echoing them", async () => {
        expect(await runCli("{}", "k".repeat(129), token)).toEqual({
            code: 1,
            stdout: "",
            stderr: "commitment_key_unavailable\n",
        });
        expect(await runCli("{}", key, "x".repeat(257))).toEqual({
            code: 1,
            stdout: "",
            stderr: "api_token_unavailable\n",
        });
        expect(await runCli("{}", `${key}\nextra`, token)).toEqual({
            code: 1,
            stdout: "",
            stderr: "commitment_key_unavailable\n",
        });
        expect(await runCli("{}", key, `${token}\r`)).toEqual({
            code: 1,
            stdout: "",
            stderr: "api_token_unavailable\n",
        });
    });

    it("rejects ordinary files for both secret descriptors", async () => {
        const directory = await mkdtemp(join(tmpdir(), "openbot-worker-canary-cli-"));
        const keyPath = join(directory, "key");
        const tokenPath = join(directory, "token");
        await writeFile(keyPath, key, { mode: 0o600 });
        await writeFile(tokenPath, token, { mode: 0o600 });
        const keyFile = await open(keyPath, "r");
        const tokenFile = await open(tokenPath, "r");
        try {
            expect(await runCli("{}", undefined, undefined, [], process.env, [keyFile.fd, tokenFile.fd])).toEqual({
                code: 1,
                stdout: "",
                stderr: "commitment_key_unavailable\n",
            });
            expect(await runCli("{}", key, undefined, [], process.env, ["pipe", tokenFile.fd])).toEqual({
                code: 1,
                stdout: "",
                stderr: "api_token_unavailable\n",
            });
        } finally {
            await keyFile.close();
            await tokenFile.close();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("emits only a stable denial for a hostile command", async () => {
        const result = await runCli("{}", key, token);
        expect(result).toEqual({ code: 1, stdout: "", stderr: "invalid_canary_command\n" });
        expect(`${result.stdout}${result.stderr}`).not.toContain(key);
        expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    });
});
