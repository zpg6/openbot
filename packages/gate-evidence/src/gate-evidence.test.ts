import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspectRecordedItem2BlockersV1, RECORDED_ITEM2_CORE_BLOCKERS_V1 } from "./blockers.js";
import {
    canonicalUntrustedProbeReportBytesV1,
    digestUntrustedProbeReportV1,
    inspectUntrustedProbeReportIntegrityV1,
} from "./canonical.js";
import {
    CONNECTOR_COMMON_CHECK_IDS_V1,
    ITEM2_MAX_REPORT_TTL_MS_V1,
    UntrustedConnectorProbeReportV1Schema,
} from "./contracts.js";

const hex = (character: string): string => character.repeat(64);
const observedAt = 1_000;
const completedAt = 2_000;
const validUntil = 3_000;
const asOf = 2_500;

const common = {
    schema_version: 1 as const,
    report_digest: hex("0"),
    configuration_digest: hex("1"),
    installation_digest: hex("2"),
    environment_digest: hex("3"),
    probe_definition_digest: hex("4"),
    collector_build_digest: hex("5"),
    probe_run_digest: hex("6"),
    commitment_key_id_digest: hex("7"),
    redaction_version: 1 as const,
    observed_at: observedAt,
    completed_at: completedAt,
    valid_until: validUntil,
};

const transcript = (checkId: string, index: number) => ({
    commitment_algorithm: "hmac-sha256-v1" as const,
    commitment_key_id_digest: common.commitment_key_id_digest,
    reference_commitment: index.toString(16).padStart(64, "0"),
    gate_id: "connector" as const,
    check_id: checkId,
    configuration_digest: common.configuration_digest,
    installation_digest: common.installation_digest,
    environment_digest: common.environment_digest,
    probe_run_digest: common.probe_run_digest,
    observed_at: observedAt + index,
    request_commitment: hex("7"),
    response_commitment: hex("8"),
    observation_commitment: hex("9"),
    redacted_fields: ["authorization"] as const,
});

const checks = (ids: readonly string[]) =>
    ids.map((check_id, index) => ({
        check_id,
        outcome: "passed" as const,
        transcript_commitments: [transcript(check_id, index + 1)],
    }));

const globalChecks = [
    ...CONNECTOR_COMMON_CHECK_IDS_V1,
    "global_public_target_validation",
    "operator_auth_config_absence_readback",
] as const;
const specificChecks = [
    ...CONNECTOR_COMMON_CHECK_IDS_V1,
    "positive_resource_scope",
    "sibling_resource_denial",
] as const;

const connectorReport = (resourceRule: "global" | "specific" = "global") => ({
    ...common,
    kind: "connector" as const,
    identity_digest_algorithm: "hmac-sha256-v1" as const,
    metorial_api_version: "2026-01-01-magnetar" as const,
    sdk_version: "3.0.9",
    generated_client_version: "3.0.2",
    package_integrity_digest: hex("9"),
    deployment_status: "active" as const,
    effective_filter_digest: hex("8"),
    deployment_digest: hex("a"),
    provider_digest: hex("b"),
    provider_version_digest: hex("c"),
    provider_spec_digest: hex("d"),
    auth_setup: { kind: "none" as const },
    tools: [
        {
            tool_key_digest: hex("e"),
            input_schema_digest: hex("f"),
            output_schema_digest: hex("a"),
            descriptor_digest: hex("b"),
            vendor_effect_tags: { read_only: true as const, destructive: false as const },
            reviewed_effect: "read_only" as const,
            resource_rule:
                resourceRule === "global"
                    ? ({ kind: "global_public_read_only" } as const)
                    : ({
                          kind: "connector_specific",
                          mapping_key_digest: hex("c"),
                          mapping_version: 1,
                          scope_digest: hex("d"),
                      } as const),
            incidental_effects: ["provider_access_log" as const],
            maximum_observed_result_bytes: 65_536,
            enforced_result_max_bytes: 65_536,
        },
    ],
    checks: checks(resourceRule === "global" ? globalChecks : specificChecks),
});

const withReportDigest = async (input: unknown): Promise<Record<string, unknown>> => {
    const result = await digestUntrustedProbeReportV1(input, { as_of_ms: asOf });
    if (!result.success) throw new Error(result.code);
    return { ...(input as Record<string, unknown>), report_digest: result.digest };
};

