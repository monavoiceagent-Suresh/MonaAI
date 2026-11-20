// Persists the workspace's own ASR/TTS provider choice (one row per client, saved whole) and resolves the
// engine's Persona -> Workspace -> Global precedence for the dispatch/test-call/inbound-publish paths to
// send into the engine's PersonaIn (agent/app/models.py), which already has its own asr_provider/
// asr_fallback_provider/tts_provider/tts_fallback_provider fields.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prompt, PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import {
  engineErrorReason,
  listEngineLlmOptions,
  validateEngineLlmModels,
} from "@/lib/voice-engine/client";
import type { EngineLlmOptions } from "@/lib/voice-engine/types";

// agent/app/config.py ASRProvider / TTSProvider.
export const asrProviders = ["elevenlabs_scribe", "deepgram_nova3"] as const;
export const ttsProviders = [
  "bakbak",
  "elevenlabs_premium",
  "elevenlabs_standard",
  "deepgram_aura",
  "sarvam",
] as const;
// OpenRouter is the engine's only LLM gateway. "groq" stays in the stored type only so a row saved before
// this still loads; it is never offered, sent to the engine, or saved again.
export const llmProviders = ["openrouter", "groq"] as const;
export type LlmProvider = (typeof llmProviders)[number];
export type AsrProvider = (typeof asrProviders)[number];
export type TtsProvider = (typeof ttsProviders)[number];

export interface VoiceProviderSettingsView {
  asrProvider: AsrProvider | null;
  asrFallbackProvider: AsrProvider | null;
  ttsProvider: TtsProvider | null;
  ttsFallbackProvider: TtsProvider | null;
  llmProvider: LlmProvider | null;
  llmFallbackProvider: LlmProvider | null;
  /** The OpenRouter model that answers first; null = the engine's OPENROUTER_MODEL. */
  llmModel: string | null;
  /** A different OpenRouter model used when the primary fails before replying; null = the engine's
   * LLM_FALLBACK_MODEL. */
  llmFallbackModel: string | null;
}

/** A brand-new workspace (no row saved yet) has made no choice at this tier: every field falls through to
 * the persona's own choice, or failing that, the engine's own global default. */
function defaults(): VoiceProviderSettingsView {
  return {
    asrProvider: null,
    asrFallbackProvider: null,
    ttsProvider: null,
    ttsFallbackProvider: null,
    llmProvider: null,
    llmFallbackProvider: null,
    llmModel: null,
    llmFallbackModel: null,
  };
}

const settingsFields = {
  asrProvider: z.enum(asrProviders).nullable(),
  asrFallbackProvider: z.enum(asrProviders).nullable(),
  ttsProvider: z.enum(ttsProviders).nullable(),
  ttsFallbackProvider: z.enum(ttsProviders).nullable(),
  llmProvider: z.enum(llmProviders).nullable(),
  llmFallbackProvider: z.enum(llmProviders).nullable(),
  llmModel: z.string().trim().max(200).nullable(),
  llmFallbackModel: z.string().trim().max(200).nullable().default(null),
};
function withNoMatchingFallback<
  T extends {
    asrProvider: unknown;
    asrFallbackProvider: unknown;
    ttsProvider: unknown;
    ttsFallbackProvider: unknown;
    llmProvider: unknown;
    llmFallbackProvider: unknown;
  },
>(shape: z.ZodType<T>) {
  return shape
    .refine((v) => v.asrProvider === null || v.asrProvider !== v.asrFallbackProvider, {
      message: "The ASR fallback must be different from the primary.",
    })
    .refine((v) => v.ttsProvider === null || v.ttsProvider !== v.ttsFallbackProvider, {
      message: "The TTS fallback must be different from the primary.",
    })
    .refine((v) => v.llmProvider === null || v.llmProvider !== v.llmFallbackProvider, {
      message: "The LLM fallback must be different from the primary.",
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
    llmProvider: row.llmProvider as LlmProvider | null,
    llmFallbackProvider: row.llmFallbackProvider as LlmProvider | null,
    llmModel: row.llmModel,
    llmFallbackModel: row.llmFallbackModel,
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

  // OpenRouter only: a provider choice is never saved (an old "groq" choice is cleared), and empty model
  // boxes mean "the engine's default".
  const settings: VoiceProviderSettingsView = {
    ...input,
    llmProvider: null,
    llmFallbackProvider: null,
    llmModel: input.llmModel?.trim() || null,
    llmFallbackModel: input.llmFallbackModel?.trim() || null,
  };
  if (settings.llmModel || settings.llmFallbackModel) {
    const problem = await llmModelProblem(settings.llmModel, settings.llmFallbackModel);
    if (problem) return { ok: false, reason: problem };
  }

  await database.voiceProviderSettings.upsert({
    where: { clientId },
    create: { clientId, ...settings },
    update: { ...settings },
  });
  return { ok: true, settings };
}

/** Why a primary/fallback model pair cannot be saved, or null when the engine confirmed both can serve calls
 * (they exist on OpenRouter, produce streamed text and differ). Unverifiable means not saved. */
export async function llmModelProblem(
  primaryModel: string | null,
  fallbackModel: string | null,
): Promise<string | null> {
  try {
    const result = await validateEngineLlmModels({ primaryModel, fallbackModel });
    return result.ok ? null : result.problems.join(" ");
  } catch (error) {
    return `The models could not be verified, so nothing was saved: ${engineErrorReason(error)}`;
  }
}

/** What `{...persona, ...this}` sends the engine for one persona: its own choice, else the workspace's,
 * else nothing at all (so the engine's own global Settings default applies, unchanged). Every field is
 * either a real provider name or simply absent — never null — to match PersonaSnapshot's optional fields. */
export interface EngineProviderConfig {
  asrProvider?: AsrProvider;
  asrFallbackProvider?: AsrProvider;
  ttsProvider?: TtsProvider;
  ttsFallbackProvider?: TtsProvider;
  llmModel?: string;
  llmFallbackModel?: string;
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
  // The LLM choice is workspace-level only (personas have no LLM override of their own), and models only:
  // OpenRouter is the engine's only gateway, so no provider is ever sent.
  if (workspace.llmModel) resolved.llmModel = workspace.llmModel;
  if (workspace.llmFallbackModel) resolved.llmFallbackModel = workspace.llmFallbackModel;
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

export type LlmOptionsResult = ({ ok: true } & EngineLlmOptions) | { ok: false; reason: string };

/** Which LLM providers the engine has keys for and their live model lists. Degrades to a reason, never throws,
 * so the form still opens (with a free-text model box) when the engine is unreachable. */
export const getLlmOptions = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<LlmOptionsResult> => {
    try {
      return { ok: true, ...(await listEngineLlmOptions()) };
    } catch (error) {
      return { ok: false, reason: engineErrorReason(error) };
    }
  });
