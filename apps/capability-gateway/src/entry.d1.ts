import { createMetorialCoreSDK } from "@metorial/core";
import { parseOpenBotExecutionRequestV1, type OpenBotExecutionRequestV1 } from "@openbot/contracts/internal";

import { compileMetorialIntegrationV1 } from "./metorial-integration.js";

interface CapabilityGatewayBindings {
    readonly CONTROL_DB_FRESH: D1Database;
    readonly METORIAL_API_KEY: string;
}

interface StoredTool {
    readonly name: string;
    readonly tool_id: string;
    readonly tool_key: string;
    readonly description: string;
    readonly input_schema: Record<string, unknown>;
}

interface StoredToolMap {
    readonly schema_version: "openbot_metorial_tool_map_v1";
    readonly tools: readonly StoredTool[];
}

interface ConnectionCatalogEntry {
    readonly display_name: string;
    readonly description: string;
    readonly icon_data_uri: string | null;
}

interface IntegrationSetupRow {
    readonly flow_id: string;
    readonly organization_id: string;
    readonly user_id: string;
    readonly provider_identifier: string;
    readonly provider_id: string;
    readonly provider_version_id: string;
    readonly setup_session_id: string;
    readonly state: string;
    readonly catalog_json: string;
    readonly expires_at_ms: number;
}

const MAX_JSON_BYTES = 512 * 1024;
const METORIAL_API_VERSION = "2026-01-01-magnetar" as const;
const jsonHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;
const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers: jsonHeaders });
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,253}$/u.test(value);
const providerIdentifier = (value: unknown): value is string =>
    typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
const displayText = (value: unknown, maximum: number): value is string =>
    typeof value === "string" && value.length > 0 && value === value.trim() && value.length <= maximum;
const metorialToolKey = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/+_-]{0,253}$/u.test(value);
const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
};
const parseJson = (value: string): unknown => {
    if (new TextEncoder().encode(value).byteLength > MAX_JSON_BYTES) throw new Error("JSON exceeded its byte limit");
    return JSON.parse(value) as unknown;
};
const parseToolMap = (value: unknown): StoredToolMap | null => {
    if (
        !record(value) ||
        value["schema_version"] !== "openbot_metorial_tool_map_v1" ||
        !Array.isArray(value["tools"])
    ) {
        return null;
    }
    const tools = value["tools"].map(tool => {
        if (
            !record(tool) ||
            typeof tool["name"] !== "string" ||
            !/^[A-Za-z0-9_-]{1,64}$/u.test(tool["name"]) ||
            !id(tool["tool_id"]) ||
            !metorialToolKey(tool["tool_key"]) ||
            !displayText(tool["description"], 4_096) ||
            !record(tool["input_schema"])
        ) {
            return null;
        }
        return tool as unknown as StoredTool;
    });
    if (
        tools.some(tool => tool === null) ||
        new Set(tools.map(tool => tool?.name)).size !== tools.length ||
        new Set(tools.map(tool => tool?.tool_id)).size !== tools.length
    ) {
        return null;
    }
    return { schema_version: "openbot_metorial_tool_map_v1", tools: tools as StoredTool[] };
};
const sdk = (env: CapabilityGatewayBindings) => {
    if (!/^metorial_(?:uk|mk|sk|ak|pk)_/u.test(env.METORIAL_API_KEY)) {
        throw new Error("METORIAL_API_KEY is not configured");
    }
    return createMetorialCoreSDK({ apiKey: env.METORIAL_API_KEY, apiVersion: METORIAL_API_VERSION });
};

