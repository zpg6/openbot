import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const excludedDirectories = new Set([".build", ".git", ".pnpm-store", ".wrangler", "coverage", "dist", "node_modules"]);
const excludedFiles = new Set(["pnpm-lock.yaml", "tests/fixtures/security/seeded-secret.txt"]);
const scannedExtensions = new Set([
    ".cjs",
    ".env",
    ".js",
    ".json",
    ".jsonc",
    ".md",
    ".mjs",
    ".toml",
    ".ts",
    ".txt",
    ".yaml",
    ".yml",
]);
const patterns = [
    {
        name: "private key",
        value: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
        sample: () => "-----BEGIN " + "PRIVATE KEY-----",
    },
    {
        name: "GitHub token",
        value: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u,
        sample: () => "ghp_" + "a".repeat(36),
    },
    {
        name: "AWS access key",
        value: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
        sample: () => "AKIA" + "A".repeat(16),
    },
    {
        name: "seeded OpenBot test secret",
        value: /\bob_test_seeded_secret_[a-f0-9]{32}\b/u,
        sample: () => "ob_test_seeded_secret_" + "a".repeat(32),
    },
    {
        name: "OpenRouter API key",
        value: /\bsk-or-v1-[a-f0-9]{64}\b/u,
        sample: () => "sk-or-v1-" + "a".repeat(64),
    },
    {
        name: "authorization bearer",
        value: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{20,}\b/iu,
        sample: () => "Authorization: Bearer " + "a".repeat(32),
    },
    {
        name: "bearer capability URL",
        value: /https:\/\/[^\s"']{0,256}[?&](?:access_token|api_key|key|secret|token)=[A-Za-z0-9._~-]{16,}/iu,
        sample: () => "https://mcp.invalid/session?token=" + "a".repeat(32),
    },
    {
        name: "Cloudflare API token assignment",
        value: /\bCLOUDFLARE_API_TOKEN\s*=\s*[A-Za-z0-9._~-]{20,}\b/u,
        sample: () => "CLOUDFLARE_API_TOKEN=" + "a".repeat(40),
    },
    {
        name: "Metorial secret assignment",
        value: /\bMETORIAL_(?:API_KEY|MANAGEMENT_KEY|MCP_TOKEN)\s*=\s*[A-Za-z0-9._~-]{20,}\b/u,
        sample: () => "METORIAL_API_KEY=" + "a".repeat(40),
    },
];

async function filesUnder(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = path.relative(process.cwd(), path.join(directory, entry.name));
        if (entry.isDirectory()) {
            if (!excludedDirectories.has(entry.name))
                files.push(...(await filesUnder(path.join(directory, entry.name))));
        } else if (!excludedFiles.has(relative) && scannedExtensions.has(path.extname(entry.name))) {
            files.push(relative);
        }
    }
    return files;
}

async function findingsFor(files) {
    const findings = [];
    for (const file of files) {
        const content = await readFile(file, "utf8");
        for (const pattern of patterns) {
            if (pattern.value.test(content)) findings.push(`${file}: ${pattern.name}`);
        }
    }
    return findings;
}

const seededFixture = "tests/fixtures/security/seeded-secret.txt";
for (const pattern of patterns) {
    if (!pattern.value.test(pattern.sample())) {
        console.error(`secret scanner self-test failed for ${pattern.name}`);
        process.exit(1);
    }
}
const seededFindings = await findingsFor([seededFixture]);
if (seededFindings.length !== 1) {
    console.error("secret scanner self-test did not detect the seeded fixture");
    process.exit(1);
}

const findings = await findingsFor(await filesUnder(process.cwd()));
if (findings.length > 0) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
} else {
    console.log("secret scan passed, including seeded-fixture self-test");
}
