import { z } from "zod";

export const RECORDED_ITEM2_CORE_BLOCKERS_V1 = Object.freeze([
    "connector_evidence_incomplete",
    "control_store_unverified",
    "gateway_reservation_unverified",
    "metorial_provisioning_unverified",
    "vendor_revocation_unverified",
    "model_route_unverified",
    "runtime_protocol_unverified",
    "code_execution_unverified",
    "identity_store_unverified",
    "jurisdiction_unverified",
] as const);

const expectedRegistryEntries = Object.freeze({
    first_connector: "connector_evidence_incomplete",
    d1_guarded_create: "control_store_unverified",
    gateway_reservation: "gateway_reservation_unverified",
    metorial_provisioning: "metorial_provisioning_unverified",
    metorial_cleanup: "vendor_revocation_unverified",
    openrouter_route: "model_route_unverified",
    runtime_wire_protocol: "runtime_protocol_unverified",
    sandbox_execution: "code_execution_unverified",
    d1_better_auth: "identity_store_unverified",
    jurisdiction: "jurisdiction_unverified",
} as const);

const GateRegistrySchema = z
    .object({
        schema_version: z.literal(1),
        item: z.literal(2),
        gates: z.array(
            z
                .object({
                    id: z.string(),
                    deny_code: z.string(),
                })
                .passthrough()
        ),
    })
    .passthrough();

export const inspectRecordedItem2BlockersV1 = (
    input: unknown
):
    | { success: true; blockers: typeof RECORDED_ITEM2_CORE_BLOCKERS_V1 }
    | { success: false; code: "invalid_gate_registry" } => {
    let parsed: ReturnType<typeof GateRegistrySchema.safeParse>;
    try {
        parsed = GateRegistrySchema.safeParse(input);
    } catch {
        return { success: false, code: "invalid_gate_registry" };
    }
    if (!parsed.success) return { success: false, code: "invalid_gate_registry" };
    const ids = parsed.data.gates.map(gate => gate.id);
    if (new Set(ids).size !== ids.length) {
        return { success: false, code: "invalid_gate_registry" };
    }
    for (const [id, denyCode] of Object.entries(expectedRegistryEntries)) {
        const entry = parsed.data.gates.find(gate => gate.id === id);
        if (!entry || entry.deny_code !== denyCode) return { success: false, code: "invalid_gate_registry" };
    }
    if (Object.keys(expectedRegistryEntries).some(id => !ids.includes(id))) {
        return { success: false, code: "invalid_gate_registry" };
    }
    return { success: true, blockers: RECORDED_ITEM2_CORE_BLOCKERS_V1 };
};