const verifyAuthority = async (database: D1Database, input: OpenBotExecutionRequestV1): Promise<boolean> => {
    const row = await database
        .prepare(
            "SELECT confirmation.document_json AS confirmation_json FROM openbot_run AS run INNER JOIN openbot_confirmation AS confirmation ON confirmation.confirmation_id = run.confirmation_id WHERE run.organization_id = ?1 AND run.run_id = ?2 AND run.bot_id = ?3 AND run.execution_state = 'running'"
        )
        .bind(input.account_id, input.run_id, input.bot.bot_id)
        .first<{ confirmation_json: string }>();
    if (row === null) return false;
    const parsed = parseJson(row.confirmation_json);
    if (!record(parsed) || !Array.isArray(parsed["permissions_snapshot"])) return false;
    const permissions = parsed["permissions_snapshot"].map(value => {
        if (!record(value)) return null;
        const permission = value;
        return {
            integration_id: permission["integration_id"],
            policy_id: permission["policy_id"],
            display_name: permission["display_name"],
            tool_key: permission["tool_key"],
            effect: permission["effect"],
            enabled: permission["enabled"],
        };
    });
    if (permissions.some(permission => permission === null)) return false;
    return (
        canonical(permissions) === canonical(input.permissions) &&
        canonical(parsed["metorial_session_intent"]) === canonical(input.metorial_session_intent)
    );
};

const paginateTools = async (
    metorial: ReturnType<typeof createMetorialCoreSDK>,
    providerVersionId: string
): Promise<Awaited<ReturnType<typeof metorial.providers.tools.list>>["items"]> => {
    const tools: Awaited<ReturnType<typeof metorial.providers.tools.list>>["items"] = [];
    let after: string | undefined;
    for (let page = 0; page < 100; page += 1) {
        const result = await metorial.providers.tools.list({
            providerVersionId,
            limit: 100,
            ...(after === undefined ? {} : { after }),
        });
        tools.push(...result.items);
        if (!result.pagination.hasMoreAfter) return tools;
        const next = result.items.at(-1)?.id;
        if (next === undefined || next === after) throw new Error("Metorial tool pagination did not advance");
        after = next;
    }
    throw new Error("Metorial tool pagination exceeded its limit");
};

const logicalToolName = (providerIndex: number, key: string): string => {
    const safe = key.replaceAll(/[^A-Za-z0-9_-]/gu, "_").slice(0, 54);
    return `p${providerIndex}_${safe}`;
};

const parseConnectionStart = (
    value: unknown
): {
    readonly account_id: string;
    readonly user_id: string;
    readonly flow_id: string;
    readonly provider_identifier: string;
    readonly provider_id: string;
    readonly provider_version_id: string;
    readonly redirect_url: string;
    readonly catalog: ConnectionCatalogEntry;
} | null => {
    if (
        !record(value) ||
        !id(value["account_id"]) ||
        !id(value["user_id"]) ||
        !id(value["flow_id"]) ||
        !providerIdentifier(value["provider_identifier"]) ||
        !id(value["provider_id"]) ||
        !id(value["provider_version_id"]) ||
        typeof value["redirect_url"] !== "string" ||
        !record(value["catalog"]) ||
        !displayText(value["catalog"]["display_name"], 128) ||
        !displayText(value["catalog"]["description"], 2_048) ||
        !(
            value["catalog"]["icon_data_uri"] === null ||
            (typeof value["catalog"]["icon_data_uri"] === "string" &&
                value["catalog"]["icon_data_uri"].startsWith("data:image/svg+xml") &&
                value["catalog"]["icon_data_uri"].length <= 64 * 1024)
        )
    ) {
        return null;
    }
    let redirect: URL;
    try {
        redirect = new URL(value["redirect_url"]);
    } catch {
        return null;
    }
    if (
        redirect.protocol !== "https:" ||
        redirect.username !== "" ||
        redirect.password !== "" ||
        redirect.port !== "" ||
        redirect.pathname !== "/integrations/metorial/callback" ||
        redirect.searchParams.size !== 1 ||
        redirect.searchParams.get("flow") !== value["flow_id"] ||
        redirect.hash !== ""
    ) {
        return null;
    }
    return value as ReturnType<typeof parseConnectionStart> & object;
};

