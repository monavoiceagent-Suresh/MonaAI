// Persists the workspace's own ASR/TTS provider choice (one row per client, saved whole) and resolves the
// engine's Persona -> Workspace -> Global precedence for the dispatch/test-call/inbound-publish paths to
// send into the engine's PersonaIn (agent/app/models.py), which already has its own asr_provider/
// asr_fallback_provider/tts_provider/tts_fallback_provider fields.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prompt, PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";

// agent/app/config.py ASRProvider / TTSProvider.
export const asrProviders = ["elevenlabs_scribe", "deepgram_nova3"] as const;
export const ttsProviders = [
  "bakbak",
  "elevenlabs_premium",
  "elevenlabs_standard",
  "deepgram_aura",
] as const;
export type AsrProvider = (typeof asrProviders)[number];
export type TtsProvider = (typeof ttsProviders)[number];

export interface VoiceProviderSettingsView {
  asrProvider: AsrProvider | null;
  asrFallbackProvider: AsrProvider | null;
  ttsProvider: TtsProvider | null;
  ttsFallbackProvider: TtsProvider | null;
}

/** A brand-new workspace (no row saved yet) has made no choice at this tier: every field falls through to
 * the persona's own choice, or failing that, the engine's own global default. */
function defaults(): VoiceProviderSettingsView {
  return {
    asrProvider: null,
    asrFallbackProvider: null,
    ttsProvider: null,
    ttsFallbackProvider: null,
  };
}

const settingsFields = {
  asrProvider: z.enum(asrProviders).nullable(),
  asrFallbackProvider: z.enum(asrProviders).nullable(),
  ttsProvider: z.enum(ttsProviders).nullable(),
  ttsFallbackProvider: z.enum(ttsProviders).nullable(),
};
function withNoMatchingFallback<
  T extends {
    asrProvider: unknown;
    asrFallbackProvider: unknown;
    ttsProvider: unknown;
    ttsFallbackProvider: unknown;
  },
>(shape: z.ZodType<T>) {
  return shape
    .refine((v) => v.asrProvider === null || v.asrProvider !== v.asrFallbackProvider, {
      message: "The ASR fallback must be different from the primary.",
    })
    .refine((v) => v.ttsProvider === null || v.ttsProvider !== v.ttsFallbackProvider, {
      message: "The TTS fallback must be different from the primary.",
    });
}
const saveSchema = withNoMatchingFallback(z.object(settingsFields));
export type SaveVoiceProviderSettingsInput = z.infer<typeof saveSchema>;

export async function getVoiceProviderSettingsForClient(
  database: PrismaClient,
  clientId: string,
): Promise<VoiceProviderSettingsView> {
  const row = await database.voiceProviderSettings.findUnique({ where: { clientId } });
  if (!row) return defaults();
  return {
    asrProvider: row.asrProvider as AsrProvider | null,
    asrFallbackProvider: row.asrFallbackProvider as AsrProvider | null,
    ttsProvider: row.ttsProvider as TtsProvider | null,
    ttsFallbackProvider: row.ttsFallbackProvider as TtsProvider | null,
  };
}

export type SaveVoiceProviderSettingsResult =
  { ok: true; settings: VoiceProviderSettingsView } | { ok: false; reason: string };

export async function saveVoiceProviderSettingsForClient(
  database: PrismaClient,
  clientId: string,
  input: SaveVoiceProviderSettingsInput,
): Promise<SaveVoiceProviderSettingsResult> {
  const client = await database.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) return { ok: false, reason: "That workspace no longer exists." };

  await database.voiceProviderSettings.upsert({
    where: { clientId },
    create: { clientId, ...input },
    update: { ...input },
  });
  return { ok: true, settings: input };
}

/** What `{...persona, ...this}` sends the engine for one persona: its own choice, else the workspace's,
 * else nothing at all (so the engine's own global Settings default applies, unchanged). Every field is
 * either a real provider name or simply absent — never null — to match PersonaSnapshot's optional fields. */
export interface EngineProviderConfig {
  asrProvider?: AsrProvider;
  asrFallbackProvider?: AsrProvider;
  ttsProvider?: TtsProvider;
  ttsFallbackProvider?: TtsProvider;
}

export async function engineProviderConfigForPersona(
  database: PrismaClient,
  clientId: string,
  prompt: Pick<
    Prompt,
    "asrProvider" | "asrFallbackProvider" | "ttsProvider" | "ttsFallbackProvider"
  >,
): Promise<EngineProviderConfig> {
  const workspace = await getVoiceProviderSettingsForClient(database, clientId);
  const asrProvider = (prompt.asrProvider as AsrProvider | null) ?? workspace.asrProvider;
  const asrFallbackProvider =
    (prompt.asrFallbackProvider as AsrProvider | null) ?? workspace.asrFallbackProvider;
  const ttsProvider = (prompt.ttsProvider as TtsProvider | null) ?? workspace.ttsProvider;
  const ttsFallbackProvider =
    (prompt.ttsFallbackProvider as TtsProvider | null) ?? workspace.ttsFallbackProvider;
  const resolved: EngineProviderConfig = {};
  if (asrProvider) resolved.asrProvider = asrProvider;
  if (asrFallbackProvider) resolved.asrFallbackProvider = asrFallbackProvider;
  if (ttsProvider) resolved.ttsProvider = ttsProvider;
  if (ttsFallbackProvider) resolved.ttsFallbackProvider = ttsFallbackProvider;
  return resolved;
}

// Super Admin only: a tenant's own workspace users never see or change this — see
// VoiceProviderSettings (components/super-admin) and src/routes/super-admin/tenants.$tenantId.tsx.
export const getVoiceProviderSettingsForTenant = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(z.object({ clientId: z.string().uuid() }))
  .handler(({ data }) => getVoiceProviderSettingsForClient(db, data.clientId));

export const saveVoiceProviderSettingsForTenant = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(withNoMatchingFallback(z.object({ clientId: z.string().uuid(), ...settingsFields })))
  .handler(({ data }) => {
    const { clientId, ...input } = data;
    return saveVoiceProviderSettingsForClient(db, clientId, input);
  });
