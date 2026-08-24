import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it } from "vitest";

import {
    D1_PROBE_CREATE_STEPS_V1,
    D1_PROBE_LIFECYCLE_STEPS_V1,
    D1_PROBE_RESOURCE_KINDS_V1,
    D1ProbeLifecycleJournalV1Schema,
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
        expect(first.plan_digest).toBe("37a357b52f35f35cf4e80dbdb7baf529a1e6e1aa8871e7b3037d268beaf9b85e");
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
