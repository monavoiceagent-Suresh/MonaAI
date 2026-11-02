import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { bucketCalls, rangeStart, summarizeCalls, type Range } from "@/lib/workspace-metrics";

const rangeSchema = z.enum(["today", "7d", "30d"]);

export interface WorkspaceClient {
  id: string;
  name: string;
  status: string;
  creditBalance: number;
}

export interface OverviewCallback {
  id: string;
  contact: string;
  direction: "inbound" | "outbound";
  summary: string;
  date: string;
}

export interface CampaignPerformance {
  id: string;
  name: string;
  leads: number;
  calls: number;
  interested: number;
}

export interface WorkspaceOverview {
  client: WorkspaceClient | null;
  calls: ReturnType<typeof summarizeCalls>;
  bars: ReturnType<typeof bucketCalls>;
  totals: { activeCampaigns: number; leads: number; callbackRequests: number };
  /** The newest callback requests (calls whose outcome is "Callback"). */
  callbacks: OverviewCallback[];
  campaignPerformance: CampaignPerformance[];
}

const NO_TOTALS = { activeCampaigns: 0, leads: 0, callbackRequests: 0 };

/**
 * The caller's workspace, resolved from their own membership row. Every tenant-scoped
 * service starts here, so no client id ever comes from request input.
 *
 * A suspended workspace resolves to null here, exactly like having no workspace at all. This
 * is the single enforcement point for Super Admin suspension: every tenant-scoped server
 * function already treats "no workspace" as "nothing to do," so suspending a tenant blocks
 * every one of those operations (campaigns, leads, prompts, calls, inbound numbers, outcome
 * rules, test calls) without each of them needing its own suspension check.
 */
export async function currentWorkspaceClient(
  database: PrismaClient,
  userId: string,
): Promise<WorkspaceClient | null> {
  const membership = await database.clientMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { clientId: true },
  });
  if (!membership) return null;
  const client = await database.client.findUnique({
    where: { id: membership.clientId },
    select: { id: true, name: true, status: true, creditBalance: true },
  });
  return client && client.status === "active" ? client : null;
}

/** Whether the caller's own (oldest) workspace is suspended — used to block sign-in outright,
 * before a session is even issued. False if the caller has no workspace at all. */
export async function isCallerWorkspaceSuspended(
  database: PrismaClient,
  userId: string,
): Promise<boolean> {
  const membership = await database.clientMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { client: { select: { status: true } } },
  });
  return membership?.client.status === "suspended";
}

export async function getWorkspaceCreditsFor(database: PrismaClient, userId: string) {
  return { client: await currentWorkspaceClient(database, userId) };
}

export async function getWorkspaceOverviewFor(
  database: PrismaClient,
  userId: string,
  range: Range,
): Promise<WorkspaceOverview> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) {
    return {
      client: null,
      calls: summarizeCalls([]),
      bars: bucketCalls([], range),
      totals: NO_TOTALS,
      callbacks: [],
      campaignPerformance: [],
    };
  }

  const [rows, activeCampaigns, leads, callbackRequests, callbackCalls, campaigns] =
    await Promise.all([
      database.call.findMany({
        where: { clientId: client.id, createdAt: { gte: rangeStart(range) } },
        select: { outcome: true, durationSeconds: true, createdAt: true },
      }),
      database.campaign.count({ where: { clientId: client.id, status: "Active" } }),
      database.lead.count({ where: { clientId: client.id } }),
      database.call.count({ where: { clientId: client.id, outcome: "Callback" } }),
      database.call.findMany({
        where: { clientId: client.id, outcome: "Callback" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 4,
        select: {
          id: true,
          direction: true,
          callerNumber: true,
          dialledNumber: true,
          summary: true,
          createdAt: true,
        },
      }),
      database.campaign.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { id: true, name: true },
      }),
    ]);
  const campaignIds = campaigns.map((c) => c.id);
  const [leadGroups, callGroups, interestedGroups] = await Promise.all([
    database.lead.groupBy({
      by: ["campaignId"],
      where: { clientId: client.id, campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    database.call.groupBy({
      by: ["campaignId"],
      where: { clientId: client.id, campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    database.call.groupBy({
      by: ["campaignId"],
      where: { clientId: client.id, campaignId: { in: campaignIds }, outcome: "Interested" },
      _count: { _all: true },
    }),
  ]);
  const countFor = (
    groups: { campaignId: string | null; _count: { _all: number } }[],
    id: string,
  ) => groups.find((g) => g.campaignId === id)?._count._all ?? 0;
  const normalized = rows.map((row) => ({
    outcome: row.outcome,
    duration_seconds: row.durationSeconds,
    created_at: row.createdAt.toISOString(),
  }));
  return {
    client,
    calls: summarizeCalls(normalized),
    bars: bucketCalls(normalized, range),
    totals: { activeCampaigns, leads, callbackRequests },
    callbacks: callbackCalls.map((call) => ({
      id: call.id,
      contact: (call.direction === "inbound" ? call.callerNumber : call.dialledNumber) ?? "",
      direction: call.direction === "inbound" ? "inbound" : "outbound",
      summary: call.summary ?? "",
      date: call.createdAt.toISOString(),
    })),
    campaignPerformance: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      leads: countFor(leadGroups, c.id),
      calls: countFor(callGroups, c.id),
      interested: countFor(interestedGroups, c.id),
    })),
  };
}

export const getWorkspaceCredits = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => getWorkspaceCreditsFor(db, context.userId));

export const getWorkspaceOverview = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .validator(rangeSchema)
  .handler(({ context, data }) => getWorkspaceOverviewFor(db, context.userId, data));
