// Queue one reported test call through the engine's existing dispatch/outbox path.
// A campaign test resolves its saved persona and voice on the server, without consuming its leads.
import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient } from "@/lib/workspace.functions";
import { engineOutcomeRulesForClient } from "@/lib/call-outcome-settings.functions";
import { engineErrorReason, placeTestCall } from "@/lib/voice-engine/client";
import { personaSnapshot, workflowForPurpose } from "@/lib/voice-engine/persona";
import { engineProviderConfigForPersona } from "@/lib/voice-provider-settings.functions";
import { isUniqueViolation } from "@/lib/db-errors";

// Matches the engine's own OutboundCallIn/TestCallIn pattern (agent/app/models.py).
const DIALLABLE_PHONE = /^\+?[0-9]{10,15}$/;

const inputSchema = z.object({
  personaKey: z.string().min(1).optional(),
  campaignId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid().optional(),
  to: z.string().regex(DIALLABLE_PHONE, "Enter a valid phone number, e.g. +919876543210."),
  contactName: z.string().trim().max(100).optional(),
});

export type TestOutboundCallResult =
  | { ok: true; jobId: string; status: "queued" }
  | { ok: false; reason: string; retrySameKey?: boolean };

export async function placeTestOutboundCall(
  database: typeof db,
  userId: string,
  input: z.infer<typeof inputSchema>,
): Promise<TestOutboundCallResult> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { ok: false, reason: "Your account isn't linked to a workspace yet." };

  const campaign = input.campaignId
    ? await database.campaign.findFirst({ where: { id: input.campaignId, clientId: client.id } })
    : null;
  if (input.campaignId && !campaign) return { ok: false, reason: "Campaign not found." };
  const baseUrl = process.env["APP_BASE_URL"]?.replace(/\/+$/, "");
  if (!baseUrl) return { ok: false, reason: "APP_BASE_URL is not configured." };
  const personaKey = campaign?.personaKey ?? input.personaKey;
  if (!personaKey) return { ok: false, reason: "Choose a persona." };

  const prompt = await database.prompt.findFirst({
    where: { clientId: client.id, personaKey },
  });
  if (!prompt) return { ok: false, reason: "That persona no longer exists." };
  if (!prompt.active) {
    return { ok: false, reason: `"${prompt.name}" is switched off. Turn it on in Prompts first.` };
  }

  const persona = personaSnapshot(prompt, workflowForPurpose(campaign?.purpose ?? prompt.purpose));
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

  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  let job = await database.voiceEngineJob.findUnique({ where: { idempotencyKey } });
  if (job && (job.clientId !== client.id || job.campaignId !== null)) {
    return { ok: false, reason: "Invalid test-call request." };
  }
  if (job?.engineJobId) return { ok: true, jobId: job.id, status: "queued" };
  if (job?.status === "failed") return { ok: false, reason: job.lastError ?? "Test call rejected." };
  if (!job) {
    try {
      job = await database.voiceEngineJob.create({
        data: { clientId: client.id, idempotencyKey, status: "pending", personaVersion: prompt.currentVersion },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      job = await database.voiceEngineJob.findUnique({ where: { idempotencyKey } });
      if (!job || job.clientId !== client.id || job.campaignId !== null)
        return { ok: false, reason: "Invalid test-call request." };
    }
  }

  try {
    const outcome = await placeTestCall({
      clientId: client.id,
      persona: { ...persona, outcomeRules, ...(outcomeFallback ? { outcomeFallback } : {}), ...providerConfig },
      to: input.to,
      contactName: input.contactName || null,
      idempotencyKey: job.idempotencyKey,
      webhookUrl: `${baseUrl}/api/webhooks/voice-engine`,
      ...(campaign?.voiceId && campaign.voiceModelId
        ? { voiceId: campaign.voiceId, ttsModelId: campaign.voiceModelId } : {}),
      ...(campaign?.voiceStability != null ||
      campaign?.voiceSimilarityBoost != null ||
      campaign?.voiceStyle != null
        ? {
            voiceSettings: {
              ...(campaign?.voiceStability != null ? { stability: campaign.voiceStability } : {}),
              ...(campaign?.voiceSimilarityBoost != null
                ? { similarityBoost: campaign.voiceSimilarityBoost }
                : {}),
              ...(campaign?.voiceStyle != null ? { style: campaign.voiceStyle } : {}),
            },
          }
        : {}),
    });
    if (outcome.kind === "rejected") {
      await database.voiceEngineJob.update({ where: { id: job.id }, data: { status: "failed", lastError: outcome.message } });
      return { ok: false, reason: outcome.message };
    }
    if (outcome.kind === "queued") {
      await database.voiceEngineJob.update({ where: { id: job.id }, data: {
        engineJobId: outcome.engineJobId, status: "dispatched", dispatchedAt: new Date(), lastError: null,
      } });
      return { ok: true, jobId: job.id, status: "queued" };
    }
    // A dashboard must not advertise reported, duplicate-safe calls against an older engine.
    return { ok: false, reason: "Upgrade the voice engine before using reported test calls." };
  } catch (error) {
    return { ok: false, retrySameKey: true, reason: `${engineErrorReason(error)} Retry with the same request to check it safely.` };
  }
}

export const testOutboundCall = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(inputSchema)
  .handler(({ context, data }) => placeTestOutboundCall(db, context.userId, data));
