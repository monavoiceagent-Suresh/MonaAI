// Super Admin tenant management: list/search, create, view/edit, suspend/reactivate and
// permanently delete tenants. Reuses the existing Client/ClientMember/User models and the
// existing password/session utilities — there is no separate "tenant" system to build.
//
// Every export wrapped in createServerFn uses requireSuperAdmin, never requireAuth, so a
// signed-in tenant admin can never reach any operation in this file.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { isUniqueViolation } from "@/lib/db-errors";
import { hashPassword } from "@/lib/password";
import { setInboundNumbersSuspendedForClient } from "@/lib/inbound.functions";
import { stopCampaignDispatch } from "@/lib/campaigns.functions";
import { syncTenantToEngine } from "@/lib/voice-engine/client";

const PAGE_SIZE = 20;
const MIN_PASSWORD_LENGTH = 12;

const listSchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z.enum(["all", "active", "suspended"]).default("all"),
  page: z.number().int().min(1).default(1),
});
export type TenantListInput = z.infer<typeof listSchema>;

export interface TenantListItem {
  id: string;
  name: string;
  status: string;
  creditBalance: number;
  createdAt: string;
  adminEmail: string | null;
  adminFullName: string | null;
}

export interface TenantListResult {
  tenants: TenantListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listTenantsFor(
  database: PrismaClient,
  input: TenantListInput,
): Promise<TenantListResult> {
  const search = input.search?.trim();
  const where = {
    ...(input.status !== "all" ? { status: input.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            {
              members: {
                some: { user: { email: { contains: search, mode: "insensitive" as const } } },
              },
            },
          ],
        }
      : {}),
  };

  const [total, clients] = await Promise.all([
    database.client.count({ where }),
    database.client.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        status: true,
        creditBalance: true,
        createdAt: true,
        members: {
          where: { role: "owner" },
          take: 1,
          select: { user: { select: { email: true, fullName: true } } },
        },
      },
    }),
  ]);

  return {
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
    tenants: clients.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      creditBalance: c.creditBalance,
      createdAt: c.createdAt.toISOString(),
      adminEmail: c.members[0]?.user.email ?? null,
      adminFullName: c.members[0]?.user.fullName || null,
    })),
  };
}

/**
 * Best-effort: logs and swallows a sync failure rather than blocking the Mona-side action that
 * triggered it (tenant creation, suspension, reactivation). Safe to do so only because the
 * engine's own tenant validation stays in "log_only" mode (app/tenants.py) until every existing
 * tenant has been confirmed synced — see the M1 rollout stages in
 * docs/MULTI_TENANT_TELEPHONY_PLAN.md. Once that flips to "enforcing", a missed sync here would
 * start rejecting that tenant's dispatches/publishes, so the rollout stage gate matters.
 */
async function syncTenantBestEffort(
  clientId: string,
  name: string,
  status: "active" | "suspended",
) {
  try {
    await syncTenantToEngine({ id: clientId, name, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the voice engine.";
    console.error(
      `[super-admin] tenant sync to engine failed: client=${clientId} status=${status}: ${message}`,
    );
  }
}

const createTenantSchema = z.object({
  businessName: z.string().trim().min(2).max(100),
  adminFullName: z.string().trim().min(1).max(100),
  adminEmail: z.string().trim().toLowerCase().max(255).email(),
  adminPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export type CreateTenantResult = { ok: true; clientId: string } | { ok: false; reason: string };

/** Mirrors scripts/create-user.ts's transaction shape (client + owner membership + user),
 * just driven from the Super Admin console instead of a CLI. */
export async function createTenantFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  const passwordHash = await hashPassword(input.adminPassword);
  try {
    const client = await database.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: { name: input.businessName, createdBy: superAdminUserId },
        select: { id: true },
      });
      await tx.clientMember.create({
        data: {
          client: { connect: { id: created.id } },
          role: "owner",
          user: {
            create: { email: input.adminEmail, fullName: input.adminFullName, passwordHash },
          },
        },
      });
      return created;
    });
    console.log(
      `[super-admin] tenant created: client=${client.id} admin=${input.adminEmail} by=${superAdminUserId}`,
    );
    await syncTenantBestEffort(client.id, input.businessName, "active");
    return { ok: true, clientId: client.id };
  } catch (error) {
    if (isUniqueViolation(error, "email")) {
      return { ok: false, reason: "An account with that email already exists." };
    }
    throw error;
  }
}

export interface TenantDetail {
  id: string;
  name: string;
  status: string;
  creditBalance: number;
  createdAt: string;
  adminEmail: string | null;
  adminFullName: string | null;
  agentCount: number;
  campaignCount: number;
}

