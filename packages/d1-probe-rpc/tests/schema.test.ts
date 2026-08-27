import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import * as rpc from "../src/index.js";
import {
    D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_TABLE_NAMES_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_TRIGGERS_V1,
} from "../src/schema.js";

const expectedTables = [
    "_openbot_probe_authority",
    "_openbot_probe_slot",
    "_openbot_probe_confirmation",
    "_openbot_probe_run",
    "_openbot_probe_run_guard",
    "_openbot_probe_outbox",
    "_openbot_probe_gateway_budget",
    "_openbot_probe_gateway_call",
    "_openbot_probe_gateway_guard",
    "_openbot_probe_gateway_sink_receipt",
    "_openbot_probe_external_sink_receipt",
    "_openbot_probe_external_trial",
    "_openbot_probe_external_trial_assignment",
    "_openbot_probe_external_trial_readiness",
    "_openbot_probe_external_trial_readiness_guard",
    "_openbot_probe_external_gateway_budget",
    "_openbot_probe_external_gateway_reservation",
    "_openbot_probe_external_gateway_guard",
    "_openbot_probe_capacity",
    "_openbot_probe_sandbox_lease",
    "_openbot_probe_capacity_guard",
    "_openbot_probe_capacity_release",
    "_openbot_probe_destroy_observation",
    "_openbot_probe_destroy_observation_guard",
    "_openbot_probe_capacity_release_guard",
    "_openbot_probe_audit_head",
    "_openbot_probe_audit_event",
    "_openbot_probe_audit_guard",
] as const;

describe("disposable D1 probe schema", () => {
    it("pins the exact DDL digest", () => {
        const digest = `sha256:${createHash("sha256").update(D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1).digest("hex")}`;

        expect(D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1).toBe(
            "sha256:af03a7328447a2a254ce93ea6d66f912399645e610efe1422380c2f55e1aadad"
        );
        expect(digest).toBe(D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1);
    });

    it("pins every disposable table and trigger", () => {
        const tables = [...D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z0-9_]+)/gu)].map(
            match => match[1]
        );
        const triggers = [
            ...D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1.matchAll(/CREATE TRIGGER IF NOT EXISTS ([a-z0-9_]+)/gu),
        ].map(match => match[1]);

        expect(tables).toEqual(expectedTables);
        expect(triggers).toEqual(["_openbot_probe_audit_append_guard", "_openbot_probe_audit_advance_head"]);
        expect(D1_DISPOSABLE_PROBE_SCHEMA_TABLE_NAMES_V1).toEqual(expectedTables);
        expect(D1_DISPOSABLE_PROBE_SCHEMA_TRIGGERS_V1).toEqual([
            { name: "_openbot_probe_audit_append_guard", tbl_name: "_openbot_probe_audit_event" },
            { name: "_openbot_probe_audit_advance_head", tbl_name: "_openbot_probe_audit_event" },
        ]);
        expect(D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1).toHaveLength(expectedTables.length + triggers.length);
        expect(D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1).toHaveLength(D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1.length);
        expect(Object.isFrozen(D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1)).toBe(true);
        expect(Object.isFrozen(D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1)).toBe(true);
        expect(D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1.every(Object.isFrozen)).toBe(true);
        expect(
            D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1.every(
                entry => !entry.sql.includes(" IF NOT EXISTS ") && !entry.sql.endsWith(";")
            )
        ).toBe(true);
    });

    it("does not add the schema to the ordinary RPC entrypoint", () => {
        expect("D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1" in rpc).toBe(false);
        expect("D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1" in rpc).toBe(false);
        expect("D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1" in rpc).toBe(false);
        expect("D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1" in rpc).toBe(false);
    });
});
