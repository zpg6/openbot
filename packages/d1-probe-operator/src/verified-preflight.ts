import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import {
    D1ProbeCommitmentKeyV1Schema,
    D1ProbePreflightPlanV1Schema,
    D1ProbePreflightRequestV1Schema,
    type D1ProbePreflightPlanV1,
    type D1ProbePreflightRequestV1,
} from "./contracts.js";
import { compileD1ProbePreflightPlanV1 } from "./preflight.js";

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

export interface VerifiedD1ProbePreflightV1 {
    readonly schema_version: 1;
    readonly kind: "verified_d1_probe_preflight";
}

export interface VerifiedD1ProbePreflightContextV1 {
    readonly request: DeepReadonly<D1ProbePreflightRequestV1>;
    readonly plan: DeepReadonly<D1ProbePreflightPlanV1>;
}

export type VerifyD1ProbePreflightDenialV1 =
    | "invalid_preflight_request"
    | "invalid_preflight_plan"
    | "invalid_commitment_key"
    | "preflight_recompilation_failed"
    | "preflight_plan_mismatch";

const verifiedContexts = new WeakMap<VerifiedD1ProbePreflightV1, VerifiedD1ProbePreflightContextV1>();

const deepFreeze = <T>(value: T): DeepReadonly<T> => {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value as DeepReadonly<T>;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value) as DeepReadonly<T>;
};

const parse = <T>(
    schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
    input: unknown
) => {
    try {
        const result = schema.safeParse(input);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

export const verifyD1ProbePreflightV1 = async (
    requestInput: unknown,
    planInput: unknown,
    commitmentKeyInput: unknown
): Promise<
    | Readonly<{ success: true; verified: VerifiedD1ProbePreflightV1 }>
    | Readonly<{ success: false; code: VerifyD1ProbePreflightDenialV1 }>
> => {
    const request = parse(D1ProbePreflightRequestV1Schema, requestInput);
    if (request === null) return { success: false, code: "invalid_preflight_request" };
    const plan = parse(D1ProbePreflightPlanV1Schema, planInput);
    if (plan === null) return { success: false, code: "invalid_preflight_plan" };
    const commitmentKey = parse(D1ProbeCommitmentKeyV1Schema, commitmentKeyInput);
    if (commitmentKey === null) return { success: false, code: "invalid_commitment_key" };

    const recompiled = await compileD1ProbePreflightPlanV1(request, commitmentKey);
    if (!recompiled.success) {
        return {
            success: false,
            code:
                recompiled.code === "invalid_commitment_key"
                    ? "invalid_commitment_key"
                    : recompiled.code === "invalid_preflight_request"
                      ? "invalid_preflight_request"
                      : "preflight_recompilation_failed",
        };
    }

    let suppliedBytes: string;
    let recompiledBytes: string;
    try {
        suppliedBytes = canonicalizeJsonV1(plan as CanonicalJsonValueV1);
        recompiledBytes = canonicalizeJsonV1(recompiled.plan as CanonicalJsonValueV1);
    } catch {
        return { success: false, code: "preflight_recompilation_failed" };
    }
    if (suppliedBytes !== recompiledBytes) return { success: false, code: "preflight_plan_mismatch" };

    const context = deepFreeze({
        request: structuredClone(request),
        plan: structuredClone(recompiled.plan),
    });
    const verified = Object.freeze({
        schema_version: 1 as const,
        kind: "verified_d1_probe_preflight" as const,
    });
    verifiedContexts.set(verified, context);
    return { success: true, verified };
};

export const resolveVerifiedD1ProbePreflightV1 = (
    verified: VerifiedD1ProbePreflightV1
): VerifiedD1ProbePreflightContextV1 | null => verifiedContexts.get(verified) ?? null;
