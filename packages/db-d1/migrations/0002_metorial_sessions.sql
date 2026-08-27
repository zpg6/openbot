PRAGMA foreign_keys = ON;

CREATE TABLE "openbot_metorial_session" (
    "session_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "run_id" TEXT NOT NULL REFERENCES "openbot_run"("run_id") ON DELETE CASCADE,
    "state" TEXT NOT NULL CHECK ("state" IN ('active', 'deleting', 'deleted', 'cleanup_failed')),
    "tool_map_json" TEXT NOT NULL CHECK (json_valid("tool_map_json")),
    "created_at_ms" INTEGER NOT NULL,
    "updated_at_ms" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "openbot_metorial_session_org_run_uidx" ON "openbot_metorial_session" ("organization_id", "run_id");
CREATE INDEX "openbot_metorial_session_state_updated_idx" ON "openbot_metorial_session" ("state", "updated_at_ms");
