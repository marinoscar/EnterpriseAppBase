-- EXAMPLE (PP-14.27): the migration an app writes for `coach-notes.prisma`
-- (`npm run prisma:migrate:dev -- --create-only --name add_coach_notes`, then the
-- hand-written parts Prisma cannot express: the partial index and the policy).

-- CreateTable
CREATE TABLE "coach_notes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "notification_id" UUID,
    "grant_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_notes_org_id_idx" ON "coach_notes"("org_id");

-- Raw SQL: at most one note per notification that is not tied to a grant.
-- Prisma cannot express a partial unique index; this one is listed in
-- platform.lock `rawSqlIndexes`.
CREATE UNIQUE INDEX "coach_notes_notification_plain_uniq_idx" ON "coach_notes"("notification_id") WHERE "grant_id" IS NULL AND "notification_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: composite, so a note can never point at another organization's grant.
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_grant_id_org_id_fkey" FOREIGN KEY ("grant_id", "org_id") REFERENCES "grants"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: an organization table is visible only to its own
-- organization (transaction-local app.org_id) or to a transaction that carries
-- app.rls_bypass. The policy is listed in platform.lock `rlsPolicies`, with the
-- expression hashes `platform db policies` prints.
ALTER TABLE "coach_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coach_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "coach_notes_org_isolation" ON "coach_notes"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid OR current_setting('app.rls_bypass', true) = 'on');
