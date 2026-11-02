// Super Admin campaign overview: cross-tenant, READ-ONLY. No create/edit/start/stop/lead
// management here by design — those stay exclusively in the Tenant Admin dashboard
// (src/lib/campaigns.functions.ts), which this file never calls into or duplicates.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { campaignStatuses } from "@/lib/campaigns";

const PAGE_SIZE = 20;

const listSchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z.enum(["all", ...campaignStatuses]).default("all"),
  page: z.number().int().min(1).default(1),
});
export type AdminCampaignListInput = z.infer<typeof listSchema>;

export interface AdminCampaignListItem {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string;
  status: string;
  createdAt: string;
  leadCount: number;
  callCount: number;
  interestedCount: number;
}

export interface AdminCampaignListResult {
  campaigns: AdminCampaignListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAllCampaignsFor(
  database: PrismaClient,
  input: AdminCampaignListInput,
): Promise<AdminCampaignListResult> {
  const search = input.search?.trim();
  const where = {
    ...(input.status !== "all" ? { status: input.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { client: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, campaigns] = await Promise.all([
    database.campaign.count({ where }),
    database.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        clientId: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  const campaignIds = campaigns.map((c) => c.id);
  const [leadGroups, calls] = await Promise.all([
    database.lead.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    database.call.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { campaignId: true, outcome: true },
    }),
  ]);
  const leadCounts = new Map(leadGroups.map((g) => [g.campaignId, g._count._all]));
  const callCounts = new Map<string, number>();
  const interestedCounts = new Map<string, number>();
  for (const call of calls) {
    if (!call.campaignId) continue;
    callCounts.set(call.campaignId, (callCounts.get(call.campaignId) ?? 0) + 1);
    if (call.outcome.trim().toLowerCase() === "interested") {
      interestedCounts.set(call.campaignId, (interestedCounts.get(call.campaignId) ?? 0) + 1);
    }
  }

  return {
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      tenantId: c.clientId,
      tenantName: c.client.name,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      leadCount: leadCounts.get(c.id) ?? 0,
      callCount: callCounts.get(c.id) ?? 0,
      interestedCount: interestedCounts.get(c.id) ?? 0,
    })),
  };
}

export interface CampaignSummary {
  total: number;
  active: number;
  paused: number;
  completed: number;
}

export async function getCampaignSummaryFor(database: PrismaClient): Promise<CampaignSummary> {
  const [total, active, paused, completed] = await Promise.all([
    database.campaign.count(),
    database.campaign.count({ where: { status: "Active" } }),
    database.campaign.count({ where: { status: "Paused" } }),
    database.campaign.count({ where: { status: "Completed" } }),
  ]);
  return { total, active, paused, completed };
}

export interface TenantCampaignCount {
  tenantId: string;
  tenantName: string;
  count: number;
}

export async function getTenantCampaignCountsFor(
  database: PrismaClient,
): Promise<TenantCampaignCount[]> {
  const groups = await database.campaign.groupBy({ by: ["clientId"], _count: { _all: true } });
  const clients = await database.client.findMany({
    where: { id: { in: groups.map((g) => g.clientId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(clients.map((c) => [c.id, c.name]));
  return groups
    .map((g) => ({
      tenantId: g.clientId,
      tenantName: nameMap.get(g.clientId) ?? "Unknown",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

export const listAllCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(listSchema)
  .handler(({ data }) => listAllCampaignsFor(db, data));

export const getCampaignSummary = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(() => getCampaignSummaryFor(db));

export const getTenantCampaignCounts = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(() => getTenantCampaignCountsFor(db));
