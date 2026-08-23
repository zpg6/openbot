import { describe, expect, it } from "vitest";
import { bootstrapGateAttestationVerifierV1 } from "@openbot/gate-attestation/bootstrap";
import { verifyGateAttestationV1 } from "@openbot/gate-attestation/internal";

const digest = (character: string): string => character.repeat(64);

const envelope = {
    schema_version: 1 as const,
    signature_algorithm: "ecdsa-p256-sha256-ieee-p1363" as const,
    gate_id: "sandbox_execution" as const,
    untrusted_report_digest: digest("1"),
    probe_definition_digest: digest("2"),
    collector_build_digest: digest("3"),
    configuration_digest: "ddf929a6fdc5b4f314056d3b26a3b84d61b24e15b83f9aac0e03860d6314613b",
    installation_digest: digest("5"),
    environment_digest: digest("6"),
    deployment_digest: digest("7"),
    required_check_set_version: 1,
    decision: "passed" as const,
    claims: {
        permission: "sandbox_profile_adoption" as const,
        admitted_data_classes: ["public", "synthetic", "organization"] as const,
        network_policy: "public_internet_blocked_unverified_dns" as const,
        repeat_destroy_safe: true as const,
        profile_configuration_digest: "ddf929a6fdc5b4f314056d3b26a3b84d61b24e15b83f9aac0e03860d6314613b",
    },
    attested_at: 1_000,
    valid_until: 5_000,
    signer_key_id: "operator-gate-1",
    signature: "bxwhNC8k6q7Oz1fO1_qxkWozPE5NxBHwhkUd8E1_0eBypEl2VhGUSSGflyZMKCZXkaRv_jBatHot6_xj1j9r1A",
};

describe("gate attestation in workerd", () => {
    it("verifies the fixed P-256 Web Crypto vector", async () => {
        const bootstrapped = await bootstrapGateAttestationVerifierV1(
            {
                schema_version: 1,
                generation: 1,
                keys: [
                    {
                        key_id: envelope.signer_key_id,
                        purpose: "gate_attestation",
                        algorithm: envelope.signature_algorithm,
                        public_key_spki_base64url:
                            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9rDORn9Gp5Zq8ECDQY4Zzi0bHnwYFQ8Mj9nFyY7MxXtob4-jn9A6Ur0j8_vqZ-UP7EPZ5py-ttODeZ_f3bkguQ",
                        not_before: 0,
                        not_after: 10_000,
                        revoked_at: null,
                    },
                ],
            },
            {
                context: {
                    installation_digest: envelope.installation_digest,
                    environment_digest: envelope.environment_digest,
                    deployment_digest: envelope.deployment_digest,
                },
                read_current_registry_generation: () => 1,
                now_ms: () => 2_000,
            }
        );
        if (!bootstrapped.success) throw new Error(bootstrapped.code);
        const result = await verifyGateAttestationV1(bootstrapped.verifier, envelope, {
            expected: {
                gate_id: envelope.gate_id,
                untrusted_report_digest: envelope.untrusted_report_digest,
                probe_definition_digest: envelope.probe_definition_digest,
                collector_build_digest: envelope.collector_build_digest,
                configuration_digest: envelope.configuration_digest,
                required_check_set_version: envelope.required_check_set_version,
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.verified.attestation_digest).toBe(
                "bf8954aa4be6b3831e7a651fd2111c14bfa51d423ee354df5871da2c5e29b7f7"
            );
        }
    });
});
