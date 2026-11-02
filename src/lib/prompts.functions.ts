import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  Prisma,
  type Prompt,
  type PromptVersion as PromptVersionRow,
  type PrismaClient,
} from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { isUniqueViolation } from "@/lib/db-errors";
import { currentWorkspaceClient } from "@/lib/workspace.functions";
import {
  newPromptContent,
  promptLanguages,
  validatePersonaKey,
  validatePrompt,
  type AgentPrompt,
  type PromptContent,
} from "@/lib/prompts";

export const promptContentSchema = z.object({
  name: z.string(),
  personaKey: z.string(),
  purpose: z.string(),
  active: z.boolean(),
  language: z.enum(promptLanguages as [string, ...string[]]),
  languages: z.array(z.string()),
  instructions: z.string(),
  knowledge: z.string(),
  greeting: z.string(),
  recognition: z.string(),
  whatsapp: z.string(),
  silenceWait: z.number(),
  silenceNudges: z.number(),
  voicemail: z.boolean(),
  listen: z.number(),
  stop: z.number(),
  confirmations: z.number(),
  confidence: z.number(),
}) satisfies z.ZodType<PromptContent>;

type PromptRow = Prompt & { versions: PromptVersionRow[] };

/** A saved revision's content; the columns fill in anything a revision does not carry. */
export function contentOf(snapshot: unknown, row: Prompt): PromptContent {
  const parsed = promptContentSchema.safeParse(snapshot);
  if (parsed.success) return parsed.data;
  return {
    ...newPromptContent(row.name),
    personaKey: row.personaKey,
    purpose: row.purpose,
    active: row.active,
    language: row.language,
    languages: [row.language],
    instructions: row.instructions,
    knowledge: row.knowledge,
    greeting: row.greeting,
  };
}

function promptFromRow(row: PromptRow): AgentPrompt {
  const versions = row.versions.map((v) => ({
    version: v.version,
    at: v.createdAt.toISOString(),
    content: contentOf(v.content, row),
  }));
  return { id: row.id, content: versions[0]?.content ?? contentOf(null, row), versions };
}

/** Every persona of the caller's workspace with its full content and revision history (newest first). */
export async function listPromptsFor(database: PrismaClient, userId: string) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { client: null, prompts: [] as AgentPrompt[] };
  const rows = await database.prompt.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: "asc" },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  return { client, prompts: rows.map(promptFromRow) };
}

export async function deletePromptFor(
  database: PrismaClient,
  userId: string,
  input: { promptId: string },
) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  const prompt = await database.prompt.findFirst({
    where: { id: input.promptId, clientId: client.id },
    select: { id: true, personaKey: true },
  });
  if (!prompt) throw new Error("Prompt not found.");

  const inUse = await database.campaign.findFirst({
    where: { clientId: client.id, personaKey: prompt.personaKey, status: { not: "Completed" } },
    select: { name: true },
  });
  if (inUse) {
    throw new Error(
      `The campaign "${inUse.name}" still uses this persona. Change its persona or complete it first.`,
    );
  }
  const routed = await database.inboundNumber.findFirst({
    where: { clientId: client.id, personaKey: prompt.personaKey },
    select: { phone: true },
  });
  if (routed) {
    throw new Error(
      `The inbound number ${routed.phone} still uses this persona. Assign it another persona first.`,
    );
  }
  await database.prompt.deleteMany({ where: { id: prompt.id, clientId: client.id } });
  return { promptId: prompt.id };
}

/**
 * The actual save: create or version-bump a persona, given an already-resolved tenant. Shared
 * by the tenant-facing savePromptVersionFor (which resolves clientId from the caller's own
 * session) and the Super Admin agent-management functions (which take clientId directly, since
 * the Super Admin is never a member of the tenant's workspace).
 */
export async function savePromptVersionForClient(
  database: PrismaClient,
  clientId: string,
  createdByUserId: string,
  input: { promptId: string | null; content: PromptContent },
) {
  const validationError = validatePrompt(input.content);
  if (validationError) throw new Error(validationError);

  const snapshot = input.content as unknown as Prisma.InputJsonValue;

  if (input.promptId) {
    return database.$transaction(async (tx) => {
      const existing = await tx.prompt.findFirst({
        where: { id: input.promptId!, clientId },
        select: { id: true, currentVersion: true },
      });
      if (!existing) throw new Error("Prompt not found.");

      const nextVersion = existing.currentVersion + 1;
      // Compare-and-set on the version: a concurrent save makes this one fail instead of
      // silently overwriting it or skipping a version number.
      const updated = await tx.prompt.updateMany({
        where: { id: existing.id, clientId, currentVersion: existing.currentVersion },
        data: {
          name: input.content.name.trim(),
          purpose: input.content.purpose,
          active: input.content.active,
          language: input.content.language,
          instructions: input.content.instructions,
          knowledge: input.content.knowledge,
          greeting: input.content.greeting,
          currentVersion: nextVersion,
        },
      });
      if (updated.count === 0)
        throw new Error("This prompt was saved elsewhere. Reload and try again.");

      await tx.promptVersion.create({
        data: {
          promptId: existing.id,
          version: nextVersion,
          content: snapshot,
          createdBy: createdByUserId,
        },
      });
      return { promptId: existing.id, version: nextVersion };
    });
  }

  const keyError = validatePersonaKey(input.content.personaKey, []);
  if (keyError) throw new Error(keyError);

  try {
    return await database.$transaction(async (tx) => {
      const created = await tx.prompt.create({
        data: {
          clientId,
          personaKey: input.content.personaKey,
          name: input.content.name.trim(),
          purpose: input.content.purpose,
          active: input.content.active,
          language: input.content.language,
          instructions: input.content.instructions,
          knowledge: input.content.knowledge,
          greeting: input.content.greeting,
          currentVersion: 1,
        },
        select: { id: true },
      });
      await tx.promptVersion.create({
        data: { promptId: created.id, version: 1, content: snapshot, createdBy: createdByUserId },
      });
      return { promptId: created.id, version: 1 };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Error("This persona key is already in use. Choose another.");
    throw error;
  }
}

export async function savePromptVersionFor(
  database: PrismaClient,
  userId: string,
  input: { promptId: string | null; content: PromptContent },
) {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) throw new Error("Your account isn't linked to a workspace yet.");
  return savePromptVersionForClient(database, client.id, userId, input);
}

export const listPrompts = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => listPromptsFor(db, context.userId));

export const deletePrompt = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ promptId: z.string().uuid() }))
  .handler(({ context, data }) => deletePromptFor(db, context.userId, data));

export const savePromptVersion = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(z.object({ promptId: z.string().uuid().nullable(), content: promptContentSchema }))
  .handler(({ context, data }) => savePromptVersionFor(db, context.userId, data));
