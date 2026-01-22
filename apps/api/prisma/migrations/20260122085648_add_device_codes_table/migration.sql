-- CreateEnum
CREATE TYPE "DeviceCodeStatus" AS ENUM ('pending', 'approved', 'denied', 'expired');

-- CreateTable
CREATE TABLE "device_codes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "user_id" UUID,
    "status" "DeviceCodeStatus" NOT NULL DEFAULT 'pending',
    "client_info" JSONB,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_device_code_key" ON "device_codes"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_user_code_key" ON "device_codes"("user_code");

-- CreateIndex
CREATE INDEX "device_codes_device_code_idx" ON "device_codes"("device_code");

-- CreateIndex
CREATE INDEX "device_codes_user_code_idx" ON "device_codes"("user_code");

-- CreateIndex
CREATE INDEX "device_codes_status_expires_at_idx" ON "device_codes"("status", "expires_at");

-- CreateIndex
CREATE INDEX "device_codes_user_id_idx" ON "device_codes"("user_id");

-- AddForeignKey
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
