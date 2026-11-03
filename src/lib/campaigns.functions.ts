import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Campaign as CampaignRow, PrismaClient } from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { isUniqueViolation } from "@/lib/db-errors";
import { currentWorkspaceClient } from "@/lib/workspace.functions";
import { engineOutcomeRulesForClient } from "@/lib/call-outcome-settings.functions";
import { engineProviderConfigForPersona } from "@/lib/voice-provider-settings.functions";
import { campaignStatuses, type CampaignStatus } from "@/lib/campaigns";
import { services } from "@/lib/campaign-setup";
import { personaSnapshot, workflowForPurpose } from "@/lib/voice-engine/persona";
import {
  cancelEngineJob,
  dispatchCampaignToEngine,
  VoiceEngineNotConfiguredError,
  VoiceEngineUnavailableError,
} from "@/lib/voice-engine/client";

const statusSchema = z.enum(campaignStatuses);

// ASSUMPTION (flagged, not approved): the only allowed status transitions. Confirm against
// the real product workflow before relying on it.
export const ALLOWED_CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  Scheduled: ["Active", "Paused", "Completed"],
  Active: ["Paused", "Completed", "Out of credits", "Credit cap reached"],
  Paused: ["Active", "Completed"],
  "Out of credits": ["Active", "Completed"],
  "Credit cap reached": ["Active", "Completed"],
  Completed: [],
};

export interface CampaignCallStats {
  calls: number;
  minutes: number;
  interested: number;
}

export interface CampaignList {
  client: Awaited<ReturnType<typeof currentWorkspaceClient>>;
  campaigns: CampaignRow[];
  leadCounts: Record<string, number>;
  callStats: Record<string, CampaignCallStats>;
}

export async function listCampaignsFor(
  database: PrismaClient,
  userId: string,
): Promise<CampaignList> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { client: null, campaigns: [], leadCounts: {}, callStats: {} };

  const [campaigns, leadGroups, calls] = await Promise.all([
    database.campaign.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" } }),
    database.lead.groupBy({
      by: ["campaignId"],
      where: { clientId: client.id },
      _count: { _all: true },
    }),
    database.call.findMany({
      where: { clientId: client.id, campaignId: { not: null } },
      select: { campaignId: true, durationSeconds: true, outcome: true },
    }),
  ]);

  const leadCounts: Record<string, number> = {};
  for (const group of leadGroups) leadCounts[group.campaignId] = group._count._all;

  const callStats: Record<string, CampaignCallStats> = {};
  for (const call of calls) {
    const campaignId = call.campaignId;
    if (!campaignId) continue;
    const stats = (callStats[campaignId] ??= { calls: 0, minutes: 0, interested: 0 });
    stats.calls += 1;
    stats.minutes += Math.round(call.durationSeconds / 60);
    if (call.outcome.trim().toLowerCase() === "interested") stats.interested += 1;
  }

  return { client, campaigns, leadCounts, callStats };
}

const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(100),
  purpose: z.enum(services as [string, ...string[]]),
  callingStart: z.string().regex(/^\d{2}:\d{2}$/),
  callingEnd: z.string().regex(/^\d{2}:\d{2}$/),
  maxTries: z.number().int().min(1),
  retryGapMinutes: z.number().int().min(1),
  callbackWindowDays: z.number().int().min(1),
  personaKey: z.string().min(1),
  voice: z.string().min(1),
  // The real provider voice behind that display name (GET /voices); optional so an older caller that
  // only knows the label still works, applying no voice override (the agent keeps its current one).
  voiceId: z.string().min(1).optional(),
  voiceModelId: z.string().min(1).optional(),
  ambience: z.boolean(),
  creditCap: z.number().int().positive().nullable(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  rows: z.array(z.object({
    name: z.string().trim().max(100), phone: z.string().regex(/^\+?\d{7,15}$/),
  })).min(1).max(5000).optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export async function createCampaignFor(
  database: PrismaClient,
  userId: string,
  input: CreateCampaignInput,
): Promise<CampaignRow> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  if (input.callingEnd <= input.callingStart) {
    throw new Error("Calling hours must end after they start.");
  }
  if (input.scheduledAt && new Date(input.scheduledAt) <= new Date())
    throw new Error("Choose a future start date and time.");
  return database.campaign.create({
    data: {
      clientId: client.id,
      name: input.name,
      purpose: input.purpose,
      status: "Scheduled",
      personaKey: input.personaKey,
      voice: input.voice,
      voiceId: input.voiceId ?? "",
      voiceModelId: input.voiceModelId ?? "",
      ambience: input.ambience,
      callingStart: input.callingStart,
      callingEnd: input.callingEnd,
      maxTries: input.maxTries,
      retryGapMinutes: input.retryGapMinutes,
      callbackWindowDays: input.callbackWindowDays,
      creditCap: input.creditCap,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      ...(input.rows?.length ? { leads: { createMany: {
        data: input.rows.map((row) => ({ clientId: client.id, name: row.name || "—", phone: row.phone })),
        skipDuplicates: true,
      } } } : {}),
    },
  });
}

