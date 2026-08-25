import { createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { chmod, link, lstat, readFile, readdir, rename, symlink, unlink, writeFile } from "node:fs/promises";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { afterEach, describe, expect, it } from "vitest";

import {
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_MAX_PLAINTEXT_BYTES_V1,
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1,
    archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1,
    d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1,
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyTestOnlyV1,
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1,
    type D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1,
} from "./cloudflare-worker-canary-response-archive.js";

const cleanupPrefixes = new Set<string>();
const cleanupPaths = new Set<string>();

afterEach(async () => {
    for (const path of cleanupPaths) await unlink(path).catch(() => undefined);
    const names = await readdir(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1).catch(() => []);
    for (const prefix of cleanupPrefixes) {
        for (const name of names) {
            if (name.startsWith(`${prefix}.`)) {
                await unlink(`${D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1}/${name}`).catch(
                    () => undefined
                );
            }
        }
    }
    cleanupPrefixes.clear();
    cleanupPaths.clear();
});

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const randomDigest = (): string => randomBytes(32).toString("hex");

const observedClaim = async (
    responseBytes: Uint8Array,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1> = {}
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const draft: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 = {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
        journal_revision: 2,
        previous_claim_digest: randomDigest(),
        plan_digest: randomDigest(),
        operation_revision: 0,
        operation_state: "prepared",
        operation_record_digest: randomDigest(),
        execution_nonce_commitment: randomDigest(),
        lease_generation: 0,
        lease_record_digest: randomDigest(),
        workflow_step: "prepared_worker_list",
        request_kind: "inspect_worker",
        request_method: "GET",
        transcript_sequence: 1,
        effect_phase: "response_observed",
        intent_observed_at_ms: 1_785_999_999_998,
        dispatch_started_at_ms: 1_785_999_999_999,
        request_digest: randomDigest(),
        request_path_digest: randomDigest(),
        response_status: 200,
        response_digest: digest(responseBytes),
        ambiguity_classification: "none",
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        ...overrides,
    };
    const claim = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(draft);
    if (claim === null) throw new Error("test claim did not validate");
    cleanupPrefixes.add(claim.plan_digest);
    return claim;
};

const startedAndObservedClaims = async (
    responseBytes: Uint8Array
): Promise<{
    readonly started: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1;
    readonly observed: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1;
}> => {
    const base = await observedClaim(responseBytes);
    const { claim_digest: _baseDigest, ...baseDraft } = base;
    const started = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        ...baseDraft,
        journal_revision: 1,
        previous_claim_digest: randomDigest(),
        effect_phase: "dispatch_started",
        response_status: null,
        response_digest: null,
        ambiguity_classification: "may_have_dispatched",
    });
    if (started === null) throw new Error("test started claim did not validate");
    const observed = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        ...baseDraft,
        journal_revision: 2,
        previous_claim_digest: started.claim_digest,
    });
    if (observed === null) throw new Error("test observed claim did not validate");
    return { started, observed };
};

const contextFor = (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1 => {
    if (
        claim.effect_phase !== "response_observed" ||
        claim.response_status === null ||
        claim.response_digest === null
    ) {
        throw new Error("test claim is not observed");
    }
    return {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_response_archive_expected_context",
        plan_digest: claim.plan_digest,
        execution_nonce_commitment: claim.execution_nonce_commitment,
        operation_revision: claim.operation_revision,
        operation_state: claim.operation_state,
        operation_record_digest: claim.operation_record_digest,
        claim_digest: claim.claim_digest,
        journal_revision: claim.journal_revision,
        transcript_sequence: claim.transcript_sequence,
        effect_phase: claim.effect_phase,
        workflow_step: claim.workflow_step,
        request_kind: claim.request_kind,
        request_method: claim.request_method,
        request_digest: claim.request_digest,
        request_path_digest: claim.request_path_digest,
        response_status: claim.response_status,
        response_digest: claim.response_digest,
        caller_asserted_response_content_type: "application/json; charset=utf-8",
        caller_asserted_response_content_encoding: "identity",
        caller_asserted_response_observed_at_ms: 1_786_000_000_000,
    };
};

const pathFor = (claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1): string => {
    const path = d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1(claim.plan_digest, claim.claim_digest);
    if (path === null) throw new Error("test archive path unavailable");
    return path;
};

const archive = async (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    responseBytes: Uint8Array,
    key: Uint8Array = randomBytes(32)
) => await archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, contextFor(claim), responseBytes, key);

