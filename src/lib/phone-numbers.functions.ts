import { inventoryTransaction } from "./inventory-lock";
import { revokeInboundRoute } from "./voice-engine/client";
// Super Admin phone number inventory & tenant assignment (M1: see
// docs/MULTI_TENANT_TELEPHONY_PLAN.md). Mona's Prisma database is the sole source of truth for
// inventory and assignment — the engine is never given a second copy of this data; it only ever
// receives the one resolved, validated caller ID a dispatch job needs (campaigns.functions.ts).
//
// Numbers are added manually (typed in by a Super Admin from what Exotel's own console already
// provisioned): there is no Exotel provisioning API integration here, by design — confirming that
// API's behaviour is an explicit dependency this milestone does not take on.
//
// Lifecycle: Available (UNASSIGNED) -> Assigned -> Unassigned | Suspended; Suspended -> Reactivated
// (back to Assigned). Every transition writes a PhoneNumberAssignmentEvent; nothing updates
// PhoneNumber.status without also writing one, so the table is always a complete audit trail.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { isUniqueViolation } from "@/lib/db-errors";
import { phoneProblem } from "@/lib/inbound-numbers";

const PAGE_SIZE = 20;

async function revokeNumberRouting(database: PrismaClient, phone: string, clientId: string) {
  const draft = await database.inboundNumber.findUnique({ where: { phone } });
  const highest = draft
    ? await database.inboundPublication.aggregate({
        where: { numberId: draft.id },
        _max: { version: true },
      })
    : null;
  // Fence even a publish whose DB transaction timed out after its HTTP request was sent.
  const floor = Math.max(draft?.knownEngineVersion ?? 0, highest?._max.version ?? 0) + 2;
  await revokeInboundRoute(phone, clientId, floor);
}

export const phoneNumberCapabilities = ["VOICE_IN", "VOICE_OUT", "VOICE_BOTH"] as const;
export type PhoneNumberCapability = (typeof phoneNumberCapabilities)[number];

export const phoneNumberStatuses = [
  "UNASSIGNED",
  "ASSIGNED",
  "SUSPENDED",
  "RELEASED",
  "DISABLED",
] as const;
export type PhoneNumberStatus = (typeof phoneNumberStatuses)[number];

const listSchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z.enum(["all", ...phoneNumberStatuses]).default("all"),
  page: z.number().int().min(1).default(1),
});
export type PhoneNumberListInput = z.infer<typeof listSchema>;

export interface PhoneNumberListItem {
  id: string;
  e164: string;
  exotelNumberSid: string | null;
  capability: PhoneNumberCapability;
  status: PhoneNumberStatus;
  clientId: string | null;
  clientName: string | null;
  isDefaultOutboundCallerId: boolean;
  createdAt: string;
}

