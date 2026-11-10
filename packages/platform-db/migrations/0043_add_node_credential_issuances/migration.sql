-- CreateTable
CREATE TABLE "node_credential_issuances" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "purpose" VARCHAR(97) NOT NULL,
    "version" VARCHAR(16) NOT NULL,
    "job_id" UUID,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "node_credential_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "node_credential_issuances_node_id_issued_at_idx" ON "node_credential_issuances"("node_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "node_credential_issuances_issued_at_idx" ON "node_credential_issuances"("issued_at");

-- CreateIndex
CREATE INDEX "node_credential_issuances_job_id_idx" ON "node_credential_issuances"("job_id");

-- AddForeignKey
ALTER TABLE "node_credential_issuances" ADD CONSTRAINT "node_credential_issuances_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "worker_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_credential_issuances" ADD CONSTRAINT "node_credential_issuances_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