describe("recorded Item 2 blockers", () => {
    it("exports operational APIs only through the internal entrypoint", async () => {
        const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
            exports: Record<string, unknown>;
        };
        expect(Object.keys(manifest.exports)).toEqual(["./internal"]);
    });

    it("returns the exact core blocker list including the runtime wire protocol", async () => {
        const fixture = JSON.parse(
            await readFile(new URL("../../../docs/fixtures/item-2-gates.json", import.meta.url), "utf8")
        ) as unknown;
        expect(inspectRecordedItem2BlockersV1(fixture)).toEqual({
            success: true,
            blockers: RECORDED_ITEM2_CORE_BLOCKERS_V1,
        });
    });

    it("cannot remove blockers when registry statuses change", async () => {
        const fixture = JSON.parse(
            await readFile(new URL("../../../docs/fixtures/item-2-gates.json", import.meta.url), "utf8")
        ) as { gates: Array<Record<string, unknown>> };
        for (const gate of fixture.gates) gate["status"] = "passed";
        expect(inspectRecordedItem2BlockersV1(fixture)).toEqual({
            success: true,
            blockers: RECORDED_ITEM2_CORE_BLOCKERS_V1,
        });
    });
});

describe("untrusted probe reports", () => {
    it("accepts both global-public and connector-specific report shapes", () => {
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(connectorReport("global")).success).toBe(true);
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(connectorReport("specific")).success).toBe(true);
    });

    it("requires credential-free global tools, one resource-rule family, and the 128 KiB result limit", () => {
        const credentialed = {
            ...connectorReport("global"),
            auth_setup: { kind: "oauth", scope_digests: [hex("a")] },
        };
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(credentialed).success).toBe(false);

        const mixed = structuredClone(connectorReport("global"));
        mixed.tools.push(structuredClone(connectorReport("specific").tools[0]!));
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(mixed).success).toBe(false);

        const oversized = structuredClone(connectorReport());
        oversized.tools[0]!.enforced_result_max_bytes = 128 * 1024 + 1;
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(oversized).success).toBe(false);
    });

    it("rejects raw connector IDs and secret-bearing fields", () => {
        expect(
            UntrustedConnectorProbeReportV1Schema.safeParse({
                ...connectorReport(),
                provider_deployment_id: "raw-provider-id",
            }).success
        ).toBe(false);
        expect(
            UntrustedConnectorProbeReportV1Schema.safeParse({
                ...connectorReport(),
                metorial_mcp_session_url: [
                    "https://mcp.metorial.example/session?",
                    "access_",
                    "token=metorial_bearer_capability_fixture",
                ].join(""),
            }).success
        ).toBe(false);
        expect(
            UntrustedConnectorProbeReportV1Schema.safeParse({
                ...connectorReport(),
                provider_auth_config_ref: "auth-config-bearer-reference-fixture",
            }).success
        ).toBe(false);
    });

    it("rejects future reports, excessive TTLs, and transcript reuse", () => {
        const future = connectorReport();
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: observedAt - 1 })).toEqual({
            success: false,
            code: "future_probe_report",
        });
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: Number.NaN })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: Number.POSITIVE_INFINITY })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
        expect(canonicalUntrustedProbeReportBytesV1(future, { as_of_ms: -1 })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });

        const longLived = { ...connectorReport(), valid_until: completedAt + ITEM2_MAX_REPORT_TTL_MS_V1 + 1 };
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(longLived).success).toBe(false);

        const reused = structuredClone(connectorReport());
        reused.checks[1]!.transcript_commitments[0]!.reference_commitment =
            reused.checks[0]!.transcript_commitments[0]!.reference_commitment;
        expect(UntrustedConnectorProbeReportV1Schema.safeParse(reused).success).toBe(false);
    });

    it("returns typed denials for cyclic, getter, and hostile proxy input", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic["self"] = cyclic;
        expect(canonicalUntrustedProbeReportBytesV1(cyclic, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });

        const getter = Object.defineProperty({}, "kind", {
            enumerable: true,
            get: () => {
                throw new Error("getter ran");
            },
        });
        expect(canonicalUntrustedProbeReportBytesV1(getter, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });

        const proxy = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("hostile proxy");
                },
            }
        );
        expect(canonicalUntrustedProbeReportBytesV1(proxy, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "invalid_probe_report",
        });
    });

    it("canonicalizes key order and matches a fixed digest vector", async () => {
        const report = connectorReport();
        const reordered = Object.fromEntries(Object.entries(report).reverse());
        const left = await digestUntrustedProbeReportV1(report, { as_of_ms: asOf });
        const right = await digestUntrustedProbeReportV1(reordered, { as_of_ms: asOf });
        expect(left).toEqual(right);
        expect(left.success && left.digest).toBe("7e62a7e494c8ce3fa14273e72ba7008221080b28dd7b3bb2b888b0f6b8a4e172");
    });

    it("checks only content integrity and retains the untrusted report name", async () => {
        const report = await withReportDigest(connectorReport());
        const inspected = await inspectUntrustedProbeReportIntegrityV1(report, { as_of_ms: asOf });
        expect(inspected.success).toBe(true);
        if (inspected.success) expect(inspected.report.kind).toBe("connector");

        const forged = { ...report, completed_at: completedAt + 1 };
        expect(await inspectUntrustedProbeReportIntegrityV1(forged, { as_of_ms: asOf })).toEqual({
            success: false,
            code: "report_digest_mismatch",
        });
    });
});
