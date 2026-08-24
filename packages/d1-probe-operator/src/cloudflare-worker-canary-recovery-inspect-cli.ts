import { z } from "zod";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import { readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1 } from "./cloudflare-worker-canary-state.js";

const MAX_REQUEST_BYTES_V1 = 512;
const POST_PLAN_CLEANUP_GRACE_MS_V1 = 600_000;

const RequestV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_recovery_inspection_request"),
        plan_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .strict();

const writeLine = async (stream: NodeJS.WritableStream, value: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        stream.write(`${value}\n`, error => (error === null || error === undefined ? resolve() : reject(error)));
    });
};

const fail = async (code: string): Promise<void> => {
    await writeLine(process.stderr, code).catch(() => undefined);
    process.exitCode = 1;
};

const readStream = async (stream: NodeJS.ReadableStream, maximum: number): Promise<Uint8Array | null> => {
    try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.byteLength;
            if (size > maximum) {
                if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
                return null;
            }
            chunks.push(bytes);
        }
        return Buffer.concat(chunks);
    } catch {
        return null;
    }
};

const readCanonicalRequest = async (): Promise<z.infer<typeof RequestV1Schema> | null> => {
    const bytes = await readStream(process.stdin, MAX_REQUEST_BYTES_V1);
    if (bytes === null) return null;
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const input = JSON.parse(text) as unknown;
        const canonical = canonicalizeJsonV1(input as CanonicalJsonValueV1);
        if (text !== canonical && text !== `${canonical}\n`) return null;
        const parsed = RequestV1Schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const main = async (): Promise<void> => {
    if (process.argv.length !== 2) return await fail("usage_error");
    const request = await readCanonicalRequest();
    if (request === null) return await fail("invalid_recovery_inspection_request");

    const state = await readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1(request.plan_digest);
    if (!state.success) {
        return await fail(state.code === "state_not_found" ? "recovery_state_not_found" : "recovery_state_unavailable");
    }

    const automaticCleanupEnd =
        state.operation.plan.expires_at_ms <= Number.MAX_SAFE_INTEGER - POST_PLAN_CLEANUP_GRACE_MS_V1
            ? state.operation.plan.expires_at_ms + POST_PLAN_CLEANUP_GRACE_MS_V1
            : null;
    const now = Date.now();
    const automaticCleanupWindowStatus =
        now < state.operation.plan.not_before_ms
            ? "not_started"
            : automaticCleanupEnd !== null && now < automaticCleanupEnd
              ? "active"
              : "expired";
    const recoveryStatus =
        state.operation.state === "absence_observed"
            ? "no_action_required"
            : state.operation.state === "delete_dispatching"
              ? "delete_outcome_requires_manual_review"
              : state.operation.state === "manual_required"
                ? "manual_review_required"
                : state.operation.state === "cleanup_reconciling"
                  ? "automatic_cleanup_core_unwired"
                  : "credentialed_runner_not_durably_integrated";

    const result = {
        schema_version: 1 as const,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_recovery_inspection" as const,
        plan_digest: state.operation.plan.plan_digest,
        revision: state.operation.revision,
        state: state.operation.state,
        worker_identity_retained: state.operation.worker_id !== null,
        version_identity_retained: state.operation.version_id !== null,
        deployment_identity_retained: state.operation.deployment_id !== null,
        automatic_cleanup_window_status: automaticCleanupWindowStatus,
        recovery_status: recoveryStatus,
        delete_replay_allowed: false as const,
        manual_cleanup_executable: false as const,
        secure_secret_fd_launcher_available: false as const,
        caller_mutation_authority: false as const,
        authoritative: false as const,
        eligible_for_upload: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    await writeLine(process.stdout, canonicalizeJsonV1(result as CanonicalJsonValueV1));
};

try {
    await main();
} catch {
    await fail("recovery_inspection_internal_error");
}
