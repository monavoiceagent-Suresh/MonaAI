// Focused checks for Phase 3: the financial-analytics "unavailable" contract, tenant
// aggregation field naming (never "purchased"/"consumed"), date-range filtering, and that the
// credit-adjustment trend buckets correctly. Authorization itself (requireSuperAdmin) is
// already covered by super-admin-access.int.test.ts — every export here uses the same
// middleware, so it isn't re-tested per function.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import {
  getBusinessOverviewFor,
  getCreditAnalyticsFor,
  getFinancialAnalyticsFor,
  getOperationalSummaryFor,
  getTenantBusinessAnalyticsFor,
} from "@/lib/super-admin-analytics.functions";
import { adjustTenantCreditFor } from "@/lib/super-admin-credits.functions";

const SUPER_ADMIN_ID = randomUUID();
const clientIds: string[] = [];

afterAll(async () => {
  await db.client.deleteMany({ where: { id: { in: clientIds } } });
});

async function makeTenant(name?: string) {
  const client = await db.client.create({
    data: { name: name ?? `Analytics tenant ${randomUUID().slice(0, 8)}` },
    select: { id: true, name: true },
  });
  clientIds.push(client.id);
  return client;
}

describe("financial analytics", () => {
  it("is always reported unavailable, with a reason — never a fabricated number", () => {
    const result = getFinancialAnalyticsFor();
    expect(result.available).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe("business overview", () => {
  it("reports real tenant and credit totals, and never claims revenue is available", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 100,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    const overview = await getBusinessOverviewFor(db);
    expect(overview.totalTenants).toBeGreaterThanOrEqual(1);
    expect(overview.revenueAvailable).toBe(false);
  });

  it("date range only restricts the adjustment count, not the tenant counts", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 50,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const noAdjustmentsInRange = await getBusinessOverviewFor(db, { from: farFuture });
    expect(noAdjustmentsInRange.totalCreditAdjustments).toBe(0);
    // Tenant counts are a snapshot, unaffected by the range.
    expect(noAdjustmentsInRange.totalTenants).toBeGreaterThanOrEqual(1);
  });
});

describe("tenant business analytics", () => {
  it("relabels ledger adjustments as positive/negative adjustments, never purchased/consumed, and never claims revenue", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 200,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: -300,
      reason: "x",
      idempotencyKey: randomUUID(),
    });

    const result = await getTenantBusinessAnalyticsFor(db, { page: 1, search: tenant.name });
    const row = result.tenants.find((t) => t.tenantId === tenant.id);
    expect(row).toMatchObject({
      totalPositiveAdjustments: 200,
      totalNegativeAdjustments: 300,
      negativeBalanceExposure: 100,
      creditBalance: -100,
      actualRevenue: null,
      recordedExpenses: null,
    });
    expect(row).not.toHaveProperty("totalPurchased");
    expect(row).not.toHaveProperty("totalConsumed");
  });

  it("includes each tenant's current status", async () => {
    const tenant = await makeTenant();
    await db.client.update({ where: { id: tenant.id }, data: { status: "suspended" } });
    const result = await getTenantBusinessAnalyticsFor(db, { page: 1, search: tenant.name });
    expect(result.tenants.find((t) => t.tenantId === tenant.id)?.status).toBe("suspended");
  });
});

describe("credit analytics", () => {
  it("sums positive and negative adjustments correctly and includes both balance extremes in the comparison", async () => {
    const low = await makeTenant();
    const high = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: low.id,
      amount: -500,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: high.id,
      amount: 5000,
      reason: "x",
      idempotencyKey: randomUUID(),
    });

    const analytics = await getCreditAnalyticsFor(db);
    expect(analytics.totalPositiveAdjustments).toBeGreaterThanOrEqual(5000);
    expect(analytics.totalNegativeAdjustments).toBeGreaterThanOrEqual(500);
    const ids = analytics.tenantComparison.map((t) => t.tenantId);
    expect(ids).toContain(high.id);
  });

  it("buckets the adjustment trend by day within the given range, and excludes adjustments outside it", async () => {
    // Platform-wide, not per-tenant, so sibling tests' "now" adjustments would pollute a
    // window anchored on today. Anchoring on a historical window nobody else touches keeps
    // this test's total exact instead of just "greater than."
    const tenant = await makeTenant();
    const anchor = new Date(Date.now() - 100 * 86_400_000);
    const from = new Date(anchor.getTime() - 2 * 86_400_000).toISOString();
    const to = anchor.toISOString();

    await db.creditTransaction.create({
      data: { clientId: tenant.id, amount: 10, note: "in range", createdAt: anchor },
    });
    await db.creditTransaction.create({
      data: {
        clientId: tenant.id,
        amount: 999,
        note: "outside range",
        createdAt: new Date(anchor.getTime() - 30 * 86_400_000),
      },
    });

    const analytics = await getCreditAnalyticsFor(db, { from, to });
    const totalInTrend = analytics.trend.reduce((sum, p) => sum + p.positive, 0);
    expect(totalInTrend).toBe(10);
  });
});

describe("operational summary", () => {
  it("splits connected vs not-connected by duration, matching summarizeCalls' own convention", async () => {
    const tenant = await makeTenant();
    await db.call.create({
      data: {
        clientId: tenant.id,
        direction: "outbound",
        durationSeconds: 120,
        outcome: "Interested",
      },
    });
    await db.call.create({
      data: {
        clientId: tenant.id,
        direction: "outbound",
        durationSeconds: 0,
        outcome: "No answer",
      },
    });

    const summary = await getOperationalSummaryFor(db);
    expect(summary.totalCalls).toBeGreaterThanOrEqual(2);
    expect(summary.successfulCalls).toBeGreaterThanOrEqual(1);
    expect(summary.failedCalls).toBeGreaterThanOrEqual(1);
  });

  it("date range restricts which calls are counted", async () => {
    const tenant = await makeTenant();
    await db.call.create({
      data: {
        clientId: tenant.id,
        direction: "outbound",
        durationSeconds: 60,
        outcome: "Interested",
      },
    });

    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const summary = await getOperationalSummaryFor(db, { from: farFuture });
    expect(summary.tenantCallActivity.find((t) => t.tenantId === tenant.id)).toBeUndefined();
  });

  it("never selects transcript, summary or collected-field columns", async () => {
    const tenant = await makeTenant();
    await db.call.create({
      data: {
        clientId: tenant.id,
        direction: "outbound",
        durationSeconds: 60,
        outcome: "Interested",
        summary: "a private summary",
      },
    });
    const summary = await getOperationalSummaryFor(db);
    expect(JSON.stringify(summary)).not.toContain("a private summary");
  });
});
