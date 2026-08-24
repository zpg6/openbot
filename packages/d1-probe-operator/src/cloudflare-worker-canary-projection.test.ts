import { describe, expect, it } from "vitest";

import {
    projectD1ProbeCloudflareWorkerCleanupIdentityV1,
    projectD1ProbeCloudflareWorkerDeploymentObservationV1,
    projectD1ProbeCloudflareWorkerListPageV1,
    projectD1ProbeCloudflareWorkerVersionObservationV1,
} from "./cloudflare-worker-canary-projection.js";

const workerId = "canary-worker-id";
const versionId = "11111111-1111-4111-8111-111111111111";
const deploymentId = "22222222-2222-4222-8222-222222222222";
const exactTags = ["openbot-canary-owner-0123456789abcdef0123456789abcdef", "openbot-canary-attempt-aabb"];
const workerExpectation = {
    worker_id: workerId,
    script_name: "openbot-d1-probe-canary-1234567890abcdef",
    exact_tags: exactTags,
};

const cleanupIdentity = () => {
    const result = projectD1ProbeCloudflareWorkerCleanupIdentityV1(
        { id: workerId, name: workerExpectation.script_name, tags: [...exactTags].reverse() },
        workerExpectation
    );
    if (!result.success) throw new Error("test cleanup identity did not project");
    return result.identity;
};

const envelope = (result: readonly unknown[], resultInfo?: unknown) => ({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
});

const listInput = (result: readonly unknown[], overrides: Record<string, unknown> = {}) => ({
    page: 1,
    per_page: 2,
    max_pages: 3,
    prior_item_count: 0,
    prior_worker_ids: [],
    prior_correlated_candidate_observed: false,
    expected_total_count: null,
    expected_total_pages: null,
    envelope: envelope(result),
    ...overrides,
});

const observationWindow = {
    not_before_ms: Date.parse("2026-08-24T18:00:00.000Z"),
    expires_at_ms: Date.parse("2026-08-24T18:05:00.000Z"),
};

const versionExpectation = {
    version_id: versionId,
    version_tag: "openbot-canary-version-0123456789abcdef0123456789abcdef",
    version_message: "openbot canary version 0123456789abcdef0123456789abcdef",
    ...observationWindow,
    module_content_base64: "ZXhwb3J0IGRlZmF1bHQge307",
};

const versionObservation = () => ({
    id: versionId,
    created_on: "2026-08-24T18:01:00.000Z",
    annotations: {
        "workers/tag": versionExpectation.version_tag,
        "workers/message": versionExpectation.version_message,
    },
    main_module: "entry.js",
    compatibility_date: "2026-08-22",
    compatibility_flags: [],
    bindings: [],
    modules: [
        {
            name: "entry.js",
            content_type: "application/javascript+module",
            content_base64: versionExpectation.module_content_base64,
        },
    ],
});

const deploymentExpectation = {
    deployment_id: deploymentId,
    version_id: versionId,
    deployment_message: "openbot canary deployment 0123456789abcdef0123456789abcdef",
    ...observationWindow,
};

const deploymentObservation = () => ({
    id: deploymentId,
    created_on: "2026-08-24T18:02:00.000Z",
    strategy: "percentage",
    annotations: { "workers/message": deploymentExpectation.deployment_message },
    versions: [{ version_id: versionId, percentage: 100 }],
});

