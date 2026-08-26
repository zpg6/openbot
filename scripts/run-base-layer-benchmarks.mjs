import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const PROFILE_TIMEOUT_MS = 180_000;
const REPORT_PREFIX = "OPENBOT_BASE_LAYER_BENCHMARK ";

const profiles = Object.freeze([
    Object.freeze({
        name: "max_scale",
        operations: 128,
        concurrency: 16,
        responseBytes: 4_096,
        contentionContenders: 64,
    }),
    Object.freeze({
        name: "max_payload",
        operations: 1,
        concurrency: 1,
        responseBytes: 256 * 1024,
        contentionContenders: 8,
    }),
]);

const fail = message => {
    throw new Error(message);
};

const exactFiniteNonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const durableSessionContendersFor = profile =>
    Math.min(256, Math.max(16, profile.operations * 2, profile.concurrency * 8));

export const validateBaseLayerBenchmarkReportV1 = (input, profile) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) fail(`${profile.name}: invalid report`);
    const report = input;
    const throughput = report.throughput;
    const contention = report.contention;
    const durableSessionContention = report.durable_session_contention;
    if (
        report.schema_version !== 1 ||
        report.kind !== "openbot_base_layer_e2e_benchmark" ||
        report.authority !== false ||
        typeof throughput !== "object" ||
        throughput === null ||
        Array.isArray(throughput) ||
        typeof contention !== "object" ||
        contention === null ||
        Array.isArray(contention) ||
        typeof durableSessionContention !== "object" ||
        durableSessionContention === null ||
        Array.isArray(durableSessionContention)
    ) {
        fail(`${profile.name}: report envelope changed`);
    }
    const expectedThroughput = {
        workload: "worker_canary_local_durability_v1",
        operations: profile.operations,
        concurrency: profile.concurrency,
        requests: profile.operations * 3,
        state_records: profile.operations * 4,
        effect_claims: profile.operations * 9,
        encrypted_response_archives: profile.operations * 3,
        durable_transcripts_reconstructed: profile.operations,
        durable_recovery_sessions_opened: profile.operations,
        cleanup_resumption_plans_compiled: profile.operations,
        driver_bootstraps: profile.operations,
        cleanup_obligations: profile.operations,
        response_body_bytes_per_request: profile.responseBytes,
    };
    for (const [key, expected] of Object.entries(expectedThroughput)) {
        if (throughput[key] !== expected) fail(`${profile.name}: throughput ${key} changed`);
    }
    if (
        !exactFiniteNonnegative(throughput.duration_ms) ||
        !exactFiniteNonnegative(throughput.operations_per_second) ||
        !exactFiniteNonnegative(throughput.response_mebibytes_per_second) ||
        contention.workload !== "worker_canary_state_revision_zero_contention_v1" ||
        contention.contenders !== profile.contentionContenders ||
        contention.winners !== 1 ||
        contention.safe_denials !== profile.contentionContenders - 1 ||
        !exactFiniteNonnegative(contention.duration_ms) ||
        !exactFiniteNonnegative(contention.attempts_per_second)
    ) {
        fail(`${profile.name}: correctness or contention report changed`);
    }
    const exactSessionContenders = durableSessionContendersFor(profile);
    if (
        durableSessionContention.workload !== "worker_canary_durable_session_identity_contention_v1" ||
        durableSessionContention.concurrency !== exactSessionContenders * 2 ||
        durableSessionContention.exact_identity_attempts !== exactSessionContenders ||
        durableSessionContention.exact_identity_sessions_created !== exactSessionContenders ||
        durableSessionContention.identity_substitution_attempts !== exactSessionContenders ||
        durableSessionContention.identity_substitution_safe_denials !== exactSessionContenders ||
        JSON.stringify(durableSessionContention.immutable_identity_fields_challenged) !==
            JSON.stringify(["plan_digest", "execution_nonce", "script_name", "ownership_tag", "attempt_tag"]) ||
        durableSessionContention.sessions_discarded_without_hook_execution !== exactSessionContenders ||
        durableSessionContention.effect_claims_written !== 0 ||
        durableSessionContention.response_archives_written !== 0 ||
        durableSessionContention.state_revision_after_contention !== 0 ||
        !exactFiniteNonnegative(durableSessionContention.duration_ms) ||
        !exactFiniteNonnegative(durableSessionContention.attempts_per_second)
    ) {
        fail(`${profile.name}: durable session contention report changed`);
    }
    return Object.freeze({ profile: profile.name, report });
};

