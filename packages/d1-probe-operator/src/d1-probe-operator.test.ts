import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import {
    D1_PROBE_CREATE_STEPS_V1,
    D1_PROBE_LIFECYCLE_STEPS_V1,
    D1_PROBE_RESOURCE_KINDS_V1,
    D1ProbeLifecycleJournalV1Schema,
    type D1ProbeLifecycleJournalV1,
    D1ProbePreflightPlanV1Schema,
    type D1ProbeLifecycleStepV1,
    type D1ProbePreflightPlanV1,
    type D1ProbeResourceKindV1,
} from "./contracts.js";
import {
    advanceD1ProbeLifecycleJournalV1,
    createD1ProbeLifecycleJournalV1,
    lifecycleResourceForStepV1,
    markD1ProbeLifecycleAmbiguousV1,
} from "./lifecycle.js";
import { compileD1ProbePreflightPlanV1 } from "./preflight.js";
import { readD1ProbeCloudflareRouteV1, type ObservedD1ProbeCloudflareRouteV1 } from "./cloudflare-route-reader.js";
import {
    createD1ProbeDatabaseV1,
    deleteD1ProbeDatabaseV1,
    resolveCreatedD1ProbeDatabaseV1,
} from "./cloudflare-database.js";
import { inspectD1ProbeRouteReadbackV1 } from "./route-precheck.js";
import { executeD1ProbeRouteCheckV1 } from "./route-command.js";
import {
    resolveVerifiedD1ProbePreflightV1,
    verifyD1ProbePreflightV1,
    type VerifiedD1ProbePreflightV1,
} from "./verified-preflight.js";

const hex = (character: string): string => character.repeat(64);
const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

const suffixes = Object.fromEntries(
    D1_PROBE_RESOURCE_KINDS_V1.map((kind, index) => [kind, index.toString(36).padStart(16, "0")])
) as Record<D1ProbeResourceKindV1, string>;

const request = () => ({
    schema_version: 1 as const,
    kind: "d1_probe_preflight_request" as const,
    account_id: "a".repeat(32),
    zone_id: "b".repeat(32),
    probe_origin: "https://probe.example.test",
    database_jurisdiction: "us" as const,
    installation_digest: hex("1"),
    environment_digest: hex("2"),
    configuration_digest: hex("3"),
    probe_definition_digest: hex("4"),
    collector_build_digest: hex("5"),
    commitment_key_id_digest: hex("6"),
    operator_database_deny_list: ["11111111-1111-1111-1111-111111111111", "2".repeat(32)],
    resource_suffixes: { ...suffixes },
});

const plan = async () => {
    const result = await compileD1ProbePreflightPlanV1(request(), { hmac_key_base64url: key });
    if (!result.success) throw new Error(result.code);
    return result.plan;
};

const verifiedPreflight = async () => {
    const rawRequest = request();
    const compiledPlan = await plan();
    const result = await verifyD1ProbePreflightV1(rawRequest, compiledPlan, { hmac_key_base64url: key });
    if (!result.success) throw new Error(result.code);
    return result.verified;
};

const observedRoute = async (): Promise<ObservedD1ProbeCloudflareRouteV1> => {
    const result = await readD1ProbeCloudflareRouteV1(
        await verifiedPreflight(),
        { api_token: "r".repeat(32) },
        {
            fetch: (async (input: string | URL | Request) =>
                String(input).includes("/dns_records?")
                    ? jsonResponse(cloudflareDnsResponse(1))
                    : jsonResponse(cloudflareZoneResponse())) as typeof globalThis.fetch,
        }
    );
    if (!result.success) throw new Error(result.code);
    return result.observed;
};

const routeReadback = () => ({
    schema_version: 1 as const,
    kind: "untrusted_d1_probe_route_readback" as const,
    zone: {
        id: request().zone_id,
        account_id: request().account_id,
        name: "example.test",
        status: "active" as const,
        type: "full" as const,
        paused: false,
    },
    dns_query: {
        zone_id: request().zone_id,
        name_exact: "probe.example.test",
        proxied: true as const,
        pages: [
            {
                page: 1,
                per_page: 1000 as const,
                count: 1,
                total_count: 1,
                total_pages: 1,
                records: [
                    {
                        id: "c".repeat(32),
                        name: "probe.example.test",
                        type: "A" as const,
                        proxiable: true,
                        proxied: true,
                    },
                ],
            },
        ],
    },
});

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(value), {
        ...init,
        headers: { "content-type": "application/json; charset=utf-8", ...init?.headers },
    });

const cloudflareZoneResponse = () => ({
    success: true,
    errors: [],
    messages: [],
    result: {
        id: request().zone_id,
        account: { id: request().account_id, name: "Probe account" },
        name: "example.test",
        status: "active",
        type: "full",
        paused: false,
        unrelated_future_field: true,
    },
});

const cloudflareDnsResponse = (page: number, totalPages = 1) => ({
    success: true,
    errors: [],
    messages: [],
    result: [
        {
            id: (page + 11).toString(16).padStart(32, "0"),
            name: "probe.example.test",
            type: page % 2 === 0 ? "AAAA" : "A",
            proxiable: true,
            proxied: true,
            content: page % 2 === 0 ? "2001:db8::1" : "192.0.2.1",
        },
    ],
    result_info: {
        count: 1,
        page,
        per_page: 1000,
        total_count: totalPages,
        total_pages: totalPages,
    },
});

const cloudflareDatabaseCreateResponse = (
    overrides: Partial<{
        uuid: string;
        name: string;
        jurisdiction: "eu" | "us" | "fedramp";
        read_replication: { mode: "auto" | "disabled" };
    }> = {}
) => ({
    success: true,
    errors: [],
    messages: [],
    result: {
        uuid: "33333333-3333-4333-8333-333333333333",
        name: `openbot-d1-probe-${suffixes.database}`,
        jurisdiction: "us" as const,
        read_replication: { mode: "auto" as const },
        version: "production",
        ...overrides,
    },
});

const runCli = async (
    input: string,
    keyInput?: string
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", new URL("./cli.ts", import.meta.url).pathname], {
            cwd: new URL("../", import.meta.url).pathname,
            stdio: ["pipe", "pipe", "pipe", keyInput === undefined ? "ignore" : "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdout === null || child.stderr === null || child.stdin === null) {
            reject(new Error("missing child standard stream"));
            return;
        }
        child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.once("error", reject);
        child.once("close", code =>
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            })
        );
        child.stdin.end(input);
        if (keyInput !== undefined) {
            const keyStream = child.stdio[3];
            if (keyStream === undefined || keyStream === null || !("end" in keyStream)) {
                reject(new Error("missing child commitment-key stream"));
                return;
            }
            keyStream.end(keyInput);
        }
    });

const runRouteCli = async (
    input: string,
    keyInput?: string,
    tokenInput?: string,
    extraArguments: string[] = [],
    environment: NodeJS.ProcessEnv = process.env
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ["--import", "tsx", new URL("./route-cli.ts", import.meta.url).pathname, ...extraArguments],
            {
                cwd: new URL("../", import.meta.url).pathname,
                env: environment,
                stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
            }
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        if (child.stdout === null || child.stderr === null || child.stdin === null) {
            reject(new Error("missing route-check child standard stream"));
            return;
        }
        child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.once("error", reject);
        child.once("close", code =>
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            })
        );
        child.stdin.end(input);
        for (const descriptor of [3, 4] as const) {
            const secret = descriptor === 3 ? keyInput : tokenInput;
            const stream = child.stdio[descriptor];
            if (stream === undefined || stream === null || !("end" in stream)) {
                reject(new Error(`missing route-check file descriptor ${descriptor}`));
                return;
            }
            stream.on("error", () => undefined);
            stream.end(secret ?? "");
        }
    });

