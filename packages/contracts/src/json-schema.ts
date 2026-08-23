import { z } from "zod";
import { JsonValueSchema, type JsonValue } from "./primitives.js";

export const JSON_SCHEMA_SUBSET_LIMITS_V1 = Object.freeze({
    max_bytes: 16 * 1024,
    max_depth: 12,
    max_properties: 128,
    max_refs: 32,
} as const);

const allowedKeys = new Set([
    "$schema",
    "$ref",
    "$defs",
    "type",
    "title",
    "description",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
    "minimum",
    "maximum",
    "enum",
    "const",
]);
const types = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);
const refPrefix = "#/$defs/";
const encoder = new TextEncoder();

export type JsonSchemaSubsetV1 = Record<string, JsonValue>;

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const addIssue = (context: z.RefinementCtx, path: PropertyKey[], message: string): void => {
    context.addIssue({ code: "custom", path, message });
};

const validateSchema = (root: Record<string, unknown>, context: z.RefinementCtx): void => {
    let propertyCount = 0;
    let refCount = 0;
    const references = new Map<string, string[]>();
    const definitions = isObject(root["$defs"]) ? root["$defs"] : {};

    const visit = (schema: unknown, path: PropertyKey[], depth: number, owner: string): void => {
        if (!isObject(schema)) {
            addIssue(context, path, "Schema node must be an object");
            return;
        }
        if (depth > JSON_SCHEMA_SUBSET_LIMITS_V1.max_depth) {
            addIssue(context, path, "Schema exceeds the maximum depth");
            return;
        }

        for (const key of Object.keys(schema)) {
            if (!allowedKeys.has(key)) addIssue(context, [...path, key], "Unsupported JSON Schema keyword");
        }
        if (schema["$schema"] !== undefined && schema["$schema"] !== "https://json-schema.org/draft/2020-12/schema") {
            addIssue(context, [...path, "$schema"], "Unsupported JSON Schema draft");
        }
        if (schema["type"] !== undefined && (typeof schema["type"] !== "string" || !types.has(schema["type"]))) {
            addIssue(context, [...path, "type"], "Unsupported JSON Schema type");
        }
        for (const key of ["title", "description"] as const) {
            const value = schema[key];
            const maximum = key === "title" ? 256 : 2_048;
            if (value !== undefined && (typeof value !== "string" || encoder.encode(value).byteLength > maximum)) {
                addIssue(context, [...path, key], `${key} must be a string within its UTF-8 byte limit`);
            }
        }
        if (schema["$ref"] !== undefined) {
            refCount += 1;
            if (typeof schema["$ref"] !== "string" || !schema["$ref"].startsWith(refPrefix)) {
                addIssue(context, [...path, "$ref"], "Only local $defs references are supported");
            } else {
                const name = schema["$ref"].slice(refPrefix.length);
                if (!name || name.includes("/") || !Object.hasOwn(definitions, name)) {
                    addIssue(context, [...path, "$ref"], "Reference does not name a local definition");
                } else {
                    references.set(owner, [...(references.get(owner) ?? []), name]);
                }
            }
            const refSiblings = Object.keys(schema).filter(key => !["$ref", "title", "description"].includes(key));
            if (refSiblings.length > 0) {
                addIssue(context, path, "$ref may have only title and description siblings");
            }
        }
        if (schema["properties"] !== undefined) {
            if (!isObject(schema["properties"])) {
                addIssue(context, [...path, "properties"], "Properties must be an object");
            } else {
                const entries = Object.entries(schema["properties"]);
                propertyCount += entries.length;
                for (const [name, child] of entries) {
                    if (name.length === 0 || encoder.encode(name).byteLength > 128) {
                        addIssue(context, [...path, "properties", name], "Property name exceeds 128 UTF-8 bytes");
                    }
                    visit(child, [...path, "properties", name], depth + 1, owner);
                }
            }
        }
        if (schema["$defs"] !== undefined) {
            if (!isObject(schema["$defs"])) {
                addIssue(context, [...path, "$defs"], "$defs must be an object");
            } else if (path.length !== 0) {
                addIssue(context, [...path, "$defs"], "$defs is allowed only at the root");
            } else {
                for (const [name, child] of Object.entries(schema["$defs"])) {
                    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
                        addIssue(context, ["$defs", name], "Definition name has an invalid format");
                    }
                    visit(child, ["$defs", name], depth + 1, name);
                }
            }
        }
        if (schema["items"] !== undefined) {
            visit(schema["items"], [...path, "items"], depth + 1, owner);
        }
        if (schema["additionalProperties"] !== undefined && schema["additionalProperties"] !== false) {
            visit(schema["additionalProperties"], [...path, "additionalProperties"], depth + 1, owner);
        }
        const required = schema["required"];
        const properties = schema["properties"];
        if (required !== undefined) {
            if (
                !Array.isArray(required) ||
                required.some(item => typeof item !== "string") ||
                new Set(required).size !== required.length
            ) {
                addIssue(context, [...path, "required"], "Required fields must be unique strings");
            } else if (isObject(properties) && required.some(item => !Object.hasOwn(properties, item as string))) {
                addIssue(context, [...path, "required"], "Required fields must exist in properties");
            }
        }
        for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]) {
            const value = schema[key];
            if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
                addIssue(context, [...path, key], "Bound must be a nonnegative safe integer");
            }
        }
        for (const key of ["minimum", "maximum"]) {
            const value = schema[key];
            if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
                addIssue(context, [...path, key], "Numeric bound must be finite");
            }
        }
        if (
            schema["enum"] !== undefined &&
            (!Array.isArray(schema["enum"]) || schema["enum"].length === 0 || schema["enum"].length > 64)
        ) {
            addIssue(context, [...path, "enum"], "Enum must contain between 1 and 64 values");
        }
        if (
            typeof schema["minimum"] === "number" &&
            typeof schema["maximum"] === "number" &&
            schema["minimum"] > schema["maximum"]
        ) {
            addIssue(context, path, "Minimum cannot exceed maximum");
        }
        for (const [minimumKey, maximumKey] of [
            ["minLength", "maxLength"],
            ["minItems", "maxItems"],
            ["minProperties", "maxProperties"],
        ] as const) {
            const minimum = schema[minimumKey];
            const maximum = schema[maximumKey];
            if (typeof minimum === "number" && typeof maximum === "number" && minimum > maximum) {
                addIssue(context, path, `${minimumKey} cannot exceed ${maximumKey}`);
            }
        }
    };

    visit(root, [], 0, "#root");
    if (propertyCount > JSON_SCHEMA_SUBSET_LIMITS_V1.max_properties) {
        addIssue(context, [], "Schema exceeds the property limit");
    }
    if (refCount > JSON_SCHEMA_SUBSET_LIMITS_V1.max_refs) {
        addIssue(context, [], "Schema exceeds the reference limit");
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const findCycle = (name: string): boolean => {
        if (visiting.has(name)) return true;
        if (visited.has(name)) return false;
        visiting.add(name);
        for (const target of references.get(name) ?? []) {
            if (findCycle(target)) return true;
        }
        visiting.delete(name);
        visited.add(name);
        return false;
    };
    for (const name of ["#root", ...Object.keys(definitions)]) {
        if (findCycle(name)) {
            addIssue(context, [], "Recursive JSON Schema references are not supported");
            break;
        }
    }
};

export const JsonSchemaSubsetV1Schema: z.ZodType<JsonSchemaSubsetV1> = z
    .record(z.string(), z.unknown())
    .superRefine((schema, context) => {
        const jsonValue = JsonValueSchema.safeParse(schema);
        if (!jsonValue.success) {
            addIssue(context, [], "Schema contains a value that JSON cannot represent");
            return;
        }
        let encoded: Uint8Array;
        try {
            encoded = encoder.encode(JSON.stringify(schema));
        } catch {
            addIssue(context, [], "Schema must be JSON serializable");
            return;
        }
        if (encoded.byteLength > JSON_SCHEMA_SUBSET_LIMITS_V1.max_bytes) {
            addIssue(context, [], "Schema exceeds the UTF-8 byte limit");
            return;
        }
        validateSchema(schema, context);
    }) as z.ZodType<JsonSchemaSubsetV1>;
