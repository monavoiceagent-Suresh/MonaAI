import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { isUniqueViolation } from "@/lib/db-errors";
import { normalizeOutcome } from "@/lib/outcomes";
import type { QueueState } from "@/lib/campaigns";
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
 * Applies a credit delta and writes its ledger row. The guard lives in the UPDATE itself,
 * so two concurrent debits cannot both pass a stale balance check.
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
    WHERE id = ${clientId}::uuid AND credit_balance + ${amount} >= 0`;
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
  try {
    return await database.$transaction(async (tx): Promise<WebhookResult> => {
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
          break;
        case "call.completed":
        case "call.failed": {
          // The lead id comes from the engine, so it is only trusted for this job's own campaign.
          const lead =
            event.data.leadId && UUID.test(event.data.leadId)
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
          const outcome = normalizeOutcome(event.data.outcome, { failed });
          const reportedAt = new Date(event.occurredAt);
          const leadPhone = event.data.leadPhone;
          const transcriptRef = event.data.transcriptRef;
          await tx.call.create({
            data: {
              clientId: job.clientId,
              campaignId: job.campaignId,
              leadId: lead?.id ?? null,
              jobId: job.id,
              direction: "outbound",
              dialledNumber: leadPhone && PHONE.test(leadPhone) ? leadPhone : null,
              status: failed ? "failed" : "completed",
              engineCallId: event.data.engineCallId ?? null,
              outcome,
              outcomeRaw: event.data.outcome?.slice(0, 200) ?? null,
              durationSeconds: event.data.durationSeconds ?? 0,
              transcriptUrl: event.data.transcriptUrl ?? null,
              transcriptRef:
                transcriptRef && DIGITS_ONLY.test(transcriptRef) ? transcriptRef : null,
              reportedAt: isNaN(+reportedAt) ? null : reportedAt,
            },
          });
          if (lead) {
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
          await tx.voiceEngineJob.update({
            where: { id: job.id },
            data: {
              status: JOB_STATUS_FOR[event.eventType],
              lastError: event.data.errorMessage ?? null,
              completedAt: new Date(),
            },
          });
          const minutes = event.data.minutesUsed ?? 0;
          if (minutes > 0) {
            await applyCreditTransaction(
              tx,
              job.clientId,
              -Math.ceil(minutes * CREDITS_PER_MINUTE),
              `Voice engine usage for job ${job.id} (${minutes} min)`,
            );
          }
          // A finished run completes the campaign; a failed one pauses it so it can be resumed.
          // A cancelled run was requested by a pause/complete, which already set the status.
          if (event.eventType !== "job.cancelled") {
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
      return { processed: false, reason: "duplicate event" };
    throw error;
  }
}
