import { describe, expect, it } from "vitest";
import * as internalContracts from "./internal.js";
import * as rootContracts from "./index.js";
import * as publicContracts from "./public.js";

describe("contract entrypoints", () => {
    it("keeps the root entrypoint route-safe", () => {
        expect(Object.keys(rootContracts).sort()).toEqual(Object.keys(publicContracts).sort());
        expect(publicContracts).not.toHaveProperty("StoredOrganizationToolPolicyV1Schema");
        expect(publicContracts).not.toHaveProperty("botToolPolicySelectionMatchesPolicyV1");
        expect(publicContracts).not.toHaveProperty("BotV1Schema");
        expect(publicContracts).not.toHaveProperty("BotProfileV1Schema");
        expect(publicContracts).not.toHaveProperty("BotPermissionSelectionV1Schema");
        expect(publicContracts).not.toHaveProperty("RuntimeLimitsV1Schema");
        expect(publicContracts).not.toHaveProperty("verifyCompilerManifestExtensionEnvelopeV1");
        expect(publicContracts).not.toHaveProperty("classifyUserAuthoredContentV1");
        expect(publicContracts).not.toHaveProperty("computeAuthorityChainMatchesV1");
        expect(publicContracts).not.toHaveProperty("computeAuthorityChainIsValidV1");
    });

    it("requires the explicit internal entrypoint for authority records", () => {
        expect(internalContracts).toHaveProperty("StoredOrganizationToolPolicyV1Schema");
        expect(internalContracts).toHaveProperty("botToolPolicySelectionMatchesPolicyV1");
        expect(internalContracts).toHaveProperty("BotV1Schema");
        expect(internalContracts).toHaveProperty("BotProfileV1Schema");
        expect(internalContracts).toHaveProperty("BotPermissionSelectionV1Schema");
        expect(internalContracts).toHaveProperty("RuntimeLimitsV1Schema");
        expect(internalContracts).toHaveProperty("verifyCompilerManifestExtensionEnvelopeV1");
        expect(internalContracts).toHaveProperty("computeAuthorityChainMatchesV1");
        expect(internalContracts).not.toHaveProperty("computeAuthorityChainIsValidV1");
    });
});