const beginConnection = async (env: CapabilityGatewayBindings, value: unknown): Promise<Response> => {
    const input = parseConnectionStart(value);
    if (input === null) return json({ error: "invalid_connection_request" }, 422);
    const membership = await env.CONTROL_DB_FRESH.prepare(
        "SELECT role FROM member WHERE organizationId = ?1 AND userId = ?2"
    )
        .bind(input.account_id, input.user_id)
        .first<{ role: string }>();
    if (
        membership === null ||
        !membership.role
            .split(",")
            .map(role => role.trim())
            .includes("owner")
    ) {
        return json({ error: "organization_owner_required" }, 403);
    }
    const metorial = sdk(env);
    const setup = await metorial.providerSetupSessions.create({
        providerId: input.provider_id,
        redirectUrl: input.redirect_url,
        type: "auto",
        name: `OpenBot ${input.catalog.display_name}`,
        metadata: {
            openbot_flow_id: input.flow_id,
            openbot_organization_id: input.account_id,
            openbot_user_id: input.user_id,
        },
        configuration: { toolFilters: { enabled: false }, ui: { layout: "box" } },
    });
    if (setup.providerId !== null && setup.providerId !== input.provider_id) {
        await metorial.providerSetupSessions.delete(setup.id);
        return json({ error: "provider_mismatch" }, 409);
    }
    const now = Date.now();
    try {
        await env.CONTROL_DB_FRESH.prepare(
            "INSERT INTO openbot_integration_setup (flow_id, organization_id, user_id, provider_identifier, provider_id, provider_version_id, setup_session_id, state, catalog_json, expires_at_ms, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?10)"
        )
            .bind(
                input.flow_id,
                input.account_id,
                input.user_id,
                input.provider_identifier,
                input.provider_id,
                input.provider_version_id,
                setup.id,
                JSON.stringify(input.catalog),
                setup.expiresAt.getTime(),
                now
            )
            .run();
    } catch (error) {
        await metorial.providerSetupSessions.delete(setup.id);
        throw error;
    }
    return json({ url: setup.url, flow_id: input.flow_id }, 201);
};

const integrationSetup = async (
    database: D1Database,
    accountId: string,
    userId: string,
    flowId: string
): Promise<IntegrationSetupRow | null> =>
    await database
        .prepare(
            "SELECT flow_id, organization_id, user_id, provider_identifier, provider_id, provider_version_id, setup_session_id, state, catalog_json, expires_at_ms FROM openbot_integration_setup WHERE flow_id = ?1 AND organization_id = ?2 AND user_id = ?3"
        )
        .bind(flowId, accountId, userId)
        .first<IntegrationSetupRow>();

