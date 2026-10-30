-- A dispatch can be accepted by the engine (it has an engine_job_id) but still end up marked "failed" here if
-- saving that locally then fails (campaigns.functions.ts dispatchCampaign). Until the earlier unique index,
-- that orphan did not block a second dispatch, so retrying could start a duplicate batch of calls to the same
-- leads while the engine was still running the first one. Treat it as open too: a retry is blocked, with a
-- clear reason, until the campaign is paused to cancel it (stopCampaignDispatch now reconciles it).
DROP INDEX "voice_engine_jobs_one_active_per_campaign";

CREATE UNIQUE INDEX "voice_engine_jobs_one_active_per_campaign"
  ON "voice_engine_jobs" ("campaign_id")
  WHERE "status" IN ('pending', 'dispatched', 'running') OR ("status" = 'failed' AND "engine_job_id" IS NOT NULL);
