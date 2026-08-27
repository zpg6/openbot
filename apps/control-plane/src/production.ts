import pickerCatalog from "./generated/metorial-integration-picker.json" with { type: "json" };

import { createControlPlane, type ControlPlaneBindings } from "./app.js";
import { createOpenBotAuthV1 } from "./auth.js";
import { createD1ProductRepositoryV1 } from "./d1-product-repository.js";
import type {
    ControlPlaneActorV1,
    ControlPlaneProductProofDependenciesV1,
    ProductProofChatAgentDecisionV1,
    ProductProofMetorialCatalogAppV1,
    ProductProofMetorialIntegrationV1,
} from "./product-proof.js";

const METORIAL_API_VERSION = "2026-01-01-magnetar";
const MAX_INTERNAL_RESPONSE_BYTES = 256 * 1024;

export interface ProductionControlPlaneBindings extends ControlPlaneBindings {
    readonly OPENBOT_ORIGIN: string;
    readonly BETTER_AUTH_SECRET: string;
    readonly RESEND_API_KEY: string;
    readonly OPENBOT_EMAIL_FROM: string;
    readonly OPENROUTER_API_KEY?: string | undefined;
    readonly OPENROUTER_MODEL?: string | undefined;
}

type PickerCatalog = {
    readonly integrations: readonly (readonly [
        string,
        string,
        string,
        readonly string[],
        string | null,
        number | null,
        string | null,
        string,
        string,
    ])[];
};

const catalogApps: readonly ProductProofMetorialCatalogAppV1[] = (
    pickerCatalog as unknown as PickerCatalog
).integrations.map(entry => ({
    identifier: entry[0],
    display_name: entry[1],
    description: entry[2],
    categories: entry[3],
    icon_url: entry[4],
    featured_rank: entry[5],
    icon_data_uri: entry[6],
    provider_id: entry[7],
    provider_version_id: entry[8],
}));

const strictOrigin = (value: string): string => {
    const parsed = new URL(value);
    if (
        parsed.protocol !== "https:" ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.port !== "" ||
        parsed.pathname !== "/" ||
        parsed.search !== "" ||
        parsed.hash !== ""
    ) {
        throw new Error("OPENBOT_ORIGIN must be one default-port HTTPS origin");
    }
    return parsed.origin;
};

const escapeEmailHtml = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const sendEmail = async (
    env: ProductionControlPlaneBindings,
    input: { readonly to: string; readonly subject: string; readonly html: string }
): Promise<void> => {
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: env.OPENBOT_EMAIL_FROM, ...input }),
    });
    if (!response.ok) throw new Error(`Email delivery failed with status ${response.status}`);
};

