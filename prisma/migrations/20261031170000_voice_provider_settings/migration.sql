-- The Persona tier of the engine's Persona -> Workspace -> Global provider precedence. Null means "no
-- choice at this tier"; the resolved value falls through to the workspace or the engine's own default.
ALTER TABLE "prompts" ADD COLUMN "asr_provider" TEXT;
ALTER TABLE "prompts" ADD COLUMN "asr_fallback_provider" TEXT;
ALTER TABLE "prompts" ADD COLUMN "tts_provider" TEXT;
ALTER TABLE "prompts" ADD COLUMN "tts_fallback_provider" TEXT;

-- CreateTable
CREATE TABLE "voice_provider_settings" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "asr_provider" TEXT,
    "asr_fallback_provider" TEXT,
    "tts_provider" TEXT,
    "tts_fallback_provider" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "voice_provider_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_provider_settings_client_id_key" ON "voice_provider_settings"("client_id");

-- AddForeignKey
ALTER TABLE "voice_provider_settings" ADD CONSTRAINT "voice_provider_settings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
