-- Test calls reuse the existing dispatch job, webhook and reporting models.
ALTER TABLE "voice_engine_jobs" ALTER COLUMN "campaign_id" DROP NOT NULL;
ALTER TABLE "campaigns" ADD COLUMN "scheduled_at" TIMESTAMPTZ(6);