const completeConnection = async (env: CapabilityGatewayBindings, value: unknown): Promise<Response> => {
    if (!record(value) || !id(value["account_id"]) || !id(value["user_id"]) || !id(value["flow_id"])) {
        return json({ error: "invalid_connection_completion" }, 422);
    }
    const row = await integrationSetup(env.CONTROL_DB_FRESH, value["account_id"], value["user_id"], value["flow_id"]);
    if (row === null) return json({ error: "connection_flow_unavailable" }, 404);
    if (row.state === "completed") return json({ integration_state: "connected" });
    if (row.state !== "pending") return json({ error: "connection_flow_unavailable" }, 409);
    if (row.expires_at_ms <= Date.now()) {
        await env.CONTROL_DB_FRESH.prepare(
            "UPDATE openbot_integration_setup SET state = 'expired', updated_at_ms = ?1 WHERE flow_id = ?2 AND state = 'pending'"
        )
            .bind(Date.now(), row.flow_id)
            .run();
        return json({ error: "connection_flow_expired" }, 409);
    }
    const metorial = sdk(env);
    const setup = await metorial.providerSetupSessions.get(row.setup_session_id);
    if (setup.status !== "completed") {
        if (["failed", "archived", "deleted", "expired"].includes(setup.status)) {
            await env.CONTROL_DB_FRESH.prepare(
                "UPDATE openbot_integration_setup SET state = 'failed', updated_at_ms = ?1 WHERE flow_id = ?2 AND state = 'pending'"
            )
                .bind(Date.now(), row.flow_id)
                .run();
        }
        return json({ error: "connection_not_completed", status: setup.status }, 409);
    }
    const deployment = setup.deployment;
    if (setup.providerId !== row.provider_id || deployment === null) {
        return json({ error: "connection_provider_mismatch" }, 409);
    }
    const tools = await paginateTools(metorial, row.provider_version_id);
    if (tools.length < 1 || tools.length > 256) return json({ error: "unsupported_tool_count" }, 409);
    const specificationIds = new Set(tools.map(tool => tool.specificationId));
    if (specificationIds.size !== 1) return json({ error: "provider_specification_drift" }, 409);
    const providerSpecificationId = tools[0]?.specificationId;
    if (providerSpecificationId === undefined) return json({ error: "provider_tools_unavailable" }, 409);
    const catalogValue = parseJson(row.catalog_json);
    if (!record(catalogValue)) return json({ error: "connection_catalog_invalid" }, 409);
    const catalog = catalogValue as unknown as ConnectionCatalogEntry;
    const existing = await env.CONTROL_DB_FRESH.prepare(
        "SELECT integration_id FROM openbot_integration WHERE organization_id = ?1 AND provider_identifier = ?2"
    )
        .bind(row.organization_id, row.provider_identifier)
        .first<{ integration_id: string }>();
    const integrationId = existing?.integration_id ?? `integration_${crypto.randomUUID().replaceAll("-", "")}`;
    const integration = await compileMetorialIntegrationV1({
        integration_id: integrationId,
        provider_identifier: row.provider_identifier,
        provider_id: row.provider_id,
        provider_version_id: row.provider_version_id,
        provider_specification_id: providerSpecificationId,
        catalog,
        setup: {
            deployment,
            authConfig: setup.authConfig,
            credentials: setup.credentials,
            authMethod: setup.authMethod,
        },
        tools,
    });
    const now = Date.now();
    await env.CONTROL_DB_FRESH.batch([
        env.CONTROL_DB_FRESH.prepare(
            "INSERT INTO openbot_integration (integration_id, organization_id, provider_identifier, connection_state, document_json, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, 'connected', ?4, ?5, ?5) ON CONFLICT(organization_id, provider_identifier) DO UPDATE SET connection_state = 'connected', document_json = excluded.document_json, updated_at_ms = excluded.updated_at_ms"
        ).bind(integrationId, row.organization_id, row.provider_identifier, JSON.stringify(integration), now),
        env.CONTROL_DB_FRESH.prepare(
            "UPDATE openbot_integration_setup SET state = 'completed', updated_at_ms = ?1 WHERE flow_id = ?2 AND state = 'pending'"
        ).bind(now, row.flow_id),
    ]);
    return json({ integration_state: "connected", integration_id: integrationId });
};

const existingSession = async (
    database: D1Database,
    accountId: string,
    runId: string
): Promise<{ readonly session_id: string; readonly state: string; readonly tool_map_json: string } | null> =>
    await database
        .prepare(
            "SELECT session_id, state, tool_map_json FROM openbot_metorial_session WHERE organization_id = ?1 AND run_id = ?2"
        )
        .bind(accountId, runId)
        .first<{ session_id: string; state: string; tool_map_json: string }>();

const publicPreparedSession = (sessionId: string, toolMap: StoredToolMap): Record<string, unknown> => ({
    session_id: sessionId,
    tools: toolMap.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
    })),
});

