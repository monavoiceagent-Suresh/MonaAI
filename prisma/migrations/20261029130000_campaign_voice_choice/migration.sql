-- The real provider voice a campaign actually calls with (GET /voices on the engine), sent with the dispatch
-- so the engine applies it to the agent. Empty strings (not NULL, matching "voice") mean "no choice made yet
-- / keep whatever the agent already has" — dispatchCampaign only sends them to the engine when non-empty.
ALTER TABLE "campaigns" ADD COLUMN "voice_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "campaigns" ADD COLUMN "voice_model_id" TEXT NOT NULL DEFAULT '';
