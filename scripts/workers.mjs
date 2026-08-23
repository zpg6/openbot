import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { workerDeploymentOrder } from "./workers-config.mjs";

const [command, environment = "preview"] = process.argv.slice(2);
const packageManagerEntrypoint = process.env.npm_execpath;
const wranglerLogPath = process.env["WRANGLER_LOG_PATH"] ?? path.resolve(".wrangler/logs/workers.log");

if (!packageManagerEntrypoint) {
    console.error("run this command through the pinned package manager: corepack pnpm <script>");
    process.exit(2);
}

await mkdir(path.dirname(wranglerLogPath), { recursive: true });

if (!new Set(["deploy", "dry-run", "typegen"]).has(command)) {
    console.error("usage: node scripts/workers.mjs <deploy|dry-run|typegen> [preview|production]");
    process.exit(2);
}

if (!new Set(["preview", "production"]).has(environment)) {
    console.error(`unsupported environment: ${environment}`);
    process.exit(2);
}

for (const worker of workerDeploymentOrder) {
    const outputDirectory = path.resolve(".build", "workers", worker.name);
    if (command === "deploy") {
        const content = await readFile(worker.config, "utf8");
        if (content.includes("REPLACE_WITH_")) {
            console.error(`${worker.config}: replace every placeholder before deployment`);
            process.exit(1);
        }
    }

    const args = [packageManagerEntrypoint, "exec", "wrangler"];
    if (command === "typegen") {
        args.push(
            "types",
            `apps/${worker.name}/worker-configuration.d.ts`,
            "--config",
            worker.config,
            "--env",
            environment,
            "--include-runtime",
            "false"
        );
    } else {
        args.push("deploy", "--config", worker.config, "--env", environment);
        if (command === "dry-run") {
            args.push(
                "--dry-run",
                "--outdir",
                outputDirectory,
                "--metafile",
                path.join(outputDirectory, "bundle-meta.json")
            );
        }
    }

    const result = spawnSync(process.execPath, args, {
        env: {
            ...process.env,
            WRANGLER_LOG_PATH: wranglerLogPath,
            WRANGLER_SEND_METRICS: "false",
        },
        stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);

    if (command === "dry-run") {
        const metadata = JSON.parse(await readFile(path.join(outputDirectory, "bundle-meta.json"), "utf8"));
        const inputs = Object.values(metadata.outputs ?? {}).flatMap(output =>
            Object.entries(output.inputs ?? {})
                .filter(([, usage]) => usage.bytesInOutput > 0)
                .map(([input]) => input)
        );
        const forbidden = inputs.filter(input =>
            /(?:artifact-gateway|drizzle-orm\/(?:aws-data-api\/pg|bun-sql|mysql2|neon|node-postgres|pglite|planetscale-serverless|postgres-js|singlestore|tidb-serverless)|node_modules\/(?:mysql2|pg|postgres)\/)/u.test(
                input
            )
        );
        const drizzleInputs = inputs.filter(input => input.includes("node_modules/drizzle-orm/"));

        if (forbidden.length > 0) {
            console.error(`${worker.name} bundle contains deferred inputs:\n${forbidden.join("\n")}`);
            process.exit(1);
        }
        if (worker.name !== "control-plane" && drizzleInputs.length > 0) {
            console.error(`${worker.name} bundle unexpectedly contains Drizzle inputs:\n${drizzleInputs.join("\n")}`);
            process.exit(1);
        }
    }
}
