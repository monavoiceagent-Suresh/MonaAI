import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { isUniqueViolation } from "@/lib/db-errors";
import { normalizeOutcome } from "@/lib/outcomes";
import type { QueueState } from "@/lib/campaigns";
import { haltOtherActiveCampaignsOnCreditDepletion } from "@/lib/campaigns.functions";
import type { LeadState, VoiceEngineEvent } from "./types";

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signatureHeader, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUEUE_STATE_FOR: Record<LeadState, QueueState> = {
  done: "Done",
  retry: "Retry scheduled",
  exhausted: "Exhausted",
  queued: "Queued",
};

const JOB_STATUS_FOR = {
  "job.completed": "completed",
  "job.cancelled": "cancelled",
  "job.failed": "failed",
} as const;

const DIGITS_ONLY = /^[0-9]{1,18}$/;
const PHONE = /^\+?[0-9]{5,15}$/;

// ASSUMPTION (flagged, not approved): 1 reported engine minute = 1 credit by default.
const CREDITS_PER_MINUTE = Number(process.env["VOICE_ENGINE_CREDITS_PER_MINUTE"] ?? "1");

export class InsufficientCreditsError extends Error {}

/**
 * Record actual usage atomically, including overrun (the schema already permits negative
 * balances). A completed call must not leave its job unfinishable while waiting for a top-up.
 */
