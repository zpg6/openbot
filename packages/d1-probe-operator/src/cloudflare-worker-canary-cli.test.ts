import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const runCli = async (
    input = "credential-command-sentinel",
    extraArguments: readonly string[] = [],
    environment: NodeJS.ProcessEnv = process.env
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
                stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdin === null || child.stdout === null || child.stderr === null) {
            reject(new Error("missing disabled Worker API canary child stream"));
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
            const stream = child.stdio[descriptor];
            if (stream !== null && stream !== undefined && "end" in stream) {
                stream.on("error", () => undefined);
                stream.end(`credential-fd-${descriptor}-sentinel`);
            }
        }
    });

describe("Cloudflare Worker API canary disabled CLI", () => {
    it("fails closed before reading input, credentials, arguments, or environment", async () => {
        for (const result of [
            await runCli(),
            await runCli("alternate-command", ["extra"], {
                ...process.env,
                CLOUDFLARE_API_TOKEN: "environment-token-sentinel",
                D1_PROBE_COMMITMENT_KEY: "environment-key-sentinel",
            }),
        ]) {
            expect(result).toEqual({ code: 1, stdout: "", stderr: "worker_api_canary_disabled\n" });
            expect(`${result.stdout}${result.stderr}`).not.toMatch(
                /credential-command-sentinel|credential-fd-|environment-token|environment-key/u
            );
        }
    });
});
