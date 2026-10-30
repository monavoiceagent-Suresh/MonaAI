// Persists the workspace's own Call Outcome Rules (one row per client, saved whole) and reads them back
// for the dispatch/test-call paths to send into the engine's PersonaIn.outcomeRules/outcomeFallback.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireAuth } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import { currentWorkspaceClient } from "@/lib/workspace.functions";
import {
  defaultOutcomeRules,
  fallbackDefinition,
  validateOutcomeRules,
  validateThreshold,
  type OutcomeRule,
} from "@/lib/call-outcome-rules";

const DEFAULT_THRESHOLD_SECONDS = 15;

export interface CallOutcomeSettingsView {
  rules: OutcomeRule[];
  fallback: string;
  shortHangupThresholdSeconds: number;
}

const outcomeRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  definition: z.string(),
  enabled: z.boolean(),
  builtIn: z.boolean(),
});

const saveSchema = z.object({
  rules: z.array(outcomeRuleSchema).max(32),
  fallback: z.string(),
  shortHangupThresholdSeconds: z.number().int(),
});
export type SaveCallOutcomeSettingsInput = z.infer<typeof saveSchema>;

/** A brand-new workspace (no row saved yet) sees the same defaults the page always offered locally. */
function defaults(): CallOutcomeSettingsView {
  return {
    rules: defaultOutcomeRules(),
    fallback: fallbackDefinition,
    shortHangupThresholdSeconds: DEFAULT_THRESHOLD_SECONDS,
  };
}

export async function getCallOutcomeSettingsForClient(
  database: PrismaClient,
  clientId: string,
): Promise<CallOutcomeSettingsView> {
  const row = await database.callOutcomeSettings.findUnique({ where: { clientId } });
  if (!row) return defaults();
  return {
    rules: row.rules as unknown as OutcomeRule[],
    fallback: row.fallback,
    shortHangupThresholdSeconds: row.shortHangupThresholdSeconds,
  };
}

export async function getCallOutcomeSettingsFor(
  database: PrismaClient,
  userId: string,
): Promise<CallOutcomeSettingsView> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return defaults();
  return getCallOutcomeSettingsForClient(database, client.id);
}

export type SaveCallOutcomeSettingsResult =
  { ok: true; settings: CallOutcomeSettingsView } | { ok: false; reason: string };

export async function saveCallOutcomeSettingsFor(
  database: PrismaClient,
  userId: string,
  input: SaveCallOutcomeSettingsInput,
): Promise<SaveCallOutcomeSettingsResult> {
  const client = await currentWorkspaceClient(database, userId);
  if (!client) return { ok: false, reason: "Your account isn't linked to a workspace yet." };

  const ruleError = validateOutcomeRules(input.rules, input.fallback);
  if (ruleError) return { ok: false, reason: ruleError };
  const thresholdError = validateThreshold(String(input.shortHangupThresholdSeconds));
  if (thresholdError) return { ok: false, reason: thresholdError };

  await database.callOutcomeSettings.upsert({
    where: { clientId: client.id },
    create: {
      clientId: client.id,
      rules: input.rules,
      fallback: input.fallback,
      shortHangupThresholdSeconds: input.shortHangupThresholdSeconds,
    },
    update: {
      rules: input.rules,
      fallback: input.fallback,
      shortHangupThresholdSeconds: input.shortHangupThresholdSeconds,
    },
  });
  return {
    ok: true,
    settings: {
      rules: input.rules,
      fallback: input.fallback,
      shortHangupThresholdSeconds: input.shortHangupThresholdSeconds,
    },
  };
}

/** What a dispatch/test call sends the engine: only the enabled conversation rules, name+definition only.
 * Empty means "no custom rules" — the engine then uses its own fixed per-workflow list, unchanged. */
export async function engineOutcomeRulesForClient(
  database: PrismaClient,
  clientId: string,
): Promise<{ outcomeRules: { name: string; definition: string }[]; outcomeFallback?: string }> {
  const settings = await getCallOutcomeSettingsForClient(database, clientId);
  const enabled = settings.rules.filter((r) => r.enabled);
  if (!enabled.length) return { outcomeRules: [] };
  return {
    outcomeRules: enabled.map((r) => ({ name: r.name, definition: r.definition })),
    outcomeFallback: settings.fallback,
  };
}

export const getCallOutcomeSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(({ context }) => getCallOutcomeSettingsFor(db, context.userId));

export const saveCallOutcomeSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(saveSchema)
  .handler(({ context, data }) => saveCallOutcomeSettingsFor(db, context.userId, data));
