import { describe, expect, it, vi } from "vitest";

import { compileOpenBotAuthOptionsV1, isOpenBotAuthHandlerRequestV1 } from "../src/auth.js";

const database = {} as D1Database;
const delivery = Object.freeze({
    sendMagicLink: vi.fn(async () => undefined),
    sendOrganizationInvitation: vi.fn(async () => undefined),
});

describe("OpenBot Better Auth boundary", () => {
    it("pins magic-link and organization plugins to the fixed secure origin", () => {
        const options = compileOpenBotAuthOptionsV1({
            database,
            origin: "https://openbot.example",
            secret: "a".repeat(32),
            delivery,
        });

        expect(options.baseURL).toBe("https://openbot.example");
        expect(options.basePath).toBe("/api/auth");
        expect(options.trustedOrigins).toEqual(["https://openbot.example"]);
        expect(options.rateLimit).toMatchObject({ enabled: true, storage: "database" });
        expect(options.advanced).toMatchObject({
            useSecureCookies: true,
            disableCSRFCheck: false,
            disableOriginCheck: false,
            trustedProxyHeaders: false,
            cookiePrefix: "openbot",
        });
        expect(options.plugins?.map(plugin => plugin.id)).toEqual(["magic-link", "organization"]);
    });

    it("rejects inferred, non-HTTPS, credentialed, portful, and pathful origins", () => {
        for (const origin of [
            "http://openbot.example",
            "https://user:pass@openbot.example",
            "https://openbot.example:8443",
            "https://openbot.example/app",
        ]) {
            expect(() => compileOpenBotAuthOptionsV1({ database, origin, secret: "a".repeat(32), delivery })).toThrow(
                /fixed default-port HTTPS origin/u
            );
        }
        expect(() =>
            compileOpenBotAuthOptionsV1({
                database,
                origin: "https://openbot.example",
                secret: "too-short",
                delivery,
            })
        ).toThrow(/at least 32 bytes/u);
    });

    it("exposes only session read, one-use verification, and sign-out through the raw handler", () => {
        const allowed = [
            ["GET", "/api/auth/get-session"],
            ["GET", "/api/auth/magic-link/verify?token=opaque"],
            ["POST", "/api/auth/sign-out"],
        ] as const;
        for (const [method, path] of allowed) {
            expect(
                isOpenBotAuthHandlerRequestV1(
                    new Request(`https://openbot.example${path}`, { method }),
                    "https://openbot.example"
                )
            ).toBe(true);
        }

        for (const [method, path] of [
            ["POST", "/api/auth/sign-in/magic-link"],
            ["POST", "/api/auth/organization/create"],
            ["POST", "/api/auth/organization/update-member-role"],
            ["GET", "/api/auth/magic-link/verify/"],
        ] as const) {
            expect(
                isOpenBotAuthHandlerRequestV1(
                    new Request(`https://openbot.example${path}`, { method }),
                    "https://openbot.example"
                )
            ).toBe(false);
        }
        expect(
            isOpenBotAuthHandlerRequestV1(
                new Request("https://evil.example/api/auth/get-session"),
                "https://openbot.example"
            )
        ).toBe(false);
    });
});
