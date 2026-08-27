import { digestCanonicalJsonV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it } from "vitest";

import { compileD1ProbeWorkerJsonVersionContractV1 } from "../src/worker-version-contract.js";

const encoder = new TextEncoder();
const baseInput = () => ({
    role: "writer_a" as const,
    operation_id: "d".repeat(32),
    generated_script_name_commitment: "1".repeat(64),
    database_id: "33333333-3333-4333-8333-333333333333",
    sink_script_name: "openbot-d1-probe-0000000000000001",
    module_bytes: encoder.encode("export class D1ProbeWriterAService{};export default {}"),
});

describe("beta Worker JSON Version contract", () => {
    it("binds the exact canonical beta body and keeps raw module SHA syntax separate", async () => {
        const contract = await compileD1ProbeWorkerJsonVersionContractV1(baseInput());
        expect(contract).not.toBeNull();
        if (contract === null) return;
        expect(contract).toMatchObject({
            schema_version: 1,
            kind: "beta_worker_json_version_v1",
            role: "writer_a",
            generated_script_name_commitment: "1".repeat(64),
            module_sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            binding_configuration_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
            artifact_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
            version_request_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        });
        expect(contract.body).toEqual({
            main_module: "entry.js",
            compatibility_date: "2026-08-22",
            compatibility_flags: [],
            annotations: {
                "workers/message": `openbot:d1-probe:v1:${"d".repeat(32)}:writer_a:first-private-version`,
                "workers/tag": `openbot:d1-probe:v1:${"d".repeat(32)}:writer_a:version`,
                "workers/triggered_by": "openbot-d1-probe-operator",
            },
            bindings: [
                { name: "PROBE_DB", type: "d1", database_id: "33333333-3333-4333-8333-333333333333" },
                {
                    name: "PROBE_SINK",
                    type: "service",
                    service: "openbot-d1-probe-0000000000000001",
                    entrypoint: "D1ProbeSinkService",
                },
                { name: "VERSION_METADATA", type: "version_metadata" },
            ],
            modules: [
                {
                    name: "entry.js",
                    content_type: "application/javascript+module",
                    content_base64: btoa("export class D1ProbeWriterAService{};export default {}"),
                },
            ],
        });
        expect(contract.artifact_digest).toBe(
            await digestCanonicalJsonV1("openbot.d1-probe.beta-worker-json-version.v1", contract.body as never)
        );
        expect(contract.version_request_digest).toBe(
            await digestCanonicalJsonV1("openbot.d1-probe.cloudflare-version-request.v1", {
                method: "POST",
                path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
                query: { deploy: false },
                body: contract.body,
            } as never)
        );
        expect(Object.isFrozen(contract)).toBe(true);
        expect(Object.isFrozen(contract.body)).toBe(true);
    });

    it("changes only the digests that each reviewed substitution can affect", async () => {
        const initial = await compileD1ProbeWorkerJsonVersionContractV1(baseInput());
        expect(initial).not.toBeNull();
        if (initial === null) return;

        const cases = [
            ["role", { ...baseInput(), role: "writer_b" as const }, true, true, false],
            ["sink", { ...baseInput(), sink_script_name: "openbot-d1-probe-0000000000000004" }, true, true, false],
            ["database", { ...baseInput(), database_id: "55555555-5555-4555-8555-555555555555" }, true, true, false],
            ["module", { ...baseInput(), module_bytes: encoder.encode("export default {}") }, true, false, true],
            ["caller", { ...baseInput(), generated_script_name_commitment: "2".repeat(64) }, false, true, false],
        ] as const;
        for (const [name, input, artifactChanges, bindingChanges, moduleChanges] of cases) {
            const changed = await compileD1ProbeWorkerJsonVersionContractV1(input);
            expect(changed, name).not.toBeNull();
            if (changed === null) continue;
            expect(changed.artifact_digest === initial.artifact_digest, `${name} artifact`).toBe(!artifactChanges);
            expect(
                changed.binding_configuration_digest === initial.binding_configuration_digest,
                `${name} binding`
            ).toBe(!bindingChanges);
            expect(changed.module_sha256 === initial.module_sha256, `${name} module`).toBe(!moduleChanges);
        }
    });

    it.each([
        ["role", { ...baseInput(), role: "admin" }],
        ["operation", { ...baseInput(), operation_id: "short" }],
        ["caller", { ...baseInput(), generated_script_name_commitment: "short" }],
        ["database", { ...baseInput(), database_id: "not-a-database" }],
        ["sink", { ...baseInput(), sink_script_name: "production-worker" }],
        ["module", { ...baseInput(), module_bytes: new Uint8Array() }],
    ])("rejects invalid %s input", async (_name, input) => {
        await expect(compileD1ProbeWorkerJsonVersionContractV1(input as never)).resolves.toBeNull();
    });
});
