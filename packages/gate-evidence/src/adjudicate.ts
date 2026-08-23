import { z } from "zod";

import { inspectUntrustedProbeReportIntegrityV1 } from "./canonical.js";
import { D1DeploymentCommitmentV1Schema, Item2DigestV1Schema, type UntrustedProbeReportDenialV1 } from "./contracts.js";

const D1GateIdV1Schema = z.enum(["d1_guarded_create", "gateway_reservation"]);

export const D1ProbeAdjudicationExpectationsV1Schema = z
    .object({
        schema_version: z.literal(1),
        expected_platform: z.literal("cloudflare_d1_deployed"),
        gate_id: D1GateIdV1Schema,
        required_check_set_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        as_of_ms: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        expected_report_digest: Item2DigestV1Schema,
        expected_deployment_digest: Item2DigestV1Schema,
        expected_configuration_digest: Item2DigestV1Schema,
        expected_probe_definition_digest: Item2DigestV1Schema,
        expected_collector_build_digest: Item2DigestV1Schema,
        expected_installation_digest: Item2DigestV1Schema,
        expected_environment_digest: Item2DigestV1Schema,
        expected_probe_run_digest: Item2DigestV1Schema,
        expected_commitment_key_id_digest: Item2DigestV1Schema,
    })
    .strict();

export type D1ProbeAdjudicationExpectationsV1 = z.infer<typeof D1ProbeAdjudicationExpectationsV1Schema>;
export type D1ProbeAdjudicationDenialV1 =
    | UntrustedProbeReportDenialV1
    | "invalid_adjudication_expectations"
    | "invalid_deployment"
    | "unexpected_gate"
    | "unexpected_check_set_version"
    | "unexpected_report_digest"
    | "unexpected_deployment_digest"
    | "deployment_digest_mismatch"
    | "final_observation_set_digest_mismatch"
    | "unexpected_configuration_digest"
    | "unexpected_probe_definition_digest"
    | "unexpected_collector_build_digest"
    | "unexpected_installation_digest"
    | "unexpected_environment_digest"
    | "unexpected_probe_run_digest"
    | "unexpected_commitment_key_id_digest"
    | "report_not_current"
    | "check_not_passed"
    | "collector_inconclusive"
    | "collector_manual_required";

export type D1ProbeAdjudicationV1 =
    | {
          success: true;
          assessment: "eligible_for_operator_review";
          authoritative: false;
          gate_promotion_allowed: false;
          attestation_created: false;
          gate_id: "d1_guarded_create" | "gateway_reservation";
          report_digest: string;
      }
    | { success: false; code: D1ProbeAdjudicationDenialV1 };

const expectedDigestFields = [
    ["report_digest", "expected_report_digest", "unexpected_report_digest"],
    ["deployment_digest", "expected_deployment_digest", "unexpected_deployment_digest"],
    ["configuration_digest", "expected_configuration_digest", "unexpected_configuration_digest"],
    ["probe_definition_digest", "expected_probe_definition_digest", "unexpected_probe_definition_digest"],
    ["collector_build_digest", "expected_collector_build_digest", "unexpected_collector_build_digest"],
    ["installation_digest", "expected_installation_digest", "unexpected_installation_digest"],
    ["environment_digest", "expected_environment_digest", "unexpected_environment_digest"],
    ["probe_run_digest", "expected_probe_run_digest", "unexpected_probe_run_digest"],
    ["commitment_key_id_digest", "expected_commitment_key_id_digest", "unexpected_commitment_key_id_digest"],
] as const;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const encoder = new TextEncoder();

const canonicalize = (value: JsonValue): string => {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`)
        .join(",")}}`;
};

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

export const digestD1DeploymentCommitmentV1 = async (
    input: unknown
): Promise<
    { success: true; digest: string } | { success: false; code: "invalid_deployment" | "digest_unavailable" }
