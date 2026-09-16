-- =============================================================================
-- Per-user encrypted credential store (issue #387)
-- =============================================================================
-- `user_credentials` is a sibling of `credentials`, not an extension of it —
-- see the block comment above `UserCredential` in prisma/schema.prisma for
-- the full argument (the table-wide `credentials_purpose_name_key` unique
-- constraint alone rules out a nullable `owner_user_id` column; opposite
-- delete semantics and making owner-crossing unrepresentable are the other
-- two). The short version: every column of this table's address (`user_id`,
-- `purpose`, `name`) is NOT NULL, so `@@unique([userId, purpose, name])` is
-- both enforced by Postgres and directly usable by Prisma's typed
-- `findUnique`/`upsert`, the same shape `credentials_purpose_name_key` gives
-- `CredentialsService` today.
--
-- `secret` is the identical opaque `[iv][authTag][ciphertext]` base64 payload
-- as `credentials.secret` (`TEXT`, unbounded, for the same reason — encrypted
-- key material must never be truncated), encrypted under a per-owner sub-key
-- domain (`user:<userId>:<purpose>`, not bare `<purpose>`) so a ciphertext
-- moved between two users' rows fails GCM authentication instead of
-- decrypting into the wrong person's context. `SECRETS_ENCRYPTION_KEY`
-- protects this table too — it is the same master key `credentials` uses,
-- not a second one to provision.
--
-- ON DELETE CASCADE, deliberately the OPPOSITE of
-- `credentials_updated_by_user_id_fkey`'s `ON DELETE SET NULL`: a departed
-- user's personal key is not shared infrastructure anyone inherits, so their
-- row goes with them.
--
-- No `updated_by_user_id` column: the owner is the only party ever permitted
-- to write this row, so there is no separate "who last touched it" to record.
--
-- No standalone index on `user_id`: `user_credentials_user_id_purpose_name_key`
-- already leads with `user_id`, so `WHERE user_id = $1` (list-my-credentials)
-- is already an index-prefix scan without a second index to maintain on
-- every write.
-- =============================================================================

-- CreateTable
CREATE TABLE "user_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "hint" TEXT,
    "label" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_purpose_name_key" ON "user_credentials"("user_id", "purpose", "name");

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
