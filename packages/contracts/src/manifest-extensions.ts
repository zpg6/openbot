import { z } from "zod";
import { JsonValueSchema, PositiveVersionSchema, Sha256DigestSchema, type JsonValue } from "./primitives.js";

export const ManifestExtensionV1Schema = z
    .object({
        extension_id: z
            .string()
            .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/)
            .max(128),
        extension_version: PositiveVersionSchema,
        required: z.boolean(),
        payload: JsonValueSchema,
        payload_digest: Sha256DigestSchema,
    })
    .strict();
export type ManifestExtensionV1 = z.infer<typeof ManifestExtensionV1Schema>;

export const UnverifiedManifestExtensionEnvelopeV1Schema = z
    .object({
        schema_version: z.literal(1),
        extensions: z.array(ManifestExtensionV1Schema).max(8),
    })
    .strict()
    .superRefine((envelope, context) => {
        try {
            if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 32 * 1024) {
                context.addIssue({ code: "custom", message: "Extension envelope exceeds 32 KiB" });
            }
            const identities = new Set<string>();
            for (const [index, extension] of envelope.extensions.entries()) {
                const identity = extension.extension_id;
                if (identities.has(identity)) {
                    context.addIssue({
                        code: "custom",
                        path: ["extensions", index],
                        message: "Extension identity must be unique",
                    });
                }
                identities.add(identity);
            }
        } catch {
            context.addIssue({ code: "custom", message: "Extension envelope could not be inspected" });
        }
    });
export type ManifestExtensionEnvelopeV1 = z.infer<typeof UnverifiedManifestExtensionEnvelopeV1Schema>;

declare const verifiedManifestExtensionEnvelope: unique symbol;
export type VerifiedManifestExtensionEnvelopeV1 = ManifestExtensionEnvelopeV1 & {
    readonly [verifiedManifestExtensionEnvelope]: true;
};

export type ManifestExtensionVerificationFailureV1 =
    | "extension_digest_mismatch"
    | "extension_digest_verification_failed"
    | "invalid_extension_envelope"
    | "unknown_required_extension";

export const verifyCompilerManifestExtensionEnvelopeV1 = (
    input: unknown,
    options: {
        supported_versions: Readonly<Record<string, readonly number[]>>;
        verify_payload_digest: (payload: JsonValue, expected: z.infer<typeof Sha256DigestSchema>) => boolean;
    }
):
    | { success: true; data: VerifiedManifestExtensionEnvelopeV1 }
    | { success: false; code: ManifestExtensionVerificationFailureV1 } => {
    const parsed = UnverifiedManifestExtensionEnvelopeV1Schema.safeParse(input);
    if (!parsed.success) return { success: false, code: "invalid_extension_envelope" };
    for (const extension of parsed.data.extensions) {
        const versions = options.supported_versions[extension.extension_id];
        if ((!versions || !versions.includes(extension.extension_version)) && extension.required) {
            return { success: false, code: "unknown_required_extension" };
        }
        try {
            if (!options.verify_payload_digest(extension.payload, extension.payload_digest)) {
                return { success: false, code: "extension_digest_mismatch" };
            }
        } catch {
            return { success: false, code: "extension_digest_verification_failed" };
        }
    }
    return { success: true, data: parsed.data as VerifiedManifestExtensionEnvelopeV1 };
};

export const EMPTY_MANIFEST_EXTENSION_ENVELOPE_V1 = Object.freeze({
    schema_version: 1,
    extensions: [],
} as const satisfies ManifestExtensionEnvelopeV1);
