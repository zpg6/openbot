import { betterAuth, type BetterAuthOptions } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";

const MAGIC_LINK_EXPIRES_SECONDS = 5 * 60;
const INVITATION_EXPIRES_SECONDS = 48 * 60 * 60;
const SESSION_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const SESSION_UPDATE_SECONDS = 12 * 60 * 60;

export interface OpenBotIdentityDeliveryV1 {
    sendMagicLink(input: { readonly email: string; readonly url: string }): Promise<void>;
    sendOrganizationInvitation(input: {
        readonly email: string;
        readonly invitation_id: string;
        readonly organization_id: string;
        readonly organization_name: string;
        readonly inviter_name: string;
        readonly role: string;
    }): Promise<void>;
}

export interface OpenBotAuthFactoryInputV1 {
    readonly database: D1Database;
    readonly origin: string;
    readonly secret: string;
    readonly delivery: OpenBotIdentityDeliveryV1;
}

export interface OpenBotAuthV1 {
    readonly handler: (request: Request) => Promise<Response>;
    readonly api: ReturnType<typeof betterAuth>["api"];
    readonly options: BetterAuthOptions;
}

const fixedHttpsOrigin = (value: string): string => {
    const url = new URL(value);
    if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== ""
    ) {
        throw new Error("OpenBot auth requires one fixed default-port HTTPS origin");
    }
    return url.origin;
};

export const compileOpenBotAuthOptionsV1 = (input: OpenBotAuthFactoryInputV1): BetterAuthOptions => {
    const origin = fixedHttpsOrigin(input.origin);
    if (new TextEncoder().encode(input.secret).byteLength < 32) {
        throw new Error("OpenBot auth secret must contain at least 32 bytes");
    }

    return {
        appName: "OpenBot",
        baseURL: origin,
        basePath: "/api/auth",
        secret: input.secret,
        database: input.database,
        trustedOrigins: [origin],
        session: {
            expiresIn: SESSION_EXPIRES_SECONDS,
            updateAge: SESSION_UPDATE_SECONDS,
            cookieCache: { enabled: false },
        },
        rateLimit: {
            enabled: true,
            storage: "database",
            window: 60,
            max: 100,
        },
        advanced: {
            useSecureCookies: true,
            disableCSRFCheck: false,
            disableOriginCheck: false,
            trustedProxyHeaders: false,
            cookiePrefix: "openbot",
            defaultCookieAttributes: {
                httpOnly: true,
                sameSite: "lax",
                secure: true,
                path: "/",
            },
        },
        plugins: [
            magicLink({
                expiresIn: MAGIC_LINK_EXPIRES_SECONDS,
                disableSignUp: false,
                storeToken: "hashed",
                rateLimit: { window: 60, max: 5 },
                sendMagicLink: async ({ email, url }) => input.delivery.sendMagicLink({ email, url }),
            }),
            organization({
                allowUserToCreateOrganization: true,
                creatorRole: "owner",
                invitationExpiresIn: INVITATION_EXPIRES_SECONDS,
                requireEmailVerificationOnInvitation: true,
                teams: { enabled: false },
                sendInvitationEmail: async data =>
                    input.delivery.sendOrganizationInvitation({
                        email: data.email,
                        invitation_id: data.id,
                        organization_id: data.organization.id,
                        organization_name: data.organization.name,
                        inviter_name: data.inviter.user.name,
                        role: data.role,
                    }),
            }),
        ],
    };
};

export const createOpenBotAuthV1 = (input: OpenBotAuthFactoryInputV1): OpenBotAuthV1 =>
    betterAuth(compileOpenBotAuthOptionsV1(input)) as OpenBotAuthV1;

const AUTH_HANDLER_ROUTES_V1 = new Set([
    "GET /api/auth/get-session",
    "GET /api/auth/magic-link/verify",
    "POST /api/auth/sign-out",
]);

export const isOpenBotAuthHandlerRequestV1 = (request: Request, configuredOrigin: string): boolean => {
    const origin = fixedHttpsOrigin(configuredOrigin);
    const url = new URL(request.url);
    return url.origin === origin && AUTH_HANDLER_ROUTES_V1.has(`${request.method.toUpperCase()} ${url.pathname}`);
};

export const OPENBOT_AUTH_PRODUCT_ROUTES_V1 = Object.freeze({
    request_magic_link: "POST /actions/auth/magic-link",
    onboarding: "GET /onboarding",
    create_organization: "POST /actions/organizations",
    set_active_organization: "POST /actions/organizations/active",
    invite_member: "POST /actions/organization-invitations",
    accept_invitation: "POST /actions/organization-invitations/:flowId/accept",
} as const);
