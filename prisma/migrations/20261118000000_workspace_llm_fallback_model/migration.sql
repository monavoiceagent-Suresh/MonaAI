-- The workspace's fallback OpenRouter model (P0 LLM reliability). Additive and nullable: existing rows keep
-- using the engine's LLM_FALLBACK_MODEL. Requires 20261117000000_workspace_llm_settings to be applied first.
ALTER TABLE "voice_provider_settings" ADD COLUMN "llm_fallback_model" TEXT;
