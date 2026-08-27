const PUBLIC_PROVIDER_PREFIX = "plg_";
const PROVIDER_ID_PREFIX = "pro_";
const PROVIDER_VERSION_PREFIX = "prv_";
const TOOL_OBJECT = "marketplace#provider.tool";
const TRIGGER_OBJECT = "marketplace#provider.trigger";

const safeText = (value, maximumLength) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

const cleanText = value => value.replaceAll(/\s+/gu, " ").trim();

const safeIdentifier = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
const safeCapabilityKey = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/u.test(value);

const dateValue = value => {
    if (typeof value !== "string") return null;
    const candidate = value.startsWith("$D") ? value.slice(2) : value;
    const timestamp = Date.parse(candidate);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const publicImageUrl = value => {
    if (typeof value !== "string" || value.length > 4_096) return null;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }
    const allowedHosts = new Set([
        "avatar-cdn.metorial.com",
        "camo.metorial-cdn.com",
        "cdn.metorial.com",
        "provider-logos.metorial-cdn.com",
    ]);
    if (
        parsed.protocol !== "https:" ||
        !allowedHosts.has(parsed.hostname) ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.port !== "" ||
        parsed.hash !== ""
    ) {
        return null;
    }
    return parsed.toString();
};

export const readNextFlightText = html => {
    if (typeof html !== "string" || html.length < 1 || html.length > 64 * 1024 * 1024) {
        throw new Error("Metorial public catalog page must be UTF-8 text under 64 MiB");
    }
    const chunks = [];
    for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/gu)) {
        let payload;
        try {
            payload = JSON.parse(match[1]);
        } catch {
            continue;
        }
        if (Array.isArray(payload) && typeof payload[1] === "string") chunks.push(payload[1]);
    }
    if (chunks.length === 0) throw new Error("Metorial public catalog page did not contain React Flight data");
    // React Flight text chunks are byte-contiguous. A boundary can fall inside
    // a JSON property name or string, so inserting a separator corrupts data.
    return chunks.join("");
};

export const readBalancedJsonObject = (source, start) => {
    if (source[start] !== "{") throw new Error("balanced JSON extraction must start at an object");
    let depth = 0;
    let insideString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (insideString) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') insideString = false;
            continue;
        }
        if (character === '"') insideString = true;
        else if (character === "{") depth += 1;
        else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error("Metorial public catalog contained an unterminated JSON object");
};

const objectsWithMarker = (source, marker) => {
    const values = [];
    let offset = 0;
    while ((offset = source.indexOf(marker, offset)) >= 0) {
        const object = JSON.parse(readBalancedJsonObject(source, offset));
        values.push(object);
        offset += marker.length;
    }
    return values;
};

const categorySlugs = value => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(category => category?.slug).filter(safeIdentifier))].sort();
};

const stringList = (value, maximumItems, maximumLength) => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(item => safeText(item, maximumLength)).map(item => cleanText(item)))].slice(
        0,
        maximumItems
    );
};

const summaryProvider = value => {
    if (
        value === null ||
        typeof value !== "object" ||
        typeof value.id !== "string" ||
        !value.id.startsWith(PUBLIC_PROVIDER_PREFIX) ||
        !safeIdentifier(value.slug) ||
        !safeText(value.name, 160) ||
        !safeText(value.description, 16_384)
    ) {
        throw new Error("Metorial public catalog contained an invalid provider summary");
    }
    const updatedAt = dateValue(value.updatedAt);
    if (updatedAt === null) throw new Error(`Metorial public provider ${value.slug} had an invalid update time`);
    return {
        marketplace_id: value.id,
        identifier: value.slug,
        display_name: cleanText(value.name),
        description: cleanText(value.description),
        categories: categorySlugs(value.categories),
        skills: stringList(value.skills, 128, 512),
        official_icon_url: publicImageUrl(value.imageUrl),
        updated_at: updatedAt,
    };
};

export const parseMetorialPublicCatalogHtml = html => {
    const flight = readNextFlightText(html);
    const providers = objectsWithMarker(flight, '{"id":"plg_').map(summaryProvider);
    const byId = new Map();
    for (const provider of providers) {
        const existing = byId.get(provider.marketplace_id);
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(provider)) {
            throw new Error(`Metorial public provider ${provider.marketplace_id} appeared with conflicting metadata`);
        }
        byId.set(provider.marketplace_id, provider);
    }
    const unique = [...byId.values()].sort((left, right) => left.identifier.localeCompare(right.identifier));
    if (unique.length < 1_000 || new Set(unique.map(provider => provider.identifier)).size !== unique.length) {
        throw new Error("Metorial public catalog was unexpectedly small or contained duplicate identifiers");
    }
    return unique;
};