> => {
    let deployment: ReturnType<typeof D1DeploymentCommitmentV1Schema.safeParse>;
    try {
        deployment = D1DeploymentCommitmentV1Schema.safeParse(input);
    } catch {
        return { success: false, code: "invalid_deployment" };
    }
    if (!deployment.success) return { success: false, code: "invalid_deployment" };
    try {
        const bytes = encoder.encode(
            `openbot.d1-deployment-commitment.v1\u0000${canonicalize(deployment.data as unknown as JsonValue)}`
        );
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return { success: true, digest: toHex(await globalThis.crypto.subtle.digest("SHA-256", buffer)) };
    } catch {
        return { success: false, code: "digest_unavailable" };
    }
};

export const digestD1FinalObservationSetV1 = async (
    input: unknown
): Promise<{ success: true; digest: string } | { success: false; code: "digest_unavailable" }> => {
    try {
        const bytes = encoder.encode(
            `openbot.d1-final-current-state-observation-set.v1\u0000${canonicalize(input as JsonValue)}`
        );
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return { success: true, digest: toHex(await globalThis.crypto.subtle.digest("SHA-256", buffer)) };
    } catch {
        return { success: false, code: "digest_unavailable" };
    }
};

export const assessD1ProbeReportForOperatorReviewV1 = async (
    input: unknown,
    expectationsInput: unknown
): Promise<D1ProbeAdjudicationV1> => {
    let expectations: ReturnType<typeof D1ProbeAdjudicationExpectationsV1Schema.safeParse>;
    try {
        expectations = D1ProbeAdjudicationExpectationsV1Schema.safeParse(expectationsInput);
    } catch {
        return { success: false, code: "invalid_adjudication_expectations" };
    }
    if (!expectations.success) return { success: false, code: "invalid_adjudication_expectations" };

    const integrity = await inspectUntrustedProbeReportIntegrityV1(input, {
        as_of_ms: expectations.data.as_of_ms,
    });
    if (!integrity.success) return integrity;

    const report = integrity.report;
    if (report.kind !== "d1_guarded_create" && report.kind !== "gateway_reservation") {
        return { success: false, code: "unexpected_gate" };
    }
    if (report.kind !== expectations.data.gate_id) return { success: false, code: "unexpected_gate" };
    if (report.collection_status !== "complete") {
        return {
            success: false,
            code:
                report.collection_status === "manual_required" ? "collector_manual_required" : "collector_inconclusive",
        };
    }
    if (report.deployment.platform !== expectations.data.expected_platform) {
        return { success: false, code: "unexpected_gate" };
    }
    if (report.check_set_version !== expectations.data.required_check_set_version) {
        return { success: false, code: "unexpected_check_set_version" };
    }
    if (expectations.data.as_of_ms >= report.valid_until) {
        return { success: false, code: "report_not_current" };
    }

    const deploymentDigest = await digestD1DeploymentCommitmentV1(report.deployment);
    if (!deploymentDigest.success) return { success: false, code: deploymentDigest.code };
    if (deploymentDigest.digest !== report.deployment_digest) {
        return { success: false, code: "deployment_digest_mismatch" };
    }
    const finalObservationSetDigest = await digestD1FinalObservationSetV1(
        report.cleanup.final_first_primary_readback.current_state_snapshots
    );
    if (!finalObservationSetDigest.success) return finalObservationSetDigest;
    if (
        finalObservationSetDigest.digest !== report.final_observation_set_commitment ||
        finalObservationSetDigest.digest !== report.cleanup.final_first_primary_readback.observation_set_commitment
    ) {
        return { success: false, code: "final_observation_set_digest_mismatch" };
    }

    for (const [reportField, expectationField, denial] of expectedDigestFields) {
        if (report[reportField] !== expectations.data[expectationField]) {
            return { success: false, code: denial };
        }
    }
    if (report.checks.some(check => check.outcome !== "passed")) {
        return { success: false, code: "check_not_passed" };
    }

    return {
        success: true,
        assessment: "eligible_for_operator_review",
        authoritative: false,
        gate_promotion_allowed: false,
        attestation_created: false,
        gate_id: report.kind,
        report_digest: report.report_digest,
    };
};