const resourceIds = new Map<D1ProbeResourceKindV1, string>(
    D1_PROBE_RESOURCE_KINDS_V1.map((kind, index) => [kind, (index + 1).toString(16).padStart(64, "0")])
);

const eventForStep = (
    compiledPlan: D1ProbePreflightPlanV1,
    step: D1ProbeLifecycleStepV1,
    index: number,
    overrideResourceId?: string,
    overrideResourceName?: string
) => {
    const resourceKind = lifecycleResourceForStepV1(step);
    const resourceNameCommitment =
        resourceKind === null
            ? null
            : (overrideResourceName ??
              compiledPlan.resources.find(resource => resource.resource_kind === resourceKind)
                  ?.generated_name_commitment);
    return {
        step,
        observation_digest: (index + 100).toString(16).padStart(64, "0"),
        resource_kind: resourceKind,
        resource_name_commitment: resourceNameCommitment,
        resource_id_commitment:
            resourceKind === null ? null : (overrideResourceId ?? (resourceIds.get(resourceKind) as string)),
    };
};

describe("D1 probe operator preflight", () => {
    it("is private operator code with no package export", async () => {
        const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
            private?: boolean;
            exports?: unknown;
        };
        expect(manifest.private).toBe(true);
        expect(manifest).not.toHaveProperty("exports");
    });

    it("creates deterministic, non-authoritative commitments without leaking operational IDs or the HMAC key", async () => {
        const first = await plan();
        const reordered = request();
        reordered.operator_database_deny_list.reverse();
        const second = await compileD1ProbePreflightPlanV1(reordered, { hmac_key_base64url: key });
        expect(second).toEqual({ success: true, plan: first });
        expect(first).toMatchObject({
            authoritative: false,
            deploy_performed: false,
            gate_promotion_allowed: false,
            compatibility_date: "2026-08-22",
            wrangler_version: "4.125.0",
        });
        expect(first.resources.map(resource => resource.resource_kind)).toEqual(D1_PROBE_RESOURCE_KINDS_V1);
        expect(new Set(first.resources.map(resource => resource.generated_name)).size).toBe(
            D1_PROBE_RESOURCE_KINDS_V1.length
        );
        expect(first.access_application_domain).toBe("probe.example.test/_openbot-d1-probe/*");
        expect(first.routes).toEqual([
            expect.objectContaining({
                resource_kind: "writer_a_route",
                target_script_kind: "writer_a_script",
                http_method: "POST",
                exact_url: `https://probe.example.test/_openbot-d1-probe/${suffixes.writer_a_route}`,
            }),
            expect.objectContaining({
                resource_kind: "writer_b_route",
                target_script_kind: "writer_b_script",
                http_method: "POST",
                exact_url: `https://probe.example.test/_openbot-d1-probe/${suffixes.writer_b_route}`,
            }),
            expect.objectContaining({
                resource_kind: "readback_route",
                target_script_kind: "sink_script",
                http_method: "GET",
                exact_url: `https://probe.example.test/_openbot-d1-probe/${suffixes.readback_route}`,
            }),
        ]);
        const output = JSON.stringify(first);
        expect(output).not.toContain(request().account_id);
        expect(output).not.toContain(request().zone_id);
        expect(output).not.toContain(request().operator_database_deny_list[0]);
        expect(output).not.toContain(key);
        expect(first.plan_digest).toBe("fb89f02dba47f7116f3658e24ff5aff1d20ecd3686f0a3385653c1eaf5dddd7d");
    });

    it("rejects duplicate names, unsafe identifiers, noncanonical keys, and hostile input", async () => {
        const duplicate = request();
        duplicate.resource_suffixes.writer_a_script = duplicate.resource_suffixes.database;
        expect(await compileD1ProbePreflightPlanV1(duplicate, { hmac_key_base64url: key })).toEqual({
            success: false,
            code: "invalid_preflight_request",
        });

        const unsafe = request();
        unsafe.operator_database_deny_list = ["production-db"];
        expect(await compileD1ProbePreflightPlanV1(unsafe, { hmac_key_base64url: key })).toEqual({
            success: false,
            code: "invalid_preflight_request",
        });
        for (const probeOrigin of [
            "http://probe.example.test",
            "https://probe.example.test/path",
            "https://probe.example.test:8443",
            "https://127.0.0.1",
            "https://Probe.example.test",
        ]) {
            expect(
                await compileD1ProbePreflightPlanV1(
                    { ...request(), probe_origin: probeOrigin },
                    { hmac_key_base64url: key }
                )
            ).toEqual({ success: false, code: "invalid_preflight_request" });
        }
        expect(await compileD1ProbePreflightPlanV1(request(), { hmac_key_base64url: `${key}=` })).toEqual({
            success: false,
            code: "invalid_commitment_key",
        });

        const hostile = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("hostile input");
                },
            }
        );
        expect(await compileD1ProbePreflightPlanV1(hostile, {})).toEqual({
            success: false,
            code: "invalid_preflight_request",
        });
    });

    it("accepts canonical stdin with a separate file-descriptor key", async () => {
        const canonicalRequest = canonicalizeJsonV1(request() as CanonicalJsonValueV1);
        const success = await runCli(canonicalRequest, key);
        expect(success).toMatchObject({ code: 0, stderr: "" });
        expect(success.stdout).not.toContain(key);
        expect(JSON.parse(success.stdout)).toMatchObject({
            kind: "d1_probe_preflight_plan",
            deploy_performed: false,
        });
    }, 15_000);

    it("rejects noncanonical stdin", async () => {
        const noncanonical = await runCli(`${JSON.stringify(request(), null, 2)}\n`, key);
        expect(noncanonical).toEqual({ code: 1, stdout: "", stderr: "invalid_canonical_json\n" });
    }, 15_000);

    it("rejects a missing file-descriptor key", async () => {
        const canonicalRequest = canonicalizeJsonV1(request() as CanonicalJsonValueV1);
        const missingKey = await runCli(canonicalRequest);
        expect(missingKey).toEqual({ code: 1, stdout: "", stderr: "commitment_key_unavailable\n" });
    }, 15_000);
});

