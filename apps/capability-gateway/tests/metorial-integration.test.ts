import { describe, expect, it } from "vitest";

import { compileMetorialIntegrationV1, type MetorialConnectedToolV1 } from "../src/metorial-integration.ts";

const tools: readonly MetorialConnectedToolV1[] = [
    {
        id: "pto_read",
        key: "issues.v1:list/all",
        name: "List issues",
        description: "Lists issues visible to the connected account.",
        specificationId: "psp_linear",
        tags: { destructive: false, readOnly: true },
        inputSchema: { schema: { type: "object", properties: { limit: { type: "number" } } } },
        outputSchema: { schema: { type: "array" } },
    },
    {
        id: "pto_write",
        key: "create_issue",
        name: "Create issue",
        description: "Creates an issue.",
        specificationId: "psp_linear",
        tags: { destructive: false, readOnly: false },
        inputSchema: { schema: { type: "object", required: ["title"] } },
        outputSchema: null,
    },
    {
        id: "pto_delete",
        key: "delete_issue",
        name: "Delete issue",
        description: "Deletes an issue permanently.",
        specificationId: "psp_linear",
        tags: { destructive: true, readOnly: false },
        inputSchema: { schema: { type: "object", required: ["id"] } },
        outputSchema: null,
    },
];

const compile = () =>
    compileMetorialIntegrationV1({
        integration_id: "integration_linear",
        provider_identifier: "linear",
        provider_id: "pro_linear",
        provider_version_id: "prv_linear_current",
        provider_specification_id: "psp_linear",
        catalog: {
            display_name: "Linear",
            description: "Issues and projects.",
            icon_data_uri: null,
        },
        setup: {
            deployment: { id: "pdp_linear", name: "Linear deployment" },
            authConfig: { id: "pac_linear", name: "Product workspace" },
            credentials: null,
            authMethod: {},
        },
        tools,
    });

describe("Metorial integration compiler", () => {
    it("populates every live tool and preserves Metorial effect tags", async () => {
        const integration = await compile();

        expect(integration.permissions).toHaveLength(tools.length);
        expect(integration.permissions.map(permission => [permission.tool_key, permission.effect])).toEqual([
            ["issues.v1:list/all", "read"],
            ["create_issue", "write"],
            ["delete_issue", "destructive"],
        ]);
        expect(integration.permissions.every(permission => permission.enabled)).toBe(true);
        expect(integration.auth).toEqual({ mode: "user_grant", connection_grant_id: "pac_linear" });
        expect(integration.connected_account_label).toBe("Product workspace");
    });

    it("produces stable policy IDs, revisions, and schema fingerprints", async () => {
        const first = await compile();
        const second = await compile();

        expect(second).toEqual(first);
        for (const permission of first.permissions) {
            expect(permission.policy_id).toMatch(/^policy_[a-f0-9]{40}$/u);
            expect(permission.policy_revision).toMatch(/^revision_[a-f0-9]{40}$/u);
            expect(permission.policy_sha256).toMatch(/^[a-f0-9]{64}$/u);
            expect(permission.input_schema_sha256).toMatch(/^[a-f0-9]{64}$/u);
            expect(permission.output_schema_sha256).toMatch(/^[a-f0-9]{64}$/u);
        }
    });
});
