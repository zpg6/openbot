import {
    GateAttestationEnvelopeV1Schema,
    type GateAttestationEnvelopeV1,
    type GateAttestationVerificationDenialV1,
} from "./contracts.js";

export type CanonicalJsonValueV1 =
    null | boolean | number | string | CanonicalJsonValueV1[] | { [key: string]: CanonicalJsonValueV1 };
const encoder = new TextEncoder();

export const canonicalizeJsonV1 = (value: CanonicalJsonValueV1): string => {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalizeJsonV1).join(",")}]`;
    return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${canonicalizeJsonV1(value[key] as CanonicalJsonValueV1)}`)
        .join(",")}}`;
};

const parseEnvelope = (
    input: unknown
): { success: true; envelope: GateAttestationEnvelopeV1 } | { success: false; code: "invalid_attestation" } => {
    try {
        const parsed = GateAttestationEnvelopeV1Schema.safeParse(input);
        if (!parsed.success) return { success: false, code: "invalid_attestation" };
        return { success: true, envelope: parsed.data };
    } catch {
        return { success: false, code: "invalid_attestation" };
    }
};

const bytes = (domain: string, value: CanonicalJsonValueV1): Uint8Array =>
    encoder.encode(`${domain}\u0000${canonicalizeJsonV1(value)}`);

export const canonicalGateAttestationEnvelopeBytesV1 = (
    input: unknown
):
    | { success: true; envelope: GateAttestationEnvelopeV1; bytes: Uint8Array }
    | { success: false; code: "invalid_attestation" } => {
    const parsed = parseEnvelope(input);
    if (!parsed.success) return parsed;
    const { signature: _signature, ...unsignedEnvelope } = parsed.envelope;
    return {
        success: true,
        envelope: parsed.envelope,
        bytes: bytes("openbot.gate-attestation-envelope.v1", unsignedEnvelope as CanonicalJsonValueV1),
    };
};

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

export const digestGateAttestationV1 = async (
    envelope: GateAttestationEnvelopeV1
): Promise<{ success: true; digest: string } | { success: false; code: "digest_unavailable" }> => {
    try {
        const encoded = bytes("openbot.gate-attestation-record.v1", envelope as CanonicalJsonValueV1);
        const source = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
        return { success: true, digest: toHex(await globalThis.crypto.subtle.digest("SHA-256", source)) };
    } catch {
        return { success: false, code: "digest_unavailable" };
    }
};

export const digestCanonicalJsonV1 = async (domain: string, value: CanonicalJsonValueV1): Promise<string | null> => {
    try {
        const encoded = bytes(domain, value);
        const source = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
        return toHex(await globalThis.crypto.subtle.digest("SHA-256", source));
    } catch {
        return null;
    }
};

export type CanonicalGateAttestationDenialV1 = Extract<
    GateAttestationVerificationDenialV1,
    "invalid_attestation" | "digest_unavailable"
>;