describe("D1 probe resource lifecycle", () => {
    it("accepts only the exact provision and cleanup order with matching resource commitments", async () => {
        const compiledPlan = await plan();
        const created = createD1ProbeLifecycleJournalV1(compiledPlan);
        expect(created.success).toBe(true);
        if (!created.success) return;
        let journal = created.journal;
        for (const [index, step] of D1_PROBE_LIFECYCLE_STEPS_V1.entries()) {
            const result = advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                journal,
                eventForStep(compiledPlan, step, index)
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            journal = result.journal;
            if (index + 1 === D1_PROBE_CREATE_STEPS_V1.length) expect(journal.state).toBe("ready");
        }
        expect(journal.state).toBe("cleanup_confirmed");
        expect(journal.completed_steps).toEqual(D1_PROBE_LIFECYCLE_STEPS_V1);
        expect(markD1ProbeLifecycleAmbiguousV1(compiledPlan, journal, {})).toEqual({
            success: false,
            code: "terminal_lifecycle_state",
        });
    });

    it("denies skipped steps, repeated steps, and deletion under a substituted resource ID", async () => {
        const compiledPlan = await plan();
        const created = createD1ProbeLifecycleJournalV1(compiledPlan);
        if (!created.success) throw new Error(created.code);
        expect(
            advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                created.journal,
                eventForStep(compiledPlan, "sink_deployed", 0)
            )
        ).toEqual({
            success: false,
            code: "unexpected_lifecycle_step",
        });

        let journal = created.journal;
        for (const [index, step] of D1_PROBE_LIFECYCLE_STEPS_V1.entries()) {
            if (step === "database_deleted") {
                expect(
                    advanceD1ProbeLifecycleJournalV1(
                        compiledPlan,
                        journal,
                        eventForStep(compiledPlan, step, index, hex("f"))
                    )
                ).toEqual({
                    success: false,
                    code: "resource_binding_mismatch",
                });
            }
            const result = advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                journal,
                eventForStep(compiledPlan, step, index)
            );
            if (!result.success) throw new Error(result.code);
            journal = result.journal;
            expect(
                advanceD1ProbeLifecycleJournalV1(compiledPlan, journal, eventForStep(compiledPlan, step, index))
            ).toMatchObject({ success: false });
        }
    });

    it("makes ambiguity terminal and binds it to the exact next step", async () => {
        const compiledPlan = await plan();
        const created = createD1ProbeLifecycleJournalV1(compiledPlan);
        if (!created.success) throw new Error(created.code);
        const wrongStep = markD1ProbeLifecycleAmbiguousV1(compiledPlan, created.journal, {
            failed_step: "sink_deployed",
            reason: "ambiguous_create",
            observation_digest: hex("a"),
        });
        expect(wrongStep).toEqual({ success: false, code: "invalid_lifecycle_journal" });

        const ambiguous = markD1ProbeLifecycleAmbiguousV1(compiledPlan, created.journal, {
            failed_step: "database_created",
            reason: "ambiguous_create",
            observation_digest: hex("a"),
        });
        expect(ambiguous.success).toBe(true);
        if (!ambiguous.success) return;
        expect(ambiguous.journal.state).toBe("manual_required");
        expect(
            advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                ambiguous.journal,
                eventForStep(compiledPlan, "database_created", 0)
            )
        ).toEqual({
            success: false,
            code: "manual_review_required",
        });
        expect(
            markD1ProbeLifecycleAmbiguousV1(compiledPlan, ambiguous.journal, {
                failed_step: "database_created",
                reason: "ambiguous_create",
                observation_digest: hex("b"),
            })
        ).toEqual({ success: false, code: "terminal_lifecycle_state" });
    });

    it("rejects forged journal states and hostile lifecycle events", async () => {
        const compiledPlan = await plan();
        const created = createD1ProbeLifecycleJournalV1(compiledPlan);
        if (!created.success) throw new Error(created.code);
        expect(D1ProbeLifecycleJournalV1Schema.safeParse({ ...created.journal, state: "ready" }).success).toBe(false);
        const substitutedResourceJournal = {
            ...created.journal,
            planned_resources: created.journal.planned_resources.map((resource, index) =>
                index === 0 ? { ...resource, generated_name_commitment: hex("f") } : resource
            ),
        };
        expect(
            advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                substitutedResourceJournal,
                eventForStep(compiledPlan, "database_created", 0)
            )
        ).toEqual({ success: false, code: "invalid_lifecycle_journal" });
        const reducedDenyListJournal = {
            ...created.journal,
            operator_database_deny_id_commitments: created.journal.operator_database_deny_id_commitments.slice(1),
        };
        expect(
            advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                reducedDenyListJournal,
                eventForStep(compiledPlan, "database_created", 0)
            )
        ).toEqual({ success: false, code: "invalid_lifecycle_journal" });
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile event");
                },
            }
        );
        expect(advanceD1ProbeLifecycleJournalV1(compiledPlan, created.journal, hostile)).toEqual({
            success: false,
            code: "invalid_lifecycle_event",
        });
    });

    it("binds resource names and denies an operator-listed database before provisioning", async () => {
        const compiledPlan = await plan();
        const created = createD1ProbeLifecycleJournalV1(compiledPlan);
        if (!created.success) throw new Error(created.code);
        expect(
            advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                created.journal,
                eventForStep(compiledPlan, "database_created", 0, undefined, hex("f"))
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        expect(
            advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                created.journal,
                eventForStep(compiledPlan, "database_created", 0, compiledPlan.operator_database_deny_id_commitments[0])
            )
        ).toEqual({ success: false, code: "production_database_denied" });
    });
});

describe("D1 probe verified preflight", () => {
    it("recompiles the exact plan and retains an immutable in-memory context without the HMAC key", async () => {
        const rawRequest = request();
        const compiledPlan = await plan();
        const result = await verifyD1ProbePreflightV1(rawRequest, compiledPlan, { hmac_key_base64url: key });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.verified).toEqual({ schema_version: 1, kind: "verified_d1_probe_preflight" });
        expect(JSON.stringify(result.verified)).not.toContain(key);
        const context = resolveVerifiedD1ProbePreflightV1(result.verified);
        expect(context?.request.account_id).toBe(rawRequest.account_id);
        expect(context?.plan.plan_digest).toBe(compiledPlan.plan_digest);
        expect(JSON.stringify(context)).not.toContain(key);

        rawRequest.account_id = "f".repeat(32);
        compiledPlan.resources[0]!.generated_name = "openbot-d1-probe-ffffffffffffffff";
        expect(context?.request.account_id).toBe("a".repeat(32));
        expect(context?.plan.resources[0]?.generated_name).not.toBe("openbot-d1-probe-ffffffffffffffff");
        expect(() => {
            (context?.request.resource_suffixes as { database: string }).database = "f".repeat(16);
        }).toThrow(TypeError);
    });

    it("rejects substituted plans, requests, keys, and shape-only brand fabrication", async () => {
        const compiledPlan = await plan();
        expect(
            await verifyD1ProbePreflightV1(
                request(),
                { ...compiledPlan, plan_digest: hex("f") },
                { hmac_key_base64url: key }
            )
        ).toEqual({ success: false, code: "preflight_plan_mismatch" });
        expect(
            await verifyD1ProbePreflightV1(
                request(),
                {
                    ...compiledPlan,
                    routes: [
                        { ...compiledPlan.routes[0], route_pattern_commitment: hex("f") },
                        compiledPlan.routes[1],
                        compiledPlan.routes[2],
                    ],
                },
                { hmac_key_base64url: key }
            )
        ).toEqual({ success: false, code: "preflight_plan_mismatch" });

        const substitutedRequest = request();
        substitutedRequest.account_id = "c".repeat(32);
        expect(await verifyD1ProbePreflightV1(substitutedRequest, compiledPlan, { hmac_key_base64url: key })).toEqual({
            success: false,
            code: "preflight_plan_mismatch",
        });
        expect(
            await verifyD1ProbePreflightV1(request(), compiledPlan, {
                hmac_key_base64url: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
            })
        ).toEqual({ success: false, code: "preflight_plan_mismatch" });
        expect(
            resolveVerifiedD1ProbePreflightV1({
                schema_version: 1,
                kind: "verified_d1_probe_preflight",
            } as VerifiedD1ProbePreflightV1)
        ).toBeNull();
    });

    it("returns typed denials for malformed and hostile inputs", async () => {
        const compiledPlan = await plan();
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile input");
                },
            }
        );
        expect(await verifyD1ProbePreflightV1(hostile, compiledPlan, { hmac_key_base64url: key })).toEqual({
            success: false,
            code: "invalid_preflight_request",
        });
        expect(await verifyD1ProbePreflightV1(request(), hostile, { hmac_key_base64url: key })).toEqual({
            success: false,
            code: "invalid_preflight_plan",
        });
        expect(() => D1ProbePreflightPlanV1Schema.safeParse({ ...compiledPlan, probe_origin: "://" })).not.toThrow();
        expect(D1ProbePreflightPlanV1Schema.safeParse({ ...compiledPlan, probe_origin: "://" }).success).toBe(false);
        expect(
            D1ProbePreflightPlanV1Schema.safeParse({
                ...compiledPlan,
                access_application_domain: "probe.example.test/*",
            }).success
        ).toBe(false);
        for (const changedRoute of [
            { ...compiledPlan.routes[0], target_script_name: compiledPlan.routes[1].target_script_name },
            { ...compiledPlan.routes[0], http_method: "GET" },
            { ...compiledPlan.routes[0], exact_url: `${compiledPlan.routes[0].exact_url}/broader` },
        ]) {
            expect(
                D1ProbePreflightPlanV1Schema.safeParse({
                    ...compiledPlan,
                    routes: [changedRoute, compiledPlan.routes[1], compiledPlan.routes[2]],
                }).success
            ).toBe(false);
        }
        expect(await verifyD1ProbePreflightV1(request(), compiledPlan, hostile)).toEqual({
            success: false,
            code: "invalid_commitment_key",
        });
    });
});

