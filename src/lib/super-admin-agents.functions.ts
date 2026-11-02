// Super Admin agent management: cross-tenant listing/search and view/create/edit/activate for
// existing tenant agents (Prompts, in the dashboard's own data model — see
// src/lib/super-admin.functions.ts for why "agent" means "persona/prompt" here).
//
// Create/edit reuse savePromptVersionForClient (src/lib/prompts.functions.ts), the exact same
// validation and version-bump transaction the tenant-facing Prompts page already uses — this
// file only supplies the clientId explicitly instead of resolving it from a tenant session,
// and adds the cross-tenant listing a Super Admin needs that no single tenant ever would.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import {
  contentOf,
  promptContentSchema,
  savePromptVersionForClient,
} from "@/lib/prompts.functions";
import type { PromptContent } from "@/lib/prompts";

const PAGE_SIZE = 20;

const listSchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  page: z.number().int().min(1).default(1),
});
export type AgentListInput = z.infer<typeof listSchema>;

export interface AgentListItem {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string;
  active: boolean;
  language: string;
  createdAt: string;
}

export interface AgentListResult {
  agents: AgentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAgentsFor(
  database: PrismaClient,
  input: AgentListInput,
): Promise<AgentListResult> {
  const search = input.search?.trim();
  const where = {
    ...(input.status !== "all" ? { active: input.status === "active" } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { client: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, prompts] = await Promise.all([
    database.prompt.count({ where }),
    database.prompt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        active: true,
        language: true,
        createdAt: true,
        clientId: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
    agents: prompts.map((p) => ({
      id: p.id,
      name: p.name,
      tenantId: p.clientId,
      tenantName: p.client.name,
      active: p.active,
      language: p.language,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

export interface AgentDetail {
  id: string;
  tenantId: string;
  tenantName: string;
  content: PromptContent;
  currentVersion: number;
  createdAt: string;
}

export async function getAgentDetailFor(
  database: PrismaClient,
  promptId: string,
): Promise<AgentDetail | null> {
  const prompt = await database.prompt.findUnique({
    where: { id: promptId },
    include: {
      client: { select: { name: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!prompt) return null;
  return {
    id: prompt.id,
    tenantId: prompt.clientId,
    tenantName: prompt.client.name,
    content: contentOf(prompt.versions[0]?.content, prompt),
    currentVersion: prompt.currentVersion,
    createdAt: prompt.createdAt.toISOString(),
  };
}

const createAgentSchema = z.object({
  clientId: z.string().uuid(),
  content: promptContentSchema,
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export type AgentSaveResult =
  { ok: true; promptId: string; version: number } | { ok: false; reason: string };

export async function createAgentFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: CreateAgentInput,
): Promise<AgentSaveResult> {
  const client = await database.client.findUnique({
    where: { id: input.clientId },
    select: { id: true },
  });
  if (!client) return { ok: false, reason: "Tenant not found." };
  try {
    const result = await savePromptVersionForClient(database, input.clientId, superAdminUserId, {
      promptId: null,
      content: input.content,
    });
    console.log(
      `[super-admin] agent created: prompt=${result.promptId} tenant=${input.clientId} by=${superAdminUserId}`,
    );
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Couldn't create this agent.",
    };
  }
}

const updateAgentSchema = z.object({
  promptId: z.string().uuid(),
  content: promptContentSchema,
});
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export async function updateAgentFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: UpdateAgentInput,
): Promise<AgentSaveResult> {
  const prompt = await database.prompt.findUnique({
    where: { id: input.promptId },
    select: { clientId: true },
  });
  if (!prompt) return { ok: false, reason: "Agent not found." };
  try {
    const result = await savePromptVersionForClient(database, prompt.clientId, superAdminUserId, {
      promptId: input.promptId,
      content: input.content,
    });
    console.log(`[super-admin] agent updated: prompt=${input.promptId} by=${superAdminUserId}`);
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Couldn't save this agent.",
    };
  }
}

const setActiveSchema = z.object({
  promptId: z.string().uuid(),
  active: z.boolean(),
});
export type SetAgentActiveInput = z.infer<typeof setActiveSchema>;

/**
 * Activate/deactivate as its own quick action, not a content edit — but still goes through the
 * same version-bump save as an edit would, because Prompt.active and the latest PromptVersion's
 * own snapshot must never disagree (listPromptsFor reads "active" from the snapshot, not the
 * column) and PromptVersion rows are append-only by design (see prompts.functions.ts): there is
 * no other way to flip it that keeps both in sync without mutating a supposedly-immutable row.
 */
export async function setAgentActiveFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: SetAgentActiveInput,
): Promise<AgentSaveResult> {
  const detail = await getAgentDetailFor(database, input.promptId);
  if (!detail) return { ok: false, reason: "Agent not found." };
  if (detail.content.active === input.active)
    return { ok: true, promptId: input.promptId, version: detail.currentVersion };
  try {
    const result = await savePromptVersionForClient(database, detail.tenantId, superAdminUserId, {
      promptId: input.promptId,
      content: { ...detail.content, active: input.active },
    });
    console.log(
      `[super-admin] agent ${input.active ? "activated" : "deactivated"}: prompt=${input.promptId} by=${superAdminUserId}`,
    );
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Couldn't change this agent's status.",
    };
  }
}

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(listSchema)
  .handler(({ data }) => listAgentsFor(db, data));

export const getAgentDetail = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .validator(z.object({ promptId: z.string().uuid() }))
  .handler(({ data }) => getAgentDetailFor(db, data.promptId));

export const createAgent = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(createAgentSchema)
  .handler(({ context, data }) => createAgentFor(db, context.userId, data));

export const updateAgent = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(updateAgentSchema)
  .handler(({ context, data }) => updateAgentFor(db, context.userId, data));

export const setAgentActive = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(setActiveSchema)
  .handler(({ context, data }) => setAgentActiveFor(db, context.userId, data));