const csrfToken = async (secret: string, sessionId: string, userId: string): Promise<string> => {
    const bytes = new TextEncoder().encode(`openbot_csrf_v1\u0000${secret}\u0000${sessionId}\u0000${userId}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
};

type AuthSession = {
    readonly session: {
        readonly id: string;
        readonly userId: string;
        readonly activeOrganizationId?: string | null | undefined;
    };
    readonly user: {
        readonly id: string;
        readonly email: string;
        readonly name: string;
    };
};

const validAuthSession = (value: unknown): value is AuthSession => {
    if (value === null || typeof value !== "object") return false;
    const candidate = value as Partial<AuthSession>;
    return (
        candidate.session !== undefined &&
        typeof candidate.session.id === "string" &&
        typeof candidate.session.userId === "string" &&
        candidate.user !== undefined &&
        typeof candidate.user.id === "string" &&
        typeof candidate.user.email === "string" &&
        typeof candidate.user.name === "string" &&
        candidate.session.userId === candidate.user.id
    );
};

const normalizedRole = (value: string): ControlPlaneActorV1["role"] => {
    const roles = new Set(value.split(",").map(role => role.trim()));
    if (roles.has("owner")) return "owner";
    if (roles.has("admin")) return "admin";
    return "member";
};

const createD1Connector = (env: ProductionControlPlaneBindings, origin: string) => ({
    plugin_id: "metorial",
    api_version: METORIAL_API_VERSION,
    session_serialization_identity: "openbot-metorial-session@1",
    async listIntegrations(accountId: string): Promise<readonly ProductProofMetorialIntegrationV1[]> {
        const result = await env.CONTROL_DB_FRESH.prepare(
            "SELECT document_json FROM openbot_integration WHERE organization_id = ?1 ORDER BY provider_identifier ASC"
        )
            .bind(accountId)
            .all<{ document_json: string }>();
        return result.results.map(row => JSON.parse(row.document_json) as ProductProofMetorialIntegrationV1);
    },
    async listCatalogApps(): Promise<readonly ProductProofMetorialCatalogAppV1[]> {
        return catalogApps;
    },
    async setOrganizationPermissionEnabled(input: {
        readonly account_id: string;
        readonly integration_id: string;
        readonly policy_id: string;
        readonly enabled: boolean;
    }): Promise<boolean> {
        const row = await env.CONTROL_DB_FRESH.prepare(
            "SELECT document_json FROM openbot_integration WHERE organization_id = ?1 AND integration_id = ?2"
        )
            .bind(input.account_id, input.integration_id)
            .first<{ document_json: string }>();
        if (row === null) return false;
        const integration = JSON.parse(row.document_json) as ProductProofMetorialIntegrationV1;
        if (!integration.permissions.some(permission => permission.policy_id === input.policy_id)) return false;
        const updated: ProductProofMetorialIntegrationV1 = {
            ...integration,
            permissions: integration.permissions.map(permission =>
                permission.policy_id === input.policy_id ? { ...permission, enabled: input.enabled } : permission
            ),
        };
        const result = await env.CONTROL_DB_FRESH.prepare(
            "UPDATE openbot_integration SET document_json = ?1, updated_at_ms = ?2 WHERE organization_id = ?3 AND integration_id = ?4 AND document_json = ?5"
        )
            .bind(JSON.stringify(updated), Date.now(), input.account_id, input.integration_id, row.document_json)
            .run();
        return (result.meta.changes ?? 0) === 1;
    },
    async beginIntegrationConnection(input: {
        readonly account_id: string;
        readonly user_id: string;
        readonly app: ProductProofMetorialCatalogAppV1;
    }): Promise<string | null> {
        if (input.app.provider_id === null || input.app.provider_version_id === null) return null;
        const flowId = `flow_${crypto.randomUUID().replaceAll("-", "")}`;
        const response = await env.CAPABILITY_GATEWAY.fetch(
            "https://capability-gateway.internal/v1/metorial/connections",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    account_id: input.account_id,
                    user_id: input.user_id,
                    flow_id: flowId,
                    provider_identifier: input.app.identifier,
                    provider_id: input.app.provider_id,
                    provider_version_id: input.app.provider_version_id,
                    redirect_url: `${origin}/integrations/metorial/callback?flow=${encodeURIComponent(flowId)}`,
                    catalog: {
                        display_name: input.app.display_name,
                        description: input.app.description,
                        icon_data_uri: input.app.icon_data_uri,
                    },
                }),
            }
        );
        const raw = await response.text();
        if (!response.ok || raw.length > MAX_INTERNAL_RESPONSE_BYTES) return null;
        try {
            const value = JSON.parse(raw) as { url?: unknown };
            if (typeof value.url !== "string" || value.url.length > 8_192) return null;
            const parsed = new URL(value.url);
            return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
                ? parsed.href
                : null;
        } catch {
            return null;
        }
    },
    async completeIntegrationConnection(input: {
        readonly account_id: string;
        readonly user_id: string;
        readonly flow_id: string;
    }): Promise<boolean> {
        const response = await env.CAPABILITY_GATEWAY.fetch(
            "https://capability-gateway.internal/v1/metorial/connections/complete",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            }
        );
        if (!response.ok) return false;
        const raw = await response.text();
        if (raw.length > MAX_INTERNAL_RESPONSE_BYTES) return false;
        try {
            return (JSON.parse(raw) as { integration_state?: unknown }).integration_state === "connected";
        } catch {
            return false;
        }
    },
});

const parseRoutineDecision = (value: unknown): ProductProofChatAgentDecisionV1 => {
    if (value === null || typeof value !== "object") return { kind: "run_task" };
    const candidate = value as Record<string, unknown>;
    if (candidate["kind"] !== "create_routine") return { kind: "run_task" };
    const name = candidate["name"];
    const prompt = candidate["prompt"];
    const schedule = candidate["schedule"];
    if (
        typeof name !== "string" ||
        name.length < 1 ||
        name.length > 128 ||
        typeof prompt !== "string" ||
        prompt.length < 1 ||
        prompt.length > 16 * 1024 ||
        typeof schedule !== "string" ||
        schedule.length < 1 ||
        schedule.length > 256
    ) {
        return { kind: "run_task" };
    }
    return { kind: "create_routine", name, prompt, schedule };
};

const openRouterDecision = async (
    env: ProductionControlPlaneBindings,
    input: { readonly botName: string; readonly message: string }
): Promise<ProductProofChatAgentDecisionV1> => {
    if (env.OPENROUTER_API_KEY === undefined) return { kind: "run_task" };
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": strictOrigin(env.OPENBOT_ORIGIN),
            "X-Title": "OpenBot",
        },
        body: JSON.stringify({
            model: env.OPENROUTER_MODEL ?? "openai/gpt-5-mini",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content:
                        "Classify the message. Use create_routine only when the user asks for repeated or scheduled work. Otherwise use run_task. Return JSON only with kind and, for a routine, a short name, the task prompt, and the schedule in the user's words.",
                },
                { role: "user", content: `Bot: ${input.botName}\nMessage: ${input.message}` },
            ],
            response_format: { type: "json_object" },
        }),
    });
    if (!response.ok) return { kind: "run_task" };
    const raw = await response.text();
    if (raw.length > MAX_INTERNAL_RESPONSE_BYTES) return { kind: "run_task" };
    try {
        const payload = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
        const content = payload.choices?.[0]?.message?.content;
        return typeof content === "string" ? parseRoutineDecision(JSON.parse(content)) : { kind: "run_task" };
    } catch {
        return { kind: "run_task" };
    }
};

export const createProductionControlPlaneV1 = (env: ProductionControlPlaneBindings) => {
    const origin = strictOrigin(env.OPENBOT_ORIGIN);
    const auth = createOpenBotAuthV1({
        database: env.CONTROL_DB_FRESH,
        origin,
        secret: env.BETTER_AUTH_SECRET,
        delivery: {
            sendMagicLink: input =>
                sendEmail(env, {
                    to: input.email,
                    subject: "Sign in to OpenBot",
                    html: `<p>Use this link to sign in to OpenBot:</p><p><a href="${escapeEmailHtml(input.url)}">Sign in</a></p><p>This link expires in five minutes.</p>`,
                }),
            sendOrganizationInvitation: input => {
                const invitationUrl = `${origin}/api/auth/organization/accept-invitation?invitationId=${encodeURIComponent(input.invitation_id)}`;
                return sendEmail(env, {
                    to: input.email,
                    subject: `Join ${input.organization_name} on OpenBot`,
                    html: `<p>${escapeEmailHtml(input.inviter_name)} invited you to join ${escapeEmailHtml(input.organization_name)} as ${escapeEmailHtml(input.role)}.</p><p><a href="${escapeEmailHtml(invitationUrl)}">Accept invitation</a></p>`,
                });
            },
        },
    });

    const sessionFor = async (request: Request): Promise<AuthSession | null> => {
        const session: unknown = await auth.api.getSession({ headers: request.headers });
        return validAuthSession(session) ? session : null;
    };

    const dependencies: ControlPlaneProductProofDependenciesV1 = {
        repository: createD1ProductRepositoryV1(env.CONTROL_DB_FRESH),
        connector: createD1Connector(env, origin),
        async resolveActor(request) {
            const session = await sessionFor(request);
            if (session === null) return null;
            const activeOrganizationId = session.session.activeOrganizationId;
            const row = await env.CONTROL_DB_FRESH.prepare(
                activeOrganizationId === undefined || activeOrganizationId === null
                    ? 'SELECT member."organizationId" AS organization_id, member.role, organization.name FROM member INNER JOIN organization ON organization.id = member."organizationId" WHERE member."userId" = ?1 ORDER BY member."createdAt" ASC LIMIT 1'
                    : 'SELECT member."organizationId" AS organization_id, member.role, organization.name FROM member INNER JOIN organization ON organization.id = member."organizationId" WHERE member."userId" = ?1 AND member."organizationId" = ?2 LIMIT 1'
            )
                .bind(
                    ...(activeOrganizationId === undefined || activeOrganizationId === null
                        ? [session.user.id]
                        : [session.user.id, activeOrganizationId])
                )
                .first<{ organization_id: string; role: string; name: string }>();
            if (row === null) return null;
            return {
                account_id: row.organization_id,
                organization_name: row.name,
                user_id: session.user.id,
                display_name: session.user.name,
                csrf_token: await csrfToken(env.BETTER_AUTH_SECRET, session.session.id, session.user.id),
                role: normalizedRole(row.role),
            };
        },
        taskExecutor: {
            async execute(input) {
                const response = await env.ORCHESTRATOR.fetch("https://orchestrator.internal/v1/runs/execute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        schema_version: "openbot_execution_request_v1",
                        account_id: input.account_id,
                        user_id: input.user_id,
                        run_id: input.run_id,
                        bot: {
                            bot_id: input.bot.bot_id,
                            name: input.bot.name,
                            purpose: input.bot.purpose,
                            standing_instructions: input.bot.standing_instructions,
                        },
                        prompt: input.prompt,
                        permissions: input.permissions.map(permission => ({
                            integration_id: permission.integration_id,
                            policy_id: permission.policy_id,
                            display_name: permission.display_name,
                            tool_key: permission.tool_key,
                            effect: permission.effect,
                            enabled: permission.enabled,
                        })),
                        metorial_session_intent: input.metorial_session_intent,
                    }),
                });
                const raw = await response.text();
                if (!response.ok || raw.length > MAX_INTERNAL_RESPONSE_BYTES) {
                    throw new Error(`Run execution failed with status ${response.status}`);
                }
                const payload = JSON.parse(raw) as {
                    result_text?: unknown;
                    cleanup_state?: unknown;
                    metorial_tool_call_count?: unknown;
                };
                if (
                    typeof payload.result_text !== "string" ||
                    payload.result_text.length > 128 * 1024 ||
                    payload.cleanup_state !== "completed" ||
                    typeof payload.metorial_tool_call_count !== "number" ||
                    !Number.isInteger(payload.metorial_tool_call_count) ||
                    payload.metorial_tool_call_count < 0
                ) {
                    throw new Error("Run execution returned an invalid result");
                }
                return {
                    result_text: payload.result_text,
                    cleanup_state: "completed",
                    evidence_state: "metorial_verified",
                    metorial_tool_call_count: payload.metorial_tool_call_count,
                };
            },
        },
        chatAgent: {
            respond: input => openRouterDecision(env, { botName: input.bot.name, message: input.message }),
        },
        identity: {
            async resolveUser(request) {
                const session = await sessionFor(request);
                if (session === null) return null;
                return {
                    user_id: session.user.id,
                    display_name: session.user.name,
                    email: session.user.email,
                    csrf_token: await csrfToken(env.BETTER_AUTH_SECRET, session.session.id, session.user.id),
                };
            },
            async requestMagicLink(input) {
                try {
                    const response = await auth.handler(
                        new Request(`${origin}/api/auth/sign-in/magic-link`, {
                            method: "POST",
                            headers: {
                                Cookie: input.request.headers.get("Cookie") ?? "",
                                Origin: origin,
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({ email: input.email, callbackURL: "/" }),
                        })
                    );
                    return response.ok;
                } catch {
                    return false;
                }
            },
            async createOrganization(input) {
                try {
                    const response = await auth.handler(
                        new Request(`${origin}/api/auth/organization/create`, {
                            method: "POST",
                            headers: {
                                Cookie: input.request.headers.get("Cookie") ?? "",
                                Origin: origin,
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({ name: input.name, slug: input.slug }),
                        })
                    );
                    return response.ok;
                } catch {
                    return false;
                }
            },
        },
    };

    return createControlPlane(dependencies, { authHandler: auth.handler });
};
