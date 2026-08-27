PRAGMA foreign_keys = ON;

CREATE TABLE "openbot_integration_setup" (
    "flow_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "provider_identifier" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_version_id" TEXT NOT NULL,
    "setup_session_id" TEXT NOT NULL UNIQUE,
    "state" TEXT NOT NULL CHECK ("state" IN ('pending', 'completed', 'failed', 'expired')),
    "catalog_json" TEXT NOT NULL CHECK (json_valid("catalog_json")),
    "expires_at_ms" INTEGER NOT NULL,
    "created_at_ms" INTEGER NOT NULL,
    "updated_at_ms" INTEGER NOT NULL
);
CREATE INDEX "openbot_integration_setup_org_state_idx"
    ON "openbot_integration_setup" ("organization_id", "state", "updated_at_ms");