export async function updateCampaignStatusFor(
  database: PrismaClient,
  userId: string,
  input: { campaignId: string; nextStatus: CampaignStatus },
) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");

  const existing = await database.campaign.findFirst({
    where: { id: input.campaignId, clientId: client.id },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error("Campaign not found.");

  const current = existing.status as CampaignStatus;
  if (!ALLOWED_CAMPAIGN_TRANSITIONS[current]?.includes(input.nextStatus)) {
    throw new Error(`Cannot move a campaign from "${current}" to "${input.nextStatus}".`);
  }

  // Compare-and-set: if another request changed the status since we read it, nothing updates.
  const result = await database.campaign.updateMany({
    where: { id: existing.id, clientId: client.id, status: current },
    data: { status: input.nextStatus },
  });
  if (result.count === 0) {
    throw new Error("This campaign changed while you were editing. Refresh and try again.");
  }
  return { campaignId: existing.id, status: input.nextStatus };
}

const updateCampaignDetailsSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  purpose: z.enum(services as [string, ...string[]]),
  personaKey: z.string().min(1),
  callingStart: z.string().regex(/^\d{2}:\d{2}$/),
  callingEnd: z.string().regex(/^\d{2}:\d{2}$/),
});
export type UpdateCampaignDetailsInput = z.infer<typeof updateCampaignDetailsSchema>;

export async function updateCampaignDetailsFor(
  database: PrismaClient,
  userId: string,
  input: UpdateCampaignDetailsInput,
): Promise<CampaignRow> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  if (input.callingEnd <= input.callingStart) {
    throw new Error("Calling hours must end after they start.");
  }

  const result = await database.campaign.updateMany({
    where: { id: input.campaignId, clientId: client.id },
    data: {
      name: input.name,
      purpose: input.purpose,
      personaKey: input.personaKey,
      callingStart: input.callingStart,
      callingEnd: input.callingEnd,
    },
  });
  if (result.count === 0) throw new Error("Campaign not found.");
  return database.campaign.findFirstOrThrow({
    where: { id: input.campaignId, clientId: client.id },
  });
}

export interface DispatchResult {
  ok: boolean;
  jobId?: string;
  reason?: string;
}

// The engine can dial 10-15 digit numbers; the lead table also accepts shorter ones (7-15).
const DIALLABLE_PHONE = /^\+?[0-9]{10,15}$/;

// Statuses a campaign can be started from. Completed campaigns stay completed.
const STARTABLE_STATUSES = ["Scheduled", "Paused", "Out of credits", "Credit cap reached"];

/**
 * Creates a dispatch job and hands the campaign to the external voice engine, then marks the
 * campaign Active. The partial unique index "one active job per campaign" stops a
 * double-submitted click from starting two runs. Success is reported only after the engine
 * accepts the job; the engine then calls the leads and reports back by webhook.
 */
