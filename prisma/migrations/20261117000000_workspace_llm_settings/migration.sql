-- AlterTable
ALTER TABLE "voice_provider_settings" ADD COLUMN "llm_provider" TEXT,
ADD COLUMN "llm_fallback_provider" TEXT,
ADD COLUMN "llm_model" TEXT;
