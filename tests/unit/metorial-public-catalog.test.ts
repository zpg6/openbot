import { describe, expect, it } from "vitest";

import {
    parseMetorialPublicCatalogHtml,
    parseMetorialPublicProviderHtml,
    readBalancedJsonObject,
    readNextFlightText,
} from "../../scripts/metorial-public-catalog-lib.mjs";

const flightHtml = (value: string): string =>
    `<html><script>self.__next_f.push(${JSON.stringify([1, value])})</script></html>`;

const flightChunksHtml = (values: string[]): string =>
    `<html>${values
        .map(value => `<script>self.__next_f.push(${JSON.stringify([1, value])})</script>`)
        .join("")}</html>`;

describe("Metorial public catalog generation", () => {
    it("decodes React Flight chunks and balanced JSON safely", () => {
        expect(readNextFlightText(flightHtml('{"message":"a \\"quoted\\" value"}'))).toContain("quoted");
        expect(readBalancedJsonObject('{"outer":{"inner":"}"}} trailing', 0)).toBe('{"outer":{"inner":"}"}}');
        expect(readNextFlightText(flightChunksHtml(['1:{"descr', 'iption":"intact"}']))).toBe(
            '1:{"description":"intact"}'
        );
    });

    it("parses every published provider and removes repeated server-rendered copies", () => {
        const providers = Array.from({ length: 1_000 }, (_, index) => ({
            id: `plg_${index.toString().padStart(4, "0")}`,
            slug: `provider-${index}`,
            name: `Provider ${index}`,
            description: `Provider ${index} description`,
            imageUrl: "https://provider-logos.metorial-cdn.com/provider.svg",
            skills: ["read records"],
            categories: [{ slug: "apis-and-http-requests" }],
            updatedAt: "$D2026-08-26T14:00:00.000Z",
        }));
        const rendered = [...providers, providers[0]].map(value => JSON.stringify(value)).join(",");

        const parsed = parseMetorialPublicCatalogHtml(flightHtml(rendered));

        expect(parsed).toHaveLength(1_000);
        expect(parsed[0]).toMatchObject({
            identifier: "provider-0",
            categories: ["apis-and-http-requests"],
            official_icon_url: "https://provider-logos.metorial-cdn.com/provider.svg",
        });
    });

    it("parses runtime IDs and classifies all tools and triggers from Metorial tags", () => {
        const provider = {
            id: "plg_slack",
            slug: "slack",
            providerId: "pro_slack",
            globalIdentifier: "metorialslack-reviewed",
            currentVersionId: "prv_slack",
            name: "Slack",
            description: "Messages and channels.",
            imageUrl: "https://provider-logos.metorial-cdn.com/slack.svg",
            skills: ["send messages"],
            categories: [{ slug: "email-and-messaging" }],
            updatedAt: "$D2026-08-26T14:00:00.000Z",
        };
        const capability = (object: string, id: string, key: string, tags?: object) => ({
            object,
            id,
            key,
            name: key.replaceAll("_", " "),
            description: `${key} description`,
            constraints: [],
            instructions: [],
            tags,
            specificationId: `psp_${id}`,
            providerId: "pro_slack",
        });
        const source = [
            provider,
            capability("marketplace#provider.tool", "pto_read", "list_channels", {
                readOnly: true,
            }),
            capability("marketplace#provider.tool", "pto_write", "send_message", {}),
            capability("marketplace#provider.tool", "pto_delete", "delete_message", {
                destructive: true,
            }),
            capability("marketplace#provider.trigger", "ptr_message", "message_posted"),
        ]
            .map(value => JSON.stringify(value))
            .join("\n");

        const parsed = parseMetorialPublicProviderHtml(flightHtml(source), "slack");

        expect(parsed.provider_id).toBe("pro_slack");
        expect(parsed.current_version_id).toBe("prv_slack");
        expect(Object.fromEntries(parsed.tools.map(tool => [tool.key, tool.effect]))).toEqual({
            delete_message: "destructive",
            list_channels: "read",
            send_message: "write",
        });
        expect(parsed.tools.find(tool => tool.key === "send_message")?.effect_source).toBe("default_write");
        expect(parsed.triggers).toHaveLength(1);
        expect(parsed.triggers[0]?.effect).toBe("trigger");
    });

    it("rejects a detail page whose capability belongs to another provider", () => {
        const source = [
            {
                id: "plg_slack",
                slug: "slack",
                providerId: "pro_slack",
                globalIdentifier: "metorialslack-reviewed",
                currentVersionId: "prv_slack",
                name: "Slack",
                description: "Messages and channels.",
                imageUrl: "https://provider-logos.metorial-cdn.com/slack.svg",
                skills: [],
                categories: [],
                updatedAt: "$D2026-08-26T14:00:00.000Z",
            },
            {
                object: "marketplace#provider.tool",
                id: "pto_wrong",
                key: "list_channels",
                name: "List channels",
                description: "List channels.",
                constraints: [],
                instructions: [],
                tags: { readOnly: true, destructive: false },
                specificationId: "psp_wrong",
                providerId: "pro_other",
            },
        ]
            .map(value => JSON.stringify(value))
            .join("\n");

        expect(() => parseMetorialPublicProviderHtml(flightHtml(source), "slack")).toThrow("invalid marketplace");
    });
});
