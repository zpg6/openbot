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
