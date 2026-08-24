import { constants } from "node:fs";
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
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
    D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestKindV1Schema,
    D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimRequestMethodV1Schema,
    D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimWorkflowStepV1Schema,
    validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import { D1ProbeCloudflareWorkerCanaryOperationStateV1Schema } from "./cloudflare-worker-canary-operation.js";

const ARCHIVE_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-archive.v1";
const ARCHIVE_KEY_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-key.v1";
const ARCHIVE_KEY_IDENTIFIER_DOMAIN_V1 =
    "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-key-identifier.v1";
const ARCHIVE_RECORD_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-envelope.v1";
const MAX_RESPONSE_BYTES_V1 = 256 * 1024;
const MAX_ENVELOPE_BYTES_V1 = 384 * 1024;
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
    reconcile = true
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
            if (stat.size <= 0 || stat.size > MAX_ENVELOPE_BYTES_V1) {
                return { success: false, code: "archive_corrupt" };
            }
            const bytes = await handle.readFile();
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
