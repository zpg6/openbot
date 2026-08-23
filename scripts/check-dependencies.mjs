import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const excludedDirectories = new Set([".build", ".git", ".pnpm-store", ".wrangler", "coverage", "dist", "node_modules"]);
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const errors = [];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

async function filesUnder(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await filesUnder(file)));
        else files.push(path.relative(process.cwd(), file));
    }
    return files;
}

function isExactDependency(value) {
    return value === "catalog:" || value === "workspace:*" || exactVersion.test(value);
}

function readCatalog(source) {
    const catalog = new Map();
    let inside = false;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
        if (line === "catalog:") {
            inside = true;
            continue;
        }
        if (!inside) continue;
        if (line.length > 0 && !line.startsWith(" ")) break;
        if (line.trim().length === 0) continue;
        const match = /^ {4}(?:"([^"]+)"|([@A-Za-z0-9/_.-]+)):\s+([0-9A-Za-z.-]+)$/u.exec(line);
        if (!match) {
            errors.push(`pnpm-workspace.yaml:${index + 1}: invalid catalog entry`);
            continue;
        }
        catalog.set(match[1] ?? match[2], match[3]);
    }
    if (catalog.size === 0) errors.push("pnpm-workspace.yaml: catalog must not be empty");
    return catalog;
}

function checkCatalog(catalog) {
    for (const [name, version] of catalog) {
        if (!exactVersion.test(version)) errors.push(`pnpm-workspace.yaml: catalog.${name} must use an exact version`);
    }
}

function checkManifest(file, manifest, catalog) {
    for (const field of dependencyFields) {
        for (const [name, value] of Object.entries(manifest[field] ?? {})) {
            if (name === "@cloudflare/sandbox") {
                errors.push(`${file}: @cloudflare/sandbox is deferred until its adoption gate passes`);
            }
            if (typeof value !== "string" || !isExactDependency(value)) {
                errors.push(`${file}: ${field}.${name} must use an exact version, catalog:, or workspace:`);
            } else if (value === "catalog:" && !catalog.has(name)) {
                errors.push(`${file}: ${field}.${name} is missing from the workspace catalog`);
            }
        }
    }
}

const workspaceCatalog = readCatalog(await readFile("pnpm-workspace.yaml", "utf8"));
checkCatalog(workspaceCatalog);
const files = await filesUnder(process.cwd());
for (const file of files.filter(file => path.basename(file) === "package.json")) {
    checkManifest(file, JSON.parse(await readFile(file, "utf8")), workspaceCatalog);
}

const intentionallyUnpinned = { dependencies: { example: "^1.0.0" } };
const beforeSelfTest = errors.length;
checkManifest("<self-test>", intentionallyUnpinned, workspaceCatalog);
if (errors.length !== beforeSelfTest + 1) {
    errors.push("dependency pinning self-test did not reject a range");
}
errors.splice(beforeSelfTest, 1);

const beforeCatalogSelfTest = errors.length;
checkCatalog(new Map([["example", "^1.0.0"]]));
if (errors.length !== beforeCatalogSelfTest + 1) {
    errors.push("catalog pinning self-test did not reject a range");
}
errors.splice(beforeCatalogSelfTest, 1);

const forbiddenFiles = files.filter(file => /(?:entry\.(?:mysql|postgres)\.ts|artifact-gateway)/u.test(file));
for (const file of forbiddenFiles) errors.push(`${file}: deferred profile or artifact entrypoint exists`);

for (const file of files.filter(file => sourceExtensions.has(path.extname(file)))) {
    const content = await readFile(file, "utf8");
    const imports = [...content.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/gu)].map(match => match[1]);
    for (const specifier of imports) {
        if (file.startsWith("apps/control-plane/") && specifier === "@openbot/contracts/internal") {
            errors.push(`${file}: the public control plane may import only route-safe OpenBot contracts`);
        }
        if (
            specifier === "@openbot/gate-evidence/internal" &&
            !file.startsWith("packages/gate-evidence/") &&
            !file.startsWith("packages/gate-attestation/")
        ) {
            errors.push(`${file}: untrusted probe reports cannot enter application authority code`);
        }
        if (
            specifier === "@openbot/gate-attestation/internal" &&
            !file.startsWith("packages/gate-attestation/") &&
            file !== "tests/workers/gate-attestation.test.ts"
        ) {
            errors.push(`${file}: verified gate decisions may enter only an explicitly reviewed authority boundary`);
        }
        if (
            specifier === "@openbot/gate-attestation/bootstrap" &&
            !file.startsWith("packages/gate-attestation/") &&
            file !== "tests/workers/gate-attestation.test.ts"
        ) {
            errors.push(`${file}: the operator trust registry may be loaded only at the reviewed bootstrap boundary`);
        }
        if (specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/")) {
            const allowedD1Imports = new Set([
                "drizzle-orm/d1/driver",
                "drizzle-orm/sql/sql",
                "drizzle-orm/sqlite-core",
            ]);
            if (!file.startsWith("packages/db-d1/") || !allowedD1Imports.has(specifier)) {
                errors.push(`${file}: only packages/db-d1 may import the D1 Drizzle driver and SQL builder`);
            }
        }
        if (/^(?:mysql2|pg|postgres|@metorial\/|@cloudflare\/sandbox|openai$)/u.test(specifier)) {
            errors.push(`${file}: deferred database or vendor dependency imported: ${specifier}`);
        }
    }

    if (
        (file.startsWith("apps/") || file.startsWith("packages/")) &&
        !file.startsWith("packages/db-d1/") &&
        /\bD1DatabaseClient\b/u.test(content)
    ) {
        errors.push(`${file}: raw D1 or Drizzle client escaped packages/db-d1`);
    }
}

if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
} else {
    console.log("dependency pins and D1-only import boundaries passed");
}
