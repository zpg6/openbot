import { z } from "zod";

import {
    GateAttestationEnvelopeV1Schema,
    GateAttestationTrustRegistryV1Schema,
} from "@openbot/gate-attestation/internal";
import { D1ProbeAdjudicationExpectationsV1Schema } from "@openbot/gate-evidence/internal";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const TimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const OperatorIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,95}$/u);
const Base64UrlSchema = z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/u)
    .max(8_192);

export const D1GateAttestationSigningRequestV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_gate_attestation_signing_request"),
        report: z.unknown(),
        expectations: D1ProbeAdjudicationExpectationsV1Schema,
        review: z
            .object({
                reviewer_id: OperatorIdSchema,
                reviewed_at: TimestampSchema,
                decision: z.literal("approve"),
                reviewed_report_digest: DigestSchema,
            })
            .strict(),
        attestation: z
            .object({
                attested_at: TimestampSchema,
                valid_until: TimestampSchema,
                signer_key_id: OperatorIdSchema,
            })
            .strict(),
        trust_registry: GateAttestationTrustRegistryV1Schema,
    })
    .strict();
export type D1GateAttestationSigningRequestV1 = z.infer<typeof D1GateAttestationSigningRequestV1Schema>;

export const GateSigningPrivateKeyV1Schema = z
    .object({
        private_key_pkcs8_base64url: Base64UrlSchema,
    })
    .strict();

export const D1GateAttestationOperatorBundleV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_gate_attestation_operator_bundle"),
        gate_id: z.enum(["d1_guarded_create", "gateway_reservation"]),
        trust_registry_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        review: z
            .object({
                reviewer_id: OperatorIdSchema,
                reviewed_at: TimestampSchema,
                decision: z.literal("approved"),
                assessment: z.literal("eligible_for_operator_review"),
                report_digest: DigestSchema,
                expectations_digest: DigestSchema,
                review_record_digest: DigestSchema,
            })
            .strict(),
        attestation: GateAttestationEnvelopeV1Schema,
        attestation_digest: DigestSchema,
    })
    .strict()
    .superRefine((bundle, context) => {
        if (
            bundle.attestation.gate_id !== bundle.gate_id ||
            bundle.attestation.decision !== "passed" ||
            bundle.attestation.untrusted_report_digest !== bundle.review.report_digest ||
            bundle.attestation.attested_at !== bundle.review.reviewed_at ||
            bundle.attestation.operator_review_digest !== bundle.review.review_record_digest
        ) {
            context.addIssue({
                code: "custom",
                path: ["attestation"],
                message: "The signed attestation must match the reviewed D1 gate, report, decision, and time",
            });
        }
    });
export type D1GateAttestationOperatorBundleV1 = z.infer<typeof D1GateAttestationOperatorBundleV1Schema>;

export const D1GateAttestationSigningDenialV1Schema = z.enum([
    "invalid_signing_request",
    "report_not_eligible",
    "review_mismatch",
    "invalid_attestation_window",
    "unknown_signer",
    "signer_not_usable",
    "private_key_invalid",
    "private_key_mismatch",
    "signature_unavailable",
    "digest_unavailable",
    "internal_verification_failed",
]);
export type D1GateAttestationSigningDenialV1 = z.infer<typeof D1GateAttestationSigningDenialV1Schema>;
