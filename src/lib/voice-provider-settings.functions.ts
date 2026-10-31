// Persists the workspace's own ASR/TTS provider choice (one row per client, saved whole) and resolves the
// engine's Persona -> Workspace -> Global precedence for the dispatch/test-call/inbound-publish paths to
// send into the engine's PersonaIn (agent/app/models.py), which already has its own asr_provider/
// asr_fallback_provider/tts_provider/tts_fallback_provider fields.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prompt, PrismaClient } from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient } from "@/lib/workspace.functions";

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

const saveSchema = z
  .object({
    asrProvider: z.enum(asrProviders).nullable(),
    asrFallbackProvider: z.enum(asrProviders).nullable(),
    ttsProvider: z.enum(ttsProviders).nullable(),
    ttsFallbackProvider: z.enum(ttsProviders).nullable(),
  })
  .refine((v) => v.asrProvider === null || v.asrProvider !== v.asrFallbackProvider, {
    message: "The ASR fallback must be different from the primary.",
  })
  .refine((v) => v.ttsProvider === null || v.ttsProvider !== v.ttsFallbackProvider, {
    message: "The TTS fallback must be different from the primary.",
  });
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

export async function getVoiceProviderSettingsFor(
  database: PrismaClient,
  userId: string,
): Promise<VoiceProviderSettingsView> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return defaults();
  return getVoiceProviderSettingsForClient(database, client.id);
}

export type SaveVoiceProviderSettingsResult =
  { ok: true; settings: VoiceProviderSettingsView } | { ok: false; reason: string };

export async function saveVoiceProviderSettingsFor(
  database: PrismaClient,
  userId: string,
  input: SaveVoiceProviderSettingsInput,
): Promise<SaveVoiceProviderSettingsResult> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { ok: false, reason: "Your account isn't linked to a workspace yet." };

  await database.voiceProviderSettings.upsert({
    where: { clientId: client.id },
    create: { clientId: client.id, ...input },
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

export const getVoiceProviderSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => getVoiceProviderSettingsFor(db, context.userId));

export const saveVoiceProviderSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(saveSchema)
  .handler(({ context, data }) => saveVoiceProviderSettingsFor(db, context.userId, data));
