// Real, provider-backed voices for the campaign wizard's voice picker (GET /voices on the engine).
// Never a hardcoded list: if the engine or the provider is unreachable, this degrades to an empty list
// with a reason instead of throwing, so the rest of the wizard stays usable.
import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth.server";
import { engineErrorReason, listEngineVoices } from "@/lib/voice-engine/client";
import type { EngineVoiceOption } from "@/lib/voice-engine/types";

export type VoiceOptionsResult =
  | { ok: true; provider: "bakbak" | "elevenlabs"; voices: EngineVoiceOption[] }
  | { ok: false; reason: string };

export async function listVoiceOptions(): Promise<VoiceOptionsResult> {
  try {
    const result = await listEngineVoices();
    return { ok: true, provider: result.provider, voices: result.voices };
  } catch (error) {
    return { ok: false, reason: engineErrorReason(error) };
  }
}

export const getVoiceOptions = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(() => listVoiceOptions());
