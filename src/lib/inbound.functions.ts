import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { isUniqueViolation } from "@/lib/db-errors";
import { phoneProblem } from "@/lib/inbound-numbers";
import { currentWorkspaceClient } from "@/lib/workspace.functions";
import { personaSnapshot } from "@/lib/voice-engine/persona";
import { engineProviderConfigForPersona } from "@/lib/voice-provider-settings.functions";
import {
  getInboundRoute,
  getUnroutedInbound,
  publishInboundRoute,
  VoiceEngineNotConfiguredError,
  VoiceEngineUnavailableError,
} from "@/lib/voice-engine/client";
import {
  engineWorkflows,
  type EngineWorkflow,
  type InboundRoutePublishRequest,
} from "@/lib/voice-engine/types";

// A publish that never finished (the process died mid-request) stops blocking the number after this long.
const PENDING_EXPIRES_MS = 60_000;
const HISTORY_SHOWN = 10;

const inboundNumberSchema = z.object({
  numberId: z.string().uuid().nullable(),
  phone: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const problem = phoneProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  personaKey: z.string().min(1),
  workflow: z.enum(engineWorkflows),
  active: z.boolean(),
});
export type InboundNumberInput = z.infer<typeof inboundNumberSchema>;

export interface PublicationView {
  id: string;
  version: number;
  status: string;
  personaVersion: number;
  personaName: string;
  workflow: string;
  active: boolean;
  error: string | null;
  createdAt: string;
}

export interface InboundNumberView {
  id: string;
  phone: string;
  personaKey: string;
  workflow: string;
  active: boolean;
  /** What the engine last confirmed (the newest synced publication); null until the first successful publish. */
  live: PublicationView | null;
  /** True when the saved draft or the persona's latest revision differs from what is live. */
  unpublished: boolean;
  personaMissing: boolean;
  /** The newest publication, shown when it failed or is still pending. */
  attention: PublicationView | null;
  history: PublicationView[];
}

type PublicationRow = Awaited<ReturnType<PrismaClient["inboundPublication"]["findMany"]>>[number];

function snapshotOf(row: PublicationRow): InboundRoutePublishRequest {
  return row.snapshot as unknown as InboundRoutePublishRequest;
}

function viewOf(row: PublicationRow): PublicationView {
  const snapshot = snapshotOf(row);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    personaVersion: row.personaVersion,
    personaName: snapshot.persona.name,
    workflow: snapshot.persona.workflow,
    active: snapshot.active,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listInboundNumbersFor(database: PrismaClient, userId: string) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { client: null, numbers: [] as InboundNumberView[] };

  const [numbers, prompts] = await Promise.all([
    database.inboundNumber.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: "asc" },
      include: { publications: { orderBy: { version: "desc" }, take: HISTORY_SHOWN } },
    }),
    database.prompt.findMany({
      where: { clientId: client.id },
      select: { personaKey: true, currentVersion: true },
    }),
  ]);
  const currentRevision = new Map(prompts.map((p) => [p.personaKey, p.currentVersion]));

  const views: InboundNumberView[] = [];
  for (const number of numbers) {
    const liveRow = await database.inboundPublication.findFirst({
      where: { numberId: number.id, status: "synced" },
      orderBy: { version: "desc" },
    });
    const latest = number.publications[0];
    const revision = currentRevision.get(number.personaKey);
    const live = liveRow ? snapshotOf(liveRow) : null;
    views.push({
      id: number.id,
      phone: number.phone,
      personaKey: number.personaKey,
      workflow: number.workflow,
      active: number.active,
      live: liveRow ? viewOf(liveRow) : null,
      unpublished:
        !live ||
        live.persona.key !== number.personaKey ||
        live.persona.workflow !== number.workflow ||
        live.active !== number.active ||
        live.persona.version !== revision,
      personaMissing: revision === undefined,
      attention: latest && latest.status !== "synced" ? viewOf(latest) : null,
      history: number.publications.map(viewOf),
    });
  }
  return { client, numbers: views };
}

