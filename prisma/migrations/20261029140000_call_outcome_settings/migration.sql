-- CreateTable
CREATE TABLE "call_outcome_settings" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "fallback" TEXT NOT NULL DEFAULT '',
    "short_hangup_threshold_seconds" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "call_outcome_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_outcome_settings_client_id_key" ON "call_outcome_settings"("client_id");

-- AddForeignKey
ALTER TABLE "call_outcome_settings" ADD CONSTRAINT "call_outcome_settings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
