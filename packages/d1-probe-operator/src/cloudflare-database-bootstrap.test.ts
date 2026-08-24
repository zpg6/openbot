import {
    D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1,
} from "@openbot/d1-probe-rpc/schema";
import { describe, expect, it, vi } from "vitest";

import {
    createD1ProbeDatabaseV1,
    deleteD1ProbeDatabaseV1,
    observeD1ProbeDatabaseAbsenceV1,
} from "./cloudflare-database.js";
import {
    initializeD1ProbeDatabaseV1,
    initializedD1ProbeDatabaseMatchesV1,
    resolveInitializedD1ProbeDatabaseV1,
} from "./cloudflare-database-bootstrap.js";
import { createD1ProbeLifecycleJournalV1, markD1ProbeLifecycleAmbiguousV1 } from "./lifecycle.js";
import { compileD1ProbePreflightPlanV1 } from "./preflight.js";
import { readD1ProbeCloudflareRouteV1 } from "./cloudflare-route-reader.js";
import { verifyD1ProbePreflightV1 } from "./verified-preflight.js";

const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const otherKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const apiToken = "w".repeat(32);
const databaseId = "33333333-3333-4333-8333-333333333333";
const suffixes = {
    database: "0000000000000000",
    sink_script: "0000000000000001",
    writer_a_script: "0000000000000002",
    writer_b_script: "0000000000000003",
    access_application: "0000000000000004",
    access_policy: "0000000000000005",
    access_service_token: "0000000000000006",
    writer_a_route: "0000000000000007",
    writer_b_route: "0000000000000008",
    readback_route: "0000000000000009",
} as const;

const request = () => ({
    schema_version: 1 as const,
    kind: "d1_probe_preflight_request" as const,
    account_id: "a".repeat(32),
    zone_id: "b".repeat(32),
    probe_origin: "https://probe.example.test",
    database_jurisdiction: "us" as const,
    installation_digest: "1".repeat(64),
    environment_digest: "2".repeat(64),
    configuration_digest: "3".repeat(64),
    probe_definition_digest: "4".repeat(64),
    collector_build_digest: "5".repeat(64),
    commitment_key_id_digest: "6".repeat(64),
    operator_database_deny_list: ["11111111-1111-1111-1111-111111111111"],
    resource_suffixes: { ...suffixes },
});

const jsonResponse = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });

const meta = (overrides: Partial<Record<string, unknown>> = {}) => ({
    changed_db: false,
    changes: 0,
    duration: 0.1,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by_primary: true,
    size_after: 4096,
    ...overrides,
});

const queryEnvelope = (results: ReadonlyArray<unknown>) => ({
    errors: [],
    messages: [],
    result: results,
    success: true,
});

const queryResult = (results: ReadonlyArray<unknown>, overrides: Partial<Record<string, unknown>> = {}) => ({
    meta: meta(overrides),
    results,
    success: true,
});

