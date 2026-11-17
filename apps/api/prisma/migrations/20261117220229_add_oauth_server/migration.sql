-- CreateEnum
CREATE TYPE "OAuthClientKind" AS ENUM ('cimd', 'dynamic', 'registered');

-- CreateEnum
CREATE TYPE "OAuthRequestStatus" AS ENUM ('pending', 'approved', 'denied', 'expired');

-- CreateEnum
CREATE TYPE "OAuthTokenKind" AS ENUM ('access', 'refresh');

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" "OAuthClientKind" NOT NULL,
    "name" TEXT NOT NULL,
    "client_uri" TEXT,
    "logo_uri" TEXT,
    "redirect_uris" JSONB NOT NULL,
    "token_endpoint_auth_method" TEXT NOT NULL,
    "secret_hash" TEXT,
    "application_type" TEXT,
    "host" TEXT NOT NULL,
    "metadata_fetched_at" TIMESTAMPTZ,
    "metadata_expires_at" TIMESTAMPTZ,
    "created_by_user_id" UUID,
    "disabled_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_requests" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "state" TEXT,
    "resource" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "user_id" UUID,
    "status" "OAuthRequestStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID,
    "client_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" TEXT,

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "grant_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" UUID NOT NULL,
    "kind" "OAuthTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "grant_id" UUID NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "rotated_at" TIMESTAMPTZ,
    "replaced_by_id" UUID,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_client_id_idx" ON "oauth_authorization_requests"("client_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_expires_at_idx" ON "oauth_authorization_requests"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants"("user_id");

-- CreateIndex
CREATE INDEX "oauth_grants_client_id_idx" ON "oauth_grants"("client_id");

-- CreateIndex
CREATE INDEX "oauth_grants_org_id_idx" ON "oauth_grants"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_grant_id_idx" ON "oauth_authorization_codes"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_expires_at_idx" ON "oauth_authorization_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_grant_id_idx" ON "oauth_tokens"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_expires_at_idx" ON "oauth_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one ACTIVE grant per (user, client, resource): a partial unique index
-- Prisma cannot express. Listed in packages/platform-db/raw-sql-indexes.json.
CREATE UNIQUE INDEX "oauth_grants_active_uniq_idx" ON "oauth_grants"("user_id", "client_id", "resource") WHERE "revoked_at" IS NULL;
