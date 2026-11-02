// Super Admin business analytics: platform-wide credit, campaign and call aggregates, all
// computed server-side from real records. There is no revenue, payment, purchase, or expense
// data anywhere in this system (verified by inspection — see docs/technical and the Phase 3
// completion report), so every Revenue/Expense/Profit metric is reported explicitly
// unavailable rather than derived from credit pricing or manual ledger adjustments, which is
// not revenue. Reuses the existing credit/campaign aggregations from Phase 2B wherever the
// shape already matches — only tenant business analytics and the operational/call summary are
// new queries, because their shape (status joined in; date-ranged calls) genuinely differs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { getCreditOverviewFor, listTenantCreditsFor } from "@/lib/super-admin-credits.functions";
import { getCampaignSummaryFor, type CampaignSummary } from "@/lib/super-admin-campaigns.functions";

const PAGE_SIZE = 20;
const TOP_N = 10;
const DEFAULT_TREND_DAYS = 30;

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type DateRangeInput = z.infer<typeof dateRangeSchema>;

/** Only applies to activity (calls, campaigns, adjustments) — a credit balance is a snapshot
 * right now, not an event stream, so date filtering never applies to it. */
function createdAtFilter(range: DateRangeInput) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: new Date(range.from) } : {}),
    ...(range.to ? { lte: new Date(range.to) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Step 2: Business Overview
// ---------------------------------------------------------------------------

export interface BusinessOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalCreditBalance: number;
  totalNegativeBalance: number;
  tenantsWithNegativeBalance: number;
  totalCreditAdjustments: number;
  /** Always false today — no payment/purchase record exists in this system. */
  revenueAvailable: false;
}

export async function getBusinessOverviewFor(
  database: PrismaClient,
  range: DateRangeInput = {},
): Promise<BusinessOverview> {
  const createdAt = createdAtFilter(range);
  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    balanceAgg,
    creditOverview,
    totalCreditAdjustments,
  ] = await Promise.all([
    database.client.count(),
    database.client.count({ where: { status: "active" } }),
    database.client.count({ where: { status: "suspended" } }),
    database.client.aggregate({ _sum: { creditBalance: true } }),
    getCreditOverviewFor(database),
    database.creditTransaction.count({ where: createdAt ? { createdAt } : {} }),
  ]);
  return {
    totalTenants,
    activeTenants,
    suspendedTenants,
    totalCreditBalance: balanceAgg._sum.creditBalance ?? 0,
    totalNegativeBalance: creditOverview.totalOutstandingNegative,
    tenantsWithNegativeBalance: creditOverview.tenantsWithNegativeBalance,
    totalCreditAdjustments,
    revenueAvailable: false,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Financial Analytics — deliberately data-free. See the module comment: there is no
// traceable revenue or expense record anywhere in this system, so nothing is calculated here.
// ---------------------------------------------------------------------------

export interface FinancialAnalytics {
  available: false;
  reason: string;
}

const UNAVAILABLE_REASON =
  "No payment, purchase or expense records exist in this system. Revenue, expenses, net " +
  "profit and profit margin cannot be calculated from manual credit adjustments or the " +
  "configured credit price — those are not revenue.";

export function getFinancialAnalyticsFor(): FinancialAnalytics {
  return { available: false, reason: UNAVAILABLE_REASON };
}

// ---------------------------------------------------------------------------
// Step 4: Tenant Business Analytics
// ---------------------------------------------------------------------------

const tenantAnalyticsSchema = z.object({
  search: z.string().trim().max(255).optional(),
  page: z.number().int().min(1).default(1),
});
export type TenantBusinessAnalyticsInput = z.infer<typeof tenantAnalyticsSchema>;

export interface TenantBusinessRow {
  tenantId: string;
  name: string;
  status: string;
  creditBalance: number;
  // Named for what they are — ledger-derived manual adjustments — never "purchases" or
  // "consumption," per the brief's explicit instruction not to conflate the two. Scoped to
  // type: "MANUAL_ADJUSTMENT" only, so an automated voice-usage debit never shows up as an
  // "adjustment" here (see src/lib/super-admin-credits.functions.ts for the type column).
  totalPositiveAdjustments: number;
  totalNegativeAdjustments: number;
  totalVoiceUsage: number;
  negativeBalanceExposure: number;
  /** Always null: no reliable per-tenant revenue or expense record exists. */
  actualRevenue: null;
  recordedExpenses: null;
}

export interface TenantBusinessListResult {
  tenants: TenantBusinessRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getTenantBusinessAnalyticsFor(
  database: PrismaClient,
  input: TenantBusinessAnalyticsInput,
): Promise<TenantBusinessListResult> {
  // Reuses listTenantCreditsFor's query and aggregation wholesale — only the field names are
  // adapted for this finance-facing context (see the comment on TenantBusinessRow above).
  const credits = await listTenantCreditsFor(database, {
    search: input.search,
    negativeOnly: false,
    page: input.page,
  });
  const statuses = await database.client.findMany({
    where: { id: { in: credits.tenants.map((t) => t.clientId) } },
    select: { id: true, status: true },
  });
  const statusMap = new Map(statuses.map((s) => [s.id, s.status]));
  return {
    total: credits.total,
    page: credits.page,
    pageSize: credits.pageSize,
    tenants: credits.tenants.map((t) => ({
      tenantId: t.clientId,
      name: t.name,
      status: statusMap.get(t.clientId) ?? "active",
      creditBalance: t.creditBalance,
      totalPositiveAdjustments: t.totalManualAdditions,
      totalNegativeAdjustments: t.totalManualDeductions,
      totalVoiceUsage: t.totalVoiceUsage,
      negativeBalanceExposure: t.outstandingNegative,
      actualRevenue: null,
      recordedExpenses: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 5: Credit Analytics
// ---------------------------------------------------------------------------

export interface TenantBalanceComparison {
  tenantId: string;
  tenantName: string;
  creditBalance: number;
}

export interface CreditAdjustmentTrendPoint {
  label: string;
  /** MANUAL_ADJUSTMENT, amount > 0. */
  positive: number;
  /** MANUAL_ADJUSTMENT, amount < 0 (absolute). */
  negative: number;
  /** VOICE_USAGE (absolute) — real call consumption, kept as its own series rather than
   * folded into "negative" so the two are never conflated on the chart either. */
  voiceUsage: number;
}

export interface CreditAnalytics {
  totalCurrentBalance: number;
  totalNegativeBalance: number;
  /** MANUAL_ADJUSTMENT only — see CreditOverview.totalManualAdditions/Deductions. */
  totalPositiveAdjustments: number;
  totalNegativeAdjustments: number;
  totalVoiceUsage: number;
  /** The 5 most negative and 5 most positive current balances — a compact comparison, not a
   * full paginated table (Credits & Billing already has that). */
  tenantComparison: TenantBalanceComparison[];
  trend: CreditAdjustmentTrendPoint[];
}

function dailyAdjustmentBuckets(
  rows: { amount: number; type: string; createdAt: Date }[],
  from: Date,
  to: Date,
): CreditAdjustmentTrendPoint[] {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const buckets = Array.from({ length: days }, () => ({ positive: 0, negative: 0, voiceUsage: 0 }));
  for (const row of rows) {
    const day = Math.floor((row.createdAt.getTime() - from.getTime()) / 86_400_000);
    if (day < 0 || day >= days) continue;
    if (row.type === "VOICE_USAGE") {
      buckets[day]!.voiceUsage += Math.abs(row.amount);
    } else if (row.amount > 0) {
      buckets[day]!.positive += row.amount;
    } else {
      buckets[day]!.negative += Math.abs(row.amount);
    }
  }
  return buckets.map((b, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return { label: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }), ...b };
  });
}

export async function getCreditAnalyticsFor(
  database: PrismaClient,
  range: DateRangeInput = {},
): Promise<CreditAnalytics> {
  const to = range.to ? new Date(range.to) : new Date();
  const from = range.from
    ? new Date(range.from)
    : new Date(to.getTime() - (DEFAULT_TREND_DAYS - 1) * 86_400_000);

  const [overview, lowest, highest, transactionsInRange] = await Promise.all([
    getCreditOverviewFor(database),
    database.client.findMany({
      orderBy: { creditBalance: "asc" },
      take: 5,
      select: { id: true, name: true, creditBalance: true },
    }),
    database.client.findMany({
      orderBy: { creditBalance: "desc" },
      take: 5,
      select: { id: true, name: true, creditBalance: true },
    }),
    database.creditTransaction.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { amount: true, type: true, createdAt: true },
    }),
  ]);

  const totalCurrentBalanceAgg = await database.client.aggregate({ _sum: { creditBalance: true } });
  const manual = transactionsInRange.filter((t) => t.type === "MANUAL_ADJUSTMENT");
  const positiveTotal = manual.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const negativeTotal = manual
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const voiceUsageTotal = transactionsInRange
    .filter((t) => t.type === "VOICE_USAGE")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const seen = new Set<string>();
  const tenantComparison: TenantBalanceComparison[] = [];
  for (const row of [...lowest, ...highest]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    tenantComparison.push({
      tenantId: row.id,
      tenantName: row.name,
      creditBalance: row.creditBalance,
    });
  }

  return {
    totalCurrentBalance: totalCurrentBalanceAgg._sum.creditBalance ?? 0,
    totalNegativeBalance: overview.totalOutstandingNegative,
    totalPositiveAdjustments: positiveTotal,
    totalNegativeAdjustments: negativeTotal,
    totalVoiceUsage: voiceUsageTotal,
    tenantComparison,
    trend: dailyAdjustmentBuckets(transactionsInRange, from, to),
  };
}

// ---------------------------------------------------------------------------
// Step 6: Operational Business Summary — aggregates only; no transcript, recording or
// individual call record is ever selected here.
// ---------------------------------------------------------------------------

export interface TenantCallActivity {
  tenantId: string;
  tenantName: string;
  callCount: number;
}

export interface OperationalSummary {
  totalCalls: number;
  /** "Successful" = actually connected (duration_seconds > 0), the same distinction
   * summarizeCalls() already uses elsewhere in this codebase — not an invented status taxonomy,
   * since calls.status is a free-form string with no fixed enum. */
  successfulCalls: number;
  failedCalls: number;
  totalCallDurationSeconds: number;
  campaignSummary: CampaignSummary;
  tenantCallActivity: TenantCallActivity[];
}

export async function getOperationalSummaryFor(
  database: PrismaClient,
  range: DateRangeInput = {},
): Promise<OperationalSummary> {
  const createdAt = createdAtFilter(range);
  const where = createdAt ? { createdAt } : {};

  const [totalCalls, successfulCalls, durationAgg, campaignSummary, tenantGroups] =
    await Promise.all([
      database.call.count({ where }),
      database.call.count({ where: { ...where, durationSeconds: { gt: 0 } } }),
      database.call.aggregate({ where, _sum: { durationSeconds: true } }),
      getCampaignSummaryFor(database),
      database.call.groupBy({ by: ["clientId"], where, _count: { _all: true } }),
    ]);

  const clients = await database.client.findMany({
    where: { id: { in: tenantGroups.map((g) => g.clientId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(clients.map((c) => [c.id, c.name]));
  const tenantCallActivity = tenantGroups
    .map((g) => ({
      tenantId: g.clientId,
      tenantName: nameMap.get(g.clientId) ?? "Unknown",
      callCount: g._count._all,
    }))
    .sort((a, b) => b.callCount - a.callCount)
    .slice(0, TOP_N);

  return {
    totalCalls,
    successfulCalls,
    failedCalls: totalCalls - successfulCalls,
    totalCallDurationSeconds: durationAgg._sum.durationSeconds ?? 0,
    campaignSummary,
    tenantCallActivity,
  };
}

export const getBusinessOverview = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(dateRangeSchema)
  .handler(({ data }) => getBusinessOverviewFor(db, data));

export const getFinancialAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(() => getFinancialAnalyticsFor());

export const getTenantBusinessAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(tenantAnalyticsSchema)
  .handler(({ data }) => getTenantBusinessAnalyticsFor(db, data));

export const getCreditAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(dateRangeSchema)
  .handler(({ data }) => getCreditAnalyticsFor(db, data));

export const getOperationalSummary = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(dateRangeSchema)
  .handler(({ data }) => getOperationalSummaryFor(db, data));