const schemaStatements = D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1;
const schemaRows = [...D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1].sort(
    (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
);

const ddlEnvelope = (rows: ReadonlyArray<unknown> = schemaRows, initialRows: ReadonlyArray<unknown> = []) =>
    queryEnvelope(
        [queryResult(initialRows, { rows_read: initialRows.length })]
            .concat(schemaStatements.map(() => queryResult([], { changed_db: true, rows_written: 1 })))
            .concat(queryResult(rows, { rows_read: rows.length }))
    );

const prepareCreatedDatabase = async (id = databaseId) => {
    const compiled = await compileD1ProbePreflightPlanV1(request(), { hmac_key_base64url: key });
    if (!compiled.success) throw new Error(compiled.code);
    const verified = await verifyD1ProbePreflightV1(request(), compiled.plan, { hmac_key_base64url: key });
    if (!verified.success) throw new Error(verified.code);
    const route = await readD1ProbeCloudflareRouteV1(
        verified.verified,
        { api_token: apiToken },
        {
            fetch: (async (input: string | URL | Request) =>
                String(input).includes("/dns_records?")
                    ? jsonResponse({
                          errors: [],
                          messages: [],
                          result: [
                              {
                                  id: "c".repeat(32),
                                  name: "probe.example.test",
                                  type: "A",
                                  proxiable: true,
                                  proxied: true,
                              },
                          ],
                          result_info: { count: 1, page: 1, per_page: 1000, total_count: 1, total_pages: 1 },
                          success: true,
                      })
                    : jsonResponse({
                          errors: [],
                          messages: [],
                          result: {
                              account: { id: request().account_id, name: "Probe account" },
                              id: request().zone_id,
                              name: "example.test",
                              paused: false,
                              status: "active",
                              type: "full",
                          },
                          success: true,
                      })) as typeof globalThis.fetch,
        }
    );
    if (!route.success) throw new Error(route.code);
    const initialJournal = createD1ProbeLifecycleJournalV1(compiled.plan);
    if (!initialJournal.success) throw new Error(initialJournal.code);
    const created = await createD1ProbeDatabaseV1(
        route.observed,
        initialJournal.journal,
        { hmac_key_base64url: key },
        apiToken,
        {
            fetch: (async () =>
                jsonResponse({
                    errors: [],
                    messages: [],
                    result: {
                        jurisdiction: "us",
                        name: `openbot-d1-probe-${suffixes.database}`,
                        read_replication: { mode: "auto" },
                        uuid: id,
                    },
                    success: true,
                })) as typeof globalThis.fetch,
        }
    );
    if (!created.success) throw new Error(created.code);
    return { created: created.created, journal: created.journal, plan: compiled.plan };
};

const successfulBootstrapFetch = () => {
    let call = 0;
    return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        call += 1;
        if (call === 1) {
            const body = JSON.parse(String(init?.body)) as { batch: Array<{ sql: string }> };
            expect(body.batch).toHaveLength(schemaStatements.length + 2);
            expect(body.batch[0]?.sql).toBe(
                "SELECT type, name, tbl_name, sql FROM main.sqlite_schema WHERE (name GLOB '_openbot_probe_*' OR tbl_name GLOB '_openbot_probe_*') AND name NOT LIKE 'sqlite_%' AND type IN ('table', 'trigger', 'index', 'view') ORDER BY type ASC, name ASC"
            );
            return jsonResponse(ddlEnvelope());
        }
        if (call === 2) return jsonResponse(queryEnvelope([queryResult([{ foreign_keys: 1 }], { rows_read: 1 })]));
        if (call === 3) {
            return jsonResponse(
                {
                    errors: [{ code: 7500, message: "D1_ERROR: FOREIGN KEY constraint failed" }],
                    messages: [],
                    result: null,
                    success: false,
                },
                400
            );
        }
        if (call === 4) return jsonResponse(queryEnvelope([queryResult([{ row_count: 0 }], { rows_read: 1 })]));
        throw new Error("unexpected bootstrap request");
    }) as unknown as typeof globalThis.fetch;
};