describe("D1 probe route readback inspection", () => {
    it("binds an active full zone and complete proxied DNS readback without granting deployment authority", async () => {
        const verified = await verifiedPreflight();
        const result = inspectD1ProbeRouteReadbackV1(verified, routeReadback());
        expect(result).toEqual({
            success: true,
            inspection: {
                schema_version: 1,
                kind: "untrusted_d1_probe_route_inspection",
                status: "route_requirements_observed",
                authoritative: false,
                deploy_performed: false,
                eligible_for_deployment: false,
                gate_promotion_allowed: false,
                plan_digest: (await plan()).plan_digest,
                dns_record_count: 1,
            },
        });
        if (result.success) expect(Object.isFrozen(result.inspection)).toBe(true);
        expect(JSON.stringify(result)).not.toContain(request().account_id);
        expect(JSON.stringify(result)).not.toContain(request().zone_id);
        expect(JSON.stringify(result)).not.toContain("c".repeat(32));
    });

    it("denies account, zone, lifecycle, zone-boundary, and query substitution", async () => {
        const verified = await verifiedPreflight();
        const cases = [
            [
                { ...routeReadback(), zone: { ...routeReadback().zone, account_id: "d".repeat(32) } },
                "cloudflare_account_mismatch",
            ],
            [{ ...routeReadback(), zone: { ...routeReadback().zone, id: "d".repeat(32) } }, "cloudflare_zone_mismatch"],
            [{ ...routeReadback(), zone: { ...routeReadback().zone, status: "pending" } }, "cloudflare_zone_inactive"],
            [{ ...routeReadback(), zone: { ...routeReadback().zone, type: "partial" } }, "cloudflare_zone_unsupported"],
            [{ ...routeReadback(), zone: { ...routeReadback().zone, paused: true } }, "cloudflare_zone_paused"],
            [
                { ...routeReadback(), zone: { ...routeReadback().zone, name: "other.test" } },
                "probe_hostname_outside_zone",
            ],
            [
                { ...routeReadback(), dns_query: { ...routeReadback().dns_query, name_exact: "other.example.test" } },
                "dns_query_mismatch",
            ],
        ] as const;
        for (const [readback, code] of cases) {
            expect(inspectD1ProbeRouteReadbackV1(verified, readback)).toEqual({ success: false, code });
        }
    });

    it("denies incomplete, empty, duplicate, mismatched, or unproxied DNS observations", async () => {
        const verified = await verifiedPreflight();
        const base = routeReadback();
        const secondPage = {
            ...base.dns_query.pages[0],
            page: 2,
            records: [{ ...base.dns_query.pages[0]!.records[0]!, id: "d".repeat(32) }],
        };
        const cases = [
            [
                {
                    ...base,
                    dns_query: {
                        ...base.dns_query,
                        pages: [{ ...base.dns_query.pages[0], total_pages: 2 }],
                    },
                },
                "dns_pagination_incomplete",
            ],
            [
                {
                    ...base,
                    dns_query: {
                        ...base.dns_query,
                        pages: [{ ...base.dns_query.pages[0], count: 0, total_count: 0, records: [] }],
                    },
                },
                "proxied_dns_missing",
            ],
            [
                {
                    ...base,
                    dns_query: {
                        ...base.dns_query,
                        pages: [
                            { ...base.dns_query.pages[0], total_pages: 2, total_count: 2 },
                            {
                                ...secondPage,
                                total_pages: 2,
                                total_count: 2,
                                records: base.dns_query.pages[0]!.records,
                            },
                        ],
                    },
                },
                "dns_record_mismatch",
            ],
            [
                {
                    ...base,
                    dns_query: {
                        ...base.dns_query,
                        pages: [
                            {
                                ...base.dns_query.pages[0],
                                records: [{ ...base.dns_query.pages[0]!.records[0]!, name: "other.example.test" }],
                            },
                        ],
                    },
                },
                "dns_record_mismatch",
            ],
            [
                {
                    ...base,
                    dns_query: {
                        ...base.dns_query,
                        pages: [
                            {
                                ...base.dns_query.pages[0],
                                records: [{ ...base.dns_query.pages[0]!.records[0]!, proxied: false }],
                            },
                        ],
                    },
                },
                "dns_record_not_proxied",
            ],
        ] as const;
        for (const [readback, code] of cases) {
            expect(inspectD1ProbeRouteReadbackV1(verified, readback)).toEqual({ success: false, code });
        }
    });

    it("rejects shape-only preflight tokens, malformed pagination, hostile input, and later input mutation", async () => {
        expect(
            inspectD1ProbeRouteReadbackV1(
                { schema_version: 1, kind: "verified_d1_probe_preflight" } as VerifiedD1ProbePreflightV1,
                routeReadback()
            )
        ).toEqual({ success: false, code: "invalid_verified_preflight" });

        const verified = await verifiedPreflight();
        const malformed = routeReadback();
        malformed.dns_query.pages[0]!.count = 2;
        expect(inspectD1ProbeRouteReadbackV1(verified, malformed)).toEqual({
            success: false,
            code: "invalid_cloudflare_readback",
        });

        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile readback");
                },
            }
        );
        expect(() => inspectD1ProbeRouteReadbackV1(verified, hostile)).not.toThrow();
        expect(inspectD1ProbeRouteReadbackV1(verified, hostile)).toEqual({
            success: false,
            code: "invalid_cloudflare_readback",
        });

        const mutable = routeReadback();
        const result = inspectD1ProbeRouteReadbackV1(verified, mutable);
        mutable.zone.account_id = "f".repeat(32);
        expect(result.success).toBe(true);
        if (result.success) expect(result.inspection.dns_record_count).toBe(1);
    });
});

