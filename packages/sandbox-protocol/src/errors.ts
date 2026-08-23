export const SANDBOX_PROTOCOL_ERROR_CODES_V1 = [
    "bytes_after_terminal",
    "digest_mismatch",
    "frame_too_large",
    "invalid_canonical_json",
    "invalid_frame",
    "invalid_request",
    "invalid_utf8",
    "request_digest_mismatch",
    "sequence_mismatch",
    "stream_too_large",
    "terminal_missing",
] as const;

export type SandboxProtocolErrorCodeV1 = (typeof SANDBOX_PROTOCOL_ERROR_CODES_V1)[number];

export class SandboxProtocolError extends Error {
    readonly code: SandboxProtocolErrorCodeV1;

    constructor(code: SandboxProtocolErrorCodeV1, message: string) {
        super(message);
        this.name = "SandboxProtocolError";
        this.code = code;
    }
}
