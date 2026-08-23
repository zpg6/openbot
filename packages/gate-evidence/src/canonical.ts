import {
    parseUntrustedItem2ProbeReportV1,
    type UntrustedItem2ProbeReportV1,
    type UntrustedProbeReportDenialV1,
} from "./contracts.js";

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

const canonicalParsedReportBytes = (report: UntrustedItem2ProbeReportV1): Uint8Array => {
    const { report_digest: _reportDigest, ...projection } = report;
    return encoder.encode(
        `openbot.untrusted-item2-probe-report.v1\u0000${report.kind}\u0000${canonicalize(projection as JsonValue)}`
    );
};

export const canonicalUntrustedProbeReportBytesV1 = (
    input: unknown,
    options: { as_of_ms: number }
):
    | { success: true; report: UntrustedItem2ProbeReportV1; bytes: Uint8Array }
    | { success: false; code: "invalid_probe_report" | "future_probe_report" } => {
    const parsed = parseUntrustedItem2ProbeReportV1(input, options);
    if (!parsed.success) return parsed;
    return { success: true, report: parsed.report, bytes: canonicalParsedReportBytes(parsed.report) };
};

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

export const digestUntrustedProbeReportV1 = async (
    input: unknown,
    options: { as_of_ms: number }
): Promise<
    | { success: true; report: UntrustedItem2ProbeReportV1; digest: string }
    | { success: false; code: Exclude<UntrustedProbeReportDenialV1, "report_digest_mismatch"> }
> => {
    const canonical = canonicalUntrustedProbeReportBytesV1(input, options);
    if (!canonical.success) return canonical;
    try {
        const buffer = canonical.bytes.buffer.slice(
            canonical.bytes.byteOffset,
            canonical.bytes.byteOffset + canonical.bytes.byteLength
        ) as ArrayBuffer;
        const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
        return { success: true, report: canonical.report, digest: toHex(digest) };
    } catch {
        return { success: false, code: "digest_unavailable" };
    }
};

export const inspectUntrustedProbeReportIntegrityV1 = async (
    input: unknown,
    options: { as_of_ms: number }
): Promise<
    { success: true; report: UntrustedItem2ProbeReportV1 } | { success: false; code: UntrustedProbeReportDenialV1 }
> => {
    const result = await digestUntrustedProbeReportV1(input, options);
    if (!result.success) return result;
    if (result.digest !== result.report.report_digest) return { success: false, code: "report_digest_mismatch" };
    return { success: true, report: result.report };
};
