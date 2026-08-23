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
    { name: "private key", value: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u },
    { name: "GitHub token", value: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u },
    { name: "AWS access key", value: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
    { name: "seeded OpenBot test secret", value: /\bob_test_seeded_secret_[a-f0-9]{32}\b/u },
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
