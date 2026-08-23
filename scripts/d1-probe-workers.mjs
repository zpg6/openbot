import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const packageManagerEntrypoint = process.env.npm_execpath;
const wranglerLogPath = process.env["WRANGLER_LOG_PATH"] ?? path.resolve(".wrangler/logs/d1-probe-workers.log");

if (!packageManagerEntrypoint) {
    console.error("run this command through the pinned package manager: corepack pnpm d1-probe:build-local");
    process.exit(2);
}

if (process.argv.length !== 2) {
    console.error("usage: node scripts/d1-probe-workers.mjs");
    process.exit(2);
}

const workers = Object.freeze([
    Object.freeze({ name: "d1-probe-sink", config: "apps/d1-probe-sink/wrangler.local.jsonc" }),
    Object.freeze({ name: "d1-probe-writer-a", config: "apps/d1-probe-writer/wrangler.a.local.jsonc" }),
    Object.freeze({ name: "d1-probe-writer-b", config: "apps/d1-probe-writer/wrangler.b.local.jsonc" }),
]);

await mkdir(path.dirname(wranglerLogPath), { recursive: true });

for (const worker of workers) {
    const outputDirectory = path.resolve(".build", "d1-probe-workers", worker.name);
    const args = [
        packageManagerEntrypoint,
        "exec",
        "wrangler",
        "deploy",
        "--config",
        worker.config,
        "--dry-run",
        "--outdir",
        outputDirectory,
        "--metafile",
        path.join(outputDirectory, "bundle-meta.json"),
    ];
    const result = spawnSync(process.execPath, args, {
        env: {
            ...process.env,
            WRANGLER_LOG_PATH: wranglerLogPath,
            WRANGLER_SEND_METRICS: "false",
        },
        stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
