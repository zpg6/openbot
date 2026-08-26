export interface CatalogIcon {
    readonly slug: string;
    readonly title: string;
    readonly aliases?: readonly string[];
    readonly variants?: Readonly<Record<string, unknown>> | readonly string[] | null;
    readonly [key: string]: unknown;
}

export interface CatalogProvider {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
}

export interface CatalogIconIndexes {
    readonly bySlug: Map<string, CatalogIcon>;
    readonly byCandidate: Map<string, CatalogIcon[]>;
}

export interface MetorialSdkListPage<T extends { readonly id: string }> {
    readonly items: readonly T[];
    readonly pagination: { readonly hasMoreAfter: boolean };
}

export interface MetorialIntegrationCatalogEntry {
    readonly identifier: string;
    readonly package_name: string;
    readonly manifest_version: string | null;
    readonly display_name: string;
    readonly description: string;
    readonly categories: readonly string[];
    readonly skills: readonly string[];
    readonly official_logo_url: string | null;
    readonly repository_logo_path: string | null;
}

export function parseMetorialReadmeDisplayName(readme: string): string;
export function parseMetorialIntegrationManifest(input: {
    readonly directoryName: string;
    readonly manifest: unknown;
    readonly readme: string;
}): MetorialIntegrationCatalogEntry;

export function paginateMetorialSdk<T extends { readonly id: string }>(input: {
    readonly resourceName: string;
    readonly requestPage: (query: {
        readonly limit: number;
        readonly after?: string;
    }) => Promise<MetorialSdkListPage<T>>;
    readonly maxPages?: number;
}): Promise<readonly T[]>;

export function normalizeIconCandidate(value: string): string;
export function parseReviewedProviderIconMap(value: unknown): Map<string, string>;
export function buildIconIndexes(icons: readonly unknown[]): CatalogIconIndexes;
export function resolveProviderIcon(
    provider: CatalogProvider,
    indexes: CatalogIconIndexes,
    reviewedMap: ReadonlyMap<string, string>
): { readonly icon: CatalogIcon | null; readonly suggestion: CatalogIcon | null };
export function defaultVariantPath(icon: CatalogIcon): string | null;
export function safeSvg(bytes: Uint8Array): string;