describe("D1 probe Cloudflare route reader", () => {
    it("performs two bounded read-only API calls and returns no credential or raw Cloudflare ID", async () => {
        const verified = await verifiedPreflight();
        const apiToken = "x".repeat(32);
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            expect(init?.method).toBe("GET");
            expect(init?.redirect).toBe("manual");
            expect(init?.cache).toBe("no-store");
            expect(init?.credentials).toBe("omit");
            expect(init?.body).toBeUndefined();
            expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiToken}`);
            expect(new Headers(init?.headers).get("accept")).toBe("application/json");
            expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
            if (url.endsWith(`/zones/${request().zone_id}`)) return jsonResponse(cloudflareZoneResponse());
            expect(url).toBe(
                `https://api.cloudflare.com/client/v4/zones/${request().zone_id}/dns_records?match=all&name.exact=probe.example.test&page=1&per_page=1000&proxied=true`
            );
            return jsonResponse(cloudflareDnsResponse(1));
        });

        const result = await readD1ProbeCloudflareRouteV1(
            verified,
            { api_token: apiToken },
            { fetch: fetchMock as typeof globalThis.fetch }
        );
        expect(result).toMatchObject({
            success: true,
            inspection: {
                authoritative: false,
                deploy_performed: false,
                eligible_for_deployment: false,
                gate_promotion_allowed: false,
                dns_record_count: 1,
            },
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(result)).not.toContain(apiToken);
        expect(JSON.stringify(result)).not.toContain(request().account_id);
        expect(JSON.stringify(result)).not.toContain(request().zone_id);
        expect(JSON.stringify(result)).not.toContain(cloudflareDnsResponse(1).result[0]!.id);
    });

    it("reads every declared DNS page once and keeps the total bounded", async () => {
        const verified = await verifiedPreflight();
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith(`/zones/${request().zone_id}`)) return jsonResponse(cloudflareZoneResponse());
            const page = new URL(url).searchParams.get("page");
            if (page === "1") return jsonResponse(cloudflareDnsResponse(1, 2));
            if (page === "2") return jsonResponse(cloudflareDnsResponse(2, 2));
            throw new Error("unexpected page");
        });
        const result = await readD1ProbeCloudflareRouteV1(
            verified,
            { api_token: "x".repeat(32) },
            { fetch: fetchMock as typeof globalThis.fetch }
        );
        expect(result).toMatchObject({ success: true, inspection: { dns_record_count: 2 } });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("denies forged preflight state or credentials before a network request", async () => {
        const fetchMock = vi.fn();
        expect(
            await readD1ProbeCloudflareRouteV1(
                { schema_version: 1, kind: "verified_d1_probe_preflight" } as VerifiedD1ProbePreflightV1,
                { api_token: "x".repeat(32) },
                { fetch: fetchMock as typeof globalThis.fetch }
            )
        ).toEqual({ success: false, code: "invalid_verified_preflight" });

        const verified = await verifiedPreflight();
        for (const credential of [
            {},
            { api_token: "too-short" },
            { api_token: "x".repeat(32), extra: true },
            new Proxy(
                {},
                {
                    ownKeys: () => {
                        throw new Error("hostile credential");
                    },
                }
            ),
        ]) {
            expect(
                await readD1ProbeCloudflareRouteV1(verified, credential, {
                    fetch: fetchMock as typeof globalThis.fetch,
                })
            ).toEqual({ success: false, code: "invalid_api_token" });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not retry network failure and maps unsafe HTTP responses to fixed denials", async () => {
        const verified = await verifiedPreflight();
        const apiToken = { api_token: "x".repeat(32) };
        const networkFailure = vi.fn(async () => {
            throw new Error(`do not expose ${apiToken.api_token}`);
        });
        expect(
            await readD1ProbeCloudflareRouteV1(verified, apiToken, {
                fetch: networkFailure as typeof globalThis.fetch,
            })
        ).toEqual({ success: false, code: "cloudflare_request_failed" });
        expect(networkFailure).toHaveBeenCalledTimes(1);

        const responses: Array<[Response, string]> = [
            [
                new Response("", { status: 302, headers: { location: "https://attacker.example" } }),
                "cloudflare_response_invalid",
            ],
            [
                new Response("{}", { status: 200, headers: { "content-type": "text/plain" } }),
                "cloudflare_response_invalid",
            ],
            [
                new Response("{}", {
                    status: 200,
                    headers: { "content-type": "application/json", "content-encoding": "gzip" },
                }),
                "cloudflare_response_invalid",
            ],
            [
                new Response("{}", {
                    status: 200,
                    headers: { "content-type": "application/json", "content-length": "262145" },
                }),
                "cloudflare_response_too_large",
            ],
            [
                new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
                "cloudflare_response_invalid",
            ],
            [
                jsonResponse({ success: false, errors: [{ code: 1000, message: "denied" }] }),
                "cloudflare_response_invalid",
            ],
        ];
        for (const [response, code] of responses) {
            const fetchMock = vi.fn(async () => response);
            expect(
                await readD1ProbeCloudflareRouteV1(verified, apiToken, {
                    fetch: fetchMock as typeof globalThis.fetch,
                })
            ).toEqual({ success: false, code });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it("uses one deadline for the full read and enforces an aggregate response cap", async () => {
        const verified = await verifiedPreflight();
        const apiToken = { api_token: "x".repeat(32) };
        vi.useFakeTimers();
        try {
            const stalledFetch = vi.fn(
                async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
                    await new Promise((_resolve, reject) => {
                        init?.signal?.addEventListener(
                            "abort",
                            () => reject(new DOMException("timed out", "AbortError")),
                            { once: true }
                        );
                    })
            );
            const pending = readD1ProbeCloudflareRouteV1(verified, apiToken, {
                fetch: stalledFetch as typeof globalThis.fetch,
            });
            await vi.advanceTimersByTimeAsync(20_000);
            expect(await pending).toEqual({ success: false, code: "cloudflare_request_failed" });
            expect(stalledFetch).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }

        const largeFetch = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith(`/zones/${request().zone_id}`)) return jsonResponse(cloudflareZoneResponse());
            const page = Number(new URL(url).searchParams.get("page"));
            return jsonResponse({ ...cloudflareDnsResponse(page, 5), padding: "p".repeat(220_000) });
        });
        expect(
            await readD1ProbeCloudflareRouteV1(verified, apiToken, {
                fetch: largeFetch as typeof globalThis.fetch,
            })
        ).toEqual({ success: false, code: "cloudflare_response_too_large" });
        expect(largeFetch).toHaveBeenCalledTimes(6);
    });

    it("binds API observations to the preflight and rejects inconsistent pagination or proxy state", async () => {
        const verified = await verifiedPreflight();
        const run = async (zone: unknown, dns: unknown) => {
            const fetchMock = vi.fn(async (input: string | URL | Request) =>
                String(input).includes("/dns_records?") ? jsonResponse(dns) : jsonResponse(zone)
            );
            return await readD1ProbeCloudflareRouteV1(
                verified,
                { api_token: "x".repeat(32) },
                { fetch: fetchMock as typeof globalThis.fetch }
            );
        };
        expect(
            await run(
                {
                    ...cloudflareZoneResponse(),
                    result: { ...cloudflareZoneResponse().result, account: { id: "d".repeat(32) } },
                },
                cloudflareDnsResponse(1)
            )
        ).toEqual({ success: false, code: "cloudflare_account_mismatch" });
        expect(
            await run(cloudflareZoneResponse(), {
                ...cloudflareDnsResponse(1),
                result_info: { ...cloudflareDnsResponse(1).result_info, page: 2 },
            })
        ).toEqual({ success: false, code: "cloudflare_response_invalid" });
        expect(
            await run(cloudflareZoneResponse(), {
                ...cloudflareDnsResponse(1),
                result: [{ ...cloudflareDnsResponse(1).result[0], proxied: false }],
            })
        ).toEqual({ success: false, code: "dns_record_not_proxied" });
    });
});