export async function applyCreditTransaction(
  tx: Prisma.TransactionClient,
  clientId: string,
  amount: number,
  note: string,
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE clients
    SET credit_balance = credit_balance + ${amount}
    WHERE id = ${clientId}::uuid`;
  if (updated === 0)
    throw new InsufficientCreditsError(`Client ${clientId} cannot cover ${-amount} credits.`);
  // The only caller today is the automated job-usage debit below, so this is always usage, not
  // a Super Admin manual adjustment (src/lib/super-admin-credits.functions.ts writes that type).
  await tx.creditTransaction.create({ data: { clientId, amount, note, type: "VOICE_USAGE" } });
}

export interface WebhookResult {
  processed: boolean;
  reason?: string;
}

/**
 * Records the event and applies its effects in ONE transaction. If anything fails, the
 * event is not recorded, so the engine's retry is processed instead of being rejected as a duplicate.
 */
export async function processWebhookEvent(
  database: PrismaClient,
  event: VoiceEngineEvent,
): Promise<WebhookResult> {
  // Billing and its pending stop marker commit together. External cancellation runs afterward.
  let result: WebhookResult;
  try {
    result = await database.$transaction(async (tx): Promise<WebhookResult> => {
      const job = await tx.voiceEngineJob.findUnique({
        where: { engineJobId: event.engineJobId },
        select: { id: true, status: true, campaignId: true, clientId: true },
      });
      if (!job) return { processed: false, reason: "unknown engine job id" };

      await tx.voiceEngineWebhookEvent.create({
        data: {
          eventId: event.eventId,
          jobId: job.id,
          eventType: event.eventType,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        return { processed: true, reason: "job already terminal; event recorded only" };
      }

      switch (event.eventType) {
        case "call.started":
        case "call.completed":
        case "call.failed": {
          // The lead id comes from the engine, so it is only trusted for this job's own campaign.
          const lead =
            job.campaignId && event.data.leadId && UUID.test(event.data.leadId)
              ? await tx.lead.findFirst({
                  where: {
                    id: event.data.leadId,
                    campaignId: job.campaignId,
                    clientId: job.clientId,
                  },
                  select: { id: true },
                })
              : null;
          const failed = event.eventType === "call.failed";
          const started = event.eventType === "call.started";
          const outcome = started ? "Not called" : normalizeOutcome(event.data.outcome, { failed });
          const reportedAt = new Date(event.occurredAt);
          const leadPhone = event.data.leadPhone;
          const transcriptRef = event.data.transcriptRef;
          const engineCallId = event.data.engineCallId;
          const existing = engineCallId
            ? await tx.call.findUnique({
                where: { engineCallId },
                select: { clientId: true, jobId: true, status: true },
              })
            : null;
          if (existing && (existing.clientId !== job.clientId || existing.jobId !== job.id))
            throw new Error("Engine call belongs to another job.");
          if (existing && existing.status !== "initiated")
            return { processed: true, reason: "call already terminal" };
          const fields = {
            clientId: job.clientId,
            campaignId: job.campaignId,
            leadId: lead?.id ?? null,
            jobId: job.id,
            direction: "outbound",
            dialledNumber: leadPhone && PHONE.test(leadPhone) ? leadPhone : null,
            status: started ? "initiated" : failed ? "failed" : "completed",
            engineCallId: engineCallId ?? null,
            ...(event.data.callerNumber && PHONE.test(event.data.callerNumber)
              ? { callerNumber: event.data.callerNumber }
              : {}),
            outcome,
            outcomeRaw: event.data.outcome?.slice(0, 200) ?? null,
            durationSeconds: event.data.durationSeconds ?? 0,
            transcriptUrl: event.data.transcriptUrl ?? null,
            transcriptRef: transcriptRef && DIGITS_ONLY.test(transcriptRef) ? transcriptRef : null,
            reportedAt: isNaN(+reportedAt) ? null : reportedAt,
          };
          if (engineCallId) {
            await tx.call.upsert({ where: { engineCallId }, create: fields, update: fields });
          } else {
            await tx.call.create({ data: fields });
          }
          if (lead && !started) {
            const nextAttemptAt = event.data.nextAttemptAt
              ? new Date(event.data.nextAttemptAt)
              : null;
            await tx.lead.update({
              where: { id: lead.id },
              data: {
                outcome,
                attempts: { increment: 1 },
                ...(event.data.leadState && {
                  queueState: QUEUE_STATE_FOR[event.data.leadState],
                  followUpAt:
                    event.data.leadState === "retry" && nextAttemptAt && !isNaN(+nextAttemptAt)
                      ? nextAttemptAt
                      : null,
                }),
              },
            });
          }
          break;
        }
        case "job.completed":
        case "job.cancelled":
        case "job.failed": {
          const finalized = await tx.voiceEngineJob.updateMany({
            where: { id: job.id, status: { notIn: [...TERMINAL_JOB_STATUSES] } },
            data: {
              status: JOB_STATUS_FOR[event.eventType],
              lastError: event.data.errorMessage ?? null,
              completedAt: new Date(),
            },
          });
          if (finalized.count !== 1) return { processed: true, reason: "job already terminal" };
          const minutes = event.data.minutesUsed ?? 0;
          if (minutes > 0) {
            await applyCreditTransaction(
              tx,
              job.clientId,
              -Math.ceil(minutes * CREDITS_PER_MINUTE),
              `Voice engine usage for job ${job.id} (${minutes} min)`,
            );
            await tx.$executeRaw`UPDATE voice_engine_jobs SET credit_stop_pending = true WHERE id = ${job.id}::uuid`;
          }
          // A finished run completes the campaign; a failed one pauses it so it can be resumed.
          // A cancelled run was requested by a pause/complete, which already set the status.
          if (event.eventType === "job.cancelled" && job.campaignId) {
            await tx.lead.updateMany({
              where: {
                campaignId: job.campaignId,
                clientId: job.clientId,
                queueState: "Retry scheduled",
              },
              data: { queueState: "Queued" },
            });
          }
          if (event.eventType !== "job.cancelled" && job.campaignId) {
            await tx.campaign.updateMany({
              where: { id: job.campaignId, clientId: job.clientId, status: "Active" },
              data: { status: event.eventType === "job.completed" ? "Completed" : "Paused" },
            });
          }
          break;
        }
      }
      return { processed: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, "event_id"))
      result = { processed: false, reason: "duplicate event" };
    else throw error;
  }
  // Outside the transaction (and its row lock) on purpose: this calls the voice engine over
  // HTTP (stopCampaignDispatch -> cancelEngineJob), which must never run while a DB transaction
  // is still open.
  // The engine retries this event on 5xx. Pending work survives commit/crash and duplicate delivery.
  const pending = await database.$queryRaw<
    { id: string; client_id: string; campaign_id: string | null }[]
  >`
    SELECT id, client_id, campaign_id FROM voice_engine_jobs WHERE credit_stop_pending = true AND engine_job_id = ${event.engineJobId}`;
  for (const item of pending) {
    await haltOtherActiveCampaignsOnCreditDepletion(database, item.client_id, item.campaign_id);
    await database.$executeRaw`UPDATE voice_engine_jobs SET credit_stop_pending = false WHERE id = ${item.id}::uuid`;
  }
  return result;
}
