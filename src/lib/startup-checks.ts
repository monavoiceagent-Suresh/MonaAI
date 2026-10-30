// Clear, actionable startup warnings for the voice-engine integration, instead of only discovering a
// missing or half-set value from a 500 at request time (e.g. the webhook route in
// routes/api/webhooks/voice-engine.ts, or a campaign start failing with "Voice engine is not configured").
// Checks only whether a value is present — never logs a value itself.

export interface VoiceEngineEnv {
  VOICE_ENGINE_BASE_URL?: string | undefined;
  VOICE_ENGINE_API_KEY?: string | undefined;
  VOICE_ENGINE_WEBHOOK_SECRET?: string | undefined;
  APP_BASE_URL?: string | undefined;
}

export function voiceEngineWebhookWarnings(env: VoiceEngineEnv): string[] {
  const warnings: string[] = [];
  if (!env.VOICE_ENGINE_BASE_URL || !env.VOICE_ENGINE_API_KEY) {
    warnings.push(
      "VOICE_ENGINE_BASE_URL and/or VOICE_ENGINE_API_KEY is not set: campaigns, inbound routing and the " +
        "outbound test-call control cannot reach the voice engine until both are set.",
    );
  }
  if (!env.VOICE_ENGINE_WEBHOOK_SECRET) {
    warnings.push(
      "VOICE_ENGINE_WEBHOOK_SECRET is not set: /api/webhooks/voice-engine will refuse every event with a " +
        "500 until it is set to the same value as the engine's own DASHBOARD_WEBHOOK_SECRET.",
    );
  }
  if (!env.APP_BASE_URL) {
    warnings.push(
      "APP_BASE_URL is not set: campaigns cannot be started — the engine needs this app's own address " +
        "to report results to.",
    );
  }
  return warnings;
}

export function logVoiceEngineWebhookWarnings(env: VoiceEngineEnv = process.env): void {
  for (const warning of voiceEngineWebhookWarnings(env)) {
    console.warn(`[voice-engine] ${warning}`);
  }
}