export async function saveInboundNumberFor(
  database: PrismaClient,
  userId: string,
  input: InboundNumberInput,
) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");

  const persona = await database.prompt.findFirst({
    where: { clientId: client.id, personaKey: input.personaKey },
    select: { id: true },
  });
  if (!persona) throw new Error("Choose a persona that exists in this workspace.");

  const taken = "This number is already in use. Enter a different number.";
  if (!input.numberId) {
    const problem = phoneProblem(input.phone);
    if (problem) throw new Error(problem);
    try {
      return await database.inboundNumber.create({
        data: {
          clientId: client.id,
          phone: input.phone,
          personaKey: input.personaKey,
          workflow: input.workflow,
          active: input.active,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(taken);
      throw error;
    }
  }

  const existing = await database.inboundNumber.findFirst({
    where: { id: input.numberId, clientId: client.id },
    include: { _count: { select: { publications: true } } },
  });
  if (!existing) throw new Error("Number not found.");
  if (existing.phone !== input.phone) {
    if (existing._count.publications > 0) {
      throw new Error(
        "A number that has been published can't be changed. Add a new number instead.",
      );
    }
    const problem = phoneProblem(input.phone);
    if (problem) throw new Error(problem);
  }
  try {
    return await database.inboundNumber.update({
      where: { id: existing.id },
      data: {
        phone: input.phone,
        personaKey: input.personaKey,
        workflow: input.workflow,
        active: input.active,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error(taken);
    throw error;
  }
}

/**
 * Reads back what the engine now holds for the number and says how it differs from what was just sent, or null if it
 * matches. If the engine cannot be reached for the read-back, its acceptance of the publish stands.
 */
async function engineMismatch(sent: InboundRoutePublishRequest): Promise<string | null> {
  let state;
  try {
    state = await getInboundRoute(sent.phone);
  } catch (error) {
    if (
      error instanceof VoiceEngineNotConfiguredError ||
      error instanceof VoiceEngineUnavailableError
    ) {
      return null;
    }
    throw error;
  }
  if (!state) return "has no route stored for this number";
  const differences = [
    state.clientId !== sent.clientId && "belongs to a different workspace",
    state.version !== sent.version && `holds version ${state.version} instead of ${sent.version}`,
    state.active !== sent.active && `has the number ${state.active ? "on" : "off"}`,
    state.personaKey !== sent.persona.key && `uses persona "${state.personaKey}"`,
    state.personaVersion !== sent.persona.version &&
      `uses persona revision ${state.personaVersion} instead of ${sent.persona.version}`,
    state.workflow !== sent.persona.workflow && `uses the "${state.workflow}" conversation type`,
  ].filter(Boolean);
  return differences.length ? differences.join(" and ") : null;
}

export type PublishResult = { ok: true; version: number } | { ok: false; reason: string };

/**
 * Sends the number's route to the engine, which is the only thing that changes what callers hear.
 * Saved prompts and mapping edits stay drafts until this runs. A publish creates a new, higher
 * version; rolling back re-sends an earlier snapshot as a new version, so versions never go backwards.
 * Failure leaves what is live exactly as it was.
 */
export async function publishInboundNumberFor(
  database: PrismaClient,
  userId: string,
  input: { numberId: string; rollbackToPublicationId?: string | undefined },
  now: Date = new Date(),
): Promise<PublishResult> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  const number = await database.inboundNumber.findFirst({
    where: { id: input.numberId, clientId: client.id },
  });
  if (!number) throw new Error("Number not found.");

  await database.inboundPublication.updateMany({
    where: {
      numberId: number.id,
      status: "pending",
      createdAt: { lt: new Date(now.getTime() - PENDING_EXPIRES_MS) },
    },
    data: { status: "failed", error: "The publish did not finish." },
  });

  const liveRow = await database.inboundPublication.findFirst({
    where: { numberId: number.id, status: "synced" },
    orderBy: { version: "desc" },
  });

  let route: Omit<InboundRoutePublishRequest, "version">;
  if (input.rollbackToPublicationId) {
    const target = await database.inboundPublication.findFirst({
      where: { id: input.rollbackToPublicationId, numberId: number.id, status: "synced" },
    });
    if (!target) return { ok: false, reason: "That revision can't be restored." };
    if (liveRow && target.id === liveRow.id) {
      return { ok: false, reason: "That revision is already live." };
    }
    const { version: _version, ...rest } = snapshotOf(target);
    route = rest;
  } else {
    const prompt = await database.prompt.findFirst({
      where: { clientId: client.id, personaKey: number.personaKey },
    });
    if (prompt) {
      if (number.active && !prompt.active) {
        return {
          ok: false,
          reason: `The persona "${prompt.name}" is switched off. Turn it on in Prompts first.`,
        };
      }
      const persona = personaSnapshot(prompt, number.workflow as EngineWorkflow);
      if (!persona) {
        return {
          ok: false,
          reason: `The persona "${prompt.name}" uses ${prompt.language}, which the voice engine can't speak yet.`,
        };
      }
      // The resolved Persona -> Workspace -> Global provider choice; omitted keys mean the engine's own
      // global default, exactly as before these settings existed.
      const providerConfig = await engineProviderConfigForPersona(database, client.id, prompt);
      route = { phone: number.phone, clientId: client.id, active: number.active, persona: { ...persona, ...providerConfig } };
    } else if (!number.active && liveRow) {
      // Taking a number offline needs no persona text; keep the one that is live.
      const { version: _version, ...rest } = snapshotOf(liveRow);
      route = { ...rest, active: false };
    } else {
      return { ok: false, reason: "The persona for this number no longer exists." };
    }
  }

  const highest = await database.inboundPublication.aggregate({
    where: { numberId: number.id },
    _max: { version: true },
  });
  const version = Math.max(highest._max.version ?? 0, number.knownEngineVersion) + 1;
  const body: InboundRoutePublishRequest = { ...route, version };

  let publication;
  try {
    publication = await database.inboundPublication.create({
      data: {
        numberId: number.id,
        version,
        status: "pending",
        snapshot: body as unknown as Prisma.InputJsonValue,
        personaVersion: body.persona.version,
        createdBy: userId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "A publish is already in progress for this number." };
    }
    throw error;
  }

  const fail = async (reason: string, extra?: Prisma.InboundNumberUpdateManyMutationInput) => {
    await database.inboundPublication.update({
      where: { id: publication.id },
      data: { status: "failed", error: reason },
    });
    if (extra) {
      await database.inboundNumber.updateMany({ where: { id: number.id }, data: extra });
    }
    return { ok: false, reason } as const;
  };

  try {
    const result = await publishInboundRoute(body);
    if (result.kind === "applied" || result.kind === "unchanged") {
      const mismatch = await engineMismatch(body);
      if (mismatch) {
        return fail(
          `The engine accepted the publish but ${mismatch}. Nothing is confirmed live: use Check engine, or publish again.`,
        );
      }
      await database.inboundPublication.update({
        where: { id: publication.id },
        data: { status: "synced", syncedAt: new Date(), error: null },
      });
      return { ok: true, version };
    }
    if (result.kind === "stale") {
      await database.inboundNumber.updateMany({
        where: { id: number.id, knownEngineVersion: { lt: result.currentVersion } },
        data: { knownEngineVersion: result.currentVersion },
      });
      return fail(
        `The engine already holds version ${result.currentVersion}. Nothing was changed; publish again.`,
      );
    }
    return fail(result.message);
  } catch (error) {
    if (
      error instanceof VoiceEngineNotConfiguredError ||
      error instanceof VoiceEngineUnavailableError
    ) {
      return fail(
        `${error.message} Calls still follow the last confirmed version. The engine may have received this one; check its status or publish again.`,
      );
    }
    throw error;
  }
}

export interface EngineStatus {
  engine: { version: number; personaVersion: number; active: boolean; workflow: string } | null;
  reconciled: boolean;
}

/** Reads what the engine is really serving, and confirms a publish whose answer was lost on the way back. */
export async function refreshInboundNumberFor(
  database: PrismaClient,
  userId: string,
  input: { numberId: string },
): Promise<EngineStatus> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  const number = await database.inboundNumber.findFirst({
    where: { id: input.numberId, clientId: client.id },
  });
  if (!number) throw new Error("Number not found.");

  let state;
  try {
    state = await getInboundRoute(number.phone);
  } catch (error) {
    if (
      error instanceof VoiceEngineNotConfiguredError ||
      error instanceof VoiceEngineUnavailableError
    ) {
      throw new Error(error.message);
    }
    throw error;
  }
  if (!state) return { engine: null, reconciled: false };
  if (state.clientId !== client.id) {
    throw new Error("The engine routes this number for a different workspace.");
  }

  await database.inboundNumber.updateMany({
    where: { id: number.id, knownEngineVersion: { lt: state.version } },
    data: { knownEngineVersion: state.version },
  });
  const matched = await database.inboundPublication.updateMany({
    where: {
      numberId: number.id,
      version: state.version,
      status: "failed",
      personaVersion: state.personaVersion,
    },
    data: { status: "synced", syncedAt: new Date(), error: null },
  });
  return {
    engine: {
      version: state.version,
      personaVersion: state.personaVersion,
      active: state.active,
      workflow: state.workflow,
    },
    reconciled: matched.count > 0,
  };
}

export interface UnroutedNumberView {
  /** E.164, ready to add as a number. */
  phone: string;
  /** The way the telephony provider wrote it. */
  rawExample: string;
  calls: number;
  lastSeen: string;
  answeredBy: "default_agent" | "refused";
}

/**
 * Numbers that calls reached the engine on while no route was published for them: the sign of a route keyed to the
 * wrong number. Only a workspace owner sees them, and a number that any workspace has already added is never listed.
 */
export async function listUnroutedNumbersFor(
  database: PrismaClient,
  userId: string,
): Promise<{ numbers: UnroutedNumberView[]; unavailable: boolean }> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { numbers: [], unavailable: false };
  const membership = await database.clientMember.findFirst({
    where: { userId, clientId: client.id },
    select: { role: true },
  });
  if (membership?.role !== "owner") return { numbers: [], unavailable: false };

  let unrouted;
  try {
    unrouted = await getUnroutedInbound();
  } catch (error) {
    if (
      error instanceof VoiceEngineNotConfiguredError ||
      error instanceof VoiceEngineUnavailableError
    ) {
      return { numbers: [], unavailable: true };
    }
    throw error;
  }
  const candidates = unrouted
    .filter((n) => /^[1-9][0-9]{9,14}$/.test(n.phone))
    .map((n) => ({ ...n, phone: `+${n.phone}` }));
  const taken = new Set(
    (
      await database.inboundNumber.findMany({
        where: { phone: { in: candidates.map((n) => n.phone) } },
        select: { phone: true },
      })
    ).map((n) => n.phone),
  );
  return {
    unavailable: false,
    numbers: candidates
      .filter((n) => !taken.has(n.phone))
      .slice(0, 5)
      .map(({ phone, rawExample, calls, lastSeen, answeredBy }) => ({
        phone,
        rawExample,
        calls,
        lastSeen,
        answeredBy,
      })),
  };
}

export interface InboundSuspensionOutcome {
  numberId: string;
  phone: string;
  ok: boolean;
  error?: string;
}

/**
 * Super Admin suspend/reactivate: forces every one of this tenant's *live* inbound routes off
 * the engine (suspended=true), or restores each back to the tenant's own saved on/off setting
 * (suspended=false). Reuses the same "take a number offline" shape publishInboundNumberFor
 * already sends for `!active` — the live persona snapshot with just the active flag flipped, no
 * persona text needed. Deliberately self-contained (does not call publishInboundNumberFor,
 * which is scoped to a single tenant caller).
 *
 * Best-effort per number — one number's engine failure does not stop the rest from being
 * enforced — but never silent: every failure is both logged (console.error, for operational
 * visibility) and returned in the result, so the caller (setTenantStatusFor) can refuse to
 * report plain success and the Super Admin console can show exactly which numbers still need
 * attention. Numbers with nothing live to touch, or already matching the target, are reported
 * as ok (nothing to fix); only numbers actually requiring and failing a publish are reported
 * as failures — callers should treat "no entry" the same as "ok".
 */
export async function setInboundNumbersSuspendedForClient(
  database: PrismaClient,
  clientId: string,
  suspended: boolean,
): Promise<InboundSuspensionOutcome[]> {
  const numbers = await database.inboundNumber.findMany({ where: { clientId } });
  const outcomes: InboundSuspensionOutcome[] = [];
  for (const number of numbers) {
    const liveRow = await database.inboundPublication.findFirst({
      where: { numberId: number.id, status: "synced" },
      orderBy: { version: "desc" },
    });
    if (!liveRow) continue;
    const liveSnapshot = snapshotOf(liveRow);
    const targetActive = suspended ? false : number.active;
    if (liveSnapshot.active === targetActive) continue;

    const highest = await database.inboundPublication.aggregate({
      where: { numberId: number.id },
      _max: { version: true },
    });
    const version = Math.max(highest._max.version ?? 0, number.knownEngineVersion) + 1;
    const { version: _previousVersion, ...rest } = liveSnapshot;
    const body: InboundRoutePublishRequest = { ...rest, active: targetActive, version };

    let publication;
    try {
      publication = await database.inboundPublication.create({
        data: {
          numberId: number.id,
          version,
          status: "pending",
          snapshot: body as unknown as Prisma.InputJsonValue,
          personaVersion: body.persona.version,
        },
        select: { id: true },
      });
    } catch {
      // A publish is already in progress for this number (the tenant or a previous retry).
      // Leaving it alone is correct, but the caller still needs to know it isn't settled yet.
      const message = "A publish is already in progress for this number.";
      console.error(`[inbound-suspend] ${number.phone}: ${message}`);
      outcomes.push({ numberId: number.id, phone: number.phone, ok: false, error: message });
      continue;
    }

    try {
      const result = await publishInboundRoute(body);
      if (result.kind === "applied" || result.kind === "unchanged") {
        await database.inboundPublication.update({
          where: { id: publication.id },
          data: { status: "synced", syncedAt: new Date(), error: null },
        });
        outcomes.push({ numberId: number.id, phone: number.phone, ok: true });
      } else if (result.kind === "stale") {
        await database.inboundNumber.updateMany({
          where: { id: number.id, knownEngineVersion: { lt: result.currentVersion } },
          data: { knownEngineVersion: result.currentVersion },
        });
        const message = `Engine already holds version ${result.currentVersion}.`;
        await database.inboundPublication.update({
          where: { id: publication.id },
          data: { status: "failed", error: message },
        });
        console.error(`[inbound-suspend] ${number.phone}: ${message}`);
        outcomes.push({ numberId: number.id, phone: number.phone, ok: false, error: message });
      } else {
        await database.inboundPublication.update({
          where: { id: publication.id },
          data: { status: "failed", error: result.message },
        });
        console.error(`[inbound-suspend] ${number.phone}: ${result.message}`);
        outcomes.push({
          numberId: number.id,
          phone: number.phone,
          ok: false,
          error: result.message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach the voice engine.";
      await database.inboundPublication.update({
        where: { id: publication.id },
        data: { status: "failed", error: message },
      });
      console.error(`[inbound-suspend] ${number.phone}: ${message}`, error);
      outcomes.push({ numberId: number.id, phone: number.phone, ok: false, error: message });
    }
  }
  return outcomes;
}

export const listUnroutedNumbers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => listUnroutedNumbersFor(db, context.userId));

export const listInboundNumbers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => listInboundNumbersFor(db, context.userId));

export const saveInboundNumber = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(inboundNumberSchema)
  .handler(async ({ context, data }) => {
    const saved = await saveInboundNumberFor(db, context.userId, data);
    return { numberId: saved.id };
  });

export const publishInboundNumber = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    z.object({
      numberId: z.string().uuid(),
      rollbackToPublicationId: z.string().uuid().optional(),
    }),
  )
  .handler(({ context, data }) => publishInboundNumberFor(db, context.userId, data));

export const refreshInboundNumber = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ numberId: z.string().uuid() }))
  .handler(({ context, data }) => refreshInboundNumberFor(db, context.userId, data));
