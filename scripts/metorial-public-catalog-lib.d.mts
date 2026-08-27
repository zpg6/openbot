export interface MetorialPublicCapability {
    readonly capability_id: string;
    readonly specification_id: string;
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly effect: "read" | "write" | "destructive" | "trigger";
    readonly effect_source: "metorial_tags" | "default_write" | "trigger";
    readonly read_only: boolean;
    readonly destructive: boolean;
    readonly constraints: readonly string[];
    readonly instructions: readonly string[];
}

export interface MetorialPublicProviderSummary {
    readonly marketplace_id: string;
    readonly identifier: string;
    readonly display_name: string;
    readonly description: string;
    readonly categories: readonly string[];
    readonly skills: readonly string[];
    readonly official_icon_url: string | null;
    readonly updated_at: string;
}

export interface MetorialPublicProviderDetail extends MetorialPublicProviderSummary {
    readonly provider_id: string;
    readonly global_identifier: string;
    readonly current_version_id: string;
    readonly tools: readonly MetorialPublicCapability[];
    readonly triggers: readonly MetorialPublicCapability[];
}

export function readNextFlightText(html: string): string;
export function readBalancedJsonObject(source: string, start: number): string;
export function parseMetorialPublicCatalogHtml(html: string): readonly MetorialPublicProviderSummary[];
export function parseMetorialPublicProviderHtml(html: string, expectedIdentifier: string): MetorialPublicProviderDetail;