const readEnvelope = async (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): Promise<D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1> => {
    const path = pathFor(claim);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) {
        throw new Error("unsafe test archive path");
    }
    return JSON.parse(await readFile(path, "utf8")) as D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1;
};

const decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1 = async (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    context: D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1,
    key: Uint8Array
): Promise<Uint8Array | null> => {
    try {
        const envelope = await readEnvelope(claim);
        const aad = {
            ...context,
            kind: "d1_probe_cloudflare_worker_api_canary_response_archive_aad",
            domain: "openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-archive.v1",
            archive_key_identifier: createHmac("sha256", key)
                .update("openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-key-identifier.v1", "utf8")
                .digest("hex"),
            plaintext_length: envelope.plaintext_length,
        };
        const mismatches = Object.entries(aad).filter(
            ([field, value]) =>
                field !== "kind" &&
                envelope[field as keyof D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1] !== value
        );
        if (mismatches.length !== 0) return null;
        const recordKey = Buffer.from(
            hkdfSync(
                "sha256",
                key,
                Buffer.from(claim.claim_digest, "hex"),
                Buffer.from(
                    `openbot.d1-probe.cloudflare-worker-api-canary-response-preimage-key.v1\0${claim.claim_digest}`,
                    "utf8"
                ),
                32
            )
        );
        try {
            const decipher = createDecipheriv("aes-256-gcm", recordKey, Buffer.from(envelope.nonce_base64, "base64"));
            decipher.setAAD(Buffer.from(canonicalizeJsonV1(aad as CanonicalJsonValueV1), "utf8"), {
                plaintextLength: envelope.plaintext_length,
            });
            decipher.setAuthTag(Buffer.from(envelope.authentication_tag_base64, "base64"));
            const plaintext = Buffer.concat([
                decipher.update(Buffer.from(envelope.ciphertext_base64, "base64")),
                decipher.final(),
            ]);
            return digest(plaintext) === envelope.response_digest ? Uint8Array.from(plaintext) : null;
        } finally {
            recordKey.fill(0);
        }
    } catch {
        return null;
    }
};

