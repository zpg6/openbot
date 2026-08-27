import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    bootstrapGateAttestationVerifierV1,
    digestCanonicalJsonV1,
    digestGateAttestationV1,
    verifyGateAttestationV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

const evidence = vi.hoisted(() => ({
    assess: vi.fn(),
    parse: vi.fn(),
}));

vi.mock("@openbot/gate-evidence/internal", async importOriginal => ({
    ...(await importOriginal<typeof import("@openbot/gate-evidence/internal")>()),
    assessD1ProbeReportForOperatorReviewV1: evidence.assess,
    parseUntrustedItem2ProbeReportV1: evidence.parse,
}));

import { attestReviewedD1ProbeV1, inspectD1GateAttestationOperatorBundleIntegrityV1 } from "../src/sign.js";

const hex = (character: string): string => character.repeat(64);
const encodeBase64Url = (bytes: Uint8Array): string =>
    globalThis
        .btoa(String.fromCharCode(...bytes))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");

const keyPair = async () => {
    const pair = (await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
    ])) as CryptoKeyPair;
    return {
        privateKey: encodeBase64Url(new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey))),
        publicKey: encodeBase64Url(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey))),
    };
};

const expectations = {
    schema_version: 1 as const,
    expected_platform: "cloudflare_d1_deployed" as const,
    gate_id: "d1_guarded_create" as const,
    required_check_set_version: 1,
    as_of_ms: 1_000,
    expected_report_digest: hex("1"),
    expected_deployment_digest: hex("2"),
    expected_configuration_digest: hex("3"),
    expected_probe_definition_digest: hex("4"),
    expected_collector_build_digest: hex("5"),
    expected_installation_digest: hex("6"),
    expected_environment_digest: hex("7"),
    expected_probe_run_digest: hex("8"),
    expected_commitment_key_id_digest: hex("9"),
};

const request = (publicKey: string) => ({
    schema_version: 1 as const,
    kind: "d1_gate_attestation_signing_request" as const,
    report: { untrusted: true },
    expectations,
    review: {
        reviewer_id: "reviewer-1",
        reviewed_at: 1_000,
        decision: "approve" as const,
        reviewed_report_digest: hex("1"),
    },
    attestation: {
        attested_at: 1_000,
        valid_until: 2_000,
        signer_key_id: "operator-gate-1",
    },
    trust_registry: {
        schema_version: 1 as const,
        generation: 3,
        keys: [
            {
                key_id: "operator-gate-1",
                purpose: "gate_attestation" as const,
                algorithm: "ecdsa-p256-sha256-ieee-p1363" as const,
                public_key_spki_base64url: publicKey,
                not_before: 0,
                not_after: 3_000,
                revoked_at: null,
            },
        ],
    },
});

describe("reviewed D1 attestation workflow", () => {
    beforeEach(() => {
        evidence.assess.mockResolvedValue({
            success: true,
            assessment: "eligible_for_operator_review",
            authoritative: false,
            gate_promotion_allowed: false,
            attestation_created: false,
            gate_id: "d1_guarded_create",
            report_digest: hex("1"),
        });
        evidence.parse.mockReturnValue({
            success: true,
            report: { kind: "d1_guarded_create", valid_until: 2_500 },
        });
    });

    it("derives the permission, signs, self-verifies, and emits no report or private key", async () => {
        const keys = await keyPair();
        const result = await attestReviewedD1ProbeV1(request(keys.publicKey), {
            private_key_pkcs8_base64url: keys.privateKey,
        });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.bundle.attestation.claims).toEqual({ permission: "control_store_adoption" });
        expect(result.bundle.review).toMatchObject({
            reviewer_id: "reviewer-1",
            assessment: "eligible_for_operator_review",
            report_digest: hex("1"),
        });
        expect(JSON.stringify(result.bundle)).not.toMatch(/private_key|"report":|"untrusted":true/u);
        expect(evidence.assess).toHaveBeenCalledWith({ untrusted: true }, expectations);

        const verifier = await bootstrapGateAttestationVerifierV1(request(keys.publicKey).trust_registry, {
            context: {
                installation_digest: hex("6"),
                environment_digest: hex("7"),
                deployment_digest: hex("2"),
            },
            read_current_registry_generation: () => 3,
            now_ms: () => 1_000,
        });
        expect(verifier.success).toBe(true);
        if (!verifier.success) return;
        expect(
            await verifyGateAttestationV1(verifier.verifier, result.bundle.attestation, {
                expected: {
                    gate_id: "d1_guarded_create",
                    untrusted_report_digest: hex("1"),
                    probe_definition_digest: hex("4"),
                    collector_build_digest: hex("5"),
                    configuration_digest: hex("3"),
                    required_check_set_version: 1,
                },
            })
        ).toMatchObject({ success: true });

        const substitutedReviewRecord = {
            ...result.bundle.review,
            reviewer_id: "reviewer-2",
        };
        const { review_record_digest: _oldReviewDigest, ...unsignedReviewRecord } = substitutedReviewRecord;
        const substitutedReviewDigest = await digestCanonicalJsonV1(
            "openbot.d1-gate-attestation-review.v1",
            unsignedReviewRecord as CanonicalJsonValueV1
        );
        expect(substitutedReviewDigest).not.toBeNull();
        if (substitutedReviewDigest === null) return;
        const substitutedAttestation = {
            ...result.bundle.attestation,
            operator_review_digest: substitutedReviewDigest,
        };
        const substitutedAttestationDigest = await digestGateAttestationV1(substitutedAttestation);
        expect(substitutedAttestationDigest.success).toBe(true);
        if (!substitutedAttestationDigest.success) return;
        const substitutedBundle = {
            ...result.bundle,
            review: { ...substitutedReviewRecord, review_record_digest: substitutedReviewDigest },
            attestation: substitutedAttestation,
            attestation_digest: substitutedAttestationDigest.digest,
        };
        expect(await inspectD1GateAttestationOperatorBundleIntegrityV1(substitutedBundle)).toMatchObject({
            success: true,
        });
        expect(
            await verifyGateAttestationV1(verifier.verifier, substitutedAttestation, {
                expected: {
                    gate_id: "d1_guarded_create",
                    untrusted_report_digest: hex("1"),
                    probe_definition_digest: hex("4"),
                    collector_build_digest: hex("5"),
                    configuration_digest: hex("3"),
                    required_check_set_version: 1,
                },
            })
        ).toEqual({ success: false, code: "signature_invalid" });
    });

    it("rejects a key that does not match the published registry and a substituted review", async () => {
        const published = await keyPair();
        const attacker = await keyPair();
        expect(
            await attestReviewedD1ProbeV1(request(published.publicKey), {
                private_key_pkcs8_base64url: attacker.privateKey,
            })
        ).toEqual({ success: false, code: "private_key_mismatch" });

        const changedReview = request(published.publicKey);
        changedReview.review.reviewed_report_digest = hex("a");
        expect(
            await attestReviewedD1ProbeV1(changedReview, {
                private_key_pkcs8_base64url: published.privateKey,
            })
        ).toEqual({ success: false, code: "review_mismatch" });
    });
});
