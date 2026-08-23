import { SandboxProtocolError } from "./errors.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;

const canonicalize = (value: JsonValue, depth: number, state: { nodes: number }): string => {
    state.nodes += 1;
    if (depth > MAX_JSON_DEPTH || state.nodes > MAX_JSON_NODES) {
        throw new SandboxProtocolError("invalid_canonical_json", "JSON exceeds its structural limit");
    }
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new SandboxProtocolError("invalid_canonical_json", "JSON number must be finite");
        }
        return JSON.stringify(value);
    }
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(item => canonicalize(item, depth + 1, state)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys
        .map(key => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue, depth + 1, state)}`)
        .join(",")}}`;
};

export const assertCanonicalJsonV1 = (input: string): void => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(input) as unknown;
    } catch {
        throw new SandboxProtocolError("invalid_canonical_json", "Input must be valid JSON");
    }
    let canonical: string;
    try {
        canonical = canonicalize(parsed as JsonValue, 0, { nodes: 0 });
    } catch (error) {
        if (error instanceof SandboxProtocolError) throw error;
        throw new SandboxProtocolError("invalid_canonical_json", "Input must contain only JSON values");
    }
    if (canonical !== input) {
        throw new SandboxProtocolError("invalid_canonical_json", "Input must use canonical JSON encoding");
    }
};
