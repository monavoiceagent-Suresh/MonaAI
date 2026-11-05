-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "caller_id_phone_number_id" UUID;

-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" UUID NOT NULL,
    "e164" VARCHAR(16) NOT NULL,
    "exotel_number_sid" TEXT,
    "capability" TEXT NOT NULL DEFAULT 'VOICE_BOTH',
    "status" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "client_id" UUID,
    "is_default_outbound_caller_id" BOOLEAN NOT NULL DEFAULT false,
    "acquired_at" TIMESTAMPTZ(6),
    "monthly_cost_paisa" INTEGER,
    "notes" TEXT DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_number_assignment_events" (
    "id" UUID NOT NULL,
    "phone_number_id" UUID NOT NULL,
    "client_id" UUID,
    "action" TEXT NOT NULL,
    "performed_by_user_id" UUID,
    "idempotency_key" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_number_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_e164_key" ON "phone_numbers"("e164");

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_exotel_number_sid_key" ON "phone_numbers"("exotel_number_sid");

-- CreateIndex
CREATE INDEX "phone_numbers_client_id_idx" ON "phone_numbers"("client_id");

-- CreateIndex
CREATE INDEX "phone_numbers_status_idx" ON "phone_numbers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "phone_number_assignment_events_idempotency_key_key" ON "phone_number_assignment_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "phone_number_assignment_events_phone_number_id_created_at_idx" ON "phone_number_assignment_events"("phone_number_id", "created_at");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_caller_id_phone_number_id_fkey" FOREIGN KEY ("caller_id_phone_number_id") REFERENCES "phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_number_assignment_events" ADD CONSTRAINT "phone_number_assignment_events_phone_number_id_fkey" FOREIGN KEY ("phone_number_id") REFERENCES "phone_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
