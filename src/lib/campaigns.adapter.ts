// Maps persisted `campaigns`/`leads` rows onto the UI-facing Campaign/Lead shape
// (src/lib/campaigns.ts), so dashboard components keep one set of display types.
import type { Campaign as CampaignRow, Lead as LeadRow } from "@prisma/client";
import type { Campaign, CampaignStatus, Lead, QueueState } from "@/lib/campaigns";
import type { CampaignCallStats } from "@/lib/campaigns.functions";

export function campaignFromRow(
  row: Pick<
    CampaignRow,
    | "id"
    | "name"
    | "purpose"
    | "status"
    | "createdAt"
    | "personaKey"
    | "voice"
    | "voiceId"
    | "voiceModelId"
    | "voiceStability"
    | "voiceSimilarityBoost"
    | "voiceStyle"
    | "ambience"
    | "callingStart"
    | "callingEnd"
    | "maxTries"
    | "retryGapMinutes"
    | "callbackWindowDays"
  > &
    Partial<Pick<CampaignRow, "scheduledAt" | "creditCap">>,
  leadCount: number,
  stats: CampaignCallStats,
  rows: Lead[] = [],
): Campaign {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    status: row.status as CampaignStatus,
    created: row.createdAt.toISOString().slice(0, 10),
    leads: leadCount,
    calls: stats.calls,
    minutes: stats.minutes,
    interested: stats.interested,
    persona: row.personaKey,
    voice: row.voice,
    voiceId: row.voiceId,
    voiceModelId: row.voiceModelId,
    voiceStability: row.voiceStability,
    voiceSimilarityBoost: row.voiceSimilarityBoost,
    voiceStyle: row.voiceStyle,
    ambience: row.ambience,
    rules: {
      start: row.callingStart,
      end: row.callingEnd,
      days: "All days",
      maxTries: row.maxTries,
      retryGap: row.retryGapMinutes,
      callbackWindow: row.callbackWindowDays,
    },
    rows,
    setup: {
      startMode: row.scheduledAt ? "scheduled" : "immediate",
      scheduledAt: row.scheduledAt
        ? new Date(row.scheduledAt.getTime() + 330 * 60_000).toISOString().slice(0, 16)
        : "",
      retryMode: "immediate",
      retryStart: row.callingStart,
      retryEnd: row.callingEnd,
      retryOutcomes: [],
      outcomes: [],
      creditCap: row.creditCap ?? null,
    },
  };
}

export function leadFromRow(
  row: Pick<
    LeadRow,
    "id" | "name" | "phone" | "outcome" | "queueState" | "attempts" | "followUpAt"
  >,
): Lead {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    outcome: row.outcome,
    endedBy: "—",
    queue: row.queueState as QueueState,
    lastCall: "—", // no per-lead call timestamp is stored yet
    attempts: row.attempts,
    followUp: row.followUpAt ? row.followUpAt.toLocaleString("en-IN") : "—",
  };
}
