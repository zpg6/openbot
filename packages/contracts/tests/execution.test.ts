import { describe, expect, it } from "vitest";

import { parseOpenBotExecutionRequestV1 } from "../src/internal.js";

const request = () => ({
    schema_version: "openbot_execution_request_v1",
    account_id: "organization_01",
    user_id: "user_01",
    run_id: "run_01",
    bot: {
        bot_id: "bot_01",
        name: "Release helper",
        purpose: "Prepare release notes.",
        standing_instructions: "Use only approved sources.",
    },
    prompt: "Summarize the current release.",
    permissions: [
        {
            integration_id: "integration_01",
            policy_id: "policy_01",
            display_name: "Read release data",
            tool_key: "releases.v1:get/latest",
            effect: "read",
            enabled: true,
        },
    ],
    metorial_session_intent: {
        intent_version: "openbot_metorial_session_intent_v1",
        connector_plugin_id: "metorial",
        metorial_api_version: "2026-01-01-magnetar",
        serialization_identity: "openbot-metorial-session@1",
        providers: [
            {
                provider_deployment_id: "pdp_01",
                provider_version_id: "prv_01",
                provider_specification_id: "psp_01",
                auth: { mode: "user_grant", connection_grant_id: "pac_01" },
                allowed_tool_keys: ["releases.v1:get/latest"],
            },
        ],
    },
});

describe("OpenBot execution request", () => {
    it("accepts a permission-bound request with Metorial tool punctuation", () => {
        expect(parseOpenBotExecutionRequestV1(request())).not.toBeNull();
    });

    it("rejects permission and session tool drift", () => {
        const value = request();
        value.metorial_session_intent.providers[0]!.allowed_tool_keys = ["releases.v1:delete/latest"];
        expect(parseOpenBotExecutionRequestV1(value)).toBeNull();
    });

    it("rejects disabled, duplicate, and extra authority", () => {
        const disabled = request();
        disabled.permissions[0]!.enabled = false;
        expect(parseOpenBotExecutionRequestV1(disabled)).toBeNull();

        const duplicate = request();
        duplicate.permissions.push({ ...duplicate.permissions[0]! });
        duplicate.metorial_session_intent.providers[0]!.allowed_tool_keys.push("releases.v1:get/latest");
        expect(parseOpenBotExecutionRequestV1(duplicate)).toBeNull();

        expect(parseOpenBotExecutionRequestV1({ ...request(), unexpected: true })).toBeNull();
    });
});