const capability = (value, objectKind, providerId) => {
    if (
        value === null ||
        typeof value !== "object" ||
        value.object !== objectKind ||
        typeof value.id !== "string" ||
        typeof value.specificationId !== "string" ||
        value.providerId !== providerId ||
        !safeCapabilityKey(value.key) ||
        !safeText(value.name, 160) ||
        !safeText(value.description, 16_384)
    ) {
        throw new Error(`Metorial public provider contained an invalid ${objectKind}`);
    }
    const serializedTags = value.tags;
    const tags =
        serializedTags === undefined || serializedTags === "$undefined" || serializedTags === null
            ? {}
            : serializedTags;
    if (objectKind === TRIGGER_OBJECT && Object.keys(tags).length === 0) {
        return {
            capability_id: value.id,
            specification_id: value.specificationId,
            key: value.key,
            name: cleanText(value.name),
            description: cleanText(value.description),
            effect: "trigger",
            effect_source: "trigger",
            read_only: false,
            destructive: false,
            constraints: [],
            instructions: [],
        };
    }
    if (
        typeof tags !== "object" ||
        (tags.readOnly !== undefined && typeof tags.readOnly !== "boolean") ||
        (tags.destructive !== undefined && typeof tags.destructive !== "boolean")
    ) {
        throw new Error(`Metorial public capability ${value.key} had invalid effect tags`);
    }
    const readOnly = tags.readOnly === true;
    const destructive = tags.destructive === true;
    const effect = destructive ? "destructive" : readOnly ? "read" : "write";
    return {
        capability_id: value.id,
        specification_id: value.specificationId,
        key: value.key,
        name: cleanText(value.name),
        description: cleanText(value.description),
        effect,
        effect_source: Object.keys(tags).length === 0 ? "default_write" : "metorial_tags",
        read_only: readOnly,
        destructive,
        constraints: stringList(value.constraints, 64, 2_048),
        instructions: stringList(value.instructions, 64, 2_048),
    };
};

export const parseMetorialPublicProviderHtml = (html, expectedIdentifier) => {
    const flight = readNextFlightText(html);
    const providerCandidates = objectsWithMarker(flight, '{"id":"plg_').filter(
        value => value?.slug === expectedIdentifier && typeof value?.providerId === "string"
    );
    if (providerCandidates.length !== 1) {
        throw new Error(`Metorial public detail for ${expectedIdentifier} did not contain one provider record`);
    }
    const value = providerCandidates[0];
    if (
        !value.providerId.startsWith(PROVIDER_ID_PREFIX) ||
        typeof value.currentVersionId !== "string" ||
        !value.currentVersionId.startsWith(PROVIDER_VERSION_PREFIX) ||
        !safeText(value.globalIdentifier, 256)
    ) {
        throw new Error(`Metorial public detail for ${expectedIdentifier} had invalid runtime identifiers`);
    }
    const summary = summaryProvider(value);
    const tools = objectsWithMarker(flight, `{"object":"${TOOL_OBJECT}"`).map(tool =>
        capability(tool, TOOL_OBJECT, value.providerId)
    );
    const triggers = objectsWithMarker(flight, `{"object":"${TRIGGER_OBJECT}"`).map(trigger =>
        capability(trigger, TRIGGER_OBJECT, value.providerId)
    );
    const uniqueCapabilities = (values, label) => {
        const byId = new Map(values.map(item => [item.capability_id, item]));
        if (byId.size !== values.length || new Set(values.map(item => item.key)).size !== values.length) {
            throw new Error(`Metorial public provider ${expectedIdentifier} contained duplicate ${label}`);
        }
        return [...values].sort((left, right) => left.name.localeCompare(right.name));
    };
    return {
        ...summary,
        provider_id: value.providerId,
        global_identifier: value.globalIdentifier,
        current_version_id: value.currentVersionId,
        tools: uniqueCapabilities(tools, "tools"),
        triggers: uniqueCapabilities(triggers, "triggers"),
    };
};
