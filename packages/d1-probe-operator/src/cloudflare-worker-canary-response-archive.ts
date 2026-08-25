import { constants } from "node:fs";
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    hkdfSync,
    randomBytes,
    randomUUID,
} from "node:crypto";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { z } from "zod";

import {
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestKindV1Schema,
    D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema,
    D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimWorkflowStepV1Schema,
    validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import { D1ProbeCloudflareWorkerCanaryOperationStateV1Schema } from "./cloudflare-worker-canary-operation.js";

const ARCHIVE_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-archive.v1";
const ARCHIVE_KEY_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-key.v1";
const ARCHIVE_KEY_IDENTIFIER_DOMAIN_V1 =
    "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-key-identifier.v1";
const ARCHIVE_RECORD_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-envelope.v1";
const ARCHIVE_CONTENT_TYPE_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-content-type.v1";
const MAX_RESPONSE_BYTES_V1 = 256 * 1024;
const MAX_ENVELOPE_BYTES_V1 = 384 * 1024;
const MAX_INVENTORY_RECORDS_V1 = 256;
const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const Base64V1Schema = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const SafeRevisionV1Schema = z.number().int().safe().nonnegative();
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const buildRoot = resolve(repositoryRoot, ".build");

export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1 = resolve(
    buildRoot,
    "d1-probe-canary-response-archive"
);
export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_AUTHORITY_V1 = false as const;
export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_MAX_PLAINTEXT_BYTES_V1 = MAX_RESPONSE_BYTES_V1;

export const D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_response_archive_expected_context"),
        plan_digest: DigestV1Schema,
        execution_nonce_commitment: DigestV1Schema,
        operation_revision: SafeRevisionV1Schema,
        operation_state: D1ProbeCloudflareWorkerCanaryOperationStateV1Schema,
        operation_record_digest: DigestV1Schema,
        cleanup_obligation_digest: DigestV1Schema.nullable(),
        claim_digest: DigestV1Schema,
        journal_revision: SafeRevisionV1Schema,
        transcript_sequence: z.number().int().safe().positive(),
        effect_phase: z.literal("response_observed"),
        workflow_step: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimWorkflowStepV1Schema,
        request_kind: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestKindV1Schema,
        request_method: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema,
        request_digest: DigestV1Schema,
        request_path_digest: DigestV1Schema,
        response_status: z.number().int().min(100).max(599),
        response_digest: DigestV1Schema,
        caller_asserted_response_content_type: z
            .string()
            .min(1)
            .max(512)
            .regex(/^[\x20-\x7e]+$/u)
            .nullable(),
        caller_asserted_response_content_encoding: z.literal("identity").nullable(),
        caller_asserted_response_observed_at_ms: z.number().int().safe().nonnegative(),
    })
    .strict();

export type D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1Schema
>;

const ArchiveAadV1Schema = D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1Schema.omit({
    kind: true,
}).extend({
    kind: z.literal("d1_probe_cloudflare_worker_api_canary_response_archive_aad"),
    domain: z.literal(ARCHIVE_DOMAIN_V1),
    archive_key_identifier: DigestV1Schema,
    plaintext_length: z.number().int().nonnegative().max(MAX_RESPONSE_BYTES_V1),
});

const ArchiveEnvelopeDraftV1Schema = ArchiveAadV1Schema.extend({
    kind: z.literal("d1_probe_cloudflare_worker_api_canary_encrypted_response_preimage"),
    encryption: z.literal("AES-256-GCM"),
    key_derivation: z.literal("HKDF-SHA-256"),
    nonce_base64: Base64V1Schema,
    ciphertext_base64: Base64V1Schema,
    authentication_tag_base64: Base64V1Schema,
    caller_mutation_authority: z.literal(false),
    cloudflare_origin_authenticated: z.literal(false),
    effect_claim_authenticated: z.literal(false),
    authoritative: z.literal(false),
    eligible_for_upload: z.literal(false),
    eligible_for_attestation: z.literal(false),
    lifecycle_advance_allowed: z.literal(false),
    gate_promotion_allowed: z.literal(false),
}).strict();

export const D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1Schema = ArchiveEnvelopeDraftV1Schema.extend({
    archive_record_digest: DigestV1Schema,
}).strict();

export type D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1Schema
>;

export interface D1ProbeCloudflareWorkerCanaryResponseArchiveReceiptV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_response_archive_receipt";
    readonly plan_digest: string;
    readonly cleanup_obligation_digest: string | null;
    readonly claim_digest: string;
    readonly journal_revision: number;
    readonly transcript_sequence: number;
    readonly response_digest: string;
    readonly archive_key_identifier: string;
    readonly plaintext_length: number;
    readonly archive_record_digest: string;
    readonly caller_mutation_authority: false;
    readonly cloudflare_origin_authenticated: false;
    readonly effect_claim_authenticated: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryResponseArchiveDenialV1 =
    | "invalid_effect_claim"
    | "claim_not_response_observed"
    | "invalid_expected_context"
    | "claim_context_mismatch"
    | "invalid_response_bytes"
    | "response_too_large"
    | "response_digest_mismatch"
    | "invalid_archive_key"
    | "archive_not_found"
    | "unsafe_archive_path"
    | "unsafe_archive_permissions"
    | "archive_io_unavailable"
    | "archive_corrupt"
    | "archive_unreconciled"
    | "archive_already_exists"
    | "concurrent_archive_write";

export type D1ProbeCloudflareWorkerCanaryResponseArchiveResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryResponseArchiveDenialV1 }
    | { readonly success: true; readonly receipt: D1ProbeCloudflareWorkerCanaryResponseArchiveReceiptV1 };

