// Super Admin credit management: platform-wide credit overview, tenant-wise credit table,
// manual ledger adjustments, and the single global credit price. Reuses the existing
// CreditTransaction ledger and Client.creditBalance — there is no second ledger here.
//
// Client.creditBalance stays the authoritative current balance (exactly as campaigns.functions.ts
// already reads it to gate dispatch); CreditTransaction is the append-only history explaining
// every change to it. Every adjustment writes both, in one transaction, so the balance is never
// changed without a ledger entry that explains why.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { isUniqueViolation } from "@/lib/db-errors";

const PAGE_SIZE = 20;

// Fixed id of the single credit_pricing row (see the migration): the application always
// reads/writes this one row, never creates a second.
const CREDIT_PRICING_ROW_ID = "00000000-0000-0000-0000-000000000001";

export interface CreditOverview {
  /** Sum of positive MANUAL_ADJUSTMENT entries — a Super Admin crediting a tenant. Never
   * includes automated usage debits, and there is no purchase/payment flow in this system to
   * report instead. */
  totalManualAdditions: number;
  /** Sum (absolute) of negative MANUAL_ADJUSTMENT entries. */
  totalManualDeductions: number;
  /** Sum (absolute) of VOICE_USAGE entries — automated debits applied when the engine reports
   * a campaign job's usage (src/lib/voice-engine/webhook.ts). Real call consumption, not a
   * manual action. */
  totalVoiceUsage: number;
  /** Rows written before the type column existed; their origin can't be reliably determined. */
  totalUnknown: number;
  totalOutstandingNegative: number;
  tenantsWithNegativeBalance: number;
}

export async function getCreditOverviewFor(database: PrismaClient): Promise<CreditOverview> {
  const [manualAdditions, manualDeductions, voiceUsage, unknown, negativeAgg, negativeCount] =
    await Promise.all([
      database.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "MANUAL_ADJUSTMENT", amount: { gt: 0 } },
      }),
      database.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "MANUAL_ADJUSTMENT", amount: { lt: 0 } },
      }),
      database.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "VOICE_USAGE" },
      }),
      database.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "UNKNOWN" },
      }),
      database.client.aggregate({
        _sum: { creditBalance: true },
        where: { creditBalance: { lt: 0 } },
      }),
      database.client.count({ where: { creditBalance: { lt: 0 } } }),
    ]);
  return {
    totalManualAdditions: manualAdditions._sum.amount ?? 0,
    totalManualDeductions: Math.abs(manualDeductions._sum.amount ?? 0),
    totalVoiceUsage: Math.abs(voiceUsage._sum.amount ?? 0),
    totalUnknown: Math.abs(unknown._sum.amount ?? 0),
    totalOutstandingNegative: Math.abs(negativeAgg._sum.creditBalance ?? 0),
    tenantsWithNegativeBalance: negativeCount,
  };
}

const listSchema = z.object({
  search: z.string().trim().max(255).optional(),
  negativeOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
});
export type TenantCreditListInput = z.infer<typeof listSchema>;

export interface TenantCreditRow {
  clientId: string;
  name: string;
  creditBalance: number;
  totalManualAdditions: number;
  totalManualDeductions: number;
  totalVoiceUsage: number;
  outstandingNegative: number;
}

export interface TenantCreditListResult {
  tenants: TenantCreditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listTenantCreditsFor(
  database: PrismaClient,
  input: TenantCreditListInput,
): Promise<TenantCreditListResult> {
  const search = input.search?.trim();
  const where = {
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    ...(input.negativeOnly ? { creditBalance: { lt: 0 } } : {}),
  };

  const [total, clients] = await Promise.all([
    database.client.count({ where }),
    database.client.findMany({
      where,
      orderBy: { creditBalance: "asc" },
      skip: (input.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, creditBalance: true },
    }),
  ]);

  const clientIds = clients.map((c) => c.id);
  const [additionsByClient, deductionsByClient, usageByClient] = await Promise.all([
    database.creditTransaction.groupBy({
      by: ["clientId"],
      where: { clientId: { in: clientIds }, type: "MANUAL_ADJUSTMENT", amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    database.creditTransaction.groupBy({
      by: ["clientId"],
      where: { clientId: { in: clientIds }, type: "MANUAL_ADJUSTMENT", amount: { lt: 0 } },
      _sum: { amount: true },
    }),
    database.creditTransaction.groupBy({
      by: ["clientId"],
      where: { clientId: { in: clientIds }, type: "VOICE_USAGE" },
      _sum: { amount: true },
    }),
  ]);
  const additionsMap = new Map(additionsByClient.map((r) => [r.clientId, r._sum.amount ?? 0]));
  const deductionsMap = new Map(
    deductionsByClient.map((r) => [r.clientId, Math.abs(r._sum.amount ?? 0)]),
  );
  const usageMap = new Map(usageByClient.map((r) => [r.clientId, Math.abs(r._sum.amount ?? 0)]));

  return {
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
    tenants: clients.map((c) => ({
      clientId: c.id,
      name: c.name,
      creditBalance: c.creditBalance,
      totalManualAdditions: additionsMap.get(c.id) ?? 0,
      totalManualDeductions: deductionsMap.get(c.id) ?? 0,
      totalVoiceUsage: usageMap.get(c.id) ?? 0,
      outstandingNegative: c.creditBalance < 0 ? Math.abs(c.creditBalance) : 0,
    })),
  };
}

export type CreditTransactionType = "MANUAL_ADJUSTMENT" | "VOICE_USAGE" | "UNKNOWN";

export interface CreditLedgerEntry {
  id: string;
  amount: number;
  note: string;
  type: CreditTransactionType;
  createdAt: string;
}

const HISTORY_LIMIT = 20;

export async function getTenantCreditHistoryFor(
  database: PrismaClient,
  clientId: string,
): Promise<CreditLedgerEntry[]> {
  const rows = await database.creditTransaction.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    note: r.note,
    type: r.type as CreditTransactionType,
    createdAt: r.createdAt.toISOString(),
  }));
}

const adjustSchema = z.object({
  clientId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, "Enter a non-zero amount."),
  reason: z.string().trim().min(3).max(500),
  // Client-generated per adjustment attempt; a retried request with the same key is treated
  // as the same adjustment rather than a second one.
  idempotencyKey: z.string().uuid(),
});
export type AdjustCreditInput = z.infer<typeof adjustSchema>;