describe("Cloudflare canary response projections", () => {
    it("accepts exact worker identity fields and treats tags as an exact unordered set", () => {
        expect(
            projectD1ProbeCloudflareWorkerCleanupIdentityV1(
                { id: workerId, name: workerExpectation.script_name, tags: [...exactTags].reverse(), created_on: null },
                workerExpectation
            )
        ).toEqual({
            success: true,
            identity: {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_cleanup_identity",
                worker_id: workerId,
                script_name: workerExpectation.script_name,
                exact_tags: exactTags,
                observed_fields: { id: true, name: true, tags: true },
                status: "exact_identity_observed",
            },
        });
    });

    it("tolerates omitted optional worker identity fields without claiming exact observation", () => {
        expect(projectD1ProbeCloudflareWorkerCleanupIdentityV1({}, workerExpectation)).toMatchObject({
            success: true,
            identity: {
                observed_fields: { id: false, name: false, tags: false },
                status: "partial_identity_compatible",
            },
        });
        expect(
            projectD1ProbeCloudflareWorkerCleanupIdentityV1(
                { id: workerId, name: workerExpectation.script_name },
                workerExpectation
            )
        ).toMatchObject({
            success: true,
            identity: { status: "partial_identity_compatible" },
        });
    });

    it.each([
        { id: "other-worker" },
        { name: "other-name" },
        { tags: [exactTags[0]] },
        { tags: [exactTags[0], exactTags[0]] },
        { tags: [...exactTags, "extra-tag"] },
    ])("rejects each present worker identity contradiction %#", candidate => {
        expect(projectD1ProbeCloudflareWorkerCleanupIdentityV1(candidate, workerExpectation)).toEqual({
            success: false,
            code: "identity_mismatch",
        });
    });

    it("walks full pages without result_info but never turns that into complete absence metadata", () => {
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([
                { id: "other-1", name: "other-1", tags: ["other"] },
                { id: "other-2", name: "other-2", tags: ["other"] },
            ]),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "next_page_required",
            next_page: 2,
            result_info_observed: false,
            absence_metadata_complete: false,
        });
    });

    it("stops at a short metadata-free page and keeps absence metadata incomplete", () => {
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([{ id: "other-1", name: "other-1", tags: ["other"] }]),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "terminal_page_observed",
            next_page: null,
            result_info_observed: false,
            absence_metadata_complete: false,
        });
    });

    it("accepts partial result_info fields but does not treat them as complete metadata", () => {
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([{ id: "other-1", name: "other-1", tags: ["other"] }], {
                envelope: envelope([{ id: "other-1", name: "other-1", tags: ["other"] }], {
                    page: 1,
                    count: 1,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "terminal_page_observed",
            result_info_observed: true,
            absence_metadata_complete: false,
        });
    });

    it("reports bounded exhaustion for a full final page without result_info", () => {
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput(
                [
                    { id: "other-3", name: "other-3", tags: ["other"] },
                    { id: "other-4", name: "other-4", tags: ["other"] },
                ],
                {
                    page: 3,
                    prior_item_count: 4,
                    prior_worker_ids: ["other-1", "other-2", "other-3a", "other-4a"],
                    expected_total_count: 6,
                    expected_total_pages: 3,
                }
            ),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "page_bound_exhausted",
            next_page: null,
            absence_metadata_complete: false,
        });
    });

    it("marks absence metadata complete only on a consistent final metadata page with identified unrelated workers", () => {
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([{ id: "other-1", name: "other-1", tags: ["other"] }], {
                envelope: envelope([{ id: "other-1", name: "other-1", tags: ["other"] }], {
                    page: 1,
                    per_page: 2,
                    count: 1,
                    total_count: 1,
                    total_pages: 1,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "terminal_page_observed",
            result_info_observed: true,
            absence_metadata_complete: true,
        });
    });

    it("does not claim complete absence when a list item is compatible but lacks identity fields", () => {
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([{ name: workerExpectation.script_name }], {
                envelope: envelope([{ name: workerExpectation.script_name }], {
                    page: 1,
                    per_page: 2,
                    count: 1,
                    total_count: 1,
                    total_pages: 1,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            compatible_partial_matches: [{ status: "partial_identity_compatible" }],
            absence_metadata_complete: false,
        });
    });

    it("does not claim complete absence when the expected immutable ID has contradictory optional fields", () => {
        const candidate = { id: workerId, name: "contradictory-name", tags: ["other"] };
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([candidate], {
                envelope: envelope([candidate], {
                    page: 1,
                    per_page: 2,
                    count: 1,
                    total_count: 1,
                    total_pages: 1,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            correlated_candidate_observed: true,
            absence_metadata_complete: false,
        });
    });

    it("does not claim complete absence for a mismatched ID correlated by planned name and ownership tags", () => {
        const candidate = {
            id: "wrong-id",
            name: workerExpectation.script_name,
            tags: workerExpectation.exact_tags,
        };
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput([candidate], {
                envelope: envelope([candidate], {
                    page: 1,
                    per_page: 2,
                    count: 1,
                    total_count: 1,
                    total_pages: 1,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            exact_matches: [],
            compatible_partial_matches: [],
            correlated_candidate_observed: true,
            absence_metadata_complete: false,
        });
    });

    it("carries a correlated mismatch from a prior page and keeps final absence incomplete", () => {
        const current = [{ id: "other-2", name: "other-2", tags: ["other"] }];
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput(current, {
                page: 2,
                per_page: 1,
                prior_item_count: 1,
                prior_worker_ids: ["wrong-id"],
                prior_correlated_candidate_observed: true,
                expected_total_count: 2,
                expected_total_pages: 2,
                envelope: envelope(current, {
                    page: 2,
                    per_page: 1,
                    count: 1,
                    total_count: 2,
                    total_pages: 2,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "terminal_page_observed",
            correlated_candidate_observed: true,
            absence_metadata_complete: false,
        });
    });

    it("does not mint standalone absence completion from caller-supplied multi-page accumulators", () => {
        const current = [{ id: "other-2", name: "other-2", tags: ["other"] }];
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput(current, {
                page: 2,
                per_page: 1,
                prior_item_count: 1,
                prior_worker_ids: ["other-1"],
                expected_total_count: 2,
                expected_total_pages: 2,
                envelope: envelope(current, {
                    page: 2,
                    per_page: 1,
                    count: 1,
                    total_count: 2,
                    total_pages: 2,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({
            success: true,
            pagination_status: "terminal_page_observed",
            correlated_candidate_observed: false,
            absence_metadata_complete: false,
        });
    });

    it("does not complete absence metadata when a prior page contained unidentified items", () => {
        const current = [{ id: "other-3", name: "other-3", tags: ["other"] }];
        const result = projectD1ProbeCloudflareWorkerListPageV1(
            listInput(current, {
                page: 2,
                prior_item_count: 2,
                prior_worker_ids: ["other-1"],
                expected_total_count: 3,
                expected_total_pages: 2,
                envelope: envelope(current, {
                    page: 2,
                    per_page: 2,
                    count: 1,
                    total_count: 3,
                    total_pages: 2,
                }),
            }),
            workerExpectation
        );
        expect(result).toMatchObject({ success: true, absence_metadata_complete: false });
    });

    it("rejects changed pagination totals between pages", () => {
        const current = [{ id: "other-3", name: "other-3", tags: ["other"] }];
        expect(
            projectD1ProbeCloudflareWorkerListPageV1(
                listInput(current, {
                    page: 2,
                    prior_item_count: 2,
                    prior_worker_ids: ["other-1", "other-2"],
                    expected_total_count: 3,
                    expected_total_pages: 2,
                    envelope: envelope(current, {
                        page: 2,
                        per_page: 2,
                        count: 1,
                        total_count: 4,
                        total_pages: 2,
                    }),
                }),
                workerExpectation
            )
        ).toEqual({ success: false, code: "pagination_mismatch" });
    });

    it("rejects inconsistent pagination metadata and duplicate cross-page IDs", () => {
        expect(
            projectD1ProbeCloudflareWorkerListPageV1(
                listInput([], {
                    envelope: envelope([], {
                        page: 2,
                        per_page: 2,
                        count: 0,
                        total_count: 0,
                        total_pages: 0,
                    }),
                }),
                workerExpectation
            )
        ).toEqual({ success: false, code: "pagination_mismatch" });
        expect(
            projectD1ProbeCloudflareWorkerListPageV1(
                listInput([{ id: "repeated", name: "other", tags: ["other"] }], {
                    page: 2,
                    prior_item_count: 1,
                    prior_worker_ids: ["repeated"],
                    expected_total_count: 2,
                    expected_total_pages: 1,
                }),
                workerExpectation
            )
        ).toEqual({ success: false, code: "pagination_mismatch" });
    });

    it("accepts a complete version observation", () => {
        const result = projectD1ProbeCloudflareWorkerVersionObservationV1(
            versionObservation(),
            versionExpectation,
            cleanupIdentity()
        );
        expect(result).toMatchObject({
            cleanup_identity: { worker_id: workerId },
            version_identity: versionId,
            semantic_observation: { accepted: true, value: { id: versionId } },
        });
    });

    it("keeps cleanup and version identity when required version semantics are missing", () => {
        const result = projectD1ProbeCloudflareWorkerVersionObservationV1(
            { id: versionId },
            versionExpectation,
            cleanupIdentity()
        );
        expect(result).toEqual({
            cleanup_identity: cleanupIdentity(),
            version_identity: versionId,
            semantic_observation: { accepted: false, code: "missing_or_invalid_semantic_fields" },
        });
    });

    it("rejects caller-forged cleanup identity status and duplicate tag sets", () => {
        const identity = cleanupIdentity();
        expect(
            projectD1ProbeCloudflareWorkerVersionObservationV1(versionObservation(), versionExpectation, {
                ...identity,
                observed_fields: { id: false, name: false, tags: false },
                status: "exact_identity_observed",
            })
        ).toBeNull();
        expect(
            projectD1ProbeCloudflareWorkerDeploymentObservationV1(deploymentObservation(), deploymentExpectation, {
                ...identity,
                exact_tags: [identity.exact_tags[0], identity.exact_tags[0]],
            })
        ).toBeNull();
    });

    it("rejects a complete version with the wrong semantic marker", () => {
        const observation = versionObservation();
        observation.annotations["workers/tag"] = "substituted";
        expect(
            projectD1ProbeCloudflareWorkerVersionObservationV1(observation, versionExpectation, cleanupIdentity())
        ).toMatchObject({
            cleanup_identity: { worker_id: workerId },
            version_identity: versionId,
            semantic_observation: { accepted: false, code: "semantic_mismatch" },
        });
    });

    it("accepts a complete deployment observation", () => {
        expect(
            projectD1ProbeCloudflareWorkerDeploymentObservationV1(
                deploymentObservation(),
                deploymentExpectation,
                cleanupIdentity()
            )
        ).toMatchObject({
            cleanup_identity: { worker_id: workerId },
            deployment_identity: deploymentId,
            semantic_observation: { accepted: true, value: { id: deploymentId } },
        });
    });

    it("keeps cleanup and deployment identity when required deployment semantics are missing", () => {
        expect(
            projectD1ProbeCloudflareWorkerDeploymentObservationV1(
                { id: deploymentId },
                deploymentExpectation,
                cleanupIdentity()
            )
        ).toEqual({
            cleanup_identity: cleanupIdentity(),
            deployment_identity: deploymentId,
            semantic_observation: { accepted: false, code: "missing_or_invalid_semantic_fields" },
        });
    });

    it("rejects deployment percentage, version, marker, and timestamp substitutions", () => {
        for (const mutate of [
            (value: any) => (value.versions[0].percentage = 50),
            (value: any) => (value.versions[0].version_id = "33333333-3333-4333-8333-333333333333"),
            (value: any) => (value.annotations["workers/message"] = "substituted"),
            (value: any) => (value.created_on = "2026-08-24T18:06:00.000Z"),
        ]) {
            const observation = deploymentObservation();
            mutate(observation);
            const result = projectD1ProbeCloudflareWorkerDeploymentObservationV1(
                observation,
                deploymentExpectation,
                cleanupIdentity()
            );
            expect(result).toMatchObject({
                cleanup_identity: { worker_id: workerId },
                deployment_identity: deploymentId,
                semantic_observation: { accepted: false },
            });
        }
    });

    it("returns typed denials for hostile getters and proxy traps", () => {
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile ownKeys");
                },
                get: () => {
                    throw new Error("hostile get");
                },
            }
        );
        expect(projectD1ProbeCloudflareWorkerCleanupIdentityV1(hostile, workerExpectation)).toEqual({
            success: false,
            code: "invalid_candidate",
        });
        expect(projectD1ProbeCloudflareWorkerListPageV1(hostile, workerExpectation)).toEqual({
            success: false,
            code: "invalid_page",
        });
        expect(
            projectD1ProbeCloudflareWorkerVersionObservationV1(hostile, versionExpectation, cleanupIdentity())
        ).toMatchObject({
            version_identity: null,
            semantic_observation: { accepted: false, code: "missing_or_invalid_semantic_fields" },
        });
        expect(
            projectD1ProbeCloudflareWorkerDeploymentObservationV1(hostile, deploymentExpectation, cleanupIdentity())
        ).toMatchObject({
            deployment_identity: null,
            semantic_observation: { accepted: false, code: "missing_or_invalid_semantic_fields" },
        });
    });
});