export interface D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory_record";
    readonly cleanup_obligation_digest: string | null;
    readonly claim_digest: string;
    readonly journal_revision: number;
    readonly transcript_sequence: number;
    readonly response_status: number;
    readonly response_digest: string;
    readonly archive_key_identifier: string;
    readonly plaintext_length: number;
    readonly archive_record_digest: string;
    readonly caller_asserted_response_content_type_digest: string | null;
    readonly caller_asserted_response_content_encoding: "identity" | null;
    readonly caller_asserted_response_observed_at_ms: number;
    readonly caller_mutation_authority: false;
    readonly cloudflare_origin_authenticated: false;
    readonly archive_key_possession_proven: false;
    readonly archive_decryptability_proven: false;
    readonly effect_claim_persistence_proven: false;
    readonly response_authenticated: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export interface D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory";
    readonly plan_digest: string;
    readonly record_count: number;
    readonly records: readonly D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1[];
    readonly cloudflare_origin_authenticated: false;
    readonly archive_key_possession_proven: false;
    readonly archive_decryptability_proven: false;
    readonly effect_claim_persistence_proven: false;
    readonly response_authenticated: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryDenialV1 =
    | "invalid_plan_digest"
    | "archive_not_found"
    | "unsafe_archive_path"
    | "unsafe_archive_permissions"
    | "archive_io_unavailable"
    | "archive_corrupt"
    | "archive_unreconciled"
    | "archive_inventory_too_large"
    | "archive_inventory_unsafe_sequence"
    | "archive_snapshot_unstable";

export type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryDenialV1 }
    | { readonly success: true; readonly inventory: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryV1 };

export interface D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionReceiptV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_keyed_archive_resolution_receipt";
    readonly plan_digest: string;
    readonly cleanup_obligation_digest: string | null;
    readonly claim_digest: string;
    readonly journal_revision: number;
    readonly transcript_sequence: number;
    readonly response_status: number;
    readonly response_digest: string;
    readonly archive_key_identifier: string;
    readonly archive_record_digest: string;
    readonly plaintext_length: number;
    readonly local_archive_key_matched: true;
    readonly local_ciphertext_integrity_matched: true;
    readonly local_plaintext_digest_matched: true;
    readonly plaintext_exported: false;
    readonly cloudflare_origin_authenticated: false;
    readonly effect_claim_authenticated: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionDenialV1 =
    | "invalid_started_claim"
    | "invalid_archive_inventory_record"
    | "invalid_plan_expiry"
    | "invalid_archive_key"
    | "archive_not_found"
    | "unsafe_archive_path"
    | "unsafe_archive_permissions"
    | "archive_io_unavailable"
    | "archive_corrupt"
    | "archive_unreconciled"
    | "archive_context_mismatch"
    | "archive_key_mismatch"
    | "archive_decryption_failed"
    | "response_digest_mismatch"
    | "response_claim_mismatch";

export type D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionDenialV1 }
    | {
          readonly success: true;
          readonly claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1;
          readonly receipt: D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionReceiptV1;
      };

const KeyedResolutionInventoryRecordV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory_record"),
        cleanup_obligation_digest: DigestV1Schema.nullable(),
        claim_digest: DigestV1Schema,
        journal_revision: SafeRevisionV1Schema,
        transcript_sequence: z.number().int().safe().positive(),
        response_status: z.number().int().min(100).max(599),
        response_digest: DigestV1Schema,
        archive_key_identifier: DigestV1Schema,
        plaintext_length: z.number().int().nonnegative().max(MAX_RESPONSE_BYTES_V1),
        archive_record_digest: DigestV1Schema,
        caller_asserted_response_content_type_digest: DigestV1Schema.nullable(),
        caller_asserted_response_content_encoding: z.literal("identity").nullable(),
        caller_asserted_response_observed_at_ms: SafeRevisionV1Schema,
        caller_mutation_authority: z.literal(false),
        cloudflare_origin_authenticated: z.literal(false),
        archive_key_possession_proven: z.literal(false),
        archive_decryptability_proven: z.literal(false),
        effect_claim_persistence_proven: z.literal(false),
        response_authenticated: z.literal(false),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict();

type ArchiveRootResultV1 =
    | {
          readonly success: false;
          readonly code:
              "archive_not_found" | "unsafe_archive_path" | "unsafe_archive_permissions" | "archive_io_unavailable";
      }
    | { readonly success: true; readonly root: string };

const errorCode = (error: unknown): string | null =>
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : null;

const lstatOrNull = async (path: string) => {
    try {
        return await lstat(path);
    } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
    }
};