const prepareSession = async (env: CapabilityGatewayBindings, input: OpenBotExecutionRequestV1): Promise<Response> => {
    if (!(await verifyAuthority(env.CONTROL_DB_FRESH, input))) return json({ error: "authority_mismatch" }, 409);
    const current = await existingSession(env.CONTROL_DB_FRESH, input.account_id, input.run_id);
    if (current !== null) {
        if (current.state !== "active") return json({ error: "session_not_active" }, 409);
        const toolMap = parseToolMap(parseJson(current.tool_map_json));
        return toolMap === null
            ? json({ error: "stored_tool_map_invalid" }, 409)
            : json(publicPreparedSession(current.session_id, toolMap));
    }
    const metorial = sdk(env);
    const storedTools: StoredTool[] = [];
    const providerBodies = [];
    for (const [providerIndex, provider] of input.metorial_session_intent.providers.entries()) {
        const allTools = await paginateTools(metorial, provider.provider_version_id);
        const byKey = new Map(allTools.map(tool => [tool.key, tool]));
        for (const key of provider.allowed_tool_keys) {
            const tool = byKey.get(key);
            if (tool === undefined || tool.specificationId !== provider.provider_specification_id) {
                return json({ error: "metorial_tool_drift", provider_version_id: provider.provider_version_id }, 409);
            }
            const schema = tool.inputSchema?.schema;
            storedTools.push({
                name: logicalToolName(providerIndex, key),
                tool_id: tool.id,
                tool_key: key,
                description: tool.description ?? tool.name,
                input_schema: record(schema) ? schema : { type: "object", additionalProperties: true },
            });
        }
        providerBodies.push({
            providerDeploymentId: provider.provider_deployment_id,
            ...(provider.auth.mode === "user_grant" ? { providerAuthConfigId: provider.auth.connection_grant_id } : {}),
            toolFilters: { type: "tool_keys" as const, keys: [...provider.allowed_tool_keys] },
        });
    }
    if (new Set(storedTools.map(tool => tool.name)).size !== storedTools.length) {
        return json({ error: "tool_name_collision" }, 409);
    }
    const session = await metorial.sessions.create({
        name: `OpenBot run ${input.run_id}`,
        metadata: { openbot_run_id: input.run_id, openbot_organization_id: input.account_id },
        providers: providerBodies,
    });
    const toolMap: StoredToolMap = { schema_version: "openbot_metorial_tool_map_v1", tools: storedTools };
    const now = Date.now();
    try {
        await env.CONTROL_DB_FRESH.prepare(
            "INSERT INTO openbot_metorial_session (session_id, organization_id, run_id, state, tool_map_json, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?5)"
        )
            .bind(session.id, input.account_id, input.run_id, JSON.stringify(toolMap), now)
            .run();
    } catch (error) {
        await metorial.sessions.delete(session.id);
        const winner = await existingSession(env.CONTROL_DB_FRESH, input.account_id, input.run_id);
        if (winner !== null && winner.state === "active") {
            const winnerToolMap = parseToolMap(parseJson(winner.tool_map_json));
            if (winnerToolMap !== null) return json(publicPreparedSession(winner.session_id, winnerToolMap));
        }
        throw error;
    }
    return json(publicPreparedSession(session.id, toolMap), 201);
};

