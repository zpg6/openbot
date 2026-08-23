import { z } from "zod";

const encoder = new TextEncoder();

export const utf8String = (options: { maxBytes: number; minBytes?: number; pattern?: RegExp }) =>
    z.string().superRefine((value, context) => {
        const size = encoder.encode(value).byteLength;
        if (size < (options.minBytes ?? 0) || size > options.maxBytes) {
            context.addIssue({
                code: "custom",
                message: "String has an invalid UTF-8 byte length",
            });
        }
        if (options.pattern && !options.pattern.test(value)) {
            context.addIssue({ code: "custom", message: "String has an invalid format" });
        }
    });

export const EpochMillisecondsSchema = z.number().int().nonnegative().finite();
export type EpochMilliseconds = z.infer<typeof EpochMillisecondsSchema>;

export const PositiveVersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const NonnegativeFenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const Sha256DigestSchema = z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest")
    .brand<"Sha256Digest">();
export type Sha256Digest = z.infer<typeof Sha256DigestSchema>;

export const IdempotencyKeySchema = utf8String({
    minBytes: 16,
    maxBytes: 128,
    pattern: /^[A-Za-z0-9._~-]+$/,
}).brand<"IdempotencyKey">();
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

const unsafeDisplayCharacters = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
export const SafeDisplayLabelSchema = utf8String({ minBytes: 1, maxBytes: 256 })
    .refine(value => value === value.trim(), "Display label cannot have outer whitespace")
    .refine(value => !unsafeDisplayCharacters.test(value), "Display label contains unsafe characters");
export type SafeDisplayLabel = z.infer<typeof SafeDisplayLabelSchema>;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const cloneJsonValue = (input: unknown): JsonValue => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object") throw new TypeError("Value changed while cloning JSON data");

    const root: JsonValue[] | { [key: string]: JsonValue } = Array.isArray(input) ? [] : Object.create(null);
    const seen = new WeakSet<object>([input]);
    const pending: Array<{
        source: object;
        target: JsonValue[] | { [key: string]: JsonValue };
    }> = [{ source: input, target: root }];

    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) break;
        const sourceIsArray = Array.isArray(current.source);
        let arrayLength: number | undefined;
        const copiedIndices = new Set<number>();
        if (sourceIsArray) {
            const lengthDescriptor = Object.getOwnPropertyDescriptor(current.source, "length");
            if (
                !lengthDescriptor ||
                !("value" in lengthDescriptor) ||
                !Number.isSafeInteger(lengthDescriptor.value) ||
                lengthDescriptor.value < 0 ||
                lengthDescriptor.value > 10_000
            ) {
                throw new TypeError("JSON array length changed while cloning");
            }
            arrayLength = lengthDescriptor.value as number;
        }
        for (const key of Reflect.ownKeys(current.source)) {
            if (sourceIsArray && key === "length") continue;
            if (typeof key !== "string") throw new TypeError("JSON key changed while cloning");
            if (sourceIsArray) {
                if (!/^(0|[1-9][0-9]*)$/.test(key)) {
                    throw new TypeError("JSON array gained a non-index property while cloning");
                }
                const index = Number(key);
                if (arrayLength === undefined || index >= arrayLength) {
                    throw new TypeError("JSON array index changed while cloning");
                }
                copiedIndices.add(index);
            }
            const descriptor = Object.getOwnPropertyDescriptor(current.source, key);
            if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                throw new TypeError("JSON field changed while cloning");
            }
            const value = descriptor.value as unknown;
            let cloned: JsonValue;
            if (value === null || typeof value === "string" || typeof value === "boolean") {
                cloned = value;
            } else if (typeof value === "number" && Number.isFinite(value)) {
                cloned = value;
            } else if (typeof value === "object") {
                if (seen.has(value)) throw new TypeError("JSON graph changed while cloning");
                seen.add(value);
                const child: JsonValue[] | { [key: string]: JsonValue } = Array.isArray(value)
                    ? []
                    : Object.create(null);
                cloned = child;
                pending.push({ source: value, target: child });
            } else {
                throw new TypeError("JSON value changed while cloning");
            }
            Object.defineProperty(current.target, key, {
                configurable: true,
                enumerable: true,
                value: cloned,
                writable: true,
            });
        }
        if (sourceIsArray && copiedIndices.size !== arrayLength) {
            throw new TypeError("JSON array became sparse while cloning");
        }
    }
    return root;
};