describe("Cloudflare Worker canary encrypted response-preimage archive", () => {
    it("resolves one archive-ahead response claim with a key without exporting plaintext", async () => {
        const response = new TextEncoder().encode('{"id":"private-worker-id","ok":true}');
        const { started, observed } = await startedAndObservedClaims(response);
        const key = randomBytes(32);
        expect(await archive(observed, response, key)).toMatchObject({ success: true });
        const inventory = await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(
            observed.plan_digest
        );
        if (!inventory.success) throw new Error(inventory.code);
        const record = inventory.inventory.records[0];
        if (record === undefined) throw new Error("archive inventory record unavailable");

        const result = await resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1(
            started,
            record,
            1_786_000_000_001,
            key
        );

        expect(result).toMatchObject({
            success: true,
            claim: { claim_digest: observed.claim_digest, effect_phase: "response_observed" },
            receipt: {
                claim_digest: observed.claim_digest,
                local_archive_key_matched: true,
                local_ciphertext_integrity_matched: true,
                local_plaintext_digest_matched: true,
                plaintext_exported: false,
                cloudflare_origin_authenticated: false,
                effect_claim_authenticated: false,
                caller_mutation_authority: false,
                authoritative: false,
            },
        });
        expect(JSON.stringify(result)).not.toContain("private-worker-id");
        expect(JSON.stringify(result)).not.toContain(Buffer.from(response).toString("base64"));
    });

    it("denies the wrong key, an expired observation, and a substituted started claim", async () => {
        const response = new TextEncoder().encode('{"ok":true}');
        const { started, observed } = await startedAndObservedClaims(response);
        const key = randomBytes(32);
        expect(await archive(observed, response, key)).toMatchObject({ success: true });
        const inventory = await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(
            observed.plan_digest
        );
        if (!inventory.success) throw new Error(inventory.code);
        const record = inventory.inventory.records[0];
        if (record === undefined) throw new Error("archive inventory record unavailable");
        const { claim_digest: _startedDigest, ...startedDraft } = started;
        const substituted = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
            ...startedDraft,
            request_digest: randomDigest(),
        });
        if (substituted === null) throw new Error("substituted started claim unavailable");

        await expect(
            resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1(
                started,
                record,
                1_786_000_000_001,
                randomBytes(32)
            )
        ).resolves.toEqual({ success: false, code: "archive_key_mismatch" });
        await expect(
            resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1(started, record, 1_786_000_000_000, key)
        ).resolves.toEqual({ success: false, code: "archive_context_mismatch" });
        await expect(
            resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1(substituted, record, 1_786_000_000_001, key)
        ).resolves.toEqual({ success: false, code: "archive_context_mismatch" });
    });

    it("writes a canonical encrypted envelope and returns only a non-authoritative receipt", async () => {
        const response = new TextEncoder().encode('{"id":"secret-worker-id","ok":true}');
        const claim = await observedClaim(response);
        const context = contextFor(claim);
        const key = randomBytes(32);

        const result = await archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, context, response, key);
        expect(result).toMatchObject({
            success: true,
            receipt: {
                kind: "untrusted_d1_probe_cloudflare_worker_api_canary_response_archive_receipt",
                plan_digest: claim.plan_digest,
                claim_digest: claim.claim_digest,
                response_digest: claim.response_digest,
                plaintext_length: response.length,
                caller_mutation_authority: false,
                cloudflare_origin_authenticated: false,
                effect_claim_authenticated: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        });
        const path = pathFor(claim);
        const [rootStat, fileStat, stored] = await Promise.all([
            lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1),
            lstat(path),
            readFile(path, "utf8"),
        ]);
        const envelope = JSON.parse(stored) as D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1;
        expect(rootStat.mode & 0o777).toBe(0o700);
        expect(fileStat.mode & 0o777).toBe(0o600);
        expect(fileStat.nlink).toBe(1);
        expect(stored).toBe(canonicalizeJsonV1(envelope as CanonicalJsonValueV1));
        expect(stored).not.toContain("secret-worker-id");
        expect(Buffer.from(envelope.nonce_base64, "base64")).toHaveLength(12);
        expect(Buffer.from(envelope.authentication_tag_base64, "base64")).toHaveLength(16);
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(claim, context, key)
        ).resolves.toEqual(response);
    });

    it("requires a valid response_observed claim", async () => {
        const response = new Uint8Array([1, 2, 3]);
        const observed = await observedClaim(response);
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1({}, {}, response, randomBytes(32))
        ).resolves.toEqual({
            success: false,
            code: "invalid_effect_claim",
        });
        const { claim_digest: _claimDigest, ...observedDraft } = observed;
        const intent = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
            ...observedDraft,
            effect_phase: "dispatch_intent",
            dispatch_started_at_ms: null,
            response_status: null,
            response_digest: null,
            ambiguity_classification: "not_dispatched",
        });
        if (intent === null) throw new Error("test intent did not validate");
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(
                intent,
                contextFor(observed),
                response,
                randomBytes(32)
            )
        ).resolves.toEqual({ success: false, code: "claim_not_response_observed" });
    });

    it("rejects every caller-supplied context substitution", async () => {
        const response = new Uint8Array([4, 5, 6]);
        const claim = await observedClaim(response);
        const context = contextFor(claim);
        const substitutions: Record<string, unknown> = {
            plan_digest: randomDigest(),
            execution_nonce_commitment: randomDigest(),
            operation_revision: 1,
            operation_state: "shell_dispatching",
            operation_record_digest: randomDigest(),
            claim_digest: randomDigest(),
            journal_revision: 3,
            transcript_sequence: 2,
            workflow_step: "shell_create",
            request_kind: "create_worker",
            request_method: "POST",
            request_digest: randomDigest(),
            request_path_digest: randomDigest(),
            response_status: 201,
            response_digest: randomDigest(),
        };
        for (const [field, value] of Object.entries(substitutions)) {
            await expect(
                archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(
                    claim,
                    { ...context, [field]: value },
                    response,
                    randomBytes(32)
                ),
                field
            ).resolves.toEqual({ success: false, code: "claim_context_mismatch" });
        }
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(
                claim,
                { ...context, extra: "denied" },
                response,
                randomBytes(32)
            )
        ).resolves.toEqual({ success: false, code: "invalid_expected_context" });
    });

    it("checks the exact raw bytes, size limit, and 32-byte binary key", async () => {
        const response = new Uint8Array([0, 255, 1, 128]);
        const claim = await observedClaim(response);
        const context = contextFor(claim);
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(
                claim,
                context,
                new Uint8Array([0, 255]),
                randomBytes(32)
            )
        ).resolves.toEqual({ success: false, code: "response_digest_mismatch" });
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, context, "AP8BgA==", randomBytes(32))
        ).resolves.toEqual({ success: false, code: "invalid_response_bytes" });
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(
                claim,
                context,
                new Uint8Array(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_MAX_PLAINTEXT_BYTES_V1 + 1),
                randomBytes(32)
            )
        ).resolves.toEqual({ success: false, code: "response_too_large" });
        for (const key of [randomBytes(31), randomBytes(33), randomBytes(32).toString("hex"), new ArrayBuffer(32)]) {
            await expect(
                archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, context, response, key)
            ).resolves.toEqual({ success: false, code: "invalid_archive_key" });
        }
    });

    it("returns typed denials for hostile Proxy inputs", async () => {
        const response = new Uint8Array([2, 4, 6, 8]);
        const claim = await observedClaim(response);
        const context = contextFor(claim);
        const throwingObject = new Proxy(
            {},
            {
                get: () => {
                    throw new Error("hostile get");
                },
                ownKeys: () => {
                    throw new Error("hostile ownKeys");
                },
            }
        );
        const throwingBytes = new Proxy(response, {
            get: () => {
                throw new Error("hostile byte access");
            },
        });
        const throwingKey = new Proxy(randomBytes(32), {
            get: () => {
                throw new Error("hostile key access");
            },
        });
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(throwingObject, context, response, randomBytes(32))
        ).resolves.toEqual({ success: false, code: "invalid_effect_claim" });
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, throwingObject, response, randomBytes(32))
        ).resolves.toEqual({ success: false, code: "invalid_expected_context" });
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, context, throwingBytes, randomBytes(32))
        ).resolves.toEqual({ success: false, code: "invalid_response_bytes" });
        await expect(
            archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1(claim, context, response, throwingKey)
        ).resolves.toEqual({ success: false, code: "invalid_archive_key" });
    });

    it("clones caller buffers and clears only internal copies", async () => {
        const response = new Uint8Array([9, 8, 7, 6]);
        const responseBefore = Uint8Array.from(response);
        const claim = await observedClaim(response);
        const key = randomBytes(32);
        const keyBefore = Uint8Array.from(key);
        expect((await archive(claim, response, key)).success).toBe(true);
        expect(response).toEqual(responseBefore);
        expect(Uint8Array.from(key)).toEqual(keyBefore);
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(claim, contextFor(claim), key)
        ).resolves.toEqual(responseBefore);
        expect(Uint8Array.from(key)).toEqual(keyBefore);
    });

    it("uses different nonces and per-claim key contexts", async () => {
        const response = new TextEncoder().encode("same response");
        const first = await observedClaim(response);
        const second = await observedClaim(response);
        const key = randomBytes(32);
        expect((await archive(first, response, key)).success).toBe(true);
        expect((await archive(second, response, key)).success).toBe(true);
        const [firstEnvelope, secondEnvelope] = await Promise.all([readEnvelope(first), readEnvelope(second)]);
        expect(firstEnvelope.nonce_base64).not.toBe(secondEnvelope.nonce_base64);
        expect(firstEnvelope.ciphertext_base64).not.toBe(secondEnvelope.ciphertext_base64);
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(first, contextFor(first), key)
        ).resolves.toEqual(response);
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(second, contextFor(second), key)
        ).resolves.toEqual(response);
    });

    it("never overwrites a duplicate and allows only one concurrent publisher", async () => {
        const response = new TextEncoder().encode("immutable");
        const claim = await observedClaim(response);
        const key = randomBytes(32);
        const first = await archive(claim, response, key);
        if (!first.success) throw new Error(`first archive failed: ${first.code}`);
        const before = await readFile(pathFor(claim));
        await expect(archive(claim, response, key)).resolves.toEqual({
            success: false,
            code: "archive_already_exists",
        });
        expect(await readFile(pathFor(claim))).toEqual(before);

        const concurrentClaim = await observedClaim(response);
        const results = await Promise.all(
            Array.from({ length: 8 }, async () => await archive(concurrentClaim, response, key))
        );
        expect(results.filter(result => result.success)).toHaveLength(1);
        expect(
            results
                .filter(result => !result.success)
                .every(
                    result =>
                        !result.success &&
                        ["concurrent_archive_write", "archive_already_exists", "archive_unreconciled"].includes(
                            result.code
                        )
                )
        ).toBe(true);
    });

    it("rejects tampered ciphertext, AAD, tags, wrong keys, and expected context", async () => {
        const response = new TextEncoder().encode("sealed response");
        const claim = await observedClaim(response);
        const context = contextFor(claim);
        const key = randomBytes(32);
        expect((await archive(claim, response, key)).success).toBe(true);
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(claim, context, randomBytes(32))
        ).resolves.toBeNull();
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(
                claim,
                { ...context, response_status: 201 },
                key
            )
        ).resolves.toBeNull();

        const path = pathFor(claim);
        const original = await readFile(path, "utf8");
        for (const field of ["ciphertext_base64", "authentication_tag_base64", "request_digest"] as const) {
            const envelope = JSON.parse(original) as D1ProbeCloudflareWorkerCanaryEncryptedResponsePreimageV1;
            const value = envelope[field];
            const replacement = field === "request_digest" ? randomDigest() : `${value.slice(0, -4)}AAAA`;
            await writeFile(path, canonicalizeJsonV1({ ...envelope, [field]: replacement } as CanonicalJsonValueV1));
            await expect(
                decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(claim, context, key)
            ).resolves.toBeNull();
            await writeFile(path, original);
        }
    });

    it("reconciles only the exact same-inode publication temp", async () => {
        const response = new Uint8Array([7, 7, 7]);
        const claim = await observedClaim(response);
        const key = randomBytes(32);
        expect((await archive(claim, response, key)).success).toBe(true);
        const finalPath = pathFor(claim);
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1}/${claim.plan_digest}.${claim.claim_digest}.${randomUUID()}.response-preimage.tmp`;
        cleanupPaths.add(tempPath);
        await link(finalPath, tempPath);
        expect((await lstat(finalPath)).nlink).toBe(2);
        await expect(
            decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(claim, contextFor(claim), key)
        ).resolves.toBeNull();
        await expect(archive(claim, response, key)).resolves.toEqual({
            success: false,
            code: "archive_already_exists",
        });
        expect((await lstat(finalPath)).nlink).toBe(1);
        await expect(lstat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("fails closed on a pre-link orphan temp", async () => {
        const response = new Uint8Array([8, 8, 8]);
        const claim = await observedClaim(response);
        const tempPath = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1}/${claim.plan_digest}.${claim.claim_digest}.${randomUUID()}.response-preimage.tmp`;
        cleanupPaths.add(tempPath);
        await writeFile(tempPath, "orphan", { mode: 0o600, flag: "wx" });
        await expect(archive(claim, response, randomBytes(32))).resolves.toEqual({
            success: false,
            code: "archive_unreconciled",
        });
        await expect(lstat(pathFor(claim))).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(tempPath, "utf8")).toBe("orphan");
    });

    it("rejects symlink, permission, and unexplained hard-link substitutions", async () => {
        const response = new Uint8Array([3, 1, 4]);
        const key = randomBytes(32);

        const symlinkClaim = await observedClaim(response);
        const symlinkPath = pathFor(symlinkClaim);
        await archive(symlinkClaim, response, key);
        const target = `/private/tmp/openbot-response-archive-${randomUUID()}.target`;
        cleanupPaths.add(target);
        await writeFile(target, await readFile(symlinkPath), { mode: 0o600 });
        await unlink(symlinkPath);
        await symlink(target, symlinkPath);
        await expect(archive(symlinkClaim, response, key)).resolves.toEqual({
            success: false,
            code: "unsafe_archive_path",
        });

        const modeClaim = await observedClaim(response);
        await archive(modeClaim, response, key);
        await chmod(pathFor(modeClaim), 0o644);
        await expect(archive(modeClaim, response, key)).resolves.toEqual({
            success: false,
            code: "unsafe_archive_permissions",
        });

        const linkClaim = await observedClaim(response);
        const linkPath = pathFor(linkClaim);
        await archive(linkClaim, response, key);
        const unexplained = `/private/tmp/openbot-response-archive-${randomUUID()}.foreign`;
        cleanupPaths.add(unexplained);
        await link(linkPath, unexplained);
        await expect(archive(linkClaim, response, key)).resolves.toEqual({
            success: false,
            code: "unsafe_archive_path",
        });
    });

    it("accepts the exact maximum response length", async () => {
        const response = randomBytes(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_MAX_PLAINTEXT_BYTES_V1);
        const claim = await observedClaim(response);
        const key = randomBytes(32);
        expect((await archive(claim, response, key)).success).toBe(true);
        const recovered = await decryptD1ProbeCloudflareWorkerCanaryResponsePreimageTestOnlyV1(
            claim,
            contextFor(claim),
            key
        );
        expect(recovered).toEqual(Uint8Array.from(response));
    });

    it("rejects invalid path-helper inputs without constructing a path", () => {
        expect(d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1("../escape", randomDigest())).toBeNull();
        expect(d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1(randomDigest(), "../../escape")).toBeNull();
    });

    it("reads a bounded, sorted, redacted local envelope-shape inventory without a key", async () => {
        const planDigest = randomDigest();
        cleanupPrefixes.add(planDigest);
        const firstBytes = new TextEncoder().encode('{"worker":"first-secret"}');
        const secondBytes = new TextEncoder().encode('{"worker":"second-secret"}');
        const first = await observedClaim(firstBytes, {
            plan_digest: planDigest,
            journal_revision: 2,
            transcript_sequence: 1,
        });
        const second = await observedClaim(secondBytes, {
            plan_digest: planDigest,
            journal_revision: 5,
            transcript_sequence: 2,
        });
        expect((await archive(second, secondBytes)).success).toBe(true);
        expect((await archive(first, firstBytes)).success).toBe(true);
        const archivePaths = [first, second].map(claim => {
            const path = d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1(planDigest, claim.claim_digest);
            if (path === null) throw new Error("archive path unavailable");
            return path;
        });
        const beforeInventory = await Promise.all(
            archivePaths.map(async path => ({
                stat: await lstat(path),
                bytes: await readFile(path),
            }))
        );

        const result = await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(planDigest);
        const afterInventory = await Promise.all(
            archivePaths.map(async path => ({
                stat: await lstat(path),
                bytes: await readFile(path),
            }))
        );
        expect(
            afterInventory.map(({ stat, bytes }) => ({
                identity: [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs],
                bytes,
            }))
        ).toEqual(
            beforeInventory.map(({ stat, bytes }) => ({
                identity: [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs],
                bytes,
            }))
        );
        expect(result).toMatchObject({
            success: true,
            inventory: {
                kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory",
                plan_digest: planDigest,
                record_count: 2,
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
                records: [
                    {
                        claim_digest: first.claim_digest,
                        journal_revision: 2,
                        transcript_sequence: 1,
                        response_digest: first.response_digest,
                    },
                    {
                        claim_digest: second.claim_digest,
                        journal_revision: 5,
                        transcript_sequence: 2,
                        response_digest: second.response_digest,
                    },
                ],
            },
        });
        if (!result.success) throw new Error(result.code);
        expect(Object.isFrozen(result.inventory)).toBe(true);
        expect(Object.isFrozen(result.inventory.records)).toBe(true);
        expect(result.inventory.records.every(record => Object.isFrozen(record))).toBe(true);
        const output = JSON.stringify(result);
        for (const forbidden of [
            "first-secret",
            "second-secret",
            "application/json; charset=utf-8",
            "ciphertext_base64",
            "nonce_base64",
            "authentication_tag_base64",
            D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1,
        ]) {
            expect(output).not.toContain(forbidden);
        }
    });

    it("does not create or repair a missing archive root", async () => {
        const backup = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1}.test-${randomUUID()}`;
        const rootExists = await lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1)
            .then(() => true)
            .catch(() => false);
        if (rootExists) await rename(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1, backup);
        try {
            await expect(
                readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(randomDigest())
            ).resolves.toEqual({ success: false, code: "archive_not_found" });
            await expect(lstat(D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1)).rejects.toMatchObject({
                code: "ENOENT",
            });
        } finally {
            if (rootExists) await rename(backup, D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1);
        }
    });

    it("rejects hostile plan inputs and plan-prefixed temp or unknown residue", async () => {
        const throwingPlan = new Proxy(
            {},
            {
                get: () => {
                    throw new Error("hostile get");
                },
            }
        );
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(throwingPlan)
        ).resolves.toEqual({ success: false, code: "invalid_plan_digest" });
        await expect(readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1("../escape")).resolves.toEqual(
            {
                success: false,
                code: "invalid_plan_digest",
            }
        );

        for (const suffix of [
            `${randomDigest()}.${randomUUID()}.response-preimage.tmp`,
            `${randomDigest()}.response-preimage.json.backup`,
        ]) {
            const planDigest = randomDigest();
            cleanupPrefixes.add(planDigest);
            const residue = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1}/${planDigest}.${suffix}`;
            await writeFile(residue, "residue", { mode: 0o600 });
            await expect(
                readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(planDigest)
            ).resolves.toEqual({ success: false, code: "archive_unreconciled" });
        }
    });

    it("rejects symlink, hard-link, permissive, corrupt, and ciphertext substitutions", async () => {
        const response = new TextEncoder().encode("inventory shape");
        const key = randomBytes(32);

        const symlinkClaim = await observedClaim(response);
        expect((await archive(symlinkClaim, response, key)).success).toBe(true);
        const symlinkPath = pathFor(symlinkClaim);
        const target = `/private/tmp/openbot-response-inventory-${randomUUID()}.target`;
        cleanupPaths.add(target);
        await writeFile(target, await readFile(symlinkPath), { mode: 0o600 });
        await unlink(symlinkPath);
        await symlink(target, symlinkPath);
        expect(
            (await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(symlinkClaim.plan_digest))
                .success
        ).toBe(false);

        const hardlinkClaim = await observedClaim(response);
        expect((await archive(hardlinkClaim, response, key)).success).toBe(true);
        const foreign = `/private/tmp/openbot-response-inventory-${randomUUID()}.foreign`;
        cleanupPaths.add(foreign);
        await link(pathFor(hardlinkClaim), foreign);
        expect(
            (await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(hardlinkClaim.plan_digest))
                .success
        ).toBe(false);

        const modeClaim = await observedClaim(response);
        expect((await archive(modeClaim, response, key)).success).toBe(true);
        await chmod(pathFor(modeClaim), 0o644);
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(modeClaim.plan_digest)
        ).resolves.toEqual({ success: false, code: "unsafe_archive_permissions" });

        const corruptClaim = await observedClaim(response);
        expect((await archive(corruptClaim, response, key)).success).toBe(true);
        await writeFile(pathFor(corruptClaim), "not-json", { mode: 0o600 });
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(corruptClaim.plan_digest)
        ).resolves.toEqual({ success: false, code: "archive_corrupt" });

        const noncanonicalClaim = await observedClaim(response);
        expect((await archive(noncanonicalClaim, response, key)).success).toBe(true);
        const noncanonicalPath = pathFor(noncanonicalClaim);
        await writeFile(noncanonicalPath, `${await readFile(noncanonicalPath, "utf8")}\n`, { mode: 0o600 });
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(noncanonicalClaim.plan_digest)
        ).resolves.toEqual({ success: false, code: "archive_corrupt" });

        const tamperedClaim = await observedClaim(response);
        expect((await archive(tamperedClaim, response, key)).success).toBe(true);
        const tamperedEnvelope = await readEnvelope(tamperedClaim);
        await writeFile(
            pathFor(tamperedClaim),
            canonicalizeJsonV1({
                ...tamperedEnvelope,
                ciphertext_base64: `${tamperedEnvelope.ciphertext_base64.slice(0, -4)}AAAA`,
            } as CanonicalJsonValueV1),
            { mode: 0o600 }
        );
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(tamperedClaim.plan_digest)
        ).resolves.toEqual({ success: false, code: "archive_corrupt" });
    });

    it("rejects duplicate identities, order substitutions, and gapped archive sequences", async () => {
        const response = new Uint8Array([4, 2, 4, 2]);

        const duplicatePlan = randomDigest();
        const duplicateFirst = await observedClaim(response, {
            plan_digest: duplicatePlan,
            journal_revision: 2,
            transcript_sequence: 1,
        });
        const duplicateSecond = await observedClaim(response, {
            plan_digest: duplicatePlan,
            journal_revision: 5,
            transcript_sequence: 1,
        });
        expect((await archive(duplicateFirst, response)).success).toBe(true);
        expect((await archive(duplicateSecond, response)).success).toBe(true);
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(duplicatePlan)
        ).resolves.toEqual({ success: false, code: "archive_inventory_unsafe_sequence" });

        const subsetPlan = randomDigest();
        const subset = await observedClaim(response, {
            plan_digest: subsetPlan,
            journal_revision: 5,
            transcript_sequence: 2,
        });
        expect((await archive(subset, response)).success).toBe(true);
        const subsetResult = await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(subsetPlan);
        expect(subsetResult).toMatchObject({
            success: true,
            inventory: { records: [{ journal_revision: 5, transcript_sequence: 2 }] },
        });

        const mismatchPlan = randomDigest();
        const mismatch = await observedClaim(response, {
            plan_digest: mismatchPlan,
            journal_revision: 5,
            transcript_sequence: 1,
        });
        expect((await archive(mismatch, response)).success).toBe(true);
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(mismatchPlan)
        ).resolves.toEqual({
            success: false,
            code: "archive_inventory_unsafe_sequence",
        });

        const orderPlan = randomDigest();
        const orderFirst = await observedClaim(response, {
            plan_digest: orderPlan,
            journal_revision: 2,
            transcript_sequence: 1,
        });
        const orderSecond = await observedClaim(response, {
            plan_digest: orderPlan,
            journal_revision: 5,
            transcript_sequence: 2,
        });
        expect((await archive(orderFirst, response)).success).toBe(true);
        expect((await archive(orderSecond, response)).success).toBe(true);
        const firstPath = pathFor(orderFirst);
        const secondPath = pathFor(orderSecond);
        const swapPath = `${firstPath}.swap`;
        cleanupPaths.add(swapPath);
        await rename(firstPath, swapPath);
        await rename(secondPath, firstPath);
        await rename(swapPath, secondPath);
        expect((await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(orderPlan)).success).toBe(
            false
        );

        const copiedPlan = randomDigest();
        const copiedClaim = await observedClaim(response, { plan_digest: copiedPlan });
        expect((await archive(copiedClaim, response)).success).toBe(true);
        const copiedIdentityPath = d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1(
            copiedPlan,
            randomDigest()
        );
        if (copiedIdentityPath === null) throw new Error("copy path unavailable");
        await writeFile(copiedIdentityPath, await readFile(pathFor(copiedClaim)), { mode: 0o600 });
        expect((await readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(copiedPlan)).success).toBe(
            false
        );
    });

    it("fails closed before returning more than the bounded record count", async () => {
        const planDigest = randomDigest();
        cleanupPrefixes.add(planDigest);
        await Promise.all(
            Array.from({ length: 257 }, async () => {
                const path = d1ProbeCloudflareWorkerCanaryResponseArchivePathTestOnlyV1(planDigest, randomDigest());
                if (path === null) throw new Error("bounded inventory path unavailable");
                await writeFile(path, "bounded", { mode: 0o600 });
            })
        );
        await expect(readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(planDigest)).resolves.toEqual({
            success: false,
            code: "archive_inventory_too_large",
        });
    });

    it("rejects a directory snapshot that changes during inventory", async () => {
        const planDigest = randomDigest();
        cleanupPrefixes.add(planDigest);
        const residue = `${D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1}/${planDigest}.${randomDigest()}.response-preimage.json.backup`;
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyTestOnlyV1(planDigest, async () => {
                await writeFile(residue, "concurrent residue", { mode: 0o600 });
            })
        ).resolves.toEqual({ success: false, code: "archive_snapshot_unstable" });
    });

    it("rejects an earlier record rewritten while a later record is pending", async () => {
        const planDigest = randomDigest();
        const response = new Uint8Array([1, 3, 3, 7]);
        const first = await observedClaim(response, {
            plan_digest: planDigest,
            journal_revision: 2,
            transcript_sequence: 1,
        });
        const second = await observedClaim(response, {
            plan_digest: planDigest,
            journal_revision: 5,
            transcript_sequence: 2,
        });
        expect((await archive(first, response)).success).toBe(true);
        expect((await archive(second, response)).success).toBe(true);
        const firstRead = [first, second].sort((left, right) => left.claim_digest.localeCompare(right.claim_digest))[0];
        if (firstRead === undefined) throw new Error("first inventory record unavailable");
        await expect(
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyTestOnlyV1(
                planDigest,
                () => undefined,
                async recordIndex => {
                    if (recordIndex === 0) await writeFile(pathFor(firstRead), "rewritten", { mode: 0o600 });
                }
            )
        ).resolves.toEqual({ success: false, code: "archive_snapshot_unstable" });
    });
});