export async function dispatchCampaign(
  database: PrismaClient,
  params: { campaignId: string; clientId: string; webhookUrl: string },
): Promise<DispatchResult> {
  const campaign = await database.campaign.findFirst({
    where: { id: params.campaignId, clientId: params.clientId },
  });
  if (!campaign) return { ok: false, reason: "Campaign not found." };
  if (campaign.status === "Completed") {
    return {
      ok: false,
      reason: "This campaign is completed. Create a new campaign to call again.",
    };
  }

  // The persona is read now, at start, so the campaign says what the Prompts page holds at this moment.
  const prompt = await database.prompt.findFirst({
    where: { clientId: params.clientId, personaKey: campaign.personaKey },
  });
  if (!prompt) {
    return {
      ok: false,
      reason: `The persona "${campaign.personaKey}" doesn't exist. Choose another persona in the campaign settings.`,
    };
  }
  if (!prompt.active) {
    return {
      ok: false,
      reason: `The persona "${prompt.name}" is switched off. Turn it on in Prompts or choose another persona.`,
    };
  }
  const persona = personaSnapshot(prompt, workflowForPurpose(campaign.purpose));
  if (!persona) {
    return {
      ok: false,
      reason: `The persona "${prompt.name}" uses ${prompt.language}, which the voice engine can't speak yet.`,
    };
  }

  const client = await database.client.findUnique({
    where: { id: params.clientId },
    select: { creditBalance: true, status: true },
  });
  if (client?.status !== "active") return { ok: false, reason: "Workspace is not active." };
  if (!client || client.creditBalance <= 0) {
    return {
      ok: false,
      reason: "Your workspace has no credits left. Add credits to start calling.",
    };
  }

  const queued = await database.lead.findMany({
    where: { campaignId: campaign.id, clientId: params.clientId,
      queueState: { in: ["Queued", "Retry scheduled"] } },
    select: { id: true, phone: true, name: true, attempts: true, followUpAt: true },
  });
  if (!queued.length) return { ok: false, reason: "No queued leads to call." };

  const leads = queued.filter((lead) => DIALLABLE_PHONE.test(lead.phone) && lead.attempts < campaign.maxTries)
    .map(({ followUpAt, ...lead }) => ({ ...lead, ...(followUpAt ? { nextAttemptAt: followUpAt.toISOString() } : {}) }));
  const undiallable = queued.filter((lead) => !DIALLABLE_PHONE.test(lead.phone));
  const exhausted = queued.filter((lead) => lead.attempts >= campaign.maxTries);
  if (exhausted.length) {
    await database.lead.updateMany({
      where: { id: { in: exhausted.map((lead) => lead.id) }, clientId: params.clientId, campaignId: campaign.id },
      data: { queueState: "Exhausted" },
    });
  }
  if (undiallable.length) {
    await database.lead.updateMany({
      where: { id: { in: undiallable.map((lead) => lead.id) }, campaignId: campaign.id },
      data: { queueState: "Exhausted", outcome: "Invalid number" },
    });
  }
  if (!leads.length) {
    return { ok: false, reason: "No eligible leads remain: numbers are invalid or attempts are exhausted." };
  }

  let job = await database.voiceEngineJob.findFirst({
    where: { campaignId: campaign.id, clientId: params.clientId, status: "pending", engineJobId: null },
    select: { id: true, idempotencyKey: true },
  });
  try {
    job ??= await database.voiceEngineJob.create({
      data: {
        clientId: params.clientId,
        campaignId: campaign.id,
        status: "pending",
        personaVersion: prompt.currentVersion,
      },
      select: { id: true, idempotencyKey: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The blocking job may be an orphan: the engine accepted an earlier attempt, but saving that
      // locally failed, so it is still marked "failed" with an engine_job_id the dispatcher never
      // cancelled. Say so specifically — Pause now cancels it (see stopCampaignDispatch) — instead of
      // implying a second dispatch is simply running normally.
      const orphan = await database.voiceEngineJob.findFirst({
        where: { campaignId: campaign.id, status: "failed", engineJobId: { not: null } },
        select: { id: true },
      });
      return {
        ok: false,
        reason: orphan
          ? "This campaign has an unreconciled call batch from a previous attempt. Pause the campaign " +
            "to cancel those calls, then start it again."
          : "This campaign already has a dispatch in progress.",
      };
    }
    throw error;
  }

  // The workspace's own Call Outcome Rules, current right now; empty means the engine's fixed per-workflow
  // list is used, exactly as before this existed.
  const { outcomeRules, outcomeFallback } = await engineOutcomeRulesForClient(database, params.clientId);
  // The resolved Persona -> Workspace -> Global provider choice; omitted keys mean the engine's own
  // global default, exactly as before these settings existed.
  const providerConfig = await engineProviderConfigForPersona(database, params.clientId, prompt);

  let response;
  try {
    response = await dispatchCampaignToEngine({
      idempotencyKey: job.idempotencyKey,
      campaignId: campaign.id,
      clientId: params.clientId,
      persona: { ...persona, outcomeRules, ...(outcomeFallback ? { outcomeFallback } : {}), ...providerConfig },
      callingWindow: { start: campaign.callingStart, end: campaign.callingEnd },
      retryPolicy: {
        maxTries: campaign.maxTries,
        retryGapMinutes: campaign.retryGapMinutes,
        callbackWindowDays: campaign.callbackWindowDays,
      },
      leads,
      webhookUrl: params.webhookUrl,
      ...(campaign.scheduledAt ? { notBefore: campaign.scheduledAt.toISOString() } : {}),
      // Sent only when the campaign actually chose a real voice; omitted keeps the agent's current one.
      ...(campaign.voiceId && campaign.voiceModelId
        ? { voiceId: campaign.voiceId, ttsModelId: campaign.voiceModelId }
        : {}),
    });
  } catch (error) {
    // The engine was never confirmed to have accepted this job, so there is no engine_job_id to keep.
    const reason =
      error instanceof VoiceEngineNotConfiguredError
        ? "Voice engine is not configured yet."
        : error instanceof VoiceEngineUnavailableError
          ? error.message
          : "Unexpected error dispatching to the voice engine.";
    await database.voiceEngineJob.update({
      where: { id: job.id },
      // Acceptance may have succeeded before the response was lost. Keep the same key on retry.
      data: { status: "pending", lastError: reason },
    });
    return { ok: false, reason };
  }

  if (response.status === "rejected" || !response.engineJobId) {
    const reason = response.reason ?? "The voice engine rejected this campaign.";
    await database.voiceEngineJob.update({
      where: { id: job.id },
      data: { status: "failed", lastError: reason },
    });
    return { ok: false, reason };
  }

  try {
    await database.$transaction([
      database.voiceEngineJob.update({
        where: { id: job.id },
        data: { status: "dispatched", engineJobId: response.engineJobId, dispatchedAt: new Date() },
      }),
      database.campaign.updateMany({
        where: { id: campaign.id, clientId: params.clientId, status: { in: STARTABLE_STATUSES } },
        data: { status: "Active" },
      }),
    ]);
    return { ok: true, jobId: job.id };
  } catch {
    // The engine already accepted engineJobId and may already be dialling: only OUR save failed. Keep
    // the id so the orphan can still be reconciled or cancelled instead of being lost track of entirely.
    // If even that fails (e.g. the id somehow collides with another row — engine_job_id is unique), fall
    // back to recording the failure without it rather than letting a second error escape unhandled.
    try {
      await database.voiceEngineJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lastError: "The voice engine accepted this dispatch, but it could not be saved here.",
          engineJobId: response.engineJobId,
        },
      });
    } catch {
      await database.voiceEngineJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lastError: `The voice engine accepted this dispatch (${response.engineJobId}), but it could not be saved here.`,
        },
      });
    }
    return {
      ok: false,
      reason:
        "The voice engine accepted this campaign, but Mona could not record it. It has been marked " +
        "failed; pause the campaign to cancel those calls before trying again.",
    };
  }
}

