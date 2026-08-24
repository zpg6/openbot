import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const excludedDirectories = new Set([".build", ".git", ".pnpm-store", ".wrangler", "coverage", "dist", "node_modules"]);
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const errors = [];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function importsFromSource(content) {
    return [...content.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)(["'])([^"']+)\1/gu)].map(match => match[2]);
}

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
            if (name === "@openbot/d1-probe-driver" && !file.startsWith("packages/d1-probe-driver/")) {
                errors.push(`${file}: D1 probe network driver cannot be a product, authority, or Worker dependency`);
            }
            if (
                name === "@openbot/d1-probe-rpc" &&
                !file.startsWith("packages/d1-probe-rpc/") &&
                !file.startsWith("packages/d1-probes/") &&
                !file.startsWith("packages/d1-probe-operator/") &&
                !file.startsWith("packages/d1-probe-driver/") &&
                !file.startsWith("apps/d1-probe-sink/") &&
                !file.startsWith("apps/d1-probe-writer/")
            ) {
                errors.push(`${file}: D1 probe RPC code cannot enter product or authority packages`);
            }
            if (
                (name === "@openbot/d1-probe-sink" || name === "@openbot/d1-probe-writer") &&
                !file.startsWith("apps/d1-probe-sink/") &&
                !file.startsWith("apps/d1-probe-writer/")
            ) {
                errors.push(`${file}: D1 probe Worker code cannot enter product or authority packages`);
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
    const networkCall = /(?:\bfetch|\.fetch)\s*\(/u.test(content);
    const isReviewedAdapter = [
        "packages/d1-probe-operator/src/cloudflare-database-bootstrap.ts",
        "packages/d1-probe-operator/src/cloudflare-database.ts",
        "packages/d1-probe-operator/src/cloudflare-route-reader.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.test.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-canary-transport.ts",
    ].includes(file);
    if (forbiddenImport !== undefined || (networkCall && !isReviewedAdapter)) {
        errors.push(`${file}: only reviewed Cloudflare adapters may perform operator network I/O`);
    }
}

function checkD1ProbeWorkerArtifactCandidateBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/worker-artifact.ts") return;
    if (imports.some(specifier => specifier.startsWith("node:"))) {
        errors.push(`${file}: the Worker artifact candidate compiler must not import Node capabilities`);
    }
    if (/\b(?:fetch|FormData|process|spawn|readFile|writeFile)\b/u.test(content)) {
        errors.push(`${file}: the Worker artifact candidate compiler must remain pure`);
    }
    if (
        /eligible_for_upload:\s*true|deployment_ready:\s*true|resolveD1ProbeWorkerArtifact|new\s+WeakMap/u.test(content)
    ) {
        errors.push(`${file}: an untrusted Worker artifact candidate cannot mint upload authority`);
    }
}

function checkD1ProbeWorkerVersionContractImportBoundary(file, specifier) {
    if (!specifier.startsWith(".")) return;
    const resolvedImport = path.resolve(path.dirname(file), specifier).replace(/\.(?:js|ts)$/u, "");
    const contractModule = path.resolve("packages/d1-probe-operator/src/worker-version-contract");
    if (resolvedImport !== contractModule) return;
    const reviewedConsumers = new Set([
        "packages/d1-probe-operator/src/cloudflare-worker-protocol.test.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-protocol.ts",
        "packages/d1-probe-operator/src/worker-artifact.ts",
        "packages/d1-probe-operator/src/worker-version-contract.test.ts",
    ]);
    if (!reviewedConsumers.has(file)) {
        errors.push(`${file}: raw beta Worker Version bodies may enter only reviewed digest compilers and tests`);
    }
}

function checkD1ProbeWorkerCanaryTransportImportBoundary(file, specifier) {
    if (!specifier.startsWith(".")) return;
    const resolvedImport = path.resolve(path.dirname(file), specifier).replace(/\.(?:js|ts)$/u, "");
    const transportModule = path.resolve("packages/d1-probe-operator/src/cloudflare-worker-canary-transport");
    if (resolvedImport !== transportModule) return;
    const reviewedConsumers = new Set([
        "packages/d1-probe-operator/src/cloudflare-worker-canary-transport.test.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.test.ts",
        "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.ts",
    ]);
    if (!reviewedConsumers.has(file)) {
        errors.push(`${file}: Worker API canary transport may enter only its reviewed runner and tests`);
    }
}

function checkD1ProbeWorkerApiCanaryBoundary(file, content, imports) {
    const reviewedCanaryImports = new Map([
        [
            "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.ts",
            new Set(["./cloudflare-worker-canary-transport.js", "./contracts.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.test.ts",
            new Set(["./cloudflare-worker-canary-transport.js", "./cloudflare-worker-interoperability-canary.js"]),
        ],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-transport.ts", new Set()],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-transport.test.ts",
            new Set(["./cloudflare-worker-canary-transport.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-command.ts",
            new Set([
                "./cloudflare-worker-interoperability-canary.js",
                "./cloudflare-worker-canary-reservation.js",
                "./contracts.js",
            ]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-command.test.ts",
            new Set(["./cloudflare-worker-canary-command.js"]),
        ],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-cli.ts", new Set()],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-cli.test.ts", new Set()],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-reservation.ts", new Set()],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-reservation.test.ts",
            new Set(["./cloudflare-worker-canary-reservation.js"]),
        ],
        ["packages/d1-probe-operator/src/contracts.ts", new Set()],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-plan.ts",
            new Set(["./cloudflare-worker-interoperability-canary.js", "./contracts.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-plan.test.ts",
            new Set(["./cloudflare-worker-canary-command.js", "./cloudflare-worker-canary-plan.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-review.ts",
            new Set(["./cloudflare-worker-interoperability-canary.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-review.test.ts",
            new Set(["./cloudflare-worker-canary-review.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-plan-cli.ts",
            new Set(["./cloudflare-worker-canary-plan.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-plan-cli.test.ts",
            new Set(["./cloudflare-worker-interoperability-canary.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-recovery-inspect-cli.ts",
            new Set(["./cloudflare-worker-canary-state.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-recovery-inspect-cli.test.ts",
            new Set([
                "./cloudflare-worker-canary-operation.js",
                "./cloudflare-worker-canary-plan.js",
                "./cloudflare-worker-canary-state.js",
            ]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.ts",
            new Set([
                "./cloudflare-worker-interoperability-canary.js",
                "./cloudflare-worker-canary-operation.js",
                "./cloudflare-worker-canary-state.js",
                "./contracts.js",
            ]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.test.ts",
            new Set([
                "./cloudflare-worker-canary-cleanup.js",
                "./cloudflare-worker-canary-operation.js",
                "./cloudflare-worker-canary-state.js",
            ]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-operation.ts",
            new Set(["./cloudflare-worker-interoperability-canary.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-operation.test.ts",
            new Set(["./cloudflare-worker-canary-operation.js", "./cloudflare-worker-canary-plan.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-state.ts",
            new Set(["./cloudflare-worker-canary-operation.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-state.test.ts",
            new Set([
                "./cloudflare-worker-canary-operation.js",
                "./cloudflare-worker-canary-plan.js",
                "./cloudflare-worker-canary-state.js",
            ]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.ts",
            new Set(["./cloudflare-worker-canary-operation.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.test.ts",
            new Set(["./cloudflare-worker-canary-effect-journal.js"]),
        ],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease.ts", new Set()],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease.test.ts",
            new Set(["./cloudflare-worker-canary-driver-lease.js"]),
        ],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-projection.ts", new Set()],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-projection.test.ts",
            new Set(["./cloudflare-worker-canary-projection.js"]),
        ],
    ]);
    const allowedRelativeImports = reviewedCanaryImports.get(file);
    if (allowedRelativeImports === undefined) return;
    const unexpectedRelativeImport = imports.find(
        specifier => specifier.startsWith(".") && !allowedRelativeImports.has(specifier)
    );
    if (unexpectedRelativeImport !== undefined) {
        errors.push(`${file}: the isolated Worker API canary may import only its reviewed local closure`);
    }
    const forbiddenImport = imports.find(specifier =>
        /(?:^|\/)(?:lifecycle|worker-artifact|cloudflare-worker-protocol)(?:\.js)?$|^@openbot\/(?:d1-probe-driver|d1-probe-rpc|d1-probe-sink|d1-probe-writer|gate-signer)(?:\/|$)/u.test(
            specifier
        )
    );
    if (forbiddenImport !== undefined) {
        errors.push(`${file}: the isolated Worker API canary cannot enter production upload or lifecycle code`);
    }
    if (
        /\badvanceD1ProbeLifecycle|eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true|runtime_identity_verified:\s*true/u.test(
            content
        )
    ) {
        errors.push(
            `${file}: the isolated Worker API canary cannot claim runtime, attestation, lifecycle, or gate authority`
        );
    }
}

function checkD1ProbePureTransformBoundary(file, content, imports) {
    const pureTransforms = new Map([
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-plan.ts",
            new Set([
                "zod",
                "@openbot/gate-attestation/internal",
                "./cloudflare-worker-interoperability-canary.js",
                "./contracts.js",
            ]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-review.ts",
            new Set(["zod", "@openbot/gate-attestation/internal", "./cloudflare-worker-interoperability-canary.js"]),
        ],
        [
            "packages/d1-probe-operator/src/cloudflare-worker-canary-operation.ts",
            new Set(["zod", "@openbot/gate-attestation/internal", "./cloudflare-worker-interoperability-canary.js"]),
        ],
        ["packages/d1-probe-operator/src/cloudflare-worker-canary-projection.ts", new Set(["zod"])],
        [
            "packages/d1-probe-operator/src/worker-version-contract.ts",
            new Set(["@openbot/gate-attestation/internal", "./contracts.js"]),
        ],
    ]);
    const allowedRelativeImports = pureTransforms.get(file);
    if (allowedRelativeImports === undefined) return;
    const unexpectedImport = imports.find(specifier => !allowedRelativeImports.has(specifier));
    if (unexpectedImport !== undefined) {
        errors.push(`${file}: offline D1 probe transforms may import only their reviewed dependency closure`);
    }
    const nodeCapabilityImport = imports.find(specifier =>
        /^(?:node:)?(?:assert|async_hooks|buffer|child_process|cluster|console|crypto|dgram|diagnostics_channel|dns|events|fs(?:\/promises)?|http|http2|https|module|net|os|path|perf_hooks|process|readline|repl|stream|timers|tls|tty|url|util|v8|vm|wasi|worker_threads|zlib)$/u.test(
            specifier
        )
    );
    if (nodeCapabilityImport !== undefined) {
        errors.push(`${file}: offline D1 probe transforms must not import Node capabilities`);
    }
    if (
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|process|spawn|readFile|writeFile|openSync|writeSync|execFile|createReadStream|createWriteStream)\b/u.test(
            content
        )
    ) {
        errors.push(`${file}: offline D1 probe transforms must remain pure`);
    }
    if (
        /eligible_for_upload:\s*true|mutation_allowed:\s*true|lifecycle_advance_allowed:\s*true|eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(`${file}: offline D1 probe transforms cannot mint mutation or authority`);
    }
}

function checkD1ProbeCanaryPlanCliBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-plan-cli.ts") return;
    const allowedImports = new Set([
        "node:crypto",
        "node:fs",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-canary-plan.js",
    ]);
    if (
        imports.some(specifier => !allowedImports.has(specifier)) ||
        imports.some(specifier => /^(?:node:)?(?:http|http2|https|net|tls|child_process)$/u.test(specifier)) ||
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|process\.env|execFile|spawn|readFile|writeFile|openSync)\b/u.test(
            content
        )
    ) {
        errors.push(`${file}: the canary plan CLI may only read canonical stdin and secret file descriptor 3`);
    }
    const secretDescriptorArguments = [...content.matchAll(/\breadSecret\(\s*([^,\n]+)/gu)].map(match =>
        match[1]?.trim()
    );
    if (secretDescriptorArguments.length !== 1 || secretDescriptorArguments[0] !== "3") {
        errors.push(`${file}: the canary plan CLI must read its only secret from file descriptor 3`);
    }
    if (
        /eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true|lifecycle_advance_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(`${file}: the canary plan CLI cannot mint authority`);
    }
}

function checkD1ProbeCanaryCleanupBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.ts") return;
    const allowedImports = new Set([
        "zod",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-interoperability-canary.js",
        "./cloudflare-worker-canary-operation.js",
        "./cloudflare-worker-canary-state.js",
        "./contracts.js",
    ]);
    const requiredImports = ["./cloudflare-worker-canary-operation.js", "./cloudflare-worker-canary-state.js"];
    if (
        requiredImports.some(specifier => !imports.includes(specifier)) ||
        imports.some(specifier => !allowedImports.has(specifier))
    ) {
        errors.push(`${file}: canary cleanup must use the reviewed durable delete fence`);
    }
    const requestMethods = [...content.matchAll(/\brequestJson\(\s*([^,\n]+)/gu)].map(match => match[1]?.trim());
    const directFetchCount = [...content.matchAll(/\bdependencies\.fetch\s*\(/gu)].length;
    if (
        !content.includes('const API_ROOT_V1 = "https://api.cloudflare.com/client/v4"') ||
        directFetchCount !== 1 ||
        requestMethods.some(method => method !== '"GET"' && method !== '"DELETE"') ||
        /method:\s*"(?:POST|PUT|PATCH)"|requestJson\("(?:POST|PUT|PATCH)"/u.test(content) ||
        /\bforce\s*[:=]\s*true\b/u.test(content)
    ) {
        errors.push(`${file}: canary cleanup is limited to fixed Cloudflare GET and DELETE requests`);
    }
    if (
        /eligible_for_upload:\s*true|eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true|lifecycle_advance_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(`${file}: canary cleanup cannot mint upload, lifecycle, attestation, or gate authority`);
    }
}

function checkD1ProbeCanaryTransportBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-transport.ts") return;
    const allowedImports = new Set(["@openbot/gate-attestation/internal"]);
    const directFetchCount = [...content.matchAll(/\bdependencies\.fetch\s*\(/gu)].length;
    const returnedCapabilities = content.slice(content.lastIndexOf("return {"));
    const capabilityMethods = capability => {
        const match = new RegExp(`${capability}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`, "u").exec(returnedCapabilities);
        return match === null
            ? null
            : [...match[1].matchAll(/^\s*([A-Za-z_$][A-Za-z0-9_$]*):/gmu)].map(method => method[1]);
    };
    if (
        imports.some(specifier => !allowedImports.has(specifier)) ||
        directFetchCount !== 1 ||
        !content.includes('const API_ROOT_V1 = "https://api.cloudflare.com/client/v4"') ||
        !content.includes(
            'const REQUEST_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-request.v1"'
        ) ||
        !content.includes("const MAX_RESPONSE_BYTES_V1 = 256 * 1024") ||
        !content.includes("const MAX_AGGREGATE_RESPONSE_BYTES_V1 = 2 * 1024 * 1024") ||
        !content.includes("const MAX_REQUEST_DURATION_MS_V1 = 20_000") ||
        !content.includes("digestCanonicalJsonV1(") ||
        !content.includes("canonicalizeJsonV1(body)") ||
        !content.includes("response_digest: await sha256(bytes)") ||
        !content.includes('redirect: "manual"') ||
        !content.includes('"Accept-Encoding": "identity"') ||
        JSON.stringify(capabilityMethods("forward")) !== JSON.stringify(["get", "post"]) ||
        JSON.stringify(capabilityMethods("cleanup")) !== JSON.stringify(["get", "delete"]) ||
        /\b(?:FormData|WebSocket|EventSource|XMLHttpRequest|child_process|spawn|execFile|process\.env)\b/u.test(
            content
        ) ||
        /eligible_for_upload:\s*true|eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true|lifecycle_advance_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(`${file}: canary transport must remain fixed, bounded, redacted, and capability-separated`);
    }
}

function checkD1ProbeCanaryDisabledCliBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-cli.ts") return;
    if (
        imports.length !== 0 ||
        !content.includes('const DISABLED_CODE_V1 = "worker_api_canary_disabled"') ||
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|readSecret|fstatSync|readSync|closeSync|executeD1ProbeCloudflareWorkerCanaryCommandV1|process\.env)\b/u.test(
            content
        )
    ) {
        errors.push(`${file}: the unregistered credentialed canary CLI must remain a fail-closed stub`);
    }
}

function checkD1ProbeCanaryRecoveryInspectorBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-recovery-inspect-cli.ts") return;
    const allowedImports = new Set([
        "zod",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-canary-state.js",
    ]);
    if (
        !imports.includes("./cloudflare-worker-canary-state.js") ||
        imports.some(specifier => !allowedImports.has(specifier)) ||
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|spawn|execFile|readSecret|fstatSync|readSync|closeSync)\b/u.test(
            content
        ) ||
        /process\.env|Authorization|Bearer|CLOUDFLARE_API_TOKEN|cloudflare-worker-canary-(?:cleanup|command)/u.test(
            content
        ) ||
        /delete_replay_allowed:\s*true|manual_cleanup_executable:\s*true|secure_secret_fd_launcher_available:\s*true|caller_mutation_authority:\s*true|eligible_for_upload:\s*true|eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true|lifecycle_advance_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(
            `${file}: the recovery inspector must remain local, read-only, credential-free, and non-authoritative`
        );
    }
}

function checkD1ProbeCanaryStateBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-state.ts") return;
    const allowedImports = new Set([
        "node:fs",
        "node:crypto",
        "node:fs/promises",
        "node:path",
        "node:url",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-canary-operation.js",
    ]);
    if (
        imports.some(specifier => !allowedImports.has(specifier)) ||
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|child_process|spawn|execFile|process\.env)\b/u.test(
            content
        ) ||
        /eligible_for_attestation:\s*true|gate_promotion_allowed:\s*true|lifecycle_advance_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(`${file}: canary state may use only its fixed private filesystem contract`);
    }
}

function checkD1ProbeCanaryEffectJournalBoundary(file, content, imports) {
    if (file !== "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.ts") return;
    const allowedImports = new Set([
        "node:fs",
        "node:crypto",
        "node:fs/promises",
        "node:path",
        "node:url",
        "zod",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-canary-operation.js",
    ]);
    const parseStringArrayTable = tableName => {
        const table = new RegExp(`const ${tableName} = \\{([\\s\\S]*?)\\n\\} as const;`, "u").exec(content)?.[1];
        if (table === undefined) return null;
        return Object.fromEntries(
            [...table.matchAll(/^\s*([a-z_]+):\s*\[([\s\S]*?)\](?:,|$)/gmu)].map(match => [
                match[1],
                [...(match[2] ?? "").matchAll(/"([a-z_]+)"/gu)].map(value => value[1]),
            ])
        );
    };
    const expectedWorkflowTransitions = {
        prepared_worker_list: ["prepared_worker_list", "shell_create"],
        shell_create: [
            "shell_dispatch_reconciliation",
            "shell_readback",
            "cleanup_worker_list",
            "cleanup_worker_readback",
        ],
        shell_dispatch_reconciliation: [
            "shell_dispatch_reconciliation",
            "shell_readback",
            "cleanup_worker_list",
            "cleanup_worker_readback",
        ],
        shell_readback: ["shell_readback", "version_create", "cleanup_worker_list", "cleanup_worker_readback"],
        version_create: [
            "version_dispatch_reconciliation",
            "version_readback",
            "cleanup_worker_list",
            "cleanup_worker_readback",
        ],
        version_dispatch_reconciliation: [
            "version_dispatch_reconciliation",
            "version_readback",
            "cleanup_worker_list",
            "cleanup_worker_readback",
        ],
        version_readback: ["version_readback", "deployment_create", "cleanup_worker_list", "cleanup_worker_readback"],
        deployment_create: [
            "deployment_dispatch_reconciliation",
            "deployment_readback",
            "cleanup_worker_list",
            "cleanup_worker_readback",
        ],
        deployment_dispatch_reconciliation: [
            "deployment_dispatch_reconciliation",
            "deployment_readback",
            "cleanup_worker_list",
            "cleanup_worker_readback",
        ],
        deployment_readback: ["deployment_readback", "cleanup_worker_list", "cleanup_worker_readback"],
        cleanup_worker_list: ["cleanup_worker_list", "cleanup_worker_readback"],
        cleanup_worker_readback: ["delete_worker"],
        delete_worker: ["deleted_worker_readback"],
        deleted_worker_readback: ["deleted_worker_list"],
        deleted_worker_list: ["deleted_worker_list"],
    };
    const expectedOperationStateTransitions = {
        prepared: ["shell_dispatching", "cleanup_reconciling"],
        shell_dispatching: ["shell_identified", "cleanup_reconciling"],
        shell_identified: ["version_dispatching", "cleanup_reconciling"],
        version_dispatching: ["version_identified", "cleanup_reconciling"],
        version_identified: ["deployment_dispatching", "cleanup_reconciling"],
        deployment_dispatching: ["deployment_identified", "cleanup_reconciling"],
        deployment_identified: ["cleanup_reconciling"],
        cleanup_reconciling: ["delete_dispatching"],
        delete_dispatching: [],
        absence_observed: [],
        manual_required: [],
    };
    if (
        imports.some(specifier => !allowedImports.has(specifier)) ||
        !content.includes(
            'const CLAIM_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-effect-claim.v1"'
        ) ||
        !content.includes('"openbot.d1-probe.cloudflare-worker-api-canary-execution-nonce-commitment.v1"') ||
        !content.includes('"openbot.d1-probe.cloudflare-worker-api-canary-operation-record.v1"') ||
        !content.includes('"d1-probe-canary-effect-journal"') ||
        !content.includes("const MAX_CLAIM_BYTES_V1 = 32 * 1024") ||
        !content.includes("const MAX_JOURNAL_REVISIONS_V1 = 256") ||
        !content.includes("canonicalizeJsonV1(claim as CanonicalJsonValueV1)") ||
        !content.includes("await handle.sync()") ||
        !content.includes("await link(tempPath, finalPath)") ||
        !content.includes("await syncDirectory(root)") ||
        !content.includes("constants.O_NOFOLLOW") ||
        !content.includes("tempStat.dev === finalStat.dev") ||
        !content.includes("tempStat.ino === finalStat.ino") ||
        !content.includes("[89ab][0-9a-f]{3}") ||
        !content.includes("const workflowBindings = {") ||
        JSON.stringify(parseStringArrayTable("workflowTransitions")) !== JSON.stringify(expectedWorkflowTransitions) ||
        JSON.stringify(parseStringArrayTable("operationStateTransitions")) !==
            JSON.stringify(expectedOperationStateTransitions) ||
        !content.includes('claim.workflow_step !== "prepared_worker_list"') ||
        !content.includes("claim.operation_revision !== 0") ||
        !content.includes('claim.operation_state !== "prepared"') ||
        !content.includes("operation_record_digest: DigestV1Schema") ||
        !content.includes("request_method: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema") ||
        !content.includes("D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_AUTHORITY_V1 = false") ||
        !content.includes("caller_mutation_authority: z.literal(false)") ||
        !content.includes("authoritative: z.literal(false)") ||
        !content.includes("eligible_for_upload: z.literal(false)") ||
        !content.includes("eligible_for_attestation: z.literal(false)") ||
        !content.includes("lifecycle_advance_allowed: z.literal(false)") ||
        !content.includes("gate_promotion_allowed: z.literal(false)") ||
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|child_process|spawn|execFile|process|Authorization|Bearer|api_token|hmac_key_base64url|attempt_tag|worker_id|version_id|deployment_id|script_name)\b/u.test(
            content
        ) ||
        /caller_mutation_authority:\s*(?:z\.literal\()?true|authoritative:\s*(?:z\.literal\()?true|eligible_for_upload:\s*(?:z\.literal\()?true|eligible_for_attestation:\s*(?:z\.literal\()?true|gate_promotion_allowed:\s*(?:z\.literal\()?true|lifecycle_advance_allowed:\s*(?:z\.literal\()?true|closed_no_resource|no_action_allowed|cleanup_executable|mutation_allowed:\s*true/u.test(
            content
        )
    ) {
        errors.push(
            `${file}: the effect journal must remain bounded, private, caller-constructible, redacted, and non-authoritative`
        );
    }
}

function checkD1ProbeCanaryDriverLeaseBoundary(file, content, imports) {
    const source = "packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease.ts";
    const test = "packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease.test.ts";
    const testOnlySymbol = "createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1";
    const leaseModule = path.resolve("packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease");
    const importsLease = imports.some(
        specifier =>
            specifier.startsWith(".") &&
            path.resolve(path.dirname(file), specifier).replace(/\.(?:js|ts)$/u, "") === leaseModule
    );
    if (importsLease && file !== test) {
        errors.push(`${file}: the unwired Worker canary driver lease may be imported only by its focused test`);
    }
    if (
        file.startsWith("packages/d1-probe-operator/src/") &&
        content.includes(testOnlySymbol) &&
        file !== source &&
        file !== test
    ) {
        errors.push(`${file}: the Worker canary driver lease test seam may be consumed only by its focused test`);
    }
    if (file !== source) return;
    const allowedImports = new Set([
        "node:fs",
        "node:crypto",
        "node:fs/promises",
        "node:path",
        "node:url",
        "zod",
        "@openbot/gate-attestation/internal",
    ]);
    const processKillCalls = content.match(/process\.kill\s*\([^)]*\)/gu) ?? [];
    if (
        imports.some(specifier => !allowedImports.has(specifier)) ||
        !content.includes('"d1-probe-canary-driver-leases"') ||
        !content.includes("const MAX_LEASE_BYTES_V1 = 16 * 1024") ||
        !content.includes("const MAX_GENERATIONS_V1 = 1_024") ||
        !content.includes("const LeaseDurationV1Schema = z.number().int().positive().max(300_000)") ||
        !content.includes("ownerPid: process.pid") ||
        processKillCalls.length !== 1 ||
        processKillCalls[0] !== "process.kill(pid, 0)" ||
        !content.includes("await link(tempPath, finalPath)") ||
        !content.includes("await syncDirectory(root)") ||
        !content.includes("constants.O_NOFOLLOW") ||
        !content.includes("tempStat.dev === finalStat.dev") ||
        !content.includes("tempStat.ino === finalStat.ino") ||
        !content.includes("assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1") ||
        !content.includes("caller_mutation_authority: z.literal(false)") ||
        !content.includes("authoritative: z.literal(false)") ||
        !content.includes("eligible_for_upload: z.literal(false)") ||
        !content.includes("eligible_for_attestation: z.literal(false)") ||
        !content.includes("lifecycle_advance_allowed: z.literal(false)") ||
        !content.includes("gate_promotion_allowed: z.literal(false)") ||
        !content.includes("mutation_authority: z.literal(false)") ||
        /\b(?:fetch|FormData|WebSocket|EventSource|XMLHttpRequest|child_process|spawn|execFile|process\.env|Authorization|Bearer|api_token|hmac_key_base64url)\b/u.test(
            content
        ) ||
        /caller_mutation_authority:\s*(?:z\.literal\()?true|authoritative:\s*(?:z\.literal\()?true|eligible_for_upload:\s*(?:z\.literal\()?true|eligible_for_attestation:\s*(?:z\.literal\()?true|gate_promotion_allowed:\s*(?:z\.literal\()?true|lifecycle_advance_allowed:\s*(?:z\.literal\()?true|mutation_authority:\s*(?:z\.literal\()?true/u.test(
            content
        )
    ) {
        errors.push(
            `${file}: the driver lease must retain fixed process identity, zero-signal liveness, private append-only CAS, and false authority`
        );
    }
}

function checkD1ProbeRpcImportBoundary(file, specifier) {
    const resolvedImport = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    const schemaRoot = path.resolve("packages/d1-probe-rpc/src/schema");
    const schemaImport =
        specifier === "@openbot/d1-probe-rpc/schema" ||
        specifier.startsWith("@openbot/d1-probe-rpc/schema/") ||
        resolvedImport === schemaRoot ||
        resolvedImport === `${schemaRoot}.js` ||
        resolvedImport === `${schemaRoot}.ts`;
    if (schemaImport) {
        if (
            file.startsWith("packages/d1-probes/") ||
            file.startsWith("packages/d1-probe-operator/") ||
            file === "packages/d1-probe-rpc/src/schema.test.ts"
        ) {
            return;
        }
        errors.push(`${file}: disposable D1 schema may enter only probe execution or operator code`);
        return;
    }
    if (file.startsWith("packages/d1-probe-rpc/")) return;
    if (
        file.startsWith("packages/d1-probe-driver/") ||
        file.startsWith("apps/d1-probe-sink/") ||
        file.startsWith("apps/d1-probe-writer/") ||
        file.startsWith("tests/d1-probe-writer-workers/") ||
        file === "tests/unit/d1-probe-rpc-boundary.test.ts"
    ) {
        return;
    }
    const packageImport = specifier === "@openbot/d1-probe-rpc" || specifier.startsWith("@openbot/d1-probe-rpc/");
    const rpcRoot = path.resolve("packages/d1-probe-rpc");
    const resolvesIntoRpc =
        resolvedImport !== null && (resolvedImport === rpcRoot || resolvedImport.startsWith(`${rpcRoot}${path.sep}`));
    if (packageImport || resolvesIntoRpc) {
        errors.push(`${file}: D1 probe RPC code cannot enter product or authority code`);
    }
}

function checkD1ProbeDriverImportBoundary(file, specifier) {
    if (file.startsWith("packages/d1-probe-driver/")) return;
    const packageImport = specifier === "@openbot/d1-probe-driver" || specifier.startsWith("@openbot/d1-probe-driver/");
    const resolvedImport = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    const driverRoot = path.resolve("packages/d1-probe-driver");
    const resolvesIntoDriver =
        resolvedImport !== null &&
        (resolvedImport === driverRoot || resolvedImport.startsWith(`${driverRoot}${path.sep}`));
    if (packageImport || resolvesIntoDriver) {
        errors.push(`${file}: D1 probe network driver cannot enter product, authority, or Worker code`);
    }
}

function checkD1ProbeWorkerImportBoundary(file, specifier) {
    if (
        file.startsWith("apps/d1-probe-sink/") ||
        file.startsWith("apps/d1-probe-writer/") ||
        file.startsWith("tests/d1-probe-writer-workers/") ||
        file === "tests/unit/d1-probe-rpc-boundary.test.ts"
    ) {
        return;
    }
    const packageImport =
        specifier === "@openbot/d1-probe-sink" ||
        specifier.startsWith("@openbot/d1-probe-sink/") ||
        specifier === "@openbot/d1-probe-writer" ||
        specifier.startsWith("@openbot/d1-probe-writer/");
    const resolvedImport = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
    const roots = [path.resolve("apps/d1-probe-sink"), path.resolve("apps/d1-probe-writer")];
    const resolvesIntoWorker =
        resolvedImport !== null &&
        roots.some(root => resolvedImport === root || resolvedImport.startsWith(`${root}${path.sep}`));
    if (packageImport || resolvesIntoWorker) {
        errors.push(`${file}: D1 probe Worker code cannot enter product or authority code`);
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

const sideEffectImportSelfTest = importsFromSource('import "node:https";');
if (sideEffectImportSelfTest.length !== 1 || sideEffectImportSelfTest[0] !== "node:https") {
    errors.push("dependency import parser self-test did not detect a side-effect import");
}

const beforeOperatorFetchSelfTest = errors.length;
checkD1ProbeOperatorNetworkBoundary(
    "packages/d1-probe-operator/src/preflight.ts",
    "await dependencies.fetch(request)",
    []
);
if (errors.length !== beforeOperatorFetchSelfTest + 1) {
    errors.push("D1 probe operator network-boundary self-test did not reject fetch outside reviewed adapters");
}
errors.splice(beforeOperatorFetchSelfTest, 1);

const beforeWorkerArtifactSelfTest = errors.length;
checkD1ProbeWorkerArtifactCandidateBoundary(
    "packages/d1-probe-operator/src/worker-artifact.ts",
    "export const eligible_for_upload: true = true",
    []
);
if (errors.length !== beforeWorkerArtifactSelfTest + 1) {
    errors.push("Worker artifact candidate boundary self-test did not reject upload authority");
}
errors.splice(beforeWorkerArtifactSelfTest, 1);

const beforeWorkerApiCanarySelfTest = errors.length;
checkD1ProbeWorkerApiCanaryBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-interoperability-canary.ts",
    "export const eligible_for_attestation: true = true",
    []
);
if (errors.length !== beforeWorkerApiCanarySelfTest + 1) {
    errors.push("Worker API canary boundary self-test did not reject authority");
}
errors.splice(beforeWorkerApiCanarySelfTest, 1);

const beforeWorkerApiCanaryClosureSelfTest = errors.length;
checkD1ProbeWorkerApiCanaryBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-command.ts",
    "export const authoritative = false",
    ["./cloudflare-worker-canary-evidence.js"]
);
if (errors.length !== beforeWorkerApiCanaryClosureSelfTest + 1) {
    errors.push("Worker API canary boundary self-test did not reject an unreviewed intermediary import");
}
errors.splice(beforeWorkerApiCanaryClosureSelfTest, 1);

const beforeWorkerVersionContractSelfTest = errors.length;
checkD1ProbePureTransformBoundary(
    "packages/d1-probe-operator/src/worker-version-contract.ts",
    "export const mutation_allowed: true = true",
    []
);
if (errors.length !== beforeWorkerVersionContractSelfTest + 1) {
    errors.push("Worker Version contract boundary self-test did not reject mutation authority");
}
errors.splice(beforeWorkerVersionContractSelfTest, 1);

const beforePureTransformCapabilitySelfTest = errors.length;
checkD1ProbePureTransformBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-review.ts",
    'import fs from "fs"; fs.openSync("result.json", "r")',
    ["fs"]
);
if (errors.length !== beforePureTransformCapabilitySelfTest + 3) {
    errors.push("offline D1 probe transform boundary self-test did not reject bare Node and filesystem capabilities");
}
errors.splice(beforePureTransformCapabilitySelfTest, 3);

const beforeWorkerVersionConsumerSelfTest = errors.length;
checkD1ProbeWorkerVersionContractImportBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-review.ts",
    "./worker-version-contract.js"
);
if (errors.length !== beforeWorkerVersionConsumerSelfTest + 1) {
    errors.push("Worker Version contract boundary self-test did not reject an unreviewed raw-body consumer");
}
errors.splice(beforeWorkerVersionConsumerSelfTest, 1);

const beforeCanaryTransportConsumerSelfTest = errors.length;
checkD1ProbeWorkerCanaryTransportImportBoundary(
    "packages/d1-probe-operator/src/unreviewed-canary-consumer.ts",
    "./cloudflare-worker-canary-transport.js"
);
if (errors.length !== beforeCanaryTransportConsumerSelfTest + 1) {
    errors.push("Worker API canary transport consumer boundary self-test did not reject an unreviewed consumer");
}
errors.splice(beforeCanaryTransportConsumerSelfTest, 1);

const beforeCanaryPlanCliSelfTest = errors.length;
checkD1ProbeCanaryPlanCliBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-plan-cli.ts",
    "readSecret(3, MAX_HMAC_KEY_BYTES); const token = process.env.CLOUDFLARE_API_TOKEN; fetch('https://example.invalid')",
    []
);
if (errors.length !== beforeCanaryPlanCliSelfTest + 1) {
    errors.push("Worker API canary plan CLI self-test did not reject environment or network access");
}
errors.splice(beforeCanaryPlanCliSelfTest, 1);

const beforeCanaryPlanCliImportSelfTest = errors.length;
checkD1ProbeCanaryPlanCliBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-plan-cli.ts",
    "readSecret(3, MAX_HMAC_KEY_BYTES)",
    ["node:dns/promises"]
);
if (errors.length !== beforeCanaryPlanCliImportSelfTest + 1) {
    errors.push("Worker API canary plan CLI self-test did not reject an unreviewed Node capability");
}
errors.splice(beforeCanaryPlanCliImportSelfTest, 1);

const beforeCanaryPlanCliDescriptorSelfTest = errors.length;
checkD1ProbeCanaryPlanCliBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-plan-cli.ts",
    "readSecret(5, MAX_HMAC_KEY_BYTES)",
    ["node:crypto", "node:fs", "@openbot/gate-attestation/internal", "./cloudflare-worker-canary-plan.js"]
);
if (errors.length !== beforeCanaryPlanCliDescriptorSelfTest + 1) {
    errors.push("Worker API canary plan CLI self-test did not reject another secret descriptor");
}
errors.splice(beforeCanaryPlanCliDescriptorSelfTest, 1);

const beforeCanaryCleanupSelfTest = errors.length;
checkD1ProbeCanaryCleanupBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.ts",
    'const API_ROOT_V1 = "https://api.cloudflare.com/client/v4"; requestJson("POST", "/workers")',
    ["./cloudflare-worker-canary-operation.js", "./cloudflare-worker-canary-state.js"]
);
if (errors.length !== beforeCanaryCleanupSelfTest + 1) {
    errors.push("Worker API canary cleanup self-test did not reject a forward mutation");
}
errors.splice(beforeCanaryCleanupSelfTest, 1);

const beforeCanaryTransportSelfTest = errors.length;
checkD1ProbeCanaryTransportBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-transport.ts",
    'const API_ROOT_V1 = "https://api.cloudflare.com/client/v4"; dependencies.fetch("a"); dependencies.fetch("b");',
    ["node:https"]
);
if (errors.length !== beforeCanaryTransportSelfTest + 1) {
    errors.push("Worker API canary transport self-test did not reject extra network capability");
}
errors.splice(beforeCanaryTransportSelfTest, 1);

const beforeCanaryTransportCapabilitySelfTest = errors.length;
checkD1ProbeCanaryTransportBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-transport.ts",
    `
const API_ROOT_V1 = "https://api.cloudflare.com/client/v4";
const REQUEST_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-request.v1";
const MAX_RESPONSE_BYTES_V1 = 256 * 1024;
const MAX_AGGREGATE_RESPONSE_BYTES_V1 = 2 * 1024 * 1024;
const MAX_REQUEST_DURATION_MS_V1 = 20_000;
dependencies.fetch();
digestCanonicalJsonV1();
canonicalizeJsonV1(body);
const response = { response_digest: await sha256(bytes) };
const request = { redirect: "manual", "Accept-Encoding": "identity" };
return {
    transcript,
    forward: {
        get: value,
        post: value,
        put: value,
    },
    cleanup: {
        get: value,
        delete: value,
    },
};`,
    ["@openbot/gate-attestation/internal"]
);
if (errors.length !== beforeCanaryTransportCapabilitySelfTest + 1) {
    errors.push("Worker API canary transport self-test did not reject an extra capability method");
}
errors.splice(beforeCanaryTransportCapabilitySelfTest, 1);

const beforeCanaryDisabledCliSelfTest = errors.length;
checkD1ProbeCanaryDisabledCliBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-cli.ts",
    'executeD1ProbeCloudflareWorkerCanaryCommandV1(); fetch("https://example.invalid")',
    ["./cloudflare-worker-canary-command.js"]
);
if (errors.length !== beforeCanaryDisabledCliSelfTest + 1) {
    errors.push("Worker API canary disabled CLI self-test did not reject a live execution path");
}
errors.splice(beforeCanaryDisabledCliSelfTest, 1);

const beforeCanaryCleanupMethodSelfTest = errors.length;
checkD1ProbeCanaryCleanupBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.ts",
    'const API_ROOT_V1 = "https://api.cloudflare.com/client/v4"; requestJson(method, "/workers")',
    [
        "zod",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-interoperability-canary.js",
        "./cloudflare-worker-canary-operation.js",
        "./cloudflare-worker-canary-state.js",
        "./contracts.js",
    ]
);
if (errors.length !== beforeCanaryCleanupMethodSelfTest + 1) {
    errors.push("Worker API canary cleanup self-test did not reject a nonliteral request method");
}
errors.splice(beforeCanaryCleanupMethodSelfTest, 1);

const beforeCanaryCleanupDirectFetchSelfTest = errors.length;
checkD1ProbeCanaryCleanupBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-cleanup.ts",
    'const API_ROOT_V1 = "https://api.cloudflare.com/client/v4"; dependencies.fetch("a"); dependencies.fetch("b"); requestJson("GET", "/workers")',
    [
        "zod",
        "@openbot/gate-attestation/internal",
        "./cloudflare-worker-interoperability-canary.js",
        "./cloudflare-worker-canary-operation.js",
        "./cloudflare-worker-canary-state.js",
        "./contracts.js",
    ]
);
if (errors.length !== beforeCanaryCleanupDirectFetchSelfTest + 1) {
    errors.push("Worker API canary cleanup self-test did not reject a second direct fetch path");
}
errors.splice(beforeCanaryCleanupDirectFetchSelfTest, 1);

const beforeCanaryStateCapabilitySelfTest = errors.length;
checkD1ProbeCanaryStateBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-state.ts",
    'import { spawn } from "node:child_process"',
    ["node:child_process"]
);
if (errors.length !== beforeCanaryStateCapabilitySelfTest + 1) {
    errors.push("Worker API canary state self-test did not reject a process capability");
}
errors.splice(beforeCanaryStateCapabilitySelfTest, 1);

const beforeCanaryRecoveryInspectorSelfTest = errors.length;
checkD1ProbeCanaryRecoveryInspectorBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-recovery-inspect-cli.ts",
    "process.env.CLOUDFLARE_API_TOKEN; fetch('https://example.invalid')",
    ["./cloudflare-worker-canary-cleanup.js"]
);
if (errors.length !== beforeCanaryRecoveryInspectorSelfTest + 1) {
    errors.push("Worker API canary recovery inspector self-test did not reject credentials, network, or cleanup code");
}
errors.splice(beforeCanaryRecoveryInspectorSelfTest, 1);

const canaryEffectJournalBoundaryFixture = `
const CLAIM_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-effect-claim.v1";
const EXECUTION_NONCE_COMMITMENT_DOMAIN_V1 =
    "openbot.d1-probe.cloudflare-worker-api-canary-execution-nonce-commitment.v1";
const OPERATION_RECORD_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-operation-record.v1";
const root = "d1-probe-canary-effect-journal";
const MAX_CLAIM_BYTES_V1 = 32 * 1024;
const MAX_JOURNAL_REVISIONS_V1 = 256;
const workflowBindings = {};
const workflowTransitions = {
    prepared_worker_list: ["prepared_worker_list", "shell_create"],
    shell_create: ["shell_dispatch_reconciliation", "shell_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    shell_dispatch_reconciliation: ["shell_dispatch_reconciliation", "shell_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    shell_readback: ["shell_readback", "version_create", "cleanup_worker_list", "cleanup_worker_readback"],
    version_create: ["version_dispatch_reconciliation", "version_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    version_dispatch_reconciliation: ["version_dispatch_reconciliation", "version_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    version_readback: ["version_readback", "deployment_create", "cleanup_worker_list", "cleanup_worker_readback"],
    deployment_create: ["deployment_dispatch_reconciliation", "deployment_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    deployment_dispatch_reconciliation: ["deployment_dispatch_reconciliation", "deployment_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    deployment_readback: ["deployment_readback", "cleanup_worker_list", "cleanup_worker_readback"],
    cleanup_worker_list: ["cleanup_worker_list", "cleanup_worker_readback"],
    cleanup_worker_readback: ["delete_worker"],
    delete_worker: ["deleted_worker_readback"],
    deleted_worker_readback: ["deleted_worker_list"],
    deleted_worker_list: ["deleted_worker_list"],
} as const;
const operationStateTransitions = {
    prepared: ["shell_dispatching", "cleanup_reconciling"],
    shell_dispatching: ["shell_identified", "cleanup_reconciling"],
    shell_identified: ["version_dispatching", "cleanup_reconciling"],
    version_dispatching: ["version_identified", "cleanup_reconciling"],
    version_identified: ["deployment_dispatching", "cleanup_reconciling"],
    deployment_dispatching: ["deployment_identified", "cleanup_reconciling"],
    deployment_identified: ["cleanup_reconciling"],
    cleanup_reconciling: ["delete_dispatching"],
    delete_dispatching: [],
    absence_observed: [],
    manual_required: [],
} as const;
const schema = {
    operation_record_digest: DigestV1Schema,
    request_method: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema,
    caller_mutation_authority: z.literal(false),
    authoritative: z.literal(false),
    eligible_for_upload: z.literal(false),
    eligible_for_attestation: z.literal(false),
    lifecycle_advance_allowed: z.literal(false),
    gate_promotion_allowed: z.literal(false),
};
claim.workflow_step !== "prepared_worker_list";
claim.operation_revision !== 0;
claim.operation_state !== "prepared";
const D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_AUTHORITY_V1 = false;
canonicalizeJsonV1(claim as CanonicalJsonValueV1);
await handle.sync();
await link(tempPath, finalPath);
await syncDirectory(root);
constants.O_NOFOLLOW;
tempStat.dev === finalStat.dev;
tempStat.ino === finalStat.ino;
/[89ab][0-9a-f]{3}/u;
`;

const beforeCanaryEffectJournalPositiveSelfTest = errors.length;
checkD1ProbeCanaryEffectJournalBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.ts",
    canaryEffectJournalBoundaryFixture,
    ["node:fs/promises"]
);
if (errors.length !== beforeCanaryEffectJournalPositiveSelfTest) {
    errors.push("Worker API canary effect journal self-test rejected its fixed bounded contract");
}

const beforeCanaryEffectJournalCapabilitySelfTest = errors.length;
checkD1ProbeCanaryEffectJournalBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.ts",
    `${canaryEffectJournalBoundaryFixture}\nprocess.env.CLOUDFLARE_API_TOKEN; fetch('https://example.invalid'); const authoritative: true = true`,
    ["node:https"]
);
if (errors.length !== beforeCanaryEffectJournalCapabilitySelfTest + 1) {
    errors.push("Worker API canary effect journal self-test did not reject network, secret, or authority access");
}
errors.splice(beforeCanaryEffectJournalCapabilitySelfTest, 1);

const beforeCanaryEffectJournalPublicationSelfTest = errors.length;
checkD1ProbeCanaryEffectJournalBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.ts",
    canaryEffectJournalBoundaryFixture.replace(
        "const MAX_CLAIM_BYTES_V1 = 32 * 1024",
        "const MAX_CLAIM_BYTES_V1 = Number.MAX_SAFE_INTEGER"
    ),
    ["node:fs/promises"]
);
if (errors.length !== beforeCanaryEffectJournalPublicationSelfTest + 1) {
    errors.push("Worker API canary effect journal self-test did not reject unbounded noncanonical publication");
}
errors.splice(beforeCanaryEffectJournalPublicationSelfTest, 1);

const beforeCanaryEffectJournalWorkflowSelfTest = errors.length;
checkD1ProbeCanaryEffectJournalBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-effect-journal.ts",
    canaryEffectJournalBoundaryFixture.replace(
        'shell_create: ["shell_dispatch_reconciliation"',
        'shell_create: ["shell_create", "shell_dispatch_reconciliation"'
    ),
    ["node:fs/promises"]
);
if (errors.length !== beforeCanaryEffectJournalWorkflowSelfTest + 1) {
    errors.push("Worker API canary effect journal self-test did not reject a mutation retry transition");
}
errors.splice(beforeCanaryEffectJournalWorkflowSelfTest, 1);

const canaryDriverLeaseBoundaryFixture = `
const root = "d1-probe-canary-driver-leases";
const MAX_LEASE_BYTES_V1 = 16 * 1024;
const MAX_GENERATIONS_V1 = 1_024;
const LeaseDurationV1Schema = z.number().int().positive().max(300_000);
const schema = {
    caller_mutation_authority: z.literal(false),
    authoritative: z.literal(false),
    eligible_for_upload: z.literal(false),
    eligible_for_attestation: z.literal(false),
    lifecycle_advance_allowed: z.literal(false),
    gate_promotion_allowed: z.literal(false),
    mutation_authority: z.literal(false),
};
const defaults = { ownerPid: process.pid };
process.kill(pid, 0);
await link(tempPath, finalPath);
await syncDirectory(root);
constants.O_NOFOLLOW;
tempStat.dev === finalStat.dev;
tempStat.ino === finalStat.ino;
assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1;
createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1;
`;

const beforeCanaryDriverLeasePositiveSelfTest = errors.length;
checkD1ProbeCanaryDriverLeaseBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease.ts",
    canaryDriverLeaseBoundaryFixture,
    ["node:fs/promises"]
);
if (errors.length !== beforeCanaryDriverLeasePositiveSelfTest) {
    errors.push("Worker API canary driver lease self-test rejected its fixed private contract");
}

const beforeCanaryDriverLeaseCapabilitySelfTest = errors.length;
checkD1ProbeCanaryDriverLeaseBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-driver-lease.ts",
    `${canaryDriverLeaseBoundaryFixture}\nprocess.env.CLOUDFLARE_API_TOKEN; fetch('https://example.invalid'); process.kill(pid, 9)`,
    ["node:child_process"]
);
if (errors.length !== beforeCanaryDriverLeaseCapabilitySelfTest + 1) {
    errors.push("Worker API canary driver lease self-test did not reject network, environment, or nonzero signals");
}
errors.splice(beforeCanaryDriverLeaseCapabilitySelfTest, 1);

const beforeCanaryDriverLeaseTestSeamSelfTest = errors.length;
checkD1ProbeCanaryDriverLeaseBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-command.ts",
    "createD1ProbeCloudflareWorkerCanaryDriverLeaseTestOnlyStoreV1();",
    []
);
if (errors.length !== beforeCanaryDriverLeaseTestSeamSelfTest + 1) {
    errors.push("Worker API canary driver lease self-test did not fence its injected test seam");
}
errors.splice(beforeCanaryDriverLeaseTestSeamSelfTest, 1);

const beforeCanaryDriverLeaseConsumerSelfTest = errors.length;
checkD1ProbeCanaryDriverLeaseBoundary(
    "packages/d1-probe-operator/src/cloudflare-worker-canary-command.ts",
    "const lease = driverLease.acquire;",
    ["./cloudflare-worker-canary-driver-lease.js"]
);
if (errors.length !== beforeCanaryDriverLeaseConsumerSelfTest + 1) {
    errors.push("Worker API canary driver lease self-test did not reject an unreviewed production consumer");
}
errors.splice(beforeCanaryDriverLeaseConsumerSelfTest, 1);

for (const specifier of [
    "./cloudflare-worker-canary-driver-lease",
    "./subdirectory/../cloudflare-worker-canary-driver-lease.js",
]) {
    const beforeEquivalentCanaryDriverLeaseConsumerSelfTest = errors.length;
    checkD1ProbeCanaryDriverLeaseBoundary(
        "packages/d1-probe-operator/src/cloudflare-worker-canary-command.ts",
        "const lease = driverLease.acquire;",
        [specifier]
    );
    if (errors.length !== beforeEquivalentCanaryDriverLeaseConsumerSelfTest + 1) {
        errors.push(`Worker API canary driver lease self-test did not reject equivalent import spelling ${specifier}`);
    }
    errors.splice(beforeEquivalentCanaryDriverLeaseConsumerSelfTest, 1);
}

const beforeRpcManifestSelfTest = errors.length;
checkManifest(
    "apps/<self-test>/package.json",
    { dependencies: { "@openbot/d1-probe-rpc": "workspace:*" } },
    workspaceCatalog
);
if (errors.length !== beforeRpcManifestSelfTest + 1) {
    errors.push("D1 probe RPC manifest-boundary self-test did not reject a product dependency");
}
errors.splice(beforeRpcManifestSelfTest, 1);

const beforeRpcImportSelfTest = errors.length;
checkD1ProbeRpcImportBoundary("apps/<self-test>/entry.ts", "../../packages/d1-probe-rpc/src/protocol.ts");
if (errors.length !== beforeRpcImportSelfTest + 1) {
    errors.push("D1 probe RPC import-boundary self-test did not reject a product import");
}
errors.splice(beforeRpcImportSelfTest, 1);

const beforeRpcSchemaAllowedSelfTest = errors.length;
checkD1ProbeRpcImportBoundary("packages/d1-probes/<self-test>.ts", "@openbot/d1-probe-rpc/schema");
checkD1ProbeRpcImportBoundary("packages/d1-probe-operator/<self-test>.ts", "@openbot/d1-probe-rpc/schema");
if (errors.length !== beforeRpcSchemaAllowedSelfTest) {
    errors.push("D1 probe schema import-boundary self-test rejected an allowed schema consumer");
}

const beforeRpcSchemaDeniedSelfTest = errors.length;
checkD1ProbeRpcImportBoundary("packages/d1-probe-driver/<self-test>.ts", "@openbot/d1-probe-rpc/schema");
checkD1ProbeRpcImportBoundary("packages/d1-probe-rpc/src/<self-test>.ts", "./schema.js");
if (errors.length !== beforeRpcSchemaDeniedSelfTest + 2) {
    errors.push("D1 probe schema import-boundary self-test did not reject an ordinary RPC consumer");
}
errors.splice(beforeRpcSchemaDeniedSelfTest, 2);

const beforeRpcRootDeniedSelfTest = errors.length;
checkD1ProbeRpcImportBoundary("packages/d1-probes/<self-test>.ts", "@openbot/d1-probe-rpc");
if (errors.length !== beforeRpcRootDeniedSelfTest + 1) {
    errors.push("D1 probe RPC import-boundary self-test did not restrict probe execution to the schema subpath");
}
errors.splice(beforeRpcRootDeniedSelfTest, 1);

const beforeDriverManifestSelfTest = errors.length;
checkManifest(
    "apps/<self-test>/package.json",
    { dependencies: { "@openbot/d1-probe-driver": "workspace:*" } },
    workspaceCatalog
);
if (errors.length !== beforeDriverManifestSelfTest + 1) {
    errors.push("D1 probe driver manifest-boundary self-test did not reject a product dependency");
}
errors.splice(beforeDriverManifestSelfTest, 1);

const beforeDriverImportSelfTest = errors.length;
checkD1ProbeDriverImportBoundary("apps/<self-test>/entry.ts", "../../packages/d1-probe-driver/src/transport.ts");
if (errors.length !== beforeDriverImportSelfTest + 1) {
    errors.push("D1 probe driver import-boundary self-test did not reject a product import");
}
errors.splice(beforeDriverImportSelfTest, 1);

const beforeProbeWorkerManifestSelfTest = errors.length;
checkManifest(
    "apps/<self-test>/package.json",
    { dependencies: { "@openbot/d1-probe-sink": "workspace:*" } },
    workspaceCatalog
);
if (errors.length !== beforeProbeWorkerManifestSelfTest + 1) {
    errors.push("D1 probe Worker manifest-boundary self-test did not reject a product dependency");
}
errors.splice(beforeProbeWorkerManifestSelfTest, 1);

const beforeProbeWorkerImportSelfTest = errors.length;
checkD1ProbeWorkerImportBoundary("apps/<self-test>/entry.ts", "../../apps/d1-probe-sink/src/record.ts");
if (errors.length !== beforeProbeWorkerImportSelfTest + 1) {
    errors.push("D1 probe Worker import-boundary self-test did not reject a product import");
}
errors.splice(beforeProbeWorkerImportSelfTest, 1);

const forbiddenFiles = files.filter(file => /(?:entry\.(?:mysql|postgres)\.ts|artifact-gateway)/u.test(file));
for (const file of forbiddenFiles) errors.push(`${file}: deferred profile or artifact entrypoint exists`);

for (const file of files.filter(file => sourceExtensions.has(path.extname(file)))) {
    const content = await readFile(file, "utf8");
    const imports = importsFromSource(content);
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
        checkD1ProbeWorkerVersionContractImportBoundary(file, specifier);
        checkD1ProbeWorkerCanaryTransportImportBoundary(file, specifier);
        checkD1ProbeRpcImportBoundary(file, specifier);
        checkD1ProbeDriverImportBoundary(file, specifier);
        checkD1ProbeWorkerImportBoundary(file, specifier);
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
    checkD1ProbeWorkerArtifactCandidateBoundary(file, content, imports);
    checkD1ProbeWorkerApiCanaryBoundary(file, content, imports);
    checkD1ProbePureTransformBoundary(file, content, imports);
    checkD1ProbeCanaryPlanCliBoundary(file, content, imports);
    checkD1ProbeCanaryCleanupBoundary(file, content, imports);
    checkD1ProbeCanaryTransportBoundary(file, content, imports);
    checkD1ProbeCanaryDisabledCliBoundary(file, content, imports);
    checkD1ProbeCanaryRecoveryInspectorBoundary(file, content, imports);
    checkD1ProbeCanaryStateBoundary(file, content, imports);
    checkD1ProbeCanaryEffectJournalBoundary(file, content, imports);
    checkD1ProbeCanaryDriverLeaseBoundary(file, content, imports);
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