describe("Cloudflare D1 database bootstrap", () => {
    it("initializes the exact opaque target and mints opaque target-bound evidence", async () => {
        const provisioned = await prepareCreatedDatabase();
        const fetch = successfulBootstrapFetch();
        const result = await initializeD1ProbeDatabaseV1(
            provisioned.created,
            provisioned.journal,
            { hmac_key_base64url: key },
            apiToken,
            { fetch }
        );

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(fetch).toHaveBeenCalledTimes(4);
        for (const [url, init] of (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
            [string, RequestInit]
        >) {
            expect(url).toBe(
                `${"https://api.cloudflare.com/client/v4/accounts/"}${request().account_id}/d1/database/${databaseId}/query`
            );
            expect(init).toMatchObject({
                method: "POST",
                cache: "no-store",
                credentials: "omit",
                redirect: "manual",
            });
            expect(init.headers).toEqual({
                accept: "application/json",
                "accept-encoding": "identity",
                authorization: `Bearer ${apiToken}`,
                "content-type": "application/json",
            });
            expect(init.signal).toBeInstanceOf(AbortSignal);
        }
        expect(Object.isFrozen(result.initialized)).toBe(true);
        expect(Object.isFrozen(result.observation)).toBe(true);
        expect(result.journal).toEqual(provisioned.journal);
        expect(result.observation).toMatchObject({
            authoritative: false,
            eligible_for_attestation: false,
            foreign_keys: 1,
            gate_promotion_allowed: false,
            rollback_canary: "constraint_rejected_and_rolled_back",
            schema_digest: D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
        });
        expect(JSON.stringify(result)).not.toContain(databaseId);
        expect(JSON.stringify(result)).not.toContain(request().account_id);
        expect(JSON.stringify(result)).not.toContain(apiToken);
        expect(JSON.stringify(result)).not.toContain(key);
        const context = resolveInitializedD1ProbeDatabaseV1(result.initialized);
        expect(context).toMatchObject({
            created_database: provisioned.created,
            plan_digest: provisioned.plan.plan_digest,
            schema_digest: D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
        });
        expect(Object.isFrozen(context)).toBe(true);
        expect(
            await initializedD1ProbeDatabaseMatchesV1(result.initialized, provisioned.created, provisioned.journal)
        ).toBe(true);
        const copied = { ...result.initialized };
        expect(resolveInitializedD1ProbeDatabaseV1(copied)).toBeNull();
        expect(await initializedD1ProbeDatabaseMatchesV1(copied, provisioned.created, provisioned.journal)).toBe(false);
    });

    it("denies forged targets, journal substitution, and a second dispatch", async () => {
        const provisioned = await prepareCreatedDatabase();
        const fetch = successfulBootstrapFetch();
        expect(
            await initializeD1ProbeDatabaseV1(
                { schema_version: 1, kind: "created_d1_probe_database" },
                provisioned.journal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch }
            )
        ).toEqual({ success: false, code: "invalid_created_database" });
        expect(
            await initializeD1ProbeDatabaseV1(
                provisioned.created,
                { ...provisioned.journal, plan_digest: "f".repeat(64) },
                { hmac_key_base64url: key },
                apiToken,
                { fetch }
            )
        ).toEqual({ success: false, code: "invalid_lifecycle_journal" });
        expect(fetch).not.toHaveBeenCalled();

        const first = await initializeD1ProbeDatabaseV1(
            provisioned.created,
            provisioned.journal,
            { hmac_key_base64url: key },
            apiToken,
            { fetch }
        );
        expect(first.success).toBe(true);
        expect(
            await initializeD1ProbeDatabaseV1(
                provisioned.created,
                provisioned.journal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch }
            )
        ).toEqual({ success: false, code: "database_bootstrap_already_requested" });
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("rejects hostile inputs and substituted credentials before dispatch", async () => {
        const provisioned = await prepareCreatedDatabase();
        const fetch = vi.fn();
        expect(
            await initializeD1ProbeDatabaseV1(
                provisioned.created,
                provisioned.journal,
                { hmac_key_base64url: otherKey },
                apiToken,
                { fetch: fetch as typeof globalThis.fetch }
            )
        ).toEqual({ success: false, code: "preflight_reverification_failed" });
        expect(
            await initializeD1ProbeDatabaseV1(
                provisioned.created,
                provisioned.journal,
                { hmac_key_base64url: key },
                "short",
                { fetch: fetch as typeof globalThis.fetch }
            )
        ).toEqual({ success: false, code: "invalid_api_token" });
        const hostileJournal = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile journal");
                },
            }
        );
        expect(
            await initializeD1ProbeDatabaseV1(
                provisioned.created,
                hostileJournal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch: fetch as typeof globalThis.fetch }
            )
        ).toEqual({ success: false, code: "invalid_lifecycle_journal" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("makes invalid, oversized, and malformed platform responses manual without retry", async () => {
        const responses = [
            () => new Response(null, { status: 302, headers: { "content-type": "application/json" } }),
            () => new Response("{}", { status: 200, headers: { "content-type": "text/plain" } }),
            () =>
                new Response("{}", {
                    status: 200,
                    headers: { "content-length": "262145", "content-type": "application/json" },
                }),
            () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
        ];
        for (const response of responses) {
            const provisioned = await prepareCreatedDatabase();
            const fetch = vi.fn(async () => response()) as unknown as typeof globalThis.fetch;
            const result = await initializeD1ProbeDatabaseV1(
                provisioned.created,
                provisioned.journal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch }
            );
            expect(result).toMatchObject({
                success: false,
                code: "database_bootstrap_outcome_unknown",
                cleanup_target: provisioned.created,
                journal: { state: "manual_required" },
            });
            expect(fetch).toHaveBeenCalledTimes(1);
        }
    });

    it("turns an ambiguous first dispatch into exact target-bound manual cleanup without retry", async () => {
        const provisioned = await prepareCreatedDatabase();
        const forgedManual = markD1ProbeLifecycleAmbiguousV1(provisioned.plan, provisioned.journal, {
            failed_step: "sink_private_shell_created",
            reason: "unexpected_platform_result",
            observation_digest: "f".repeat(64),
            worker_dispatch_phase: "pre_dispatch",
            retry_allowed: false,
            manual_cleanup_required: true,
        });
        if (!forgedManual.success) throw new Error(forgedManual.code);
        const forgedDeleteFetch = vi.fn();
        expect(
            await deleteD1ProbeDatabaseV1(
                provisioned.created,
                forgedManual.journal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch: forgedDeleteFetch as typeof globalThis.fetch }
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        expect(forgedDeleteFetch).not.toHaveBeenCalled();

        const fetch = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof globalThis.fetch;
        const result = await initializeD1ProbeDatabaseV1(
            provisioned.created,
            provisioned.journal,
            { hmac_key_base64url: key },
            apiToken,
            { fetch }
        );

        expect(result.success).toBe(false);
        if (result.success || !("journal" in result)) return;
        expect(result.code).toBe("database_bootstrap_outcome_unknown");
        expect(result.cleanup_target).toBe(provisioned.created);
        expect(result.journal).toMatchObject({
            completed_steps: ["database_created"],
            manual_required: {
                failed_step: "sink_private_shell_created",
                reason: "unexpected_platform_result",
                worker_dispatch_phase: "pre_dispatch",
                retry_allowed: false,
                manual_cleanup_required: true,
            },
            state: "manual_required",
        });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(
            await initializeD1ProbeDatabaseV1(
                provisioned.created,
                provisioned.journal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch }
            )
        ).toEqual({ success: false, code: "database_bootstrap_already_requested" });
        expect(fetch).toHaveBeenCalledTimes(1);

        const deleteFetch = vi.fn(async () =>
            jsonResponse({ errors: [], messages: [], result: null, success: true })
        ) as unknown as typeof globalThis.fetch;
        if (result.journal.manual_required === null) throw new Error("missing bootstrap failure binding");
        expect(
            await deleteD1ProbeDatabaseV1(
                provisioned.created,
                {
                    ...result.journal,
                    manual_required: { ...result.journal.manual_required, observation_digest: "e".repeat(64) },
                },
                { hmac_key_base64url: key },
                apiToken,
                { fetch: deleteFetch }
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        expect(deleteFetch).not.toHaveBeenCalled();
        const alteredCreateObservationJournal = {
            ...result.journal,
            observations: result.journal.observations.map((observation, index) =>
                index === 0 ? { ...observation, observation_digest: "d".repeat(64) } : observation
            ),
        };
        expect(
            await deleteD1ProbeDatabaseV1(
                provisioned.created,
                alteredCreateObservationJournal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch: deleteFetch }
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        expect(
            await observeD1ProbeDatabaseAbsenceV1(
                provisioned.created,
                alteredCreateObservationJournal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch: deleteFetch }
            )
        ).toEqual({ success: false, code: "resource_binding_mismatch" });
        expect(deleteFetch).not.toHaveBeenCalled();
        const deleted = await deleteD1ProbeDatabaseV1(
            provisioned.created,
            result.journal,
            { hmac_key_base64url: key },
            apiToken,
            { fetch: deleteFetch }
        );
        expect(deleted.success).toBe(true);
        expect(deleteFetch).toHaveBeenCalledTimes(1);
        const absence = await observeD1ProbeDatabaseAbsenceV1(
            provisioned.created,
            result.journal,
            { hmac_key_base64url: key },
            apiToken,
            {
                fetch: (async () =>
                    jsonResponse({
                        errors: [],
                        result: [],
                        result_info: { count: 0, page: 1, per_page: 100, total_count: 0 },
                        success: true,
                    })) as typeof globalThis.fetch,
            }
        );
        expect(absence).toMatchObject({
            success: true,
            journal: { state: "manual_required" },
            observation: { cleanup_confirmed: false, status: "control_plane_absence_observed" },
        });
    });

    it("rejects disabled foreign keys, schema drift, and a canary that does not reject", async () => {
        const cases = [
            {
                code: "database_foreign_keys_disabled",
                responses: [ddlEnvelope(), queryEnvelope([queryResult([{ foreign_keys: 0 }], { rows_read: 1 })])],
            },
            {
                code: "database_schema_mismatch",
                responses: [ddlEnvelope(schemaRows.slice(1))],
            },
            {
                code: "database_schema_mismatch",
                responses: [
                    ddlEnvelope(schemaRows, [
                        {
                            type: "trigger",
                            name: "unrelated_trigger",
                            tbl_name: "_openbot_probe_authority",
                            sql: "CREATE TRIGGER unrelated_trigger AFTER INSERT ON _openbot_probe_authority BEGIN SELECT 1; END",
                        },
                    ]),
                ],
            },
            {
                code: "database_rollback_canary_failed",
                responses: [
                    ddlEnvelope(),
                    queryEnvelope([queryResult([{ foreign_keys: 1 }], { rows_read: 1 })]),
                    queryEnvelope([
                        queryResult([], { changed_db: true, changes: 1, rows_written: 1 }),
                        queryResult([], { changed_db: true, changes: 1, rows_written: 1 }),
                    ]),
                ],
            },
            {
                code: "database_rollback_canary_failed",
                responses: [
                    ddlEnvelope(),
                    queryEnvelope([queryResult([{ foreign_keys: 1 }], { rows_read: 1 })]),
                    {
                        errors: [{ code: 7500, message: "D1_ERROR: FOREIGN KEY constraint failed" }],
                        messages: [],
                        result: null,
                        success: false,
                    },
                    queryEnvelope([queryResult([{ row_count: 1 }], { rows_read: 1 })]),
                ],
            },
        ] as const;

        for (const testCase of cases) {
            const provisioned = await prepareCreatedDatabase();
            let index = 0;
            const fetch = vi.fn(async () => {
                const responseIndex = index++;
                return jsonResponse(testCase.responses[responseIndex], responseIndex === 2 ? 400 : 200);
            }) as unknown as typeof globalThis.fetch;
            const result = await initializeD1ProbeDatabaseV1(
                provisioned.created,
                provisioned.journal,
                { hmac_key_base64url: key },
                apiToken,
                { fetch }
            );
            expect(result.success).toBe(false);
            expect(result).toMatchObject({ code: testCase.code, cleanup_target: provisioned.created });
        }
    });
});