export interface PhoneNumberListResult {
  numbers: PhoneNumberListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPhoneNumbersFor(
  database: PrismaClient,
  input: PhoneNumberListInput,
): Promise<PhoneNumberListResult> {
  const search = input.search?.trim();
  const where = {
    ...(input.status !== "all" ? { status: input.status } : {}),
    ...(search
      ? {
          OR: [
            { e164: { contains: search, mode: "insensitive" as const } },
            { client: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, numbers] = await Promise.all([
    database.phoneNumber.count({ where }),
    database.phoneNumber.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        e164: true,
        exotelNumberSid: true,
        capability: true,
        status: true,
        clientId: true,
        isDefaultOutboundCallerId: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
    numbers: numbers.map((n) => ({
      id: n.id,
      e164: n.e164,
      exotelNumberSid: n.exotelNumberSid,
      capability: n.capability as PhoneNumberCapability,
      status: n.status as PhoneNumberStatus,
      clientId: n.clientId,
      clientName: n.client?.name ?? null,
      isDefaultOutboundCallerId: n.isDefaultOutboundCallerId,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export interface PhoneNumberAssignmentHistoryEntry {
  id: string;
  action: string;
  clientId: string | null;
  reason: string | null;
  createdAt: string;
}

export async function listPhoneNumberAssignmentHistoryFor(
  database: PrismaClient,
  phoneNumberId: string,
): Promise<PhoneNumberAssignmentHistoryEntry[]> {
  const rows = await database.phoneNumberAssignmentEvent.findMany({
    where: { phoneNumberId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    clientId: r.clientId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  }));
}

const addSchema = z.object({
  e164: z.string().trim(),
  exotelNumberSid: z.string().trim().min(1).max(100).optional(),
  capability: z.enum(phoneNumberCapabilities).default("VOICE_BOTH"),
});
export type AddPhoneNumberInput = z.infer<typeof addSchema>;

export type AddPhoneNumberResult = { ok: true; id: string } | { ok: false; reason: string };

/** Manual inventory entry: records a number Exotel's own console already provisioned. Does not
 * call Exotel — there is no provisioning API integration in this milestone (see module comment). */
export async function addPhoneNumberToInventoryFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: AddPhoneNumberInput,
): Promise<AddPhoneNumberResult> {
  const problem = phoneProblem(input.e164);
  if (problem) return { ok: false, reason: problem };
  try {
    const created = await database.phoneNumber.create({
      data: {
        e164: input.e164,
        exotelNumberSid: input.exotelNumberSid || null,
        capability: input.capability,
        status: "UNASSIGNED",
      },
      select: { id: true },
    });
    console.log(
      `[super-admin] phone number added to inventory: ${input.e164} by=${superAdminUserId}`,
    );
    return { ok: true, id: created.id };
  } catch (error) {
    if (isUniqueViolation(error, "e164")) {
      return { ok: false, reason: "This number is already in the inventory." };
    }
    if (isUniqueViolation(error, "exotel_number_sid")) {
      return { ok: false, reason: "This Exotel number SID is already recorded on another number." };
    }
    throw error;
  }
}

const assignSchema = z.object({
  phoneNumberId: z.string().uuid(),
  clientId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
export type AssignPhoneNumberInput = z.infer<typeof assignSchema>;

export type AssignPhoneNumberResult = { ok: true } | { ok: false; reason: string };

/**
 * Available (UNASSIGNED) -> Assigned. Idempotent: replaying the same idempotencyKey is a no-op,
 * not a second assignment. Refuses to silently move a number straight from one tenant to another —
 * unassign first — so a reassignment is always two explicit, separately audited steps.
 */
async function assignPhoneNumberToTenantForLocked(
  database: PrismaClient,
  superAdminUserId: string,
  input: AssignPhoneNumberInput,
): Promise<AssignPhoneNumberResult> {
  const [number, client] = await Promise.all([
    database.phoneNumber.findUnique({ where: { id: input.phoneNumberId } }),
    database.client.findUnique({ where: { id: input.clientId }, select: { id: true } }),
  ]);
  if (!number) return { ok: false, reason: "Number not found." };
  if (!client) return { ok: false, reason: "Tenant not found." };
  const oldDraft = await database.inboundNumber.findFirst({
    where: { phone: number.e164, clientId: { not: input.clientId } },
  });
  if (oldDraft)
    return {
      ok: false,
      reason: "Remove the previous tenant inbound draft before reassigning this number.",
    };
  if (number.status === "ASSIGNED" && number.clientId === input.clientId) {
    return { ok: true }; // already in the target state
  }
  if (number.status === "ASSIGNED" || number.status === "SUSPENDED") {
    return {
      ok: false,
      reason: "This number is already assigned to a tenant. Unassign it first.",
    };
  }
  if (number.status === "RELEASED" || number.status === "DISABLED") {
    return {
      ok: false,
      reason: `This number is ${number.status.toLowerCase()} and cannot be assigned.`,
    };
  }

  try {
    await database.$transaction([
      database.phoneNumber.update({
        where: { id: input.phoneNumberId },
        data: { status: "ASSIGNED", clientId: input.clientId },
      }),
      database.phoneNumberAssignmentEvent.create({
        data: {
          phoneNumberId: input.phoneNumberId,
          clientId: input.clientId,
          action: "ASSIGNED",
          performedByUserId: superAdminUserId,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ]);
    console.log(
      `[super-admin] phone number assigned: ${number.e164} -> client=${input.clientId} by=${superAdminUserId}`,
    );
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error, "idempotency_key")) return { ok: true };
    throw error;
  }
}

const unassignSchema = z.object({
  phoneNumberId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
  /** Set by the caller after being warned the number backs a published, active inbound route. */
  force: z.boolean().default(false),
});
export type UnassignPhoneNumberInput = z.infer<typeof unassignSchema>;

export type UnassignPhoneNumberResult =
  { ok: true } | { ok: false; reason: string; needsForce?: boolean };

/** Assigned -> Unassigned (back to the available pool). Invalidates the number as a future caller
 * ID: clearing clientId also clears isDefaultOutboundCallerId, so no later dispatch can resolve a
 * caller ID that no longer belongs to any tenant. */
async function unassignPhoneNumberForLocked(
  database: PrismaClient,
  superAdminUserId: string,
  input: UnassignPhoneNumberInput,
): Promise<UnassignPhoneNumberResult> {
  const number = await database.phoneNumber.findUnique({ where: { id: input.phoneNumberId } });
  if (!number) return { ok: false, reason: "Number not found." };
  if (number.status === "UNASSIGNED") return { ok: true };
  if (number.status !== "ASSIGNED" && number.status !== "SUSPENDED") {
    return { ok: false, reason: `This number is already ${number.status.toLowerCase()}.` };
  }

  if (!input.force) {
    const activeRoute = await database.inboundNumber.findFirst({
      where: { phone: number.e164, active: true },
      select: { id: true },
    });
    if (activeRoute) {
      return {
        ok: false,
        needsForce: true,
        reason:
          "This number is currently active on a published inbound route. Confirm to unassign it anyway.",
      };
    }
  }

  await revokeNumberRouting(database, number.e164, number.clientId!);
  try {
    await database.$transaction([
      database.phoneNumber.update({
        where: { id: input.phoneNumberId },
        data: { status: "UNASSIGNED", clientId: null, isDefaultOutboundCallerId: false },
      }),
      database.phoneNumberAssignmentEvent.create({
        data: {
          phoneNumberId: input.phoneNumberId,
          clientId: number.clientId,
          action: "UNASSIGNED",
          performedByUserId: superAdminUserId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
      }),
    ]);
    console.log(`[super-admin] phone number unassigned: ${number.e164} by=${superAdminUserId}`);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error, "idempotency_key")) return { ok: true };
    throw error;
  }
}

const suspendSchema = z.object({
  phoneNumberId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
});
export type SuspendPhoneNumberInput = z.infer<typeof suspendSchema>;

/**
 * Assigned -> Suspended: keeps the tenant assignment AND the isDefaultOutboundCallerId flag on
 * record (unlike unassigning). This is deliberate: resolveAndValidateCallerId still finds this
 * number as "the tenant's selection" and then rejects it on its SUSPENDED status, so a future
 * dispatch fails loudly and explicitly — the Super Admin or tenant must pick a replacement default
 * or reactivate this one. Clearing the flag here instead would make resolution see no selection at
 * all and silently fall back to the engine's global default, which is exactly the silent bypass
 * "invalidate stale selections for future dispatches" is meant to prevent.
 */
async function suspendPhoneNumberForLocked(
  database: PrismaClient,
  superAdminUserId: string,
  input: SuspendPhoneNumberInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const number = await database.phoneNumber.findUnique({ where: { id: input.phoneNumberId } });
  if (!number) return { ok: false, reason: "Number not found." };
  if (number.status === "SUSPENDED") return { ok: true };
  if (number.status !== "ASSIGNED") {
    return { ok: false, reason: "Only an assigned number can be suspended." };
  }

  await revokeNumberRouting(database, number.e164, number.clientId!);
  try {
    await database.$transaction([
      database.phoneNumber.update({
        where: { id: input.phoneNumberId },
        data: { status: "SUSPENDED" },
      }),
      database.phoneNumberAssignmentEvent.create({
        data: {
          phoneNumberId: input.phoneNumberId,
          clientId: number.clientId,
          action: "SUSPENDED",
          performedByUserId: superAdminUserId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
      }),
    ]);
    console.log(`[super-admin] phone number suspended: ${number.e164} by=${superAdminUserId}`);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error, "idempotency_key")) return { ok: true };
    throw error;
  }
}

const reactivateSchema = z.object({
  phoneNumberId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
export type ReactivatePhoneNumberInput = z.infer<typeof reactivateSchema>;

/** Suspended -> Assigned. Does not restore isDefaultOutboundCallerId: that is a deliberate,
 * separate choice (setDefaultOutboundCallerId), not an automatic side effect of reactivating. */
async function reactivatePhoneNumberForLocked(
  database: PrismaClient,
  superAdminUserId: string,
  input: ReactivatePhoneNumberInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const number = await database.phoneNumber.findUnique({ where: { id: input.phoneNumberId } });
  if (!number) return { ok: false, reason: "Number not found." };
  if (number.status === "ASSIGNED") return { ok: true };
  if (number.status !== "SUSPENDED") {
    return { ok: false, reason: "Only a suspended number can be reactivated." };
  }

  try {
    await database.$transaction([
      database.phoneNumber.update({
        where: { id: input.phoneNumberId },
        data: { status: "ASSIGNED" },
      }),
      database.phoneNumberAssignmentEvent.create({
        data: {
          phoneNumberId: input.phoneNumberId,
          clientId: number.clientId,
          action: "REACTIVATED",
          performedByUserId: superAdminUserId,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ]);
    console.log(`[super-admin] phone number reactivated: ${number.e164} by=${superAdminUserId}`);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error, "idempotency_key")) return { ok: true };
    throw error;
  }
}

const setDefaultSchema = z.object({
  phoneNumberId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
export type SetDefaultOutboundCallerIdInput = z.infer<typeof setDefaultSchema>;

/** Marks one of a tenant's assigned numbers as its default outbound caller ID, unsetting any prior
 * default for that same tenant in the same transaction (at most one default per tenant, always). */
async function setDefaultOutboundCallerIdForLocked(
  database: PrismaClient,
  superAdminUserId: string,
  input: SetDefaultOutboundCallerIdInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const number = await database.phoneNumber.findUnique({ where: { id: input.phoneNumberId } });
  if (!number) return { ok: false, reason: "Number not found." };
  if (number.status !== "ASSIGNED" || !number.clientId) {
    return { ok: false, reason: "Only a currently assigned number can be the default caller ID." };
  }
  if (number.capability !== "VOICE_OUT" && number.capability !== "VOICE_BOTH")
    return { ok: false, reason: "Number is not outbound capable." };
  if (number.isDefaultOutboundCallerId) return { ok: true };

  try {
    await database.$transaction([
      database.phoneNumber.updateMany({
        where: { clientId: number.clientId, isDefaultOutboundCallerId: true },
        data: { isDefaultOutboundCallerId: false },
      }),
      database.phoneNumber.update({
        where: { id: input.phoneNumberId },
        data: { isDefaultOutboundCallerId: true },
      }),
      database.phoneNumberAssignmentEvent.create({
        data: {
          phoneNumberId: input.phoneNumberId,
          clientId: number.clientId,
          action: "SET_DEFAULT_OUTBOUND",
          performedByUserId: superAdminUserId,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ]);
    console.log(
      `[super-admin] default outbound caller ID set: ${number.e164} by=${superAdminUserId}`,
    );
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error, "idempotency_key")) return { ok: true };
    throw error;
  }
}

export type CallerIdResolution = { ok: true; e164: string | null } | { ok: false; reason: string };

/**
 * The outbound caller ID for one dispatch (M1, condition 1): resolved and re-validated fresh at
 * every dispatch, never read from a cached/previous value, so a reassignment or suspension since
 * the campaign was configured is caught before the call is placed, not after.
 *
 * `e164: null` (not a failure) means this tenant has made no caller ID selection at all yet —
 * no campaign override and no assigned default — which is the state of every tenant before a
 * Super Admin assigns one from the Phone Numbers page. Dispatch proceeds exactly as it did before
 * M1 existed (the engine falls back to its own global default); this is required by "do not break
 * existing outbound calling" for tenants not yet migrated onto the inventory. Once a selection
 * DOES exist — a campaign override or an assigned default — it is fully validated, and any
 * failure (reassigned, suspended, wrong capability) is a hard rejection, never a silent fallback
 * to some other number: a tenant that has gone through this resolution and failed must not dial
 * out under the wrong identity.
 */
export async function resolveAndValidateCallerId(
  database: PrismaClient,
  clientId: string,
  campaignCallerIdPhoneNumberId: string | null,
): Promise<CallerIdResolution> {
  const number = campaignCallerIdPhoneNumberId
    ? await database.phoneNumber.findUnique({ where: { id: campaignCallerIdPhoneNumberId } })
    : await database.phoneNumber.findFirst({
        where: { clientId, isDefaultOutboundCallerId: true },
      });

  if (!number) {
    if (!campaignCallerIdPhoneNumberId) return { ok: true, e164: null }; // not yet migrated: see above
    return { ok: false, reason: "This campaign's outbound caller ID number no longer exists." };
  }
  if (number.clientId !== clientId) {
    return {
      ok: false,
      reason: "The selected caller ID number is no longer assigned to this workspace.",
    };
  }
  if (number.status !== "ASSIGNED") {
    return {
      ok: false,
      reason: `The selected caller ID number is ${number.status.toLowerCase()}, not assigned. Choose or assign another.`,
    };
  }
  if (number.capability !== "VOICE_OUT" && number.capability !== "VOICE_BOTH") {
    return {
      ok: false,
      reason: "The selected caller ID number is not enabled for outbound calling.",
    };
  }
  return { ok: true, e164: number.e164 };
}

export const listPhoneNumbers = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(listSchema)
  .handler(({ data }) => listPhoneNumbersFor(db, data));

export const listPhoneNumberAssignmentHistory = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(z.object({ phoneNumberId: z.string().uuid() }))
  .handler(({ data }) => listPhoneNumberAssignmentHistoryFor(db, data.phoneNumberId));

export const addPhoneNumberToInventory = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(addSchema)
  .handler(({ context, data }) => addPhoneNumberToInventoryFor(db, context.userId, data));

export const assignPhoneNumberToTenant = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(assignSchema)
  .handler(({ context, data }) => assignPhoneNumberToTenantFor(db, context.userId, data));

export const unassignPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(unassignSchema)
  .handler(({ context, data }) => unassignPhoneNumberFor(db, context.userId, data));

export const suspendPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(suspendSchema)
  .handler(({ context, data }) => suspendPhoneNumberFor(db, context.userId, data));

export const reactivatePhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(reactivateSchema)
  .handler(({ context, data }) => reactivatePhoneNumberFor(db, context.userId, data));

export const setDefaultOutboundCallerId = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(setDefaultSchema)
  .handler(({ context, data }) => setDefaultOutboundCallerIdFor(db, context.userId, data));

export async function assignPhoneNumberToTenantFor(
  database: PrismaClient,
  userId: string,
  input: AssignPhoneNumberInput,
) {
  return inventoryTransaction(database, (tx) =>
    assignPhoneNumberToTenantForLocked(tx, userId, input),
  );
}

export async function unassignPhoneNumberFor(
  database: PrismaClient,
  userId: string,
  input: UnassignPhoneNumberInput,
) {
  return inventoryTransaction(database, (tx) => unassignPhoneNumberForLocked(tx, userId, input));
}

export async function suspendPhoneNumberFor(
  database: PrismaClient,
  userId: string,
  input: SuspendPhoneNumberInput,
) {
  return inventoryTransaction(database, (tx) => suspendPhoneNumberForLocked(tx, userId, input));
}

export async function reactivatePhoneNumberFor(
  database: PrismaClient,
  userId: string,
  input: ReactivatePhoneNumberInput,
) {
  return inventoryTransaction(database, (tx) => reactivatePhoneNumberForLocked(tx, userId, input));
}

export async function setDefaultOutboundCallerIdFor(
  database: PrismaClient,
  userId: string,
  input: SetDefaultOutboundCallerIdInput,
) {
  return inventoryTransaction(database, (tx) =>
    setDefaultOutboundCallerIdForLocked(tx, userId, input),
  );
}
