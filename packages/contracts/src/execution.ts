export const OPENBOT_EXECUTION_REQUEST_VERSION_V1 = "openbot_execution_request_v1" as const;

export type OpenBotMetorialAuthBindingV1 =
    | { readonly mode: "user_grant"; readonly connection_grant_id: string }
    | { readonly mode: "deployment" }
    | { readonly mode: "authless" };

export interface OpenBotExecutionPermissionV1 {
    readonly integration_id: string;
    readonly policy_id: string;
    readonly display_name: string;
    readonly tool_key: string;
    readonly effect: "read" | "write" | "destructive";
    readonly enabled: boolean;
}

export interface OpenBotMetorialSessionIntentV1 {
    readonly intent_version: "openbot_metorial_session_intent_v1";
    readonly connector_plugin_id: "metorial";
    readonly metorial_api_version: "2026-01-01-magnetar";
    readonly serialization_identity: "openbot-metorial-session@1";
    readonly providers: readonly {
        readonly provider_deployment_id: string;
        readonly provider_version_id: string;
        readonly provider_specification_id: string;
        readonly auth: OpenBotMetorialAuthBindingV1;
        readonly allowed_tool_keys: readonly string[];
    }[];
}

export interface OpenBotExecutionRequestV1 {
    readonly schema_version: typeof OPENBOT_EXECUTION_REQUEST_VERSION_V1;
    readonly account_id: string;
    readonly user_id: string;
    readonly run_id: string;
    readonly bot: {
        readonly bot_id: string;
        readonly name: string;
        readonly purpose: string;
        readonly standing_instructions: string;
    };
    readonly prompt: string;
    readonly permissions: readonly OpenBotExecutionPermissionV1[];
    readonly metorial_session_intent: OpenBotMetorialSessionIntentV1;
}