const runProfile = async profile => {
    const child = spawn("corepack", ["pnpm", "--dir", "packages/d1-probe-operator", "bench:base-layer"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            OPENBOT_BASE_E2E_OPERATIONS: String(profile.operations),
            OPENBOT_BASE_E2E_CONCURRENCY: String(profile.concurrency),
            OPENBOT_BASE_E2E_RESPONSE_BYTES: String(profile.responseBytes),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let forceKill;
    const terminate = () => {
        child.kill("SIGTERM");
        forceKill ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
    };
    const append = (target, chunk) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) {
            outputExceeded = true;
            terminate();
            return target;
        }
        return target + chunk.toString("utf8");
    };
    child.stdout.on("data", chunk => {
        stdout = append(stdout, chunk);
    });
    child.stderr.on("data", chunk => {
        stderr = append(stderr, chunk);
    });
    const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
    }, PROFILE_TIMEOUT_MS);
    const result = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
    }).finally(() => {
        clearTimeout(timeout);
        if (forceKill !== undefined) clearTimeout(forceKill);
    });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    if (timedOut) fail(`${profile.name}: benchmark exceeded ${PROFILE_TIMEOUT_MS}ms`);
    if (outputExceeded) fail(`${profile.name}: benchmark output exceeded ${MAX_OUTPUT_BYTES} bytes`);
    if (result.code !== 0) fail(`${profile.name}: benchmark exited ${result.code ?? result.signal ?? "unknown"}`);
    const reports = `${stdout}\n${stderr}`
        .split(/\r?\n/u)
        .filter(line => line.startsWith(REPORT_PREFIX))
        .map(line => JSON.parse(line.slice(REPORT_PREFIX.length)));
    if (reports.length !== 1) fail(`${profile.name}: expected one benchmark report, received ${reports.length}`);
    return validateBaseLayerBenchmarkReportV1(reports[0], profile);
};

const reportFixture = profile => ({
    schema_version: 1,
    kind: "openbot_base_layer_e2e_benchmark",
    authority: false,
    throughput: {
        workload: "worker_canary_local_durability_v1",
        operations: profile.operations,
        concurrency: profile.concurrency,
        requests: profile.operations * 3,
        state_records: profile.operations * 4,
        effect_claims: profile.operations * 9,
        encrypted_response_archives: profile.operations * 3,
        durable_transcripts_reconstructed: profile.operations,
        durable_recovery_sessions_opened: profile.operations,
        cleanup_resumption_plans_compiled: profile.operations,
        driver_bootstraps: profile.operations,
        cleanup_obligations: profile.operations,
        response_body_bytes_per_request: profile.responseBytes,
        duration_ms: 1,
        operations_per_second: 1,
        response_mebibytes_per_second: 1,
    },
    contention: {
        workload: "worker_canary_state_revision_zero_contention_v1",
        contenders: profile.contentionContenders,
        winners: 1,
        safe_denials: profile.contentionContenders - 1,
        duration_ms: 1,
        attempts_per_second: 1,
    },
    durable_session_contention: {
        workload: "worker_canary_durable_session_identity_contention_v1",
        concurrency: durableSessionContendersFor(profile) * 2,
        exact_identity_attempts: durableSessionContendersFor(profile),
        exact_identity_sessions_created: durableSessionContendersFor(profile),
        identity_substitution_attempts: durableSessionContendersFor(profile),
        identity_substitution_safe_denials: durableSessionContendersFor(profile),
        immutable_identity_fields_challenged: [
            "plan_digest",
            "execution_nonce",
            "script_name",
            "ownership_tag",
            "attempt_tag",
        ],
        sessions_discarded_without_hook_execution: durableSessionContendersFor(profile),
        effect_claims_written: 0,
        response_archives_written: 0,
        state_revision_after_contention: 0,
        duration_ms: 1,
        attempts_per_second: 1,
    },
});

const runSelfTest = () => {
    const profile = profiles[0];
    validateBaseLayerBenchmarkReportV1(reportFixture(profile), profile);
    for (const invalid of [
        { ...reportFixture(profile), authority: true },
        {
            ...reportFixture(profile),
            throughput: { ...reportFixture(profile).throughput, operations: profile.operations - 1 },
        },
        {
            ...reportFixture(profile),
            throughput: {
                ...reportFixture(profile).throughput,
                durable_recovery_sessions_opened: profile.operations - 1,
            },
        },
        {
            ...reportFixture(profile),
            throughput: {
                ...reportFixture(profile).throughput,
                cleanup_resumption_plans_compiled: profile.operations - 1,
            },
        },
        {
            ...reportFixture(profile),
            contention: { ...reportFixture(profile).contention, winners: 2 },
        },
        {
            ...reportFixture(profile),
            durable_session_contention: {
                ...reportFixture(profile).durable_session_contention,
                effect_claims_written: 1,
            },
        },
    ]) {
        let denied = false;
        try {
            validateBaseLayerBenchmarkReportV1(invalid, profile);
        } catch {
            denied = true;
        }
        if (!denied) fail("reviewed base-layer benchmark self-test accepted an invalid report");
    }
    console.log("reviewed base-layer benchmark report self-test passed");
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    if (process.argv[2] === "--self-test") {
        runSelfTest();
    } else {
        const results = [];
        for (const profile of profiles) results.push(await runProfile(profile));
        console.log(
            `OPENBOT_REVIEWED_BASE_LAYER_BENCHMARKS ${JSON.stringify({
                schema_version: 1,
                kind: "openbot_reviewed_base_layer_benchmarks",
                authority: false,
                profiles: results.map(result => result.profile),
            })}`
        );
    }
}