/**
 * Tells the engine to stop calling for a campaign. Throws if the engine cannot be reached, so a
 * campaign is never shown as paused while calls could still go out. In-flight calls finish.
 *
 * Also reconciles an orphaned job: one the engine accepted (it has an engine_job_id) but that Mona
 * never managed to save as "dispatched", left behind at status "failed" by dispatchCampaign's own
 * recovery path. It is still cancelled here exactly like a normal running job — "failed" only means
 * Mona's record of it is wrong, not that the engine ever stopped calling for it.
 */
export async function stopCampaignDispatch(
  database: PrismaClient,
  params: { campaignId: string; clientId: string },
): Promise<void> {
  const uncertain = await database.voiceEngineJob.findFirst({
    where: { campaignId: params.campaignId, clientId: params.clientId, status: "pending", engineJobId: null },
    select: { id: true },
  });
  if (uncertain) throw new Error("Dispatch acceptance is unconfirmed. Retry Start safely, then pause the campaign.");
  const jobs = await database.voiceEngineJob.findMany({
    where: {
      campaignId: params.campaignId,
      clientId: params.clientId,
      status: { notIn: ["completed", "cancelled"] },
      engineJobId: { not: null },
    },
    select: { id: true, status: true, engineJobId: true },
  });
  for (const job of jobs) {
    try {
      await cancelEngineJob(job.engineJobId!);
    } catch (error) {
      const detail =
        error instanceof VoiceEngineNotConfiguredError ||
        error instanceof VoiceEngineUnavailableError
          ? error.message
          : "Unexpected error.";
      throw new Error(`Couldn't stop the calls, so the campaign was not changed. ${detail}`);
    }
    if (job.status === "failed") {
      // An orphan: its status already looks terminal, so the engine's own job.cancelled webhook will
      // be recorded but ignored (processWebhookEvent never changes an already-terminal job). Without
      // this, it would stay "failed" forever and keep blocking every later Start on this campaign.
      await database.voiceEngineJob.update({
        where: { id: job.id },
        data: { status: "cancelled" },
      });
    }
  }
}

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => listCampaignsFor(db, context.userId));

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(createCampaignSchema)
  .handler(async ({ context, data }) => {
    // Persist campaign + imported leads together, then register work with the existing engine
    // before answering the browser. No client-side timer or second request is needed to arm it.
    const campaign = await createCampaignFor(db, context.userId, data);
    let dispatch: DispatchResult | undefined;
    if (data.rows?.length) {
      const baseUrl = process.env["APP_BASE_URL"]?.replace(/\/+$/, "");
      try {
        dispatch = baseUrl ? await dispatchCampaign(db, {
          campaignId: campaign.id, clientId: campaign.clientId,
          webhookUrl: `${baseUrl}/api/webhooks/voice-engine`,
        }) : { ok: false, reason: "APP_BASE_URL is not configured." };
      } catch {
        dispatch = { ok: false, reason: "Execution was not confirmed. Use Start to retry safely." };
      }
    }
    return { ...campaign, dispatch };
  });

export const updateCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ campaignId: z.string().uuid(), nextStatus: statusSchema }))
  .handler(async ({ context, data }) => {
    if (data.nextStatus === "Paused" || data.nextStatus === "Completed") {
      const client = await currentWorkspaceClient(db, context.userId);
      if (client)
        await stopCampaignDispatch(db, { campaignId: data.campaignId, clientId: client.id });
    }
    return updateCampaignStatusFor(db, context.userId, data);
  });

export const updateCampaignDetails = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(updateCampaignDetailsSchema)
  .handler(({ context, data }) => updateCampaignDetailsFor(db, context.userId, data));

export const startCampaignDispatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ campaignId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const client = await currentWorkspaceClient(db, context.userId);
    if (!client) throw new Error("Your account isn't linked to a workspace yet.");
    const baseUrl = process.env["APP_BASE_URL"]?.replace(/\/+$/, "");
    if (!baseUrl) return { ok: false, reason: "APP_BASE_URL is not configured." } as DispatchResult;
    return dispatchCampaign(db, {
      campaignId: data.campaignId,
      clientId: client.id,
      webhookUrl: `${baseUrl}/api/webhooks/voice-engine`,
    });
  });