export async function getTenantDetailFor(
  database: PrismaClient,
  clientId: string,
): Promise<TenantDetail | null> {
  const client = await database.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      status: true,
      creditBalance: true,
      createdAt: true,
      members: {
        where: { role: "owner" },
        take: 1,
        select: { user: { select: { email: true, fullName: true } } },
      },
    },
  });
  if (!client) return null;

  const [agentCount, campaignCount] = await Promise.all([
    // "Agents" are the dashboard's own active personas (prompts); the engine's hydrated agent
    // rows live in its own hand-written tables, outside this app's database access.
    database.prompt.count({ where: { clientId, active: true } }),
    database.campaign.count({ where: { clientId } }),
  ]);

  return {
    id: client.id,
    name: client.name,
    status: client.status,
    creditBalance: client.creditBalance,
    createdAt: client.createdAt.toISOString(),
    adminEmail: client.members[0]?.user.email ?? null,
    adminFullName: client.members[0]?.user.fullName || null,
    agentCount,
    campaignCount,
  };
}

const updateTenantSchema = z.object({
  clientId: z.string().uuid(),
  businessName: z.string().trim().min(2).max(100),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export async function updateTenantFor(
  database: PrismaClient,
  input: UpdateTenantInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = await database.client.findUnique({
    where: { id: input.clientId },
    select: { status: true },
  });
  if (!existing) return { ok: false, reason: "Tenant not found." };
  const updated = await database.client.updateMany({
    where: { id: input.clientId },
    data: { name: input.businessName },
  });
  if (updated.count === 0) return { ok: false, reason: "Tenant not found." };
  await syncTenantBestEffort(
    input.clientId,
    input.businessName,
    existing.status as "active" | "suspended",
  );
  return { ok: true };
}

const statusSchema = z.object({
  clientId: z.string().uuid(),
  status: z.enum(["active", "suspended"]),
});
export type SetTenantStatusInput = z.infer<typeof statusSchema>;

export interface InboundSuspensionFailure {
  phone: string;
  error: string;
}
export interface CampaignSuspensionFailure {
  campaignId: string;
  name: string;
  error: string;
}

export type SetTenantStatusResult =
  | {
      ok: true;
      /** Non-empty means suspension/reactivation is NOT fully settled — the console must show
       * this as a warning, never as plain success. Click Suspend/Reactivate again to retry:
       * every number and campaign already in the target state is skipped, so re-running only
       * touches what is still outstanding. */
      inboundFailures: InboundSuspensionFailure[];
      campaignFailures: CampaignSuspensionFailure[];
    }
  | { ok: false; reason: string };

/**
 * Suspending: flips Client.status, force-revokes every member's session (so an already
 * signed-in tenant admin is logged out immediately rather than on their next login attempt),
 * stops dispatch for every "Active" campaign (new, not-yet-started calls — an already-connected
 * call finishes normally and is still billed when its usage report arrives, exactly as today),
 * and takes every one of this tenant's live inbound numbers off the engine so new inbound calls
 * stop being answered. Outbound dispatch, test calls, and every other tenant-scoped server
 * function are already blocked the moment Client.status isn't "active" (currentWorkspaceClient).
 *
 * Reactivating restores each inbound number to the tenant's own saved on/off setting. It does
 * NOT resume a campaign this function paused — resuming is a deliberate tenant action with its
 * own billing consequences, not something suspension should undo automatically.
 *
 * Idempotent and safe to call again: skips whatever is already in the target state, so clicking
 * Suspend/Reactivate again after a partial failure retries only what is still outstanding
 * (the "minimal reconciliation mechanism" — no new retry infrastructure, just re-running this).
 */
export async function setTenantStatusFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: SetTenantStatusInput,
): Promise<SetTenantStatusResult> {
  const client = await database.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, name: true, status: true },
  });
  if (!client) return { ok: false, reason: "Tenant not found." };

  const alreadyInTargetState = client.status === input.status;
  const suspending = input.status === "suspended";

  // Synchronize even on retry. A failed engine acknowledgement must not report success.
  try {
    await syncTenantToEngine({ id: input.clientId, name: client.name, status: input.status });
  } catch {
    return { ok: false, reason: "Engine tenant status was not confirmed. Retry the operation." };
  }
  if (!alreadyInTargetState) {
    await database.client.update({ where: { id: input.clientId }, data: { status: input.status } });

    if (suspending) {
      const memberUserIds = (
        await database.clientMember.findMany({
          where: { clientId: input.clientId },
          select: { userId: true },
        })
      ).map((m) => m.userId);
      if (memberUserIds.length) {
        await database.session.deleteMany({ where: { userId: { in: memberUserIds } } });
      }
    }
  }

  const campaignFailures: CampaignSuspensionFailure[] = [];
  if (suspending) {
    // Tells the engine to stop placing new calls for this campaign's open job: queued,
    // not-yet-started leads stop being dialled; a call already connected is left to finish
    // (the same cancellation stopCampaignDispatch already performs for a tenant's own Pause —
    // reused verbatim, not reimplemented). Only "Active" campaigns can have an open job.
    const activeCampaigns = await database.campaign.findMany({
      where: { clientId: input.clientId, status: "Active" },
      select: { id: true, name: true },
    });
    for (const campaign of activeCampaigns) {
      try {
        await stopCampaignDispatch(database, { campaignId: campaign.id, clientId: input.clientId });
        await database.campaign.updateMany({
          where: { id: campaign.id, clientId: input.clientId, status: "Active" },
          data: { status: "Paused" },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not reach the voice engine.";
        console.error(
          `[super-admin] couldn't stop campaign ${campaign.id} (${campaign.name}) for suspension: ${message}`,
        );
        campaignFailures.push({ campaignId: campaign.id, name: campaign.name, error: message });
      }
    }
  }

  // Always reconciled against the target state, even if Client.status was already correct —
  // this is also how a retry works: re-running only touches numbers not yet actually off (or
  // back on) the engine.
  const inboundOutcomes = await setInboundNumbersSuspendedForClient(
    database,
    input.clientId,
    suspending,
  );
  const inboundFailures: InboundSuspensionFailure[] = inboundOutcomes
    .filter((o) => !o.ok)
    .map((o) => ({ phone: o.phone, error: o.error ?? "Unknown error" }));

  console.log(
    `[super-admin] tenant ${input.status}: client=${client.id} (${client.name}) by=${superAdminUserId}` +
      (inboundFailures.length ? ` inboundFailures=${inboundFailures.length}` : "") +
      (campaignFailures.length ? ` campaignFailures=${campaignFailures.length}` : ""),
  );
  return { ok: true, inboundFailures, campaignFailures };
}

const deleteTenantSchema = z.object({
  clientId: z.string().uuid(),
  confirmName: z.string().trim().min(1).max(100),
});
export type DeleteTenantInput = z.infer<typeof deleteTenantSchema>;

/**
 * Deletes the Client row, which cascades (per the existing schema's onDelete: Cascade
 * relations) through its members, campaigns, leads, prompts + versions, calls, credit ledger,
 * voice engine jobs, inbound numbers + publications, and outcome settings — the same
 * convention src/test/tenant-fixtures.ts already relies on for test cleanup.
 *
 * The caller must type the tenant's exact current name as confirmation (checked server-side,
 * not just in the UI). After the cascade, any admin user left with zero remaining workspace
 * memberships is removed too, but a user who still belongs to another tenant is left alone —
 * this is the guard against one tenant's deletion silently costing another tenant's admin
 * their account.
 */
export async function deleteTenantPermanentlyFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: DeleteTenantInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const client = await database.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, name: true },
  });
  if (!client) return { ok: false, reason: "Tenant not found." };
  if (client.name !== input.confirmName) {
    return { ok: false, reason: "Type the tenant's exact name to confirm deletion." };
  }

  const memberUserIds = (
    await database.clientMember.findMany({
      where: { clientId: input.clientId },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  await database.client.delete({ where: { id: input.clientId } });

  if (memberUserIds.length) {
    const stillLinked = new Set(
      (
        await database.clientMember.findMany({
          where: { userId: { in: memberUserIds } },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const orphaned = memberUserIds.filter((id) => !stillLinked.has(id));
    if (orphaned.length) await database.user.deleteMany({ where: { id: { in: orphaned } } });
  }

  console.log(
    `[super-admin] tenant deleted permanently: client=${client.id} (${client.name}) by=${superAdminUserId}`,
  );
  return { ok: true };
}

export const listTenants = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(listSchema)
  .handler(({ data }) => listTenantsFor(db, data));

export const createTenant = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(createTenantSchema)
  .handler(({ context, data }) => createTenantFor(db, context.userId, data));

export const getTenantDetail = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(z.object({ clientId: z.string().uuid() }))
  .handler(({ data }) => getTenantDetailFor(db, data.clientId));

export const updateTenant = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(updateTenantSchema)
  .handler(({ data }) => updateTenantFor(db, data));

export const setTenantStatus = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(statusSchema)
  .handler(({ context, data }) => setTenantStatusFor(db, context.userId, data));

export const deleteTenantPermanently = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(deleteTenantSchema)
  .handler(({ context, data }) => deleteTenantPermanentlyFor(db, context.userId, data));
