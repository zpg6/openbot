import { z } from "zod";

import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import {
    D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
    runD1ProbeCloudflareWorkerApiCanaryV1,
    type UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1,
} from "./cloudflare-worker-interoperability-canary.js";
import {
    reserveD1ProbeCloudflareWorkerCanaryPlanV1,
    type D1ProbeCloudflareWorkerCanaryReservationResultV1,
} from "./cloudflare-worker-canary-reservation.js";
import { D1ProbeCommitmentKeyV1Schema } from "./contracts.js";

const ApiTokenV1Schema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u);
const KEY_ID_DOMAIN_V1 = "openbot.d1-probe.commitment-key-id.v1";
const PLAN_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1";
const PLAN_WINDOW_MAX_MS_V1 = 300_000;

const CommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_command"),
        plan: D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
    })
    .strict();

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const encodeBase64Url = (bytes: Uint8Array): string =>
    globalThis
        .btoa(String.fromCharCode(...bytes))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");

const decodeBase64Url = (value: string): Uint8Array | null => {
    try {
        const padding = "=".repeat((4 - (value.length % 4)) % 4);
        const binary = globalThis.atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + padding);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return encodeBase64Url(bytes) === value ? bytes : null;
    } catch {
        return null;
    }
};

const deriveCommitmentKeyIdV1 = async (hmacKeyInput: unknown): Promise<string | null> => {
    let parsed: ReturnType<typeof D1ProbeCommitmentKeyV1Schema.safeParse>;
    try {
        parsed = D1ProbeCommitmentKeyV1Schema.safeParse(hmacKeyInput);
    } catch {
        return null;
    }
    if (!parsed.success) return null;
    const raw = decodeBase64Url(parsed.data.hmac_key_base64url);
    if (raw === null || raw.byteLength < 32 || raw.byteLength > 64) return null;
    try {
        const domain = new TextEncoder().encode(`${KEY_ID_DOMAIN_V1}\u0000`);
        const preimage = new Uint8Array(domain.byteLength + raw.byteLength);
        preimage.set(domain);
        preimage.set(raw, domain.byteLength);
        return toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(preimage)));
    } catch {
        return null;
    } finally {
        raw.fill(0);
    }
};

type CoreRunnerV1 = typeof runD1ProbeCloudflareWorkerApiCanaryV1;

export interface D1ProbeCloudflareWorkerCanaryCommandDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
    readonly now: () => number;
    readonly run?: CoreRunnerV1;
    readonly reserve?: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryReservationResultV1>;
    readonly shouldTerminate?: () => boolean;
}

export type ExecuteD1ProbeCloudflareWorkerCanaryCommandDenialV1 =
    | "invalid_canary_command"
    | "invalid_canary_plan"
    | "invalid_commitment_key"
    | "commitment_key_id_mismatch"
    | "invalid_api_token"
    | "canary_plan_not_active"
    | "canary_plan_already_consumed"
    | "canary_reservation_unavailable";

export const classifyD1ProbeCloudflareWorkerCanaryProcessOutcomeV1 = (
    result: UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1,
    interrupted = false
): { readonly exit_code: 0 | 2 | 3 | 130; readonly stderr_code: string | null } => {
    if (interrupted) return { exit_code: 130, stderr_code: "worker_api_canary_interrupted" };
    if (result.status === "observed_candidate" && result.cleanup_status === "control_plane_absence_observed") {
        return { exit_code: 0, stderr_code: null };
    }
    if (result.status === "manual_required" || result.cleanup_status === "manual_required") {
        return { exit_code: 2, stderr_code: "worker_api_canary_manual_required" };
    }
    return { exit_code: 3, stderr_code: "worker_api_canary_inconclusive" };
};

export const executeD1ProbeCloudflareWorkerCanaryCommandV1 = async (
    commandInput: unknown,
    hmacKey: string,
    apiToken: string,
    dependencies: D1ProbeCloudflareWorkerCanaryCommandDependenciesV1
) => {
    let command: z.infer<typeof CommandV1Schema> | null = null;
    try {
        const parsed = CommandV1Schema.safeParse(commandInput);
        command = parsed.success ? parsed.data : null;
    } catch {
        command = null;
    }
    if (command === null) return { success: false as const, code: "invalid_canary_command" as const };

    const { plan_digest: _claimedPlanDigest, ...unsignedPlan } = command.plan;
    const planDigest = await digestCanonicalJsonV1(PLAN_DIGEST_DOMAIN_V1, unsignedPlan as CanonicalJsonValueV1);
    if (planDigest === null || planDigest !== command.plan.plan_digest) {
        return { success: false as const, code: "invalid_canary_plan" as const };
    }

    const keyIdDigest = await deriveCommitmentKeyIdV1({ hmac_key_base64url: hmacKey });
    if (keyIdDigest === null) return { success: false as const, code: "invalid_commitment_key" as const };
    if (keyIdDigest !== command.plan.commitment_key_id_digest) {
        return { success: false as const, code: "commitment_key_id_mismatch" as const };
    }
    if (!ApiTokenV1Schema.safeParse(apiToken).success) {
        return { success: false as const, code: "invalid_api_token" as const };
    }

    let now: number;
    try {
        now = dependencies.now();
    } catch {
        return { success: false as const, code: "canary_plan_not_active" as const };
    }
    if (
        !Number.isSafeInteger(now) ||
        command.plan.expires_at_ms - command.plan.not_before_ms > PLAN_WINDOW_MAX_MS_V1 ||
        now < command.plan.not_before_ms ||
        now >= command.plan.expires_at_ms
    ) {
        return { success: false as const, code: "canary_plan_not_active" as const };
    }

    let reservation: D1ProbeCloudflareWorkerCanaryReservationResultV1;
    try {
        reservation = await (dependencies.reserve ?? reserveD1ProbeCloudflareWorkerCanaryPlanV1)(
            command.plan.plan_digest
        );
    } catch {
        reservation = "reservation_unavailable";
    }
    if (reservation === "already_reserved") {
        return { success: false as const, code: "canary_plan_already_consumed" as const };
    }
    if (reservation !== "reserved") {
        return { success: false as const, code: "canary_reservation_unavailable" as const };
    }

    const run = dependencies.run ?? runD1ProbeCloudflareWorkerApiCanaryV1;
    return await run(
        command.plan,
        { api_token: apiToken },
        { hmac_key_base64url: hmacKey },
        {
            fetch: dependencies.fetch,
            now: dependencies.now,
            ...(dependencies.shouldTerminate === undefined ? {} : { shouldTerminate: dependencies.shouldTerminate }),
        }
    );
};
