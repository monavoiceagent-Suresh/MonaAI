// Real, provider-backed voices for the campaign wizard's voice picker (GET /voices on the engine).
// Never a hardcoded list: if the engine or the provider is unreachable, this degrades to an empty list
// with a reason instead of throwing, so the rest of the wizard stays usable.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "@/lib/auth.server";
import { engineErrorReason, listEngineVoices, previewEngineVoice } from "@/lib/voice-engine/client";
import type { EngineVoicesResult } from "@/lib/voice-engine/types";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient } from "@/lib/workspace.functions";

export type VoiceOptionsResult =
  | ({ ok: true } & EngineVoicesResult)
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

export const previewVoice = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }))
  .handler(async ({ context, data }) => {
    if (!(await currentWorkspaceClient(db, context.userId))) return new Response(null, { status: 404 });
    try {
      return await previewEngineVoice(data.voiceId);
    } catch {
      return new Response(null, { status: 502 });
    }
  });
