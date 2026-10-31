// Places one real outbound call right away, outside any campaign: for the "test outbound call" control on the
// Outbound Calls page. The engine creates or reuses the agent for the chosen persona itself (POST /calls/test),
// so there is nothing to set up on the engine beforehand.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient } from "@/lib/workspace.functions";
import { engineOutcomeRulesForClient } from "@/lib/call-outcome-settings.functions";
import { engineErrorReason, placeTestCall } from "@/lib/voice-engine/client";
import { personaSnapshot, workflowForPurpose } from "@/lib/voice-engine/persona";
import { engineProviderConfigForPersona } from "@/lib/voice-provider-settings.functions";

// Matches the engine's own OutboundCallIn/TestCallIn pattern (agent/app/models.py).
const DIALLABLE_PHONE = /^\+?[0-9]{10,15}$/;

const inputSchema = z.object({
  personaKey: z.string().min(1),
  to: z.string().regex(DIALLABLE_PHONE, "Enter a valid phone number, e.g. +919876543210."),
  contactName: z.string().trim().max(100).optional(),
});

export type TestOutboundCallResult =
  | { ok: true; callId: number; status: string; exotelCallSid: string | null }
  | { ok: false; reason: string };

export async function placeTestOutboundCall(
  database: typeof db,
  userId: string,
  input: z.infer<typeof inputSchema>,
): Promise<TestOutboundCallResult> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { ok: false, reason: "Your account isn't linked to a workspace yet." };

  const prompt = await database.prompt.findFirst({
    where: { clientId: client.id, personaKey: input.personaKey },
  });
  if (!prompt) return { ok: false, reason: "That persona no longer exists." };
  if (!prompt.active) {
    return { ok: false, reason: `"${prompt.name}" is switched off. Turn it on in Prompts first.` };
  }

  const persona = personaSnapshot(prompt, workflowForPurpose(prompt.purpose));
  if (!persona) {
    return {
      ok: false,
      reason: `"${prompt.name}" uses ${prompt.language}, which the voice engine can't speak yet.`,
    };
  }

  // The workspace's own Call Outcome Rules, current right now; empty means the engine's fixed per-workflow
  // list is used, exactly as before this existed.
  const { outcomeRules, outcomeFallback } = await engineOutcomeRulesForClient(database, client.id);
  // The resolved Persona -> Workspace -> Global provider choice; omitted keys mean the engine's own
  // global default, exactly as before these settings existed.
  const providerConfig = await engineProviderConfigForPersona(database, client.id, prompt);

  try {
    const outcome = await placeTestCall({
      clientId: client.id,
      persona: { ...persona, outcomeRules, ...(outcomeFallback ? { outcomeFallback } : {}), ...providerConfig },
      to: input.to,
      contactName: input.contactName || null,
    });
    if (outcome.kind === "rejected") return { ok: false, reason: outcome.message };
    return {
      ok: true,
      callId: outcome.call.id,
      status: outcome.call.status,
      exotelCallSid: outcome.call.exotel_call_sid,
    };
  } catch (error) {
    return { ok: false, reason: engineErrorReason(error) };
  }
}

export const testOutboundCall = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(inputSchema)
  .handler(({ context, data }) => placeTestOutboundCall(db, context.userId, data));
