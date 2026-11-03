import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient, type WorkspaceClient } from "@/lib/workspace.functions";
import {
  PAGE_SIZE,
  durationBounds,
  rangeStart,
  summarizeStats,
  type CallRecordView,
  type CallStats,
} from "@/lib/call-records";
import { getEngineCall, getEngineRecording } from "@/lib/voice-engine/client";

const EXPORT_LIMIT = 5_000;

export const callFilterSchema = z.object({
  direction: z.enum(["inbound", "outbound", "all"]).default("all"),
  query: z.string().trim().max(60).default(""),
  outcome: z.string().max(60).default("All"),
  duration: z.enum(["All", "Short", "Medium", "Long"]).default("All"),
  range: z.enum(["All", "Today", "7", "30"]).default("All"),
  campaignId: z.union([z.literal("All"), z.string().uuid()]).default("All"),
  dialled: z.string().max(20).default("All"),
});
export type CallFilter = z.infer<typeof callFilterSchema>;

export const callListSchema = callFilterSchema.extend({
  page: z.number().int().min(0).max(100_000).default(0),
});
export type CallListInput = z.infer<typeof callListSchema>;

export interface CallList {
  client: WorkspaceClient | null;
  rows: CallRecordView[];
  total: number;
  stats: CallStats;
  /** How many of the calls matching every filter except direction are inbound / outbound. */
  byDirection: { inbound: number; outbound: number };
  campaigns: { id: string; name: string }[];
  /** Our numbers that inbound calls were dialled on, for the number filter. */
  numbers: string[];
}

type CallWithRelations = Prisma.CallGetPayload<{
  include: { lead: { select: { name: true } }; campaign: { select: { name: true } } };
}>;

/** The details the agent collected, as display text. Whatever the agent produced is shown, never interpreted. */
function fieldsAsText(fields: Prisma.JsonValue): { key: string; value: string }[] {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      value: (value === null
        ? "—"
        : typeof value === "string"
          ? value
          : JSON.stringify(value)
      ).slice(0, 500),
    }));
}

function viewOf(call: CallWithRelations): CallRecordView {
  const inbound = call.direction === "inbound";
  const fields = call.collectedFields;
  return {
    id: call.id,
    direction: inbound ? "inbound" : "outbound",
    contact: (inbound ? call.callerNumber : call.dialledNumber) ?? "",
    name: call.lead?.name ?? "—",
    campaign: call.campaign?.name ?? null,
    dialled: inbound ? call.dialledNumber : null,
    outcome: call.outcome,
    outcomeRaw: call.outcomeRaw,
    status: call.status,
    duration: call.durationSeconds,
    date: call.createdAt.toISOString(),
    summary: call.summary ?? "",
    collectedFields: fieldsAsText(fields),
    transcriptAvailable: Boolean(call.transcriptRef),
  };
}

/** The filter as a query that can only ever see the caller's own workspace. */
function whereFor(clientId: string, input: CallFilter, now: Date): Prisma.CallWhereInput {
  const start = rangeStart(input.range, now);
  const digits = input.query.replace(/[^0-9+]/g, "");
  const bounds = durationBounds(input.duration);
  const where: Prisma.CallWhereInput = { clientId };
  if (input.direction !== "all") where.direction = input.direction;
  if (input.outcome !== "All") where.outcome = input.outcome;
  if (input.campaignId !== "All") where.campaignId = input.campaignId;
  if (input.dialled !== "All") where.dialledNumber = input.dialled;
  if (start) where.createdAt = { gte: start };
  if (input.duration !== "All") where.durationSeconds = bounds;
  if (input.query) {
    where.OR = [
      { lead: { name: { contains: input.query, mode: "insensitive" } } },
      ...(digits.length >= 3
        ? [{ callerNumber: { contains: digits } }, { dialledNumber: { contains: digits } }]
        : []),
    ];
  }
  return where;
}

const include = { lead: { select: { name: true } }, campaign: { select: { name: true } } } as const;
const newestFirst = [{ createdAt: "desc" }, { id: "desc" }] as const;

