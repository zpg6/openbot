import { SandboxProtocolError } from "./errors.js";

const encoder = new TextEncoder();

export const utf8ByteLengthV1 = (value: string): number => encoder.encode(value).byteLength;

export const hasUnpairedSurrogateV1 = (value: string): boolean => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
};

export const assertStrictUtf8StringV1 = (value: string, maximumBytes: number, field: string): void => {
    if (hasUnpairedSurrogateV1(value)) {
        throw new SandboxProtocolError("invalid_utf8", `${field} contains an unpaired UTF-16 surrogate`);
    }
    if (utf8ByteLengthV1(value) > maximumBytes) {
        throw new SandboxProtocolError("invalid_request", `${field} exceeds its UTF-8 byte limit`);
    }
};

export const sha256HexV1 = async (value: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