const toolCall = async (env: CapabilityGatewayBindings, value: unknown): Promise<Response> => {
    if (!record(value) || !id(value["account_id"]) || !id(value["run_id"]) || !id(value["session_id"])) {
        return json({ error: "invalid_tool_call" }, 422);
    }
    if (typeof value["tool_name"] !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(value["tool_name"])) {
        return json({ error: "invalid_tool_call" }, 422);
    }
    if (!record(value["input"])) return json({ error: "invalid_tool_input" }, 422);
    const row = await env.CONTROL_DB_FRESH.prepare(
        "SELECT session.tool_map_json FROM openbot_metorial_session AS session INNER JOIN openbot_run AS run ON run.run_id = session.run_id WHERE session.organization_id = ?1 AND session.run_id = ?2 AND session.session_id = ?3 AND session.state = 'active' AND run.execution_state = 'running'"
    )
        .bind(value["account_id"], value["run_id"], value["session_id"])
        .first<{ tool_map_json: string }>();
    if (row === null) return json({ error: "session_unavailable" }, 409);
    const toolMap = parseToolMap(parseJson(row.tool_map_json));
    if (toolMap === null) return json({ error: "stored_tool_map_invalid" }, 409);
    const tool = toolMap.tools.find(candidate => candidate.name === value["tool_name"]);
    if (tool === undefined) return json({ error: "tool_not_allowed" }, 403);
    const result = await sdk(env).toolCalls.create({
        sessionId: value["session_id"],
        toolId: tool.tool_id,
        input: value["input"],
        metadata: { openbot_run_id: value["run_id"] },
    });
    return json({ status: result.status, output: result.output, error: result.error });
};

const cleanup = async (env: CapabilityGatewayBindings, sessionId: string, value: unknown): Promise<Response> => {
    if (!record(value) || !id(value["account_id"]) || !id(value["run_id"])) {
        return json({ error: "invalid_cleanup_request" }, 422);
    }
    const row = await env.CONTROL_DB_FRESH.prepare(
        "SELECT state FROM openbot_metorial_session WHERE organization_id = ?1 AND run_id = ?2 AND session_id = ?3"
    )
        .bind(value["account_id"], value["run_id"], sessionId)
        .first<{ state: string }>();
    if (row === null) return json({ error: "session_unavailable" }, 404);
    if (row.state === "deleted") return json({ cleanup_state: "completed" });
    await env.CONTROL_DB_FRESH.prepare(
        "UPDATE openbot_metorial_session SET state = 'deleting', updated_at_ms = ?1 WHERE session_id = ?2 AND state IN ('active', 'cleanup_failed')"
    )
        .bind(Date.now(), sessionId)
        .run();
    try {
        await sdk(env).sessions.delete(sessionId);
        await env.CONTROL_DB_FRESH.prepare(
            "UPDATE openbot_metorial_session SET state = 'deleted', updated_at_ms = ?1 WHERE session_id = ?2"
        )
            .bind(Date.now(), sessionId)
            .run();
        return json({ cleanup_state: "completed" });
    } catch {
        await env.CONTROL_DB_FRESH.prepare(
            "UPDATE openbot_metorial_session SET state = 'cleanup_failed', updated_at_ms = ?1 WHERE session_id = ?2"
        )
            .bind(Date.now(), sessionId)
            .run();
        return json({ error: "cleanup_failed" }, 502);
    }
};

export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);
        try {
            if (request.method === "POST" && url.pathname === "/v1/metorial/sessions") {
                const input = parseOpenBotExecutionRequestV1(await request.json());
                return input === null
                    ? json({ error: "invalid_execution_request" }, 422)
                    : await prepareSession(env, input);
            }
            if (request.method === "POST" && url.pathname === "/v1/metorial/tool-calls") {
                return await toolCall(env, await request.json());
            }
            if (request.method === "POST" && url.pathname === "/v1/metorial/connections") {
                return await beginConnection(env, await request.json());
            }
            if (request.method === "POST" && url.pathname === "/v1/metorial/connections/complete") {
                return await completeConnection(env, await request.json());
            }
            const match = /^\/v1\/metorial\/sessions\/([A-Za-z0-9_-]+)$/u.exec(url.pathname);
            if (request.method === "DELETE" && match?.[1] !== undefined) {
                return await cleanup(env, match[1], await request.json());
            }
            return json({ error: "not_found" }, 404);
        } catch (error) {
            console.error("capability gateway request failed", error instanceof Error ? error.name : "UnknownError");
            return json({ error: "capability_gateway_failed" }, 502);
        }
    },
} satisfies ExportedHandler<CapabilityGatewayBindings>;