export async function listCallsFor(
  database: PrismaClient,
  userId: string,
  input: CallListInput,
  now: Date = new Date(),
): Promise<CallList> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) {
    return {
      client: null,
      rows: [],
      total: 0,
      stats: summarizeStats(0, 0, null, 0),
      byDirection: { inbound: 0, outbound: 0 },
      campaigns: [],
      numbers: [],
    };
  }
  const where = whereFor(client.id, input, now);
  // "Connected" means some talk time, inside whatever duration filter is chosen.
  const bounds = durationBounds(input.duration);
  const connectedBounds = { ...bounds, gt: bounds.gt ?? 0 };

  const [rows, total, connected, average, interested, directions, campaigns, numbers] =
    await Promise.all([
      database.call.findMany({
        where,
        include,
        orderBy: [...newestFirst],
        skip: input.page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      database.call.count({ where }),
      database.call.count({ where: { ...where, durationSeconds: connectedBounds } }),
      database.call.aggregate({
        where: { ...where, durationSeconds: connectedBounds },
        _avg: { durationSeconds: true },
      }),
      database.call.count({ where: { ...where, outcome: "Interested" } }),
      database.call.groupBy({
        by: ["direction"],
        where: whereFor(client.id, { ...input, direction: "all" }, now),
        _count: { _all: true },
      }),
      database.campaign.findMany({
        where: { clientId: client.id },
        select: { id: true, name: true },
        orderBy: { createdAt: "desc" },
      }),
      database.call.findMany({
        where: { clientId: client.id, direction: "inbound", dialledNumber: { not: null } },
        distinct: ["dialledNumber"],
        select: { dialledNumber: true },
      }),
    ]);

  return {
    client,
    rows: rows.map(viewOf),
    total,
    stats: summarizeStats(total, connected, average._avg.durationSeconds, interested),
    byDirection: {
      inbound: directions.find((d) => d.direction === "inbound")?._count._all ?? 0,
      outbound: directions.find((d) => d.direction === "outbound")?._count._all ?? 0,
    },
    campaigns,
    numbers: numbers.map((n) => n.dialledNumber!).sort(),
  };
}

/** Every call matching the filters (up to a limit), for CSV export: the same filters the table shows. */
export async function exportCallsFor(
  database: PrismaClient,
  userId: string,
  input: CallFilter,
  now: Date = new Date(),
): Promise<CallRecordView[]> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return [];
  const rows = await database.call.findMany({
    where: whereFor(client.id, input, now),
    include,
    orderBy: [...newestFirst],
    take: EXPORT_LIMIT,
  });
  return rows.map(viewOf);
}

export interface TranscriptTurn {
  index: number;
  caller: string | null;
  agent: string;
}
export interface CallTranscript {
  available: boolean;
  turns: TranscriptTurn[];
}

const lastTen = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").slice(-10);

/**
 * A call's transcript, read from the engine on demand. Nothing about the engine reaches the browser:
 * not its address, its key or a link. The call must be one of the caller's own, and the engine's record
 * must be the same call (same direction and number), because the stored reference is only a key.
 */
export async function getCallTranscriptFor(
  database: PrismaClient,
  userId: string,
  input: { callId: string },
): Promise<CallTranscript> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  const call = await database.call.findFirst({
    where: { id: input.callId, clientId: client.id },
    select: { direction: true, dialledNumber: true, transcriptRef: true },
  });
  if (!call) throw new Error("Call not found.");
  if (!call.transcriptRef) return { available: false, turns: [] };

  let detail;
  try {
    detail = await getEngineCall(call.transcriptRef);
  } catch {
    throw new Error("The transcript couldn't be loaded right now. Try again in a moment.");
  }
  const sameCall =
    detail.direction === call.direction &&
    lastTen(detail.to_number) !== "" &&
    lastTen(detail.to_number) === lastTen(call.dialledNumber);
  if (!sameCall) return { available: false, turns: [] };
  return {
    available: true,
    turns: detail.turns.map((t) => ({ index: t.idx, caller: t.user_text, agent: t.agent_text })),
  };
}

export const listCalls = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .validator(callListSchema)
  .handler(({ context, data }) => listCallsFor(db, context.userId, data));

export const exportCalls = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .validator(callFilterSchema)
  .handler(({ context, data }) => exportCallsFor(db, context.userId, data));

export const getCallTranscript = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .validator(z.object({ callId: z.string().uuid() }))
  .handler(({ context, data }) => getCallTranscriptFor(db, context.userId, data));

export async function getCallRecordingFor(database: PrismaClient, userId: string, callId: string) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return new Response(null, { status: 404 });
  const call = await database.call.findFirst({
    where: { id: callId, clientId: client.id },
    select: { engineCallId: true, direction: true, dialledNumber: true },
  });
  if (!call?.engineCallId || !/^\d{1,18}$/.test(call.engineCallId) || !call.dialledNumber) {
    return new Response(null, { status: 404 });
  }
  try {
    return await getEngineRecording(call.engineCallId, client.id, call.direction, call.dialledNumber);
  } catch {
    return new Response(null, { status: 502 });
  }
}

export const getCallRecording = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ callId: z.string().uuid() }))
  .handler(({ context, data }) => getCallRecordingFor(db, context.userId, data.callId));