export type AdjustCreditResult = { ok: true; newBalance: number } | { ok: false; reason: string };

export async function adjustTenantCreditFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: AdjustCreditInput,
): Promise<AdjustCreditResult> {
  const client = await database.client.findUnique({
    where: { id: input.clientId },
    select: { id: true },
  });
  if (!client) return { ok: false, reason: "Tenant not found." };

  try {
    const updated = await database.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          clientId: input.clientId,
          amount: input.amount,
          note: input.reason,
          createdBy: superAdminUserId,
          idempotencyKey: input.idempotencyKey,
          type: "MANUAL_ADJUSTMENT",
        },
      });
      return tx.client.update({
        where: { id: input.clientId },
        data: { creditBalance: { increment: input.amount } },
        select: { creditBalance: true },
      });
    });
    console.log(
      `[super-admin] credit adjustment: client=${input.clientId} amount=${input.amount} by=${superAdminUserId}`,
    );
    return { ok: true, newBalance: updated.creditBalance };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Same idempotencyKey already applied — return the current balance rather than erroring,
      // so a retried request (e.g. a double-click or network retry) is harmless.
      const current = await database.client.findUnique({
        where: { id: input.clientId },
        select: { creditBalance: true },
      });
      return { ok: true, newBalance: current?.creditBalance ?? 0 };
    }
    throw error;
  }
}

export interface CreditPricingView {
  pricePerCredit: number;
  updatedAt: string;
}

export async function getCreditPricingFor(database: PrismaClient): Promise<CreditPricingView> {
  const row = await database.creditPricing.findUnique({ where: { id: CREDIT_PRICING_ROW_ID } });
  return {
    pricePerCredit: row ? Number(row.pricePerCredit) : 1,
    updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
  };
}

const pricingSchema = z.object({ pricePerCredit: z.number().positive().max(1_000_000) });
export type SetCreditPricingInput = z.infer<typeof pricingSchema>;

/** Changes the one global price for future adjustments only — existing CreditTransaction rows
 * already recorded keep whatever amount was entered at the time; this has no retroactive effect. */
export async function setCreditPricingFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: SetCreditPricingInput,
): Promise<CreditPricingView> {
  const row = await database.creditPricing.upsert({
    where: { id: CREDIT_PRICING_ROW_ID },
    create: {
      id: CREDIT_PRICING_ROW_ID,
      pricePerCredit: input.pricePerCredit,
      updatedBy: superAdminUserId,
    },
    update: { pricePerCredit: input.pricePerCredit, updatedBy: superAdminUserId },
  });
  console.log(
    `[super-admin] credit price updated to ${input.pricePerCredit} by=${superAdminUserId}`,
  );
  return { pricePerCredit: Number(row.pricePerCredit), updatedAt: row.updatedAt.toISOString() };
}

export const getCreditOverview = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(() => getCreditOverviewFor(db));

export const listTenantCredits = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(listSchema)
  .handler(({ data }) => listTenantCreditsFor(db, data));

export const getTenantCreditHistory = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(z.object({ clientId: z.string().uuid() }))
  .handler(({ data }) => getTenantCreditHistoryFor(db, data.clientId));

export const adjustTenantCredit = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(adjustSchema)
  .handler(({ context, data }) => adjustTenantCreditFor(db, context.userId, data));

export const getCreditPricing = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(() => getCreditPricingFor(db));

export const setCreditPricing = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(pricingSchema)
  .handler(({ context, data }) => setCreditPricingFor(db, context.userId, data));
