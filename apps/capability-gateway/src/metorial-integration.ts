export interface MetorialConnectionCatalogV1 {
    readonly display_name: string;
    readonly description: string;
    readonly icon_data_uri: string | null;
}

export interface MetorialConnectedToolV1 {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly description: string | null;
    readonly specificationId: string;
    readonly tags: { readonly destructive: boolean | null; readonly readOnly: boolean | null } | null;
    readonly inputSchema: { readonly schema: Record<string, unknown> } | null;
    readonly outputSchema: { readonly schema: Record<string, unknown> } | null;
}

export interface MetorialCompletedSetupV1 {
    readonly deployment: { readonly id: string; readonly name: string | null };
    readonly authConfig: { readonly id: string; readonly name: string | null } | null;
    readonly credentials: { readonly name: string | null } | null;
    readonly authMethod: unknown | null;
}

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

const sha256 = async (value: unknown): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
};

const boundedText = (value: string, fallback: string, maximumBytes: number): string => {
    const normalized = value.trim().replaceAll(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ");
    const source = normalized.length > 0 ? normalized : fallback;
    if (new TextEncoder().encode(source).byteLength <= maximumBytes) return source;
    const characters = Array.from(source);
    while (characters.length > 0) {
        const candidate = `${characters.join("").trimEnd()}…`;
        if (new TextEncoder().encode(candidate).byteLength <= maximumBytes) return candidate;
        characters.pop();
    }
    return fallback.slice(0, Math.max(1, maximumBytes));
};

export const compileMetorialIntegrationV1 = async (input: {
    readonly integration_id: string;
    readonly provider_identifier: string;
    readonly provider_id: string;
    readonly provider_version_id: string;
    readonly provider_specification_id: string;
    readonly catalog: MetorialConnectionCatalogV1;
    readonly setup: MetorialCompletedSetupV1;
    readonly tools: readonly MetorialConnectedToolV1[];
}) => {
    const revisionDigest = await sha256(input.provider_version_id);
    const permissions = await Promise.all(
        input.tools.map(async tool => {
            const inputSchema = tool.inputSchema?.schema ?? {};
            const outputSchema = tool.outputSchema?.schema ?? {};
            const effect =
                tool.tags?.destructive === true ? "destructive" : tool.tags?.readOnly === true ? "read" : "write";
            const policyIdentity = await sha256({ provider_id: input.provider_id, tool_key: tool.key });
            const policyDocument = {
                provider_id: input.provider_id,
                provider_version_id: input.provider_version_id,
                specification_id: tool.specificationId,
                tool_id: tool.id,
                tool_key: tool.key,
                effect,
                input_schema: inputSchema,
                output_schema: outputSchema,
            };
            return {
                integration_id: input.integration_id,
                policy_id: `policy_${policyIdentity.slice(0, 40)}`,
                display_name: boundedText(tool.name, tool.key, 128),
                tool_key: tool.key,
                effect,
                consequence_summary: boundedText(tool.description ?? tool.name, tool.name, 512),
                resource_scope_summary: boundedText(
                    `Data available to the connected ${input.catalog.display_name} account.`,
                    "Connected account data.",
                    512
                ),
                enabled: true,
                policy_revision: `revision_${revisionDigest.slice(0, 40)}`,
                policy_sha256: await sha256(policyDocument),
                input_schema_sha256: await sha256(inputSchema),
                output_schema_sha256: await sha256(outputSchema),
            } as const;
        })
    );
    const connectedAccountLabel = boundedText(
        input.setup.authConfig?.name ??
            input.setup.credentials?.name ??
            input.setup.deployment.name ??
            input.catalog.display_name,
        input.catalog.display_name,
        512
    );
    return {
        integration_id: input.integration_id,
        provider_identifier: input.provider_identifier,
        provider_deployment_id: input.setup.deployment.id,
        provider_version_id: input.provider_version_id,
        provider_specification_id: input.provider_specification_id,
        auth:
            input.setup.authConfig === null
                ? ({ mode: input.setup.authMethod === null ? "authless" : "deployment" } as const)
                : ({ mode: "user_grant", connection_grant_id: input.setup.authConfig.id } as const),
        connected_account_label: connectedAccountLabel,
        display_name: boundedText(input.catalog.display_name, input.provider_identifier, 128),
        description: boundedText(input.catalog.description, `${input.catalog.display_name} integration`, 512),
        icon_data_uri: input.catalog.icon_data_uri,
        connection_state: "connected" as const,
        permissions,
    };
};
