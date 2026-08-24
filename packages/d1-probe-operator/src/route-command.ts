import { z } from "zod";

import {
    readD1ProbeCloudflareRouteV1,
    type D1ProbeCloudflareRouteReaderDependenciesV1,
    type ReadD1ProbeCloudflareRouteDenialV1,
} from "./cloudflare-route-reader.js";
import { D1ProbePreflightPlanV1Schema, D1ProbePreflightRequestV1Schema } from "./contracts.js";
import { verifyD1ProbePreflightV1 } from "./verified-preflight.js";

const D1ProbeRouteCheckCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_route_check_command"),
        request: D1ProbePreflightRequestV1Schema,
        plan: D1ProbePreflightPlanV1Schema,
    })
    .strict();

export type ExecuteD1ProbeRouteCheckDenialV1 =
    | ReadD1ProbeCloudflareRouteDenialV1
    | "invalid_route_check_command"
    | "invalid_commitment_key"
    | "preflight_recompilation_failed"
    | "preflight_plan_mismatch";

export const executeD1ProbeRouteCheckV1 = async (
    commandInput: unknown,
    hmacKey: string,
    apiToken: string,
    dependencies: D1ProbeCloudflareRouteReaderDependenciesV1
) => {
    let command: z.infer<typeof D1ProbeRouteCheckCommandV1Schema> | null = null;
    try {
        const parsed = D1ProbeRouteCheckCommandV1Schema.safeParse(commandInput);
        command = parsed.success ? parsed.data : null;
    } catch {
        command = null;
    }
    if (command === null) {
        return { success: false as const, code: "invalid_route_check_command" as const };
    }

    const verified = await verifyD1ProbePreflightV1(command.request, command.plan, {
        hmac_key_base64url: hmacKey,
    });
    if (!verified.success) return verified;
    return await readD1ProbeCloudflareRouteV1(verified.verified, { api_token: apiToken }, dependencies);
};