describe("D1 probe Cloudflare database creation", () => {
    const plannedJournal = async () => {
        const compiledPlan = await plan();
        const created = createD1ProbeLifecycleJournalV1(compiledPlan);
        if (!created.success) throw new Error(created.code);
        return { compiledPlan, journal: created.journal };
    };

    const provisionedDatabase = async () => {
        const observed = await observedRoute();
        const { compiledPlan, journal } = await plannedJournal();
        const created = await createD1ProbeDatabaseV1(observed, journal, { hmac_key_base64url: key }, "w".repeat(32), {
            fetch: (async () => jsonResponse(cloudflareDatabaseCreateResponse())) as typeof globalThis.fetch,
        });
        if (!created.success) throw new Error(created.code);
        return { compiledPlan, created: created.created, journal: created.journal };
    };

    const journalBeforeDatabaseDelete = (
        compiledPlan: D1ProbePreflightPlanV1,
        createdJournal: D1ProbeLifecycleJournalV1
    ) => {
        let journal = createdJournal;
        for (let index = 1; index < D1_PROBE_LIFECYCLE_STEPS_V1.length; index += 1) {
            const step = D1_PROBE_LIFECYCLE_STEPS_V1[index] as D1ProbeLifecycleStepV1;
            if (step === "database_deleted") break;
            const advanced = advanceD1ProbeLifecycleJournalV1(
                compiledPlan,
                journal,
                eventForStep(compiledPlan, step, index)
            );
            if (!advanced.success) throw new Error(advanced.code);
            journal = advanced.journal;
        }
        return journal;
    };

    it("creates only the exact disposable database and records committed lifecycle evidence", async () => {
        const observed = await observedRoute();
        const { compiledPlan, journal } = await plannedJournal();
        const apiToken = "w".repeat(32);
        const response = cloudflareDatabaseCreateResponse();
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            expect(String(input)).toBe(
                `https://api.cloudflare.com/client/v4/accounts/${request().account_id}/d1/database`
            );
            expect(init?.method).toBe("POST");
            expect(init?.redirect).toBe("manual");
            expect(init?.cache).toBe("no-store");
            expect(init?.credentials).toBe("omit");
            expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiToken}`);
            expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
            expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
            expect(init?.body).toBe(
                canonicalizeJsonV1({
                    jurisdiction: "us",
                    name: `openbot-d1-probe-${suffixes.database}`,
                    read_replication: { mode: "auto" },
                })
            );
            return jsonResponse(response);
        });

        const result = await createD1ProbeDatabaseV1(observed, journal, { hmac_key_base64url: key }, apiToken, {
            fetch: fetchMock as typeof globalThis.fetch,
        });
        expect(result).toMatchObject({
            success: true,
            journal: { state: "provisioning", completed_steps: ["database_created"] },
            observation: {
                authoritative: false,
                deploy_performed: true,
                eligible_for_attestation: false,
                gate_promotion_allowed: false,
                plan_digest: compiledPlan.plan_digest,
                database_jurisdiction: "us",
                read_replication: "auto",
            },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        if (!result.success) throw new Error(result.code);
        expect(resolveCreatedD1ProbeDatabaseV1(result.created)).toMatchObject({
            database_id: response.result.uuid,
            database_name: response.result.name,
            plan_digest: compiledPlan.plan_digest,
        });
        expect(JSON.stringify(result)).not.toContain(response.result.uuid);
        expect(JSON.stringify(result)).not.toContain(apiToken);
        expect(JSON.stringify(result)).not.toContain(key);
        expect(JSON.stringify(result)).not.toContain(request().account_id);
    });

    it("omits jurisdiction only for an explicitly automatic preflight", async () => {
        const automaticRequest = { ...request(), database_jurisdiction: "automatic" as const };
        const compiled = await compileD1ProbePreflightPlanV1(automaticRequest, { hmac_key_base64url: key });
        if (!compiled.success) throw new Error(compiled.code);
        const verified = await verifyD1ProbePreflightV1(automaticRequest, compiled.plan, {
            hmac_key_base64url: key,
        });
        if (!verified.success) throw new Error(verified.code);
        const route = await readD1ProbeCloudflareRouteV1(
            verified.verified,
            { api_token: "r".repeat(32) },
            {
                fetch: (async (input: string | URL | Request) =>
                    String(input).includes("/dns_records?")
                        ? jsonResponse(cloudflareDnsResponse(1))
                        : jsonResponse(cloudflareZoneResponse())) as typeof globalThis.fetch,
            }
        );
        if (!route.success) throw new Error(route.code);
        const journal = createD1ProbeLifecycleJournalV1(compiled.plan);
        if (!journal.success) throw new Error(journal.code);
        const responseWithJurisdiction = cloudflareDatabaseCreateResponse();
        const { jurisdiction: _jurisdiction, ...resultWithoutJurisdiction } = responseWithJurisdiction.result;
        const response = { ...responseWithJurisdiction, result: resultWithoutJurisdiction };
        const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            expect(init?.body).toBe(
                canonicalizeJsonV1({
                    name: `openbot-d1-probe-${suffixes.database}`,
                    read_replication: { mode: "auto" },
                })
            );
            return jsonResponse(response);
        });
        const result = await createD1ProbeDatabaseV1(
            route.observed,
            journal.journal,
            { hmac_key_base64url: key },
            "w".repeat(32),
            { fetch: fetchMock as typeof globalThis.fetch }
        );
        expect(result).toMatchObject({
            success: true,
            observation: { database_jurisdiction: "automatic", read_replication: "auto" },
        });
    });

    it("rejects forged route state, invalid journals, and credentials before mutation", async () => {
        const { journal } = await plannedJournal();
        const fetchMock = vi.fn();
        const dependencies = { fetch: fetchMock as typeof globalThis.fetch };
        const forged = Object.freeze({
            schema_version: 1 as const,
            kind: "observed_d1_probe_cloudflare_route" as const,
        });
        expect(
            await createD1ProbeDatabaseV1(forged, journal, { hmac_key_base64url: key }, "w".repeat(32), dependencies)
        ).toEqual({ success: false, code: "invalid_observed_route" });

        const observed = await observedRoute();
        const substitutedJournal = {
            ...journal,
            planned_resources: journal.planned_resources.map((resource, index) =>
                index === 0 ? { ...resource, generated_name_commitment: hex("f") } : resource
            ),
        };
        expect(
            await createD1ProbeDatabaseV1(
                observed,
                substitutedJournal,
                { hmac_key_base64url: key },
                "w".repeat(32),
                dependencies
            )
        ).toEqual({ success: false, code: "invalid_lifecycle_journal" });
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile journal");
                },
            }
        );
        expect(
            await createD1ProbeDatabaseV1(observed, hostile, { hmac_key_base64url: key }, "w".repeat(32), dependencies)
        ).toEqual({ success: false, code: "invalid_lifecycle_journal" });
        expect(await createD1ProbeDatabaseV1(observed, journal, {}, "w".repeat(32), dependencies)).toEqual({
            success: false,
            code: "invalid_commitment_key",
        });
        expect(
            await createD1ProbeDatabaseV1(
                observed,
                journal,
                { hmac_key_base64url: Buffer.alloc(32, 2).toString("base64url") },
                "w".repeat(32),
                dependencies
            )
        ).toEqual({
            success: false,
            code: "preflight_reverification_failed",
        });
        expect(
            await createD1ProbeDatabaseV1(observed, journal, { hmac_key_base64url: key }, "short", dependencies)
        ).toEqual({ success: false, code: "invalid_api_token" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a stale live route observation before mutation", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
            const observed = await observedRoute();
            const { journal } = await plannedJournal();
            vi.setSystemTime(new Date("2026-08-23T12:05:00.001Z"));
            const fetchMock = vi.fn();
            expect(
                await createD1ProbeDatabaseV1(observed, journal, { hmac_key_base64url: key }, "w".repeat(32), {
                    fetch: fetchMock as typeof globalThis.fetch,
                })
            ).toEqual({ success: false, code: "stale_observed_route" });
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("makes a lost or malformed create response terminal without retrying", async () => {
        for (const fetchImplementation of [
            vi.fn(async () => {
                throw new Error("response lost");
            }),
            vi.fn(async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })),
            vi.fn(
                async () =>
                    new Response("{}", {
                        status: 200,
                        headers: {
                            "content-length": "262145",
                            "content-type": "application/json",
                        },
                    })
            ),
            vi.fn(
                async () =>
                    new Response("{}", {
                        status: 200,
                        headers: {
                            "content-encoding": "gzip",
                            "content-type": "application/json",
                        },
                    })
            ),
        ]) {
            const observed = await observedRoute();
            const { journal } = await plannedJournal();
            const result = await createD1ProbeDatabaseV1(
                observed,
                journal,
                { hmac_key_base64url: key },
                "w".repeat(32),
                { fetch: fetchImplementation as typeof globalThis.fetch }
            );
            expect(result).toMatchObject({
                success: false,
                code: "database_create_outcome_unknown",
                journal: {
                    state: "manual_required",
                    manual_required: { failed_step: "database_created", reason: "ambiguous_create" },
                },
                cleanup_target: null,
            });
            expect(fetchImplementation).toHaveBeenCalledTimes(1);
        }
    });

    it("retains an opaque cleanup target for mismatched created resources", async () => {
        const cases = [
            [cloudflareDatabaseCreateResponse({ name: "wrong-name" }), "database_name_mismatch", "name_mismatch"],
            [
                cloudflareDatabaseCreateResponse({ read_replication: { mode: "disabled" } }),
                "database_configuration_mismatch",
                "unexpected_platform_result",
            ],
            [
                cloudflareDatabaseCreateResponse({ jurisdiction: "eu" }),
                "database_configuration_mismatch",
                "unexpected_platform_result",
            ],
            [
                cloudflareDatabaseCreateResponse({
                    uuid: request().operator_database_deny_list[0] as string,
                }),
                "production_database_denied",
                "id_mismatch",
            ],
        ] as const;
        for (const [response, code, reason] of cases) {
            const observed = await observedRoute();
            const { journal } = await plannedJournal();
            const result = await createD1ProbeDatabaseV1(
                observed,
                journal,
                { hmac_key_base64url: key },
                "w".repeat(32),
                { fetch: (async () => jsonResponse(response)) as typeof globalThis.fetch }
            );
            expect(result).toMatchObject({
                success: false,
                code,
                journal: {
                    state: "manual_required",
                    manual_required: { failed_step: "database_created", reason },
                },
            });
            if (result.success || !("cleanup_target" in result) || result.cleanup_target === null) {
                throw new Error("expected opaque cleanup target");
            }
            expect(resolveCreatedD1ProbeDatabaseV1(result.cleanup_target)).toMatchObject({
                database_id: response.result.uuid,
                database_name: response.result.name,
                plan_digest: (await plan()).plan_digest,
            });
            expect(JSON.stringify(result)).not.toContain(response.result.uuid);
        }
    });

    it("requests exact database deletion once and records acknowledgement without claiming absence", async () => {
        const provisioned = await provisionedDatabase();
        const journal = journalBeforeDatabaseDelete(provisioned.compiledPlan, provisioned.journal);
        const rawDatabase = resolveCreatedD1ProbeDatabaseV1(provisioned.created);
        if (rawDatabase === null) throw new Error("missing created database context");
        const apiToken = "d".repeat(32);
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            expect(String(input)).toBe(
                `https://api.cloudflare.com/client/v4/accounts/${request().account_id}/d1/database/${rawDatabase.database_id}`
            );
            expect(init?.method).toBe("DELETE");
            expect(init?.body).toBeUndefined();
            expect(init?.redirect).toBe("manual");
            expect(init?.cache).toBe("no-store");
            expect(init?.credentials).toBe("omit");
            expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiToken}`);
            expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
            return jsonResponse({ success: true, errors: [], messages: [], result: {} });
        });
        const result = await deleteD1ProbeDatabaseV1(
            provisioned.created,
            journal,
            { hmac_key_base64url: key },
            apiToken,
            { fetch: fetchMock as typeof globalThis.fetch }
        );
        expect(result).toMatchObject({
            success: true,
            journal: { state: "cleaning_up", completed_steps: expect.arrayContaining(["database_deleted"]) },
            observation: {
                status: "sdk_acknowledged",
                authoritative: false,
                absence_verified: false,
                eligible_for_attestation: false,
                gate_promotion_allowed: false,
            },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(result)).not.toContain(rawDatabase.database_id);
        expect(JSON.stringify(result)).not.toContain(apiToken);
        expect(JSON.stringify(result)).not.toContain(key);

        expect(
            await deleteD1ProbeDatabaseV1(provisioned.created, journal, { hmac_key_base64url: key }, apiToken, {
                fetch: fetchMock as typeof globalThis.fetch,
            })
        ).toEqual({ success: false, code: "database_delete_already_requested" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("makes lost, malformed, oversized, and encoded delete responses terminal without retry", async () => {
        for (const fetchImplementation of [
            vi.fn(async () => {
                throw new Error("delete response lost");
            }),
            vi.fn(async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })),
            vi.fn(
                async () =>
                    new Response("{}", {
                        status: 200,
                        headers: { "content-length": "262145", "content-type": "application/json" },
                    })
            ),
            vi.fn(
                async () =>
                    new Response("{}", {
                        status: 200,
                        headers: { "content-encoding": "gzip", "content-type": "application/json" },
                    })
            ),
        ]) {
            const provisioned = await provisionedDatabase();
            const journal = journalBeforeDatabaseDelete(provisioned.compiledPlan, provisioned.journal);
            const result = await deleteD1ProbeDatabaseV1(
                provisioned.created,
                journal,
                { hmac_key_base64url: key },
                "d".repeat(32),
                { fetch: fetchImplementation as typeof globalThis.fetch }
            );
            expect(result).toMatchObject({
                success: false,
                code: "database_delete_outcome_unknown",
                journal: {
                    state: "manual_required",
                    manual_required: { failed_step: "database_deleted", reason: "ambiguous_delete" },
                },
            });
            expect(
                await deleteD1ProbeDatabaseV1(
                    provisioned.created,
                    journal,
                    { hmac_key_base64url: key },
                    "d".repeat(32),
                    { fetch: fetchImplementation as typeof globalThis.fetch }
                )
            ).toEqual({ success: false, code: "database_delete_already_requested" });
            expect(fetchImplementation).toHaveBeenCalledTimes(1);
        }
    });

    it("allows one exact emergency cleanup request without clearing manual review", async () => {
        const observed = await observedRoute();
        const { journal } = await plannedJournal();
        const mismatched = await createD1ProbeDatabaseV1(
            observed,
            journal,
            { hmac_key_base64url: key },
            "w".repeat(32),
            {
                fetch: (async () =>
                    jsonResponse(cloudflareDatabaseCreateResponse({ name: "wrong-name" }))) as typeof globalThis.fetch,
            }
        );
        if (mismatched.success || !("cleanup_target" in mismatched) || mismatched.cleanup_target === null) {
            throw new Error("missing emergency cleanup target");
        }
        const otherMismatch = await createD1ProbeDatabaseV1(
            observed,
            journal,
            { hmac_key_base64url: key },
            "w".repeat(32),
            {
                fetch: (async () =>
                    jsonResponse(
                        cloudflareDatabaseCreateResponse({
                            uuid: "87654321-4321-4321-8321-210987654321",
                            name: "another-wrong-name",
                        })
                    )) as typeof globalThis.fetch,
            }
        );
        if (otherMismatch.success || !("cleanup_target" in otherMismatch) || otherMismatch.cleanup_target === null) {
            throw new Error("missing second emergency cleanup target");
        }
        const fetchMock = vi.fn(async () => jsonResponse({ success: true, errors: [], messages: [], result: {} }));
        expect(
            await deleteD1ProbeDatabaseV1(
                mismatched.cleanup_target,
                otherMismatch.journal,
                { hmac_key_base64url: key },
                "d".repeat(32),
                { fetch: fetchMock as typeof globalThis.fetch }
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        const result = await deleteD1ProbeDatabaseV1(
            mismatched.cleanup_target,
            mismatched.journal,
            { hmac_key_base64url: key },
            "d".repeat(32),
            { fetch: fetchMock as typeof globalThis.fetch }
        );
        expect(result).toMatchObject({
            success: true,
            journal: { state: "manual_required", manual_required: { failed_step: "database_created" } },
            observation: { status: "sdk_acknowledged", absence_verified: false },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects target, journal, key, and credential substitution before deletion", async () => {
        const provisioned = await provisionedDatabase();
        const journal = journalBeforeDatabaseDelete(provisioned.compiledPlan, provisioned.journal);
        const fetchMock = vi.fn();
        const dependencies = { fetch: fetchMock as typeof globalThis.fetch };
        expect(
            await deleteD1ProbeDatabaseV1(
                { schema_version: 1, kind: "created_d1_probe_database" },
                journal,
                { hmac_key_base64url: key },
                "d".repeat(32),
                dependencies
            )
        ).toEqual({ success: false, code: "invalid_created_database" });
        const substitutedJournal = {
            ...journal,
            observations: journal.observations.map(observation =>
                observation.step === "database_created"
                    ? { ...observation, resource_id_commitment: hex("f") }
                    : observation
            ),
        };
        expect(
            await deleteD1ProbeDatabaseV1(
                provisioned.created,
                substitutedJournal,
                { hmac_key_base64url: key },
                "d".repeat(32),
                dependencies
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        expect(
            await deleteD1ProbeDatabaseV1(
                provisioned.created,
                journal,
                { hmac_key_base64url: Buffer.alloc(32, 2).toString("base64url") },
                "d".repeat(32),
                dependencies
            )
        ).toEqual({ success: false, code: "preflight_reverification_failed" });
        expect(
            await deleteD1ProbeDatabaseV1(
                provisioned.created,
                journal,
                { hmac_key_base64url: key },
                "short",
                dependencies
            )
        ).toEqual({ success: false, code: "invalid_api_token" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("D1 probe route-check command", () => {
    it("reverifies the exact plan before the credentialed reader and emits only a non-authoritative result", async () => {
        const compiledPlan = await plan();
        const command = {
            schema_version: 1,
            kind: "d1_probe_route_check_command",
            request: request(),
            plan: compiledPlan,
        };
        const apiToken = "x".repeat(32);
        const fetchMock = vi.fn(async (input: string | URL | Request) =>
            String(input).includes("/dns_records?")
                ? jsonResponse(cloudflareDnsResponse(1))
                : jsonResponse(cloudflareZoneResponse())
        );
        const result = await executeD1ProbeRouteCheckV1(command, key, apiToken, {
            fetch: fetchMock as typeof globalThis.fetch,
        });
        expect(result).toMatchObject({
            success: true,
            inspection: {
                authoritative: false,
                deploy_performed: false,
                eligible_for_deployment: false,
                gate_promotion_allowed: false,
            },
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(result)).not.toContain(key);
        expect(JSON.stringify(result)).not.toContain(apiToken);
        expect(JSON.stringify(result)).not.toContain(request().account_id);
        expect(JSON.stringify(result)).not.toContain(request().zone_id);
    });

    it("denies malformed, hostile, or substituted commands before any API request", async () => {
        const compiledPlan = await plan();
        const fetchMock = vi.fn();
        const dependencies = { fetch: fetchMock as typeof globalThis.fetch };
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile command");
                },
            }
        );
        expect(await executeD1ProbeRouteCheckV1(hostile, key, "x".repeat(32), dependencies)).toEqual({
            success: false,
            code: "invalid_route_check_command",
        });
        expect(
            await executeD1ProbeRouteCheckV1(
                {
                    schema_version: 1,
                    kind: "d1_probe_route_check_command",
                    request: request(),
                    plan: { ...compiledPlan, plan_digest: hex("f") },
                },
                key,
                "x".repeat(32),
                dependencies
            )
        ).toEqual({ success: false, code: "preflight_plan_mismatch" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reads both secrets only from their file descriptors and rejects before network on invalid input", async () => {
        const compiledPlan = await plan();
        const command = canonicalizeJsonV1({
            schema_version: 1,
            kind: "d1_probe_route_check_command",
            request: request(),
            plan: compiledPlan,
        } as CanonicalJsonValueV1);

        expect(await runRouteCli(command)).toEqual({
            code: 1,
            stdout: "",
            stderr: "commitment_key_unavailable\n",
        });
        expect(await runRouteCli(command, key)).toEqual({
            code: 1,
            stdout: "",
            stderr: "api_token_unavailable\n",
        });
        expect(
            await runRouteCli(command, key, undefined, [], {
                ...process.env,
                CLOUDFLARE_API_TOKEN: "x".repeat(32),
            })
        ).toEqual({ code: 1, stdout: "", stderr: "api_token_unavailable\n" });
        expect(await runRouteCli(command, key, "too-short")).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_api_token\n",
        });
        expect(await runRouteCli(command, "k".repeat(129), "x".repeat(32))).toEqual({
            code: 1,
            stdout: "",
            stderr: "commitment_key_unavailable\n",
        });
        expect(await runRouteCli(command, key, "x".repeat(257))).toEqual({
            code: 1,
            stdout: "",
            stderr: "api_token_unavailable\n",
        });
    }, 30_000);

    it("requires canonical stdin, no arguments, and an exact HMAC-bound plan", async () => {
        const compiledPlan = await plan();
        const command = {
            schema_version: 1,
            kind: "d1_probe_route_check_command",
            request: request(),
            plan: compiledPlan,
        };
        expect(await runRouteCli(`${JSON.stringify(command, null, 2)}\n`, key, "too-short")).toEqual({
            code: 1,
            stdout: "",
            stderr: "invalid_canonical_json\n",
        });
        expect(
            await runRouteCli(canonicalizeJsonV1(command as CanonicalJsonValueV1), key, "too-short", ["extra"])
        ).toEqual({ code: 1, stdout: "", stderr: "usage_error\n" });
        const substituted = canonicalizeJsonV1({
            ...command,
            plan: { ...compiledPlan, plan_digest: hex("f") },
        } as CanonicalJsonValueV1);
        expect(await runRouteCli(substituted, key, "x".repeat(32))).toEqual({
            code: 1,
            stdout: "",
            stderr: "preflight_plan_mismatch\n",
        });
    }, 30_000);
});
