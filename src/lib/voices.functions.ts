// Real, provider-backed voices for the campaign wizard's voice picker (GET /voices on the engine).
// Never a hardcoded list: if the engine or the provider is unreachable, this degrades to an empty list
// with a reason instead of throwing, so the rest of the wizard stays usable.
import type { PrismaClient } from "@prisma/client";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "@/lib/auth.server";
import { engineErrorReason, listEngineVoices, previewEngineVoice } from "@/lib/voice-engine/client";
import type { EngineVoicesResult } from "@/lib/voice-engine/types";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient } from "@/lib/workspace.functions";

export type VoiceOptionsResult =
  ({ ok: true } & EngineVoicesResult) | { ok: false; reason: string };

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

const AUDIO_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;

/** The voice's cached sample, fetching and storing it from the engine on a first request for
 * that voice. Shared across every tenant: the engine always previews the same fixed line for a
 * given voice, so there is nothing to gain from caching it per-workspace. */
export async function previewVoiceFor(
  database: PrismaClient,
  userId: string,
  voiceId: string,
): Promise<Response> {
  if (!(await currentWorkspaceClient(database, userId))) return new Response(null, { status: 404 });

  const cached = await database.voicePreviewCache.findUnique({ where: { voiceId } });
  if (cached) {
    return new Response(cached.audio, {
      headers: { "content-type": cached.contentType, ...AUDIO_HEADERS },
    });
  }

  try {
    const fromEngine = await previewEngineVoice(voiceId);
    if (!fromEngine.ok) return fromEngine;
    const contentType = fromEngine.headers.get("content-type") ?? "audio/mpeg";
    const audio = Buffer.from(await fromEngine.arrayBuffer());
    // Caching is a cost-saving nicety, not something the preview should fail over: a write race
    // or a transient DB error just means the next preview of this voice calls the engine again.
    await database.voicePreviewCache
      .upsert({
        where: { voiceId },
        create: { voiceId, contentType, audio },
        update: { contentType, audio },
      })
      .catch(() => {});
    return new Response(audio, { headers: { "content-type": contentType, ...AUDIO_HEADERS } });
  } catch {
    return new Response(null, { status: 502 });
  }
}

export const previewVoice = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }))
  .handler(({ context, data }) => previewVoiceFor(db, context.userId, data.voiceId));
