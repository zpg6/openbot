PRAGMA foreign_keys = ON;

CREATE TABLE "user" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL DEFAULT 0,
    "image" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);

CREATE TABLE "session" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "expiresAt" INTEGER NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "activeOrganizationId" TEXT
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "issuer" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" INTEGER,
    "refreshTokenExpiresAt" INTEGER,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" ("issuer", "accountId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" INTEGER NOT NULL,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE "organization" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "logo" TEXT,
    "createdAt" INTEGER NOT NULL,
    "metadata" TEXT
);
CREATE INDEX "organization_slug_idx" ON "organization" ("slug");

CREATE TABLE "member" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" INTEGER NOT NULL
);
CREATE INDEX "member_organizationId_idx" ON "member" ("organizationId");
CREATE INDEX "member_userId_idx" ON "member" ("userId");
CREATE UNIQUE INDEX "member_organizationId_userId_uidx" ON "member" ("organizationId", "userId");

CREATE TABLE "invitation" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" INTEGER NOT NULL,
    "createdAt" INTEGER NOT NULL,
    "inviterId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "invitation_organizationId_idx" ON "invitation" ("organizationId");
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");

CREATE TABLE "openbot_bot" (
    "bot_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "owner_user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
    "created_at_ms" INTEGER NOT NULL,
    "document_json" TEXT NOT NULL CHECK (json_valid("document_json"))
);
CREATE INDEX "openbot_bot_org_created_idx" ON "openbot_bot" ("organization_id", "created_at_ms");

CREATE TABLE "openbot_confirmation" (
    "confirmation_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "bot_id" TEXT NOT NULL REFERENCES "openbot_bot"("bot_id") ON DELETE CASCADE,
    "state" TEXT NOT NULL CHECK ("state" IN ('pending', 'started')),
    "expires_at_ms" INTEGER NOT NULL,
    "created_at_ms" INTEGER NOT NULL,
    "document_json" TEXT NOT NULL CHECK (json_valid("document_json"))
);
CREATE INDEX "openbot_confirmation_org_state_idx" ON "openbot_confirmation" ("organization_id", "state");

CREATE TABLE "openbot_run" (
    "run_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "bot_id" TEXT NOT NULL REFERENCES "openbot_bot"("bot_id") ON DELETE CASCADE,
    "confirmation_id" TEXT NOT NULL REFERENCES "openbot_confirmation"("confirmation_id") ON DELETE RESTRICT,
    "execution_state" TEXT NOT NULL CHECK ("execution_state" IN ('running', 'completed', 'failed')),
    "created_at_ms" INTEGER NOT NULL,
    "document_json" TEXT NOT NULL CHECK (json_valid("document_json"))
);
CREATE INDEX "openbot_run_org_bot_created_idx" ON "openbot_run" ("organization_id", "bot_id", "created_at_ms");

CREATE TABLE "openbot_routine_proposal" (
    "proposal_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "bot_id" TEXT NOT NULL REFERENCES "openbot_bot"("bot_id") ON DELETE CASCADE,
    "state" TEXT NOT NULL CHECK ("state" IN ('pending', 'saved')),
    "expires_at_ms" INTEGER NOT NULL,
    "created_at_ms" INTEGER NOT NULL,
    "document_json" TEXT NOT NULL CHECK (json_valid("document_json"))
);
CREATE INDEX "openbot_routine_proposal_org_state_idx" ON "openbot_routine_proposal" ("organization_id", "state");

CREATE TABLE "openbot_routine" (
    "routine_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "bot_id" TEXT NOT NULL REFERENCES "openbot_bot"("bot_id") ON DELETE CASCADE,
    "revision" INTEGER NOT NULL,
    "created_at_ms" INTEGER NOT NULL,
    "updated_at_ms" INTEGER NOT NULL,
    "document_json" TEXT NOT NULL CHECK (json_valid("document_json"))
);
CREATE INDEX "openbot_routine_org_bot_idx" ON "openbot_routine" ("organization_id", "bot_id");

CREATE TABLE "openbot_integration" (
    "integration_id" TEXT PRIMARY KEY NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "provider_identifier" TEXT NOT NULL,
    "connection_state" TEXT NOT NULL CHECK ("connection_state" IN ('connected', 'needs_connection')),
    "document_json" TEXT NOT NULL CHECK (json_valid("document_json")),
    "created_at_ms" INTEGER NOT NULL,
    "updated_at_ms" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "openbot_integration_org_provider_uidx" ON "openbot_integration" ("organization_id", "provider_identifier");
