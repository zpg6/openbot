export const httpMethods = ["DELETE", "GET", "PATCH", "POST"] as const;

export type CoreHttpMethod = (typeof httpMethods)[number];

export interface CoreRoute {
    readonly category: "action" | "api" | "auth" | "html" | "operator";
    readonly method: CoreHttpMethod;
    readonly path: string;
}

const htmlPaths = [
    "/",
    "/login",
    "/bootstrap",
    "/reset",
    "/bots",
    "/bots/new",
    "/bots/:botId",
    "/bots/:botId/profile",
    "/bots/:botId/access",
    "/bots/:botId/runs/:runId",
    "/run-confirmations/:confirmationId",
    "/catalog/tools",
    "/catalog/tools/:policyId",
    "/catalog/skills",
    "/catalog/skills/new",
    "/catalog/skills/:skillId",
    "/connections",
    "/connections/new",
    "/connection-setups/:setupId",
    "/connections/:authorizationId",
    "/oauth/metorial/callback",
    "/audit",
    "/audit/events/:eventId",
    "/cleanup-obligations/:obligationId",
    "/settings",
] as const;

const actionPaths = [
    "/actions/bootstrap",
    "/actions/password-reset",
    "/actions/bots",
    "/actions/bots/:botId/profile",
    "/actions/bots/:botId/revisions",
    "/actions/organization-tool-policies",
    "/actions/organization-tool-policies/:policyId/disables",
    "/actions/skills",
    "/actions/skills/:skillId/revisions",
    "/actions/skills/:skillId/revisions/:revisionId/disables",
    "/actions/connection-setups",
    "/actions/connection-setups/:setupId/reopen",
    "/actions/provider-authorizations/:authorizationId/revocations",
    "/actions/capability-grants",
    "/actions/capability-grants/:grantId/revocations",
    "/actions/run-confirmations",
    "/actions/run-confirmations/:confirmationId/discards",
    "/actions/runs",
    "/actions/runs/:runId/cancellations",
    "/actions/runs/:runId/cleanup-retries",
    "/actions/runs/:runId/content-deletions",
] as const;

const apiRoutes = [
    ["GET", "/api/v1/account"],
    ["GET", "/api/v1/bots"],
    ["POST", "/api/v1/bots"],
    ["GET", "/api/v1/bots/:botId"],
    ["PATCH", "/api/v1/bots/:botId/profile"],
    ["POST", "/api/v1/bots/:botId/revisions"],
    ["GET", "/api/v1/bots/:botId/runs"],
    ["GET", "/api/v1/organization-tool-policies"],
    ["POST", "/api/v1/organization-tool-policies"],
    ["GET", "/api/v1/organization-tool-policies/:policyId"],
    ["POST", "/api/v1/organization-tool-policies/:policyId/disables"],
    ["GET", "/api/v1/skills"],
    ["POST", "/api/v1/skills"],
    ["GET", "/api/v1/skills/:skillId"],
    ["POST", "/api/v1/skills/:skillId/revisions"],
    ["POST", "/api/v1/skills/:skillId/revisions/:revisionId/disables"],
    ["GET", "/api/v1/provider-deployments"],
    ["GET", "/api/v1/provider-deployments/:deploymentId"],
    ["GET", "/api/v1/provider-authorizations"],
    ["GET", "/api/v1/provider-authorizations/:authorizationId"],
    ["POST", "/api/v1/connection-setups"],
    ["GET", "/api/v1/connection-setups/:setupId"],
    ["POST", "/api/v1/provider-authorizations/:authorizationId/revocations"],
    ["GET", "/api/v1/capability-grants"],
    ["POST", "/api/v1/capability-grants"],
    ["GET", "/api/v1/capability-grants/:grantId"],
    ["POST", "/api/v1/capability-grants/:grantId/revocations"],
    ["POST", "/api/v1/run-confirmations"],
    ["GET", "/api/v1/run-confirmations/:confirmationId"],
    ["POST", "/api/v1/run-confirmations/:confirmationId/discards"],
    ["POST", "/api/v1/runs"],
    ["GET", "/api/v1/runs/:runId"],
    ["GET", "/api/v1/runs/:runId/events"],
    ["GET", "/api/v1/runs/:runId/result"],
    ["POST", "/api/v1/runs/:runId/cancellations"],
    ["POST", "/api/v1/runs/:runId/cleanup-retries"],
    ["DELETE", "/api/v1/runs/:runId/content"],
    ["GET", "/api/v1/audit-events"],
    ["GET", "/api/v1/audit-events/:eventId"],
] as const satisfies ReadonlyArray<readonly [CoreHttpMethod, string]>;

const authRoutes = [
    ["POST", "/api/auth/sign-in/email"],
    ["GET", "/api/auth/get-session"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/sign-out"],
] as const satisfies ReadonlyArray<readonly [CoreHttpMethod, string]>;

export const coreRoutes: readonly CoreRoute[] = [
    ...htmlPaths.map(path => ({ category: "html" as const, method: "GET" as const, path })),
    ...actionPaths.map(path => ({ category: "action" as const, method: "POST" as const, path })),
    ...apiRoutes.map(([method, path]) => ({ category: "api" as const, method, path })),
    ...authRoutes.map(([method, path]) => ({ category: "auth" as const, method, path })),
    { category: "operator", method: "POST", path: "/operator/v1/admin-tokens" },
];

export function routeKey(route: Pick<CoreRoute, "method" | "path">): string {
    return `${route.method} ${route.path}`;
}