export interface OpenBotExecutionResultV1 {
    readonly result_text: string;
    readonly metorial_tool_call_count: number;
    readonly cleanup_state: "completed" | "not_required";
}

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,253}$/u.test(value);
const toolKey = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/+_-]{0,253}$/u.test(value);
const text = (value: unknown, maximum: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim();

const parseAuth = (value: unknown): OpenBotMetorialAuthBindingV1 | null => {
    if (!record(value) || typeof value["mode"] !== "string") return null;
    if (value["mode"] === "user_grant") {
        return exactKeys(value, ["mode", "connection_grant_id"]) && id(value["connection_grant_id"])
            ? { mode: "user_grant", connection_grant_id: value["connection_grant_id"] }
            : null;
    }
    return (value["mode"] === "deployment" || value["mode"] === "authless") && exactKeys(value, ["mode"])
        ? { mode: value["mode"] }
        : null;
};

const parseIntent = (value: unknown): OpenBotMetorialSessionIntentV1 | null => {
    if (
        !record(value) ||
        !exactKeys(value, [
            "intent_version",
            "connector_plugin_id",
            "metorial_api_version",
            "serialization_identity",
            "providers",
        ]) ||
        value["intent_version"] !== "openbot_metorial_session_intent_v1" ||
        value["connector_plugin_id"] !== "metorial" ||
        value["metorial_api_version"] !== "2026-01-01-magnetar" ||
        value["serialization_identity"] !== "openbot-metorial-session@1" ||
        !Array.isArray(value["providers"]) ||
        value["providers"].length < 1 ||
        value["providers"].length > 32
    ) {
        return null;
    }
    const providers = value["providers"].map(provider => {
        if (
            !record(provider) ||
            !exactKeys(provider, [
                "provider_deployment_id",
                "provider_version_id",
                "provider_specification_id",
                "auth",
                "allowed_tool_keys",
            ]) ||
            !id(provider["provider_deployment_id"]) ||
            !id(provider["provider_version_id"]) ||
            !id(provider["provider_specification_id"]) ||
            !Array.isArray(provider["allowed_tool_keys"]) ||
            provider["allowed_tool_keys"].length < 1 ||
            provider["allowed_tool_keys"].length > 512 ||
            !provider["allowed_tool_keys"].every(toolKey) ||
            new Set(provider["allowed_tool_keys"]).size !== provider["allowed_tool_keys"].length
        ) {
            return null;
        }
        const auth = parseAuth(provider["auth"]);
        return auth === null
            ? null
            : {
                  provider_deployment_id: provider["provider_deployment_id"],
                  provider_version_id: provider["provider_version_id"],
                  provider_specification_id: provider["provider_specification_id"],
                  auth,
                  allowed_tool_keys: provider["allowed_tool_keys"],
              };
    });
    return providers.some(provider => provider === null)
        ? null
        : {
              intent_version: "openbot_metorial_session_intent_v1",
              connector_plugin_id: "metorial",
              metorial_api_version: "2026-01-01-magnetar",
              serialization_identity: "openbot-metorial-session@1",
              providers: providers as OpenBotMetorialSessionIntentV1["providers"],
          };
};

export const parseOpenBotExecutionRequestV1 = (value: unknown): OpenBotExecutionRequestV1 | null => {
    if (
        !record(value) ||
        !exactKeys(value, [
            "schema_version",
            "account_id",
            "user_id",
            "run_id",
            "bot",
            "prompt",
            "permissions",
            "metorial_session_intent",
        ]) ||
        value["schema_version"] !== OPENBOT_EXECUTION_REQUEST_VERSION_V1 ||
        !id(value["account_id"]) ||
        !id(value["user_id"]) ||
        !id(value["run_id"]) ||
        !record(value["bot"]) ||
        !exactKeys(value["bot"], ["bot_id", "name", "purpose", "standing_instructions"]) ||
        !id(value["bot"]["bot_id"]) ||
        !text(value["bot"]["name"], 256) ||
        !text(value["bot"]["purpose"], 16_384) ||
        !text(value["bot"]["standing_instructions"], 32_768) ||
        !text(value["prompt"], 64 * 1024) ||
        !Array.isArray(value["permissions"]) ||
        value["permissions"].length < 1 ||
        value["permissions"].length > 4_096
    ) {
        return null;
    }
    const permissions = value["permissions"].map(permission => {
        if (
            !record(permission) ||
            !exactKeys(permission, ["integration_id", "policy_id", "display_name", "tool_key", "effect", "enabled"]) ||
            !id(permission["integration_id"]) ||
            !id(permission["policy_id"]) ||
            !text(permission["display_name"], 256) ||
            !toolKey(permission["tool_key"]) ||
            !["read", "write", "destructive"].includes(String(permission["effect"])) ||
            permission["enabled"] !== true
        ) {
            return null;
        }
        return permission as unknown as OpenBotExecutionPermissionV1;
    });
    const intent = parseIntent(value["metorial_session_intent"]);
    if (permissions.some(permission => permission === null) || intent === null) return null;
    const parsedPermissions = permissions as OpenBotExecutionPermissionV1[];
    if (
        new Set(parsedPermissions.map(permission => permission.policy_id)).size !== parsedPermissions.length ||
        new Set(parsedPermissions.map(permission => `${permission.integration_id}\u0000${permission.tool_key}`))
            .size !== parsedPermissions.length ||
        parsedPermissions
            .map(permission => permission.tool_key)
            .toSorted()
            .join("\u0000") !==
            intent.providers
                .flatMap(provider => provider.allowed_tool_keys)
                .toSorted()
                .join("\u0000")
    ) {
        return null;
    }
    return {
        schema_version: OPENBOT_EXECUTION_REQUEST_VERSION_V1,
        account_id: value["account_id"],
        user_id: value["user_id"],
        run_id: value["run_id"],
        bot: value["bot"] as unknown as OpenBotExecutionRequestV1["bot"],
        prompt: value["prompt"],
        permissions: parsedPermissions,
        metorial_session_intent: intent,
    };
};
