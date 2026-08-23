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
            if (name === "@openbot/d1-probes" && !file.startsWith("packages/d1-probes/")) {
                errors.push(`${file}: disposable D1 probe code cannot be a product or authority dependency`);
            }
            if (name === "@openbot/gate-signer" && !file.startsWith("packages/gate-signer/")) {
                errors.push(`${file}: offline gate signing code cannot be a product or Worker dependency`);
            }
            if (name === "@openbot/d1-probe-operator" && !file.startsWith("packages/d1-probe-operator/")) {
                errors.push(`${file}: D1 probe operator code cannot be a product or Worker dependency`);
            }
            if (typeof value !== "string" || !isExactDependency(value)) {
                errors.push(`${file}: ${field}.${name} must use an exact version, catalog:, or workspace:`);
            } else if (value === "catalog:" && !catalog.has(name)) {
                errors.push(`${file}: ${field}.${name} is missing from the workspace catalog`);
            }
        }
    }
}

function checkD1ProbeImportBoundary(file, specifier) {
    if (file.startsWith("packages/d1-probes/")) return;
    const packageImport = specifier === "@openbot/d1-probes" || specifier.startsWith("@openbot/d1-probes/");
    const relativeImport = specifier.startsWith(".");
    const resolvedImport = relativeImport ? path.resolve(path.dirname(file), specifier) : null;
    const probeRoot = path.resolve("packages/d1-probes");
    const resolvesIntoProbePackage =
        resolvedImport !== null &&
        (resolvedImport === probeRoot || resolvedImport.startsWith(`${probeRoot}${path.sep}`));
    if (packageImport || resolvesIntoProbePackage) {
        errors.push(`${file}: disposable D1 probe operations cannot enter product or authority code`);
    }
}

function checkGateSignerImportBoundary(file, specifier) {
    if (file.startsWith("packages/gate-signer/")) return;
    const packageImport = specifier === "@openbot/gate-signer" || specifier.startsWith("@openbot/gate-signer/");
    const resolvedImport = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    const signerRoot = path.resolve("packages/gate-signer");
    const resolvesIntoSigner =
        resolvedImport !== null &&
        (resolvedImport === signerRoot || resolvedImport.startsWith(`${signerRoot}${path.sep}`));
    if (packageImport || resolvesIntoSigner) {
        errors.push(`${file}: offline private-key signing code cannot enter product, authority, or Worker code`);
    }
}

function checkD1ProbeOperatorImportBoundary(file, specifier) {
    if (file.startsWith("packages/d1-probe-operator/")) return;
    const packageImport =
        specifier === "@openbot/d1-probe-operator" || specifier.startsWith("@openbot/d1-probe-operator/");
    const resolvedImport = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    const operatorRoot = path.resolve("packages/d1-probe-operator");
    const resolvesIntoOperator =
        resolvedImport !== null &&
        (resolvedImport === operatorRoot || resolvedImport.startsWith(`${operatorRoot}${path.sep}`));
    if (packageImport || resolvesIntoOperator) {
        errors.push(`${file}: D1 probe resource and cleanup code cannot enter product, authority, or Worker code`);
    }
}

function checkD1ProbeOperatorNetworkBoundary(file, content, imports) {
    if (!file.startsWith("packages/d1-probe-operator/")) return;
    const forbiddenImport = imports.find(specifier =>
        /^(?:node:)?(?:dgram|dns|http|http2|https|net|tls)$|^(?:undici|wrangler)$/u.test(specifier)
    );
    if (forbiddenImport !== undefined || /\bfetch\s*\(/u.test(content)) {
        errors.push(`${file}: D1 probe preflight and lifecycle code must remain network-free`);
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

const beforeProbeManifestSelfTest = errors.length;
checkManifest(
    "apps/<self-test>/package.json",
    { dependencies: { "@openbot/d1-probes": "workspace:*" } },
    workspaceCatalog
);
if (errors.length !== beforeProbeManifestSelfTest + 1) {
    errors.push("D1 probe manifest-boundary self-test did not reject a product dependency");
}
errors.splice(beforeProbeManifestSelfTest, 1);

const beforeProbeImportSelfTest = errors.length;
checkD1ProbeImportBoundary("apps/<self-test>/entry.ts", "../../packages/d1-probes/src/protocol.ts");
if (errors.length !== beforeProbeImportSelfTest + 1) {
    errors.push("D1 probe import-boundary self-test did not reject a relative product import");
}
errors.splice(beforeProbeImportSelfTest, 1);

const beforeSignerManifestSelfTest = errors.length;
checkManifest(
    "apps/<self-test>/package.json",
    { dependencies: { "@openbot/gate-signer": "workspace:*" } },
    workspaceCatalog
);
if (errors.length !== beforeSignerManifestSelfTest + 1) {
    errors.push("gate signer manifest-boundary self-test did not reject a product dependency");
}
errors.splice(beforeSignerManifestSelfTest, 1);

const beforeSignerImportSelfTest = errors.length;
checkGateSignerImportBoundary("apps/<self-test>/entry.ts", "../../packages/gate-signer/src/sign.ts");
if (errors.length !== beforeSignerImportSelfTest + 1) {
    errors.push("gate signer import-boundary self-test did not reject a relative product import");
}
errors.splice(beforeSignerImportSelfTest, 1);

const beforeOperatorManifestSelfTest = errors.length;
checkManifest(
    "apps/<self-test>/package.json",
    { dependencies: { "@openbot/d1-probe-operator": "workspace:*" } },
    workspaceCatalog
);
if (errors.length !== beforeOperatorManifestSelfTest + 1) {
    errors.push("D1 probe operator manifest-boundary self-test did not reject a product dependency");
}
errors.splice(beforeOperatorManifestSelfTest, 1);

const beforeOperatorImportSelfTest = errors.length;
checkD1ProbeOperatorImportBoundary("apps/<self-test>/entry.ts", "../../packages/d1-probe-operator/src/lifecycle.ts");
if (errors.length !== beforeOperatorImportSelfTest + 1) {
    errors.push("D1 probe operator import-boundary self-test did not reject a relative product import");
}
errors.splice(beforeOperatorImportSelfTest, 1);

const beforeOperatorNetworkSelfTest = errors.length;
checkD1ProbeOperatorNetworkBoundary("packages/d1-probe-operator/<self-test>.ts", 'import "node:https";', [
    "node:https",
]);
if (errors.length !== beforeOperatorNetworkSelfTest + 1) {
    errors.push("D1 probe operator network-boundary self-test did not reject a network import");
}
errors.splice(beforeOperatorNetworkSelfTest, 1);

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
            !file.startsWith("packages/gate-attestation/") &&
            !file.startsWith("packages/gate-signer/")
        ) {
            errors.push(`${file}: untrusted probe reports cannot enter application authority code`);
        }
        if (
            specifier === "@openbot/gate-attestation/internal" &&
            !file.startsWith("packages/gate-attestation/") &&
            !file.startsWith("packages/gate-signer/") &&
            !file.startsWith("packages/d1-probe-operator/") &&
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
        checkD1ProbeImportBoundary(file, specifier);
        checkGateSignerImportBoundary(file, specifier);
        checkD1ProbeOperatorImportBoundary(file, specifier);
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
    checkD1ProbeOperatorNetworkBoundary(file, content, imports);

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