const isContainedPath = (parent: string, child: string): boolean => {
    const pathFromParent = relative(parent, child);
    return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`);
};

const makeDirectory = async (path: string): Promise<void> => {
    try {
        await mkdir(path, { mode: 0o700 });
    } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
    }
};

const ensureArchiveRoot = async (createIfMissing: boolean): Promise<ArchiveRootResultV1> => {
    try {
        const repositoryStat = await lstat(repositoryRoot);
        if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_archive_path" };
        }
        const realRepositoryRoot = await realpath(repositoryRoot);
        let buildStat = await lstatOrNull(buildRoot);
        if (buildStat === null) {
            if (!createIfMissing) return { success: false, code: "archive_not_found" };
            await makeDirectory(buildRoot);
            buildStat = await lstat(buildRoot);
        }
        if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_archive_path" };
        }
        let archiveStat = await lstatOrNull(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1);
        if (archiveStat === null) {
            if (!createIfMissing) return { success: false, code: "archive_not_found" };
            await makeDirectory(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1);
            archiveStat = await lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1);
        }
        if (!archiveStat.isDirectory() || archiveStat.isSymbolicLink()) {
            return { success: false, code: "unsafe_archive_path" };
        }
        if ((archiveStat.mode & 0o777) !== 0o700) {
            return { success: false, code: "unsafe_archive_permissions" };
        }
        const realArchiveRoot = await realpath(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1);
        if (
            !isContainedPath(realRepositoryRoot, realArchiveRoot) ||
            realArchiveRoot !== resolve(realRepositoryRoot, ".build", "d1-probe-canary-response-archive")
        ) {
            return { success: false, code: "unsafe_archive_path" };
        }
        return { success: true, root: realArchiveRoot };
    } catch {
        return { success: false, code: "archive_io_unavailable" };
    }
};

const archivePathFor = (root: string, planDigest: string, claimDigest: string): string =>
    resolve(root, `${planDigest}.${claimDigest}.response-preimage.json`);

const tempNamePattern = (planDigest: string, claimDigest: string): RegExp =>
    new RegExp(
        `^${planDigest}\\.${claimDigest}\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.response-preimage\\.tmp$`,
        "u"
    );

const syncDirectory = async (path: string): Promise<void> => {
    const handle = await open(path, constants.O_RDONLY);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

const reconcilePublishedArchive = async (
    root: string,
    planDigest: string,
    claimDigest: string,
    finalStat: Awaited<ReturnType<typeof lstat>>
): Promise<boolean> => {
    if (finalStat.nlink !== 2) return finalStat.nlink === 1;
    const pattern = tempNamePattern(planDigest, claimDigest);
    const candidates = (await readdir(root)).filter(name => pattern.test(name));
    for (const name of candidates) {
        const tempPath = resolve(root, name);
        const tempStat = await lstatOrNull(tempPath);
        if (
            tempStat !== null &&
            tempStat.isFile() &&
            !tempStat.isSymbolicLink() &&
            tempStat.dev === finalStat.dev &&
            tempStat.ino === finalStat.ino &&
            tempStat.nlink === 2 &&
            (tempStat.mode & 0o777) === 0o600
        ) {
            await unlink(tempPath);
            await syncDirectory(root);
            const reconciled = await lstat(archivePathFor(root, planDigest, claimDigest));
            return reconciled.isFile() && !reconciled.isSymbolicLink() && reconciled.nlink === 1;
        }
    }
    return false;
};

const decodeCanonicalBase64 = (value: string): Buffer | null => {
    try {
        const decoded = Buffer.from(value, "base64");
        return decoded.toString("base64") === value ? decoded : null;
    } catch {
        return null;
    }
};

const archiveAad = (
    context: D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1,
    plaintextLength: number,
    archiveKeyIdentifier: string
): z.infer<typeof ArchiveAadV1Schema> => ({
    ...context,
    kind: "d1_probe_cloudflare_worker_api_canary_response_archive_aad",
    domain: ARCHIVE_DOMAIN_V1,
    archive_key_identifier: archiveKeyIdentifier,
    plaintext_length: plaintextLength,
});

const contextMatchesClaim = (
    context: D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1,
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): boolean =>
    context.plan_digest === claim.plan_digest &&
    context.execution_nonce_commitment === claim.execution_nonce_commitment &&
    context.operation_revision === claim.operation_revision &&
    context.operation_state === claim.operation_state &&
    context.operation_record_digest === claim.operation_record_digest &&
    context.cleanup_obligation_digest === claim.cleanup_obligation_digest &&
    context.claim_digest === claim.claim_digest &&
    context.journal_revision === claim.journal_revision &&
    context.transcript_sequence === claim.transcript_sequence &&
    context.effect_phase === claim.effect_phase &&
    context.workflow_step === claim.workflow_step &&
    context.request_kind === claim.request_kind &&
    context.request_method === claim.request_method &&
    context.request_digest === claim.request_digest &&
    context.request_path_digest === claim.request_path_digest &&
    context.response_status === claim.response_status &&
    context.response_digest === claim.response_digest;

const deriveRecordKey = (archiveKey: Buffer, claimDigest: string): Buffer => {
    const salt = Buffer.from(claimDigest, "hex");
    try {
        return Buffer.from(
            hkdfSync("sha256", archiveKey, salt, Buffer.from(`${ARCHIVE_KEY_DOMAIN_V1}\0${claimDigest}`, "utf8"), 32)
        );
    } finally {
        salt.fill(0);
    }
};

const digestEnvelopeDraft = async (draft: z.infer<typeof ArchiveEnvelopeDraftV1Schema>): Promise<string | null> =>
    await digestCanonicalJsonV1(ARCHIVE_RECORD_DIGEST_DOMAIN_V1, draft as CanonicalJsonValueV1);

const validateEnvelope = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1 | null> => {
    try {
        const parsed = D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1Schema.safeParse(input);
        if (!parsed.success) return null;
        const { archive_record_digest: claimedDigest, ...draft } = parsed.data;
        const [nonce, tag, ciphertext] = [
            decodeCanonicalBase64(draft.nonce_base64),
            decodeCanonicalBase64(draft.authentication_tag_base64),
            decodeCanonicalBase64(draft.ciphertext_base64),
        ];
        if (
            nonce === null ||
            tag === null ||
            ciphertext === null ||
            nonce.length !== 12 ||
            tag.length !== 16 ||
            ciphertext.length !== draft.plaintext_length
        ) {
            return null;
        }
        return (await digestEnvelopeDraft(draft)) === claimedDigest ? parsed.data : null;
    } catch {
        return null;
    }
};

const receiptFor = (
    envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1
): D1ProbeCloudflareWorkerCanaryResponseArchiveReceiptV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_response_archive_receipt",
    plan_digest: envelope.plan_digest,
    cleanup_obligation_digest: envelope.cleanup_obligation_digest,
    claim_digest: envelope.claim_digest,
    journal_revision: envelope.journal_revision,
    transcript_sequence: envelope.transcript_sequence,
    response_digest: envelope.response_digest,
    archive_key_identifier: envelope.archive_key_identifier,
    plaintext_length: envelope.plaintext_length,
    archive_record_digest: envelope.archive_record_digest,
    caller_mutation_authority: false,
    cloudflare_origin_authenticated: false,
    effect_claim_authenticated: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
});

const readEnvelope = async (
    root: string,
    planDigest: string,
    claimDigest: string,
    reconcile = true,
    expectedStat?: Awaited<ReturnType<typeof lstat>>
): Promise<
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryResponseArchiveDenialV1 }
    | { readonly success: true; readonly envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1 }
> => {
    const path = archivePathFor(root, planDigest, claimDigest);
    try {
        const finalName = `${planDigest}.${claimDigest}.response-preimage.json`;
        const tempPattern = tempNamePattern(planDigest, claimDigest);
        const claimEntries = (await readdir(root)).filter(name => name.startsWith(`${planDigest}.${claimDigest}.`));
        if (claimEntries.some(name => name !== finalName && !tempPattern.test(name))) {
            return { success: false, code: "archive_unreconciled" };
        }
        let tempEntries = claimEntries.filter(name => tempPattern.test(name));
        let pathStat = await lstatOrNull(path);
        if (pathStat === null) {
            return { success: false, code: tempEntries.length === 0 ? "archive_not_found" : "archive_unreconciled" };
        }
        if (
            reconcile &&
            pathStat.nlink === 2 &&
            (await reconcilePublishedArchive(root, planDigest, claimDigest, pathStat))
        ) {
            pathStat = await lstat(path);
            tempEntries = (await readdir(root)).filter(name => tempPattern.test(name));
        }
        if (tempEntries.length !== 0) return { success: false, code: "archive_unreconciled" };
        if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
            return { success: false, code: reconcile ? "unsafe_archive_path" : "archive_unreconciled" };
        }
        if ((pathStat.mode & 0o777) !== 0o600) {
            return { success: false, code: "unsafe_archive_permissions" };
        }
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1) return { success: false, code: "unsafe_archive_path" };
            if ((stat.mode & 0o777) !== 0o600) return { success: false, code: "unsafe_archive_permissions" };
            if (
                expectedStat !== undefined &&
                (stat.dev !== expectedStat.dev ||
                    stat.ino !== expectedStat.ino ||
                    stat.mode !== expectedStat.mode ||
                    stat.nlink !== expectedStat.nlink ||
                    stat.size !== expectedStat.size ||
                    stat.mtimeMs !== expectedStat.mtimeMs ||
                    stat.ctimeMs !== expectedStat.ctimeMs)
            ) {
                return { success: false, code: "archive_unreconciled" };
            }
            if (stat.size <= 0 || stat.size > MAX_ENVELOPE_BYTES_V1) {
                return { success: false, code: "archive_corrupt" };
            }
            const bytes = await handle.readFile();
            if (expectedStat !== undefined) {
                const afterReadStat = await handle.stat();
                if (
                    afterReadStat.dev !== stat.dev ||
                    afterReadStat.ino !== stat.ino ||
                    afterReadStat.mode !== stat.mode ||
                    afterReadStat.nlink !== stat.nlink ||
                    afterReadStat.size !== stat.size ||
                    afterReadStat.mtimeMs !== stat.mtimeMs ||
                    afterReadStat.ctimeMs !== stat.ctimeMs
                ) {
                    return { success: false, code: "archive_unreconciled" };
                }
            }
            let text: string;
            let input: unknown;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                input = JSON.parse(text) as unknown;
            } catch {
                return { success: false, code: "archive_corrupt" };
            }
            const envelope = await validateEnvelope(input);
            if (
                envelope === null ||
                envelope.plan_digest !== planDigest ||
                envelope.claim_digest !== claimDigest ||
                canonicalizeJsonV1(envelope as CanonicalJsonValueV1) !== text
            ) {
                return { success: false, code: "archive_corrupt" };
            }
            return { success: true, envelope };
        } finally {
            await handle.close();
        }
    } catch {
        return { success: false, code: "archive_io_unavailable" };
    }
};

const encryptEnvelope = async (
    context: D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1,
    responseBytes: Buffer,
    archiveKey: Buffer
): Promise<D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1> => {
    const archiveKeyIdentifier = createHmac("sha256", archiveKey)
        .update(ARCHIVE_KEY_IDENTIFIER_DOMAIN_V1, "utf8")
        .digest("hex");
    const aad = archiveAad(context, responseBytes.length, archiveKeyIdentifier);
    const aadBytes = Buffer.from(canonicalizeJsonV1(aad as CanonicalJsonValueV1), "utf8");
    const nonce = randomBytes(12);
    const recordKey = deriveRecordKey(archiveKey, context.claim_digest);
    try {
        const cipher = createCipheriv("aes-256-gcm", recordKey, nonce);
        cipher.setAAD(aadBytes, { plaintextLength: responseBytes.length });
        const ciphertext = Buffer.concat([cipher.update(responseBytes), cipher.final()]);
        const draft = ArchiveEnvelopeDraftV1Schema.parse({
            ...aad,
            kind: "d1_probe_cloudflare_worker_api_canary_encrypted_response_preimage",
            encryption: "AES-256-GCM",
            key_derivation: "HKDF-SHA-256",
            nonce_base64: nonce.toString("base64"),
            ciphertext_base64: ciphertext.toString("base64"),
            authentication_tag_base64: cipher.getAuthTag().toString("base64"),
            caller_mutation_authority: false,
            cloudflare_origin_authenticated: false,
            effect_claim_authenticated: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        const recordDigest = await digestEnvelopeDraft(draft);
        if (recordDigest === null) throw new Error("archive envelope digest unavailable");
        return D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1Schema.parse({
            ...draft,
            archive_record_digest: recordDigest,
        });
    } finally {
        recordKey.fill(0);
        nonce.fill(0);
        aadBytes.fill(0);
    }
};

const publishEnvelope = async (
    root: string,
    envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1
): Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveResultV1> => {
    const finalPath = archivePathFor(root, envelope.plan_digest, envelope.claim_digest);
    const existing = await readEnvelope(root, envelope.plan_digest, envelope.claim_digest);
    if (existing.success) return { success: false, code: "archive_already_exists" };
    if (existing.code !== "archive_not_found") return { success: false, code: existing.code };
    const tempPath = resolve(
        root,
        `${envelope.plan_digest}.${envelope.claim_digest}.${randomUUID()}.response-preimage.tmp`
    );
    let tempCreated = false;
    try {
        const handle = await open(tempPath, "wx", 0o600);
        tempCreated = true;
        try {
            await handle.chmod(0o600);
            await handle.writeFile(canonicalizeJsonV1(envelope as CanonicalJsonValueV1));
            await handle.sync();
        } finally {
            await handle.close();
        }
        await link(tempPath, finalPath);
        await unlink(tempPath).catch(error => {
            if (errorCode(error) !== "ENOENT") throw error;
        });
        tempCreated = false;
        await syncDirectory(root);
        return { success: true, receipt: receiptFor(envelope) };
    } catch (error) {
        if (errorCode(error) === "EEXIST") return { success: false, code: "concurrent_archive_write" };
        return { success: false, code: "archive_io_unavailable" };
    } finally {
        if (tempCreated) await unlink(tempPath).catch(() => undefined);
    }
};

export const archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1 = async (
    claimInput: unknown,
    expectedContextInput: unknown,
    responseBytesInput: unknown,
    archiveKeyInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveResultV1> => {
    let responseBytes: Buffer | null = null;
    let archiveKey: Buffer | null = null;
    try {
        const claim = await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(claimInput);
        if (claim === null) return { success: false, code: "invalid_effect_claim" };
        if (claim.effect_phase !== "response_observed") {
            return { success: false, code: "claim_not_response_observed" };
        }
        let context: D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1 | null = null;
        try {
            const parsed =
                D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1Schema.safeParse(expectedContextInput);
            context = parsed.success ? parsed.data : null;
        } catch {
            return { success: false, code: "invalid_expected_context" };
        }
        if (context === null) return { success: false, code: "invalid_expected_context" };
        if (!contextMatchesClaim(context, claim)) return { success: false, code: "claim_context_mismatch" };
        try {
            if (!(responseBytesInput instanceof Uint8Array)) {
                return { success: false, code: "invalid_response_bytes" };
            }
            if (responseBytesInput.byteLength > MAX_RESPONSE_BYTES_V1) {
                return { success: false, code: "response_too_large" };
            }
            responseBytes = Buffer.from(responseBytesInput);
        } catch {
            return { success: false, code: "invalid_response_bytes" };
        }
        try {
            if (!(archiveKeyInput instanceof Uint8Array) || archiveKeyInput.byteLength !== 32) {
                return { success: false, code: "invalid_archive_key" };
            }
            archiveKey = Buffer.from(archiveKeyInput);
        } catch {
            return { success: false, code: "invalid_archive_key" };
        }
        const digest = createHash("sha256").update(responseBytes).digest("hex");
        if (digest !== context.response_digest) return { success: false, code: "response_digest_mismatch" };
        const root = await ensureArchiveRoot(true);
        if (!root.success) return root;
        const envelope = await encryptEnvelope(context, responseBytes, archiveKey);
        return await publishEnvelope(root.root, envelope);
    } catch {
        return { success: false, code: "archive_io_unavailable" };
    } finally {
        archiveKey?.fill(0);
        responseBytes?.fill(0);
    }
};

const archiveContextForEnvelope = (
    envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1
): D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_response_archive_expected_context",
    plan_digest: envelope.plan_digest,
    execution_nonce_commitment: envelope.execution_nonce_commitment,
    operation_revision: envelope.operation_revision,
    operation_state: envelope.operation_state,
    operation_record_digest: envelope.operation_record_digest,
    cleanup_obligation_digest: envelope.cleanup_obligation_digest,
    claim_digest: envelope.claim_digest,
    journal_revision: envelope.journal_revision,
    transcript_sequence: envelope.transcript_sequence,
    effect_phase: "response_observed",
    workflow_step: envelope.workflow_step,
    request_kind: envelope.request_kind,
    request_method: envelope.request_method,
    request_digest: envelope.request_digest,
    request_path_digest: envelope.request_path_digest,
    response_status: envelope.response_status,
    response_digest: envelope.response_digest,
    caller_asserted_response_content_type: envelope.caller_asserted_response_content_type,
    caller_asserted_response_content_encoding: envelope.caller_asserted_response_content_encoding,
    caller_asserted_response_observed_at_ms: envelope.caller_asserted_response_observed_at_ms,
});

const responseClaimDraftFromArchive = (
    started: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1
): D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
    journal_revision: started.journal_revision + 1,
    previous_claim_digest: started.claim_digest,
    plan_digest: started.plan_digest,
    operation_revision: started.operation_revision,
    operation_state: started.operation_state,
    operation_record_digest: started.operation_record_digest,
    execution_nonce_commitment: started.execution_nonce_commitment,
    lease_generation: started.lease_generation,
    lease_record_digest: started.lease_record_digest,
    cleanup_obligation_digest: started.cleanup_obligation_digest,
    workflow_step: started.workflow_step,
    request_kind: started.request_kind,
    request_method: started.request_method,
    transcript_sequence: started.transcript_sequence,
    effect_phase: "response_observed",
    intent_observed_at_ms: started.intent_observed_at_ms,
    dispatch_started_at_ms: started.dispatch_started_at_ms,
    request_digest: started.request_digest,
    request_path_digest: started.request_path_digest,
    response_status: envelope.response_status,
    response_digest: envelope.response_digest,
    ambiguity_classification: "none",
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
});

const envelopeMatchesStartedAndInventory = (
    envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1,
    started: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    record: z.infer<typeof KeyedResolutionInventoryRecordV1Schema>,
    planExpiresAtMs: number
): boolean =>
    started.effect_phase === "dispatch_started" &&
    started.dispatch_started_at_ms !== null &&
    envelope.plan_digest === started.plan_digest &&
    envelope.execution_nonce_commitment === started.execution_nonce_commitment &&
    envelope.operation_revision === started.operation_revision &&
    envelope.operation_state === started.operation_state &&
    envelope.operation_record_digest === started.operation_record_digest &&
    envelope.cleanup_obligation_digest === started.cleanup_obligation_digest &&
    envelope.cleanup_obligation_digest === record.cleanup_obligation_digest &&
    envelope.claim_digest === record.claim_digest &&
    envelope.journal_revision === started.journal_revision + 1 &&
    envelope.journal_revision === record.journal_revision &&
    envelope.transcript_sequence === started.transcript_sequence &&
    envelope.transcript_sequence === record.transcript_sequence &&
    envelope.workflow_step === started.workflow_step &&
    envelope.request_kind === started.request_kind &&
    envelope.request_method === started.request_method &&
    envelope.request_digest === started.request_digest &&
    envelope.request_path_digest === started.request_path_digest &&
    envelope.response_status === record.response_status &&
    envelope.response_digest === record.response_digest &&
    envelope.archive_key_identifier === record.archive_key_identifier &&
    envelope.plaintext_length === record.plaintext_length &&
    envelope.archive_record_digest === record.archive_record_digest &&
    contentTypeDigest(envelope.caller_asserted_response_content_type) ===
        record.caller_asserted_response_content_type_digest &&
    envelope.caller_asserted_response_content_encoding === record.caller_asserted_response_content_encoding &&
    envelope.caller_asserted_response_observed_at_ms === record.caller_asserted_response_observed_at_ms &&
    envelope.caller_asserted_response_observed_at_ms >= started.dispatch_started_at_ms &&
    envelope.caller_asserted_response_observed_at_ms < planExpiresAtMs;

export const resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1 = async (
    startedClaimInput: unknown,
    inventoryRecordInput: unknown,
    planExpiresAtMsInput: unknown,
    archiveKeyInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionResultV1> => {
    let archiveKey: Buffer | null = null;
    let recordKey: Buffer | null = null;
    let nonce: Buffer | null = null;
    let tag: Buffer | null = null;
    let ciphertext: Buffer | null = null;
    let aadBytes: Buffer | null = null;
    let plaintext: Buffer | null = null;
    try {
        const started = await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(startedClaimInput);
        if (started === null || started.effect_phase !== "dispatch_started") {
            return { success: false, code: "invalid_started_claim" };
        }
        let record: z.infer<typeof KeyedResolutionInventoryRecordV1Schema> | null = null;
        try {
            const parsed = KeyedResolutionInventoryRecordV1Schema.safeParse(inventoryRecordInput);
            record = parsed.success ? parsed.data : null;
        } catch {
            return { success: false, code: "invalid_archive_inventory_record" };
        }
        if (record === null) return { success: false, code: "invalid_archive_inventory_record" };
        if (!Number.isSafeInteger(planExpiresAtMsInput) || Number(planExpiresAtMsInput) < 0) {
            return { success: false, code: "invalid_plan_expiry" };
        }
        if (!(archiveKeyInput instanceof Uint8Array) || archiveKeyInput.byteLength !== 32) {
            return { success: false, code: "invalid_archive_key" };
        }
        archiveKey = Buffer.from(archiveKeyInput);
        const root = await ensureArchiveRoot(false);
        if (!root.success) return root;
        const read = await readEnvelope(root.root, started.plan_digest, record.claim_digest, false);
        if (!read.success) {
            switch (read.code) {
                case "archive_not_found":
                case "unsafe_archive_path":
                case "unsafe_archive_permissions":
                case "archive_io_unavailable":
                case "archive_corrupt":
                case "archive_unreconciled":
                    return { success: false, code: read.code };
                default:
                    return { success: false, code: "archive_io_unavailable" };
            }
        }
        const envelope = read.envelope;
        if (!envelopeMatchesStartedAndInventory(envelope, started, record, Number(planExpiresAtMsInput))) {
            return { success: false, code: "archive_context_mismatch" };
        }
        const keyIdentifier = createHmac("sha256", archiveKey)
            .update(ARCHIVE_KEY_IDENTIFIER_DOMAIN_V1, "utf8")
            .digest("hex");
        if (keyIdentifier !== envelope.archive_key_identifier) {
            return { success: false, code: "archive_key_mismatch" };
        }
        nonce = decodeCanonicalBase64(envelope.nonce_base64);
        tag = decodeCanonicalBase64(envelope.authentication_tag_base64);
        ciphertext = decodeCanonicalBase64(envelope.ciphertext_base64);
        if (nonce === null || tag === null || ciphertext === null) {
            return { success: false, code: "archive_corrupt" };
        }
        const context = archiveContextForEnvelope(envelope);
        const aad = archiveAad(context, envelope.plaintext_length, envelope.archive_key_identifier);
        aadBytes = Buffer.from(canonicalizeJsonV1(aad as CanonicalJsonValueV1), "utf8");
        recordKey = deriveRecordKey(archiveKey, envelope.claim_digest);
        try {
            const decipher = createDecipheriv("aes-256-gcm", recordKey, nonce);
            decipher.setAAD(aadBytes, { plaintextLength: envelope.plaintext_length });
            decipher.setAuthTag(tag);
            plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch {
            return { success: false, code: "archive_decryption_failed" };
        }
        if (
            plaintext.length !== envelope.plaintext_length ||
            createHash("sha256").update(plaintext).digest("hex") !== envelope.response_digest
        ) {
            return { success: false, code: "response_digest_mismatch" };
        }
        const claim = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
            responseClaimDraftFromArchive(started, envelope)
        );
        if (claim === null || claim.claim_digest !== envelope.claim_digest) {
            return { success: false, code: "response_claim_mismatch" };
        }
        return {
            success: true,
            claim,
            receipt: Object.freeze({
                schema_version: 1,
                kind: "untrusted_d1_probe_cloudflare_worker_api_canary_keyed_archive_resolution_receipt",
                plan_digest: envelope.plan_digest,
                cleanup_obligation_digest: envelope.cleanup_obligation_digest,
                claim_digest: envelope.claim_digest,
                journal_revision: envelope.journal_revision,
                transcript_sequence: envelope.transcript_sequence,
                response_status: envelope.response_status,
                response_digest: envelope.response_digest,
                archive_key_identifier: envelope.archive_key_identifier,
                archive_record_digest: envelope.archive_record_digest,
                plaintext_length: envelope.plaintext_length,
                local_archive_key_matched: true,
                local_ciphertext_integrity_matched: true,
                local_plaintext_digest_matched: true,
                plaintext_exported: false,
                cloudflare_origin_authenticated: false,
                effect_claim_authenticated: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            }),
        };
    } catch {
        return { success: false, code: "archive_io_unavailable" };
    } finally {
        archiveKey?.fill(0);
        recordKey?.fill(0);
        nonce?.fill(0);
        tag?.fill(0);
        ciphertext?.fill(0);
        aadBytes?.fill(0);
        plaintext?.fill(0);
    }
};

interface ArchiveSnapshotV1 {
    readonly names: readonly string[];
    readonly directory_identity: string;
}

const statIdentity = (stat: Awaited<ReturnType<typeof lstat>>): string =>
    [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(":" as const);

const readArchiveSnapshot = async (root: string): Promise<ArchiveSnapshotV1> => {
    const before = await lstat(root);
    const names = (await readdir(root)).sort();
    const after = await lstat(root);
    if (statIdentity(before) !== statIdentity(after)) throw new Error("unstable archive directory");
    return Object.freeze({ names: Object.freeze(names), directory_identity: statIdentity(after) });
};

const sameArchiveSnapshot = (first: ArchiveSnapshotV1, second: ArchiveSnapshotV1): boolean =>
    first.directory_identity === second.directory_identity &&
    first.names.length === second.names.length &&
    first.names.every((name, index) => name === second.names[index]);

const inventoryReadDenial = (
    code: D1ProbeCloudflareWorkerCanaryResponseArchiveDenialV1
): D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryDenialV1 => {
    switch (code) {
        case "archive_not_found":
        case "unsafe_archive_path":
        case "unsafe_archive_permissions":
        case "archive_io_unavailable":
        case "archive_corrupt":
        case "archive_unreconciled":
            return code;
        default:
            return "archive_io_unavailable";
    }
};

const contentTypeDigest = (contentType: string | null): string | null =>
    contentType === null
        ? null
        : createHash("sha256")
              .update(ARCHIVE_CONTENT_TYPE_DIGEST_DOMAIN_V1, "utf8")
              .update("\0", "utf8")
              .update(contentType, "utf8")
              .digest("hex");

const inventoryRecordFor = (
    envelope: D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1
): D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1 =>
    Object.freeze({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory_record",
        cleanup_obligation_digest: envelope.cleanup_obligation_digest,
        claim_digest: envelope.claim_digest,
        journal_revision: envelope.journal_revision,
        transcript_sequence: envelope.transcript_sequence,
        response_status: envelope.response_status,
        response_digest: envelope.response_digest,
        archive_key_identifier: envelope.archive_key_identifier,
        plaintext_length: envelope.plaintext_length,
        archive_record_digest: envelope.archive_record_digest,
        caller_asserted_response_content_type_digest: contentTypeDigest(envelope.caller_asserted_response_content_type),
        caller_asserted_response_content_encoding: envelope.caller_asserted_response_content_encoding,
        caller_asserted_response_observed_at_ms: envelope.caller_asserted_response_observed_at_ms,
        caller_mutation_authority: false,
        cloudflare_origin_authenticated: false,
        archive_key_possession_proven: false,
        archive_decryptability_proven: false,
        effect_claim_persistence_proven: false,
        response_authenticated: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
    });

const readResponseArchiveInventory = async (
    planDigestInput: unknown,
    afterFirstSnapshot?: () => void | Promise<void>,
    afterRecordRead?: (recordIndex: number) => void | Promise<void>
): Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1> => {
    let planDigest: string;
    try {
        const parsed = DigestV1Schema.safeParse(planDigestInput);
        if (!parsed.success) return { success: false, code: "invalid_plan_digest" };
        planDigest = parsed.data;
    } catch {
        return { success: false, code: "invalid_plan_digest" };
    }
    const root = await ensureArchiveRoot(false);
    if (!root.success) return root;
    let firstSnapshot: ArchiveSnapshotV1;
    try {
        firstSnapshot = await readArchiveSnapshot(root.root);
        await afterFirstSnapshot?.();
    } catch {
        return { success: false, code: "archive_snapshot_unstable" };
    }
    const planPrefix = `${planDigest}.`;
    const finalPattern = new RegExp(`^${planDigest}\\.([0-9a-f]{64})\\.response-preimage\\.json$`, "u");
    const planNames = firstSnapshot.names.filter(name => name.startsWith(planPrefix));
    if (planNames.length > MAX_INVENTORY_RECORDS_V1) {
        return { success: false, code: "archive_inventory_too_large" };
    }
    const claimDigests: string[] = [];
    for (const name of planNames) {
        const match = finalPattern.exec(name);
        if (match === null || match[1] === undefined) {
            return { success: false, code: "archive_unreconciled" };
        }
        claimDigests.push(match[1]);
    }
    const initialStats = new Map<string, Awaited<ReturnType<typeof lstat>>>();
    for (const claimDigest of claimDigests) {
        try {
            initialStats.set(claimDigest, await lstat(archivePathFor(root.root, planDigest, claimDigest)));
        } catch {
            return { success: false, code: "archive_snapshot_unstable" };
        }
    }
    const records: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1[] = [];
    for (let recordIndex = 0; recordIndex < claimDigests.length; recordIndex += 1) {
        const claimDigest = claimDigests[recordIndex];
        if (claimDigest === undefined) return { success: false, code: "archive_snapshot_unstable" };
        const path = archivePathFor(root.root, planDigest, claimDigest);
        const before = initialStats.get(claimDigest);
        if (before === undefined) return { success: false, code: "archive_snapshot_unstable" };
        const read = await readEnvelope(root.root, planDigest, claimDigest, false, before);
        if (!read.success) {
            try {
                const changed = !sameArchiveSnapshot(firstSnapshot, await readArchiveSnapshot(root.root));
                return {
                    success: false,
                    code: changed ? "archive_snapshot_unstable" : inventoryReadDenial(read.code),
                };
            } catch {
                return { success: false, code: "archive_snapshot_unstable" };
            }
        }
        let after: Awaited<ReturnType<typeof lstat>>;
        try {
            after = await lstat(path);
        } catch {
            return { success: false, code: "archive_snapshot_unstable" };
        }
        if (statIdentity(before) !== statIdentity(after)) {
            return { success: false, code: "archive_snapshot_unstable" };
        }
        records.push(inventoryRecordFor(read.envelope));
        try {
            await afterRecordRead?.(recordIndex);
        } catch {
            return { success: false, code: "archive_snapshot_unstable" };
        }
    }
    for (const claimDigest of claimDigests) {
        const initial = initialStats.get(claimDigest);
        if (initial === undefined) return { success: false, code: "archive_snapshot_unstable" };
        try {
            const final = await lstat(archivePathFor(root.root, planDigest, claimDigest));
            if (statIdentity(initial) !== statIdentity(final)) {
                return { success: false, code: "archive_snapshot_unstable" };
            }
        } catch {
            return { success: false, code: "archive_snapshot_unstable" };
        }
    }
    let finalSnapshot: ArchiveSnapshotV1;
    try {
        finalSnapshot = await readArchiveSnapshot(root.root);
    } catch {
        return { success: false, code: "archive_snapshot_unstable" };
    }
    if (!sameArchiveSnapshot(firstSnapshot, finalSnapshot)) {
        return { success: false, code: "archive_snapshot_unstable" };
    }
    records.sort(
        (left, right) =>
            left.journal_revision - right.journal_revision ||
            left.transcript_sequence - right.transcript_sequence ||
            left.claim_digest.localeCompare(right.claim_digest)
    );
    const claimIdentities = new Set<string>();
    const journalRevisions = new Set<number>();
    const transcriptSequences = new Set<number>();
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record === undefined) return { success: false, code: "archive_inventory_unsafe_sequence" };
        if (
            claimIdentities.has(record.claim_digest) ||
            journalRevisions.has(record.journal_revision) ||
            transcriptSequences.has(record.transcript_sequence)
        ) {
            return { success: false, code: "archive_inventory_unsafe_sequence" };
        }
        claimIdentities.add(record.claim_digest);
        journalRevisions.add(record.journal_revision);
        transcriptSequences.add(record.transcript_sequence);
        const expectedJournalRevision = record.transcript_sequence * 3 - 1;
        const previous = records[index - 1];
        if (
            !Number.isSafeInteger(expectedJournalRevision) ||
            record.journal_revision !== expectedJournalRevision ||
            (previous !== undefined &&
                (record.journal_revision <= previous.journal_revision ||
                    record.transcript_sequence <= previous.transcript_sequence))
        ) {
            return { success: false, code: "archive_inventory_unsafe_sequence" };
        }
    }
    const frozenRecords = Object.freeze(records);
    return {
        success: true,
        inventory: Object.freeze({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory",
            plan_digest: planDigest,
            record_count: frozenRecords.length,
            records: frozenRecords,
            cloudflare_origin_authenticated: false,
            archive_key_possession_proven: false,
            archive_decryptability_proven: false,
            effect_claim_persistence_proven: false,
            response_authenticated: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        }),
    };
};

export const readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1> =>
    await readResponseArchiveInventory(planDigestInput);

export const readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyTestOnlyV1 = async (
    planDigestInput: unknown,
    afterFirstSnapshot: () => void | Promise<void>,
    afterRecordRead?: (recordIndex: number) => void | Promise<void>
): Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1> =>
    await readResponseArchiveInventory(planDigestInput, afterFirstSnapshot, afterRecordRead);

export const d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1 = (
    planDigestInput: unknown,
    claimDigestInput: unknown
): string | null => {
    try {
        const planDigest = DigestV1Schema.safeParse(planDigestInput);
        const claimDigest = DigestV1Schema.safeParse(claimDigestInput);
        return planDigest.success && claimDigest.success
            ? archivePathFor(
                  D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1,
                  planDigest.data,
                  claimDigest.data
              )
            : null;
    } catch {
        return null;
    }
};