const validateJsonValue = (
    input: unknown,
    context: z.RefinementCtx,
    limits: { maxDepth: number; maxNodes: number }
): input is JsonValue => {
    const pending: Array<{ depth: number; path: PropertyKey[]; value: unknown }> = [
        { depth: 0, path: [], value: input },
    ];
    const seen = new WeakSet<object>();
    let nodes = 0;

    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) break;
        nodes += 1;
        if (nodes > limits.maxNodes || current.depth > limits.maxDepth) {
            context.addIssue({
                code: "custom",
                path: current.path,
                message: "JSON value exceeds its structural limit",
            });
            return false;
        }
        const value = current.value;
        if (value === null || typeof value === "string" || typeof value === "boolean") continue;
        if (typeof value === "number") {
            if (Number.isFinite(value)) continue;
            context.addIssue({ code: "custom", path: current.path, message: "JSON number must be finite" });
            return false;
        }
        if (typeof value !== "object") {
            context.addIssue({ code: "custom", path: current.path, message: "Value is not JSON data" });
            return false;
        }
        if (seen.has(value)) {
            context.addIssue({ code: "custom", path: current.path, message: "JSON data cannot contain a cycle" });
            return false;
        }
        seen.add(value);

        if (Array.isArray(value)) {
            const keys = Reflect.ownKeys(value);
            if (
                keys.some(
                    key =>
                        key !== "length" &&
                        (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
                )
            ) {
                context.addIssue({
                    code: "custom",
                    path: current.path,
                    message: "JSON array has a non-index property",
                });
                return false;
            }
            for (let index = 0; index < value.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                    context.addIssue({ code: "custom", path: current.path, message: "JSON arrays cannot be sparse" });
                    return false;
                }
                pending.push({ depth: current.depth + 1, path: [...current.path, index], value: descriptor.value });
            }
            continue;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            context.addIssue({
                code: "custom",
                path: current.path,
                message: "JSON object must have a plain prototype",
            });
            return false;
        }
        for (const key of Reflect.ownKeys(value)) {
            if (typeof key !== "string") {
                context.addIssue({ code: "custom", path: current.path, message: "JSON object keys must be strings" });
                return false;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                context.addIssue({
                    code: "custom",
                    path: [...current.path, key],
                    message: "JSON fields must be enumerable data properties",
                });
                return false;
            }
            pending.push({ depth: current.depth + 1, path: [...current.path, key], value: descriptor.value });
        }
    }
    return true;
};

export const JsonValueSchema: z.ZodType<JsonValue> = z
    .unknown()
    .superRefine((value, context) => {
        try {
            validateJsonValue(value, context, { maxDepth: 64, maxNodes: 10_000 });
        } catch {
            context.addIssue({ code: "custom", message: "Value cannot be inspected as JSON data" });
        }
    })
    .transform((value, context) => {
        try {
            return cloneJsonValue(value);
        } catch {
            context.addIssue({ code: "custom", message: "Value changed while copying JSON data" });
            return z.NEVER;
        }
    }) as z.ZodType<JsonValue>;

export const boundedJsonValue = (options: { maxBytes: number; maxDepth: number; maxNodes: number }) =>
    JsonValueSchema.superRefine((value, context) => {
        try {
            if (!validateJsonValue(value, context, options)) return;
            const bytes = encoder.encode(JSON.stringify(value)).byteLength;
            if (bytes > options.maxBytes) {
                context.addIssue({ code: "custom", message: "JSON value exceeds the UTF-8 byte limit" });
            }
        } catch {
            context.addIssue({ code: "custom", message: "JSON value cannot be inspected or serialized" });
        }
    });

export const DataClassV1Schema = z.enum(["public", "synthetic", "organization", "restricted", "unknown"]);
export type DataClassV1 = z.infer<typeof DataClassV1Schema>;

export const DisclosureDestinationV1Schema = z.enum([
    "metorial",
    "openrouter",
    "model_provider",
    "connector_provider",
    "cloudflare_sandbox",
]);
export type DisclosureDestinationV1 = z.infer<typeof DisclosureDestinationV1Schema>;
