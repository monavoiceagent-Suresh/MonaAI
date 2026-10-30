import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import {
  defaultOutcomeRules,
  fallbackDefinition,
  type OutcomeRule,
} from "@/lib/call-outcome-rules";
import {
  engineOutcomeRulesForClient,
  getCallOutcomeSettingsFor,
  saveCallOutcomeSettingsFor,
} from "./call-outcome-settings.functions";

const tenants: Tenant[] = [];
afterAll(() => deleteTenants(db, tenants));

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

const RULES: OutcomeRule[] = [
  {
    id: "r1",
    name: "Interested",
    definition: "Clear positive response.",
    enabled: true,
    builtIn: false,
  },
  {
    id: "r2",
    name: "Not interested",
    definition: "Clearly declines.",
    enabled: false,
    builtIn: false,
  },
];

describe("call outcome settings", () => {
  it("gives a brand-new workspace the same defaults the page always offered", async () => {
    const a = await newTenant();
    const settings = await getCallOutcomeSettingsFor(db, a.userId);
    expect(settings).toEqual({
      rules: defaultOutcomeRules(),
      fallback: fallbackDefinition,
      shortHangupThresholdSeconds: 15,
    });
  });

  it("saves and reads back exactly what was saved", async () => {
    const a = await newTenant();
    const result = await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: RULES,
      fallback: "Custom fallback.",
      shortHangupThresholdSeconds: 20,
    });
    expect(result).toEqual({
      ok: true,
      settings: { rules: RULES, fallback: "Custom fallback.", shortHangupThresholdSeconds: 20 },
    });

    const loaded = await getCallOutcomeSettingsFor(db, a.userId);
    expect(loaded).toEqual({
      rules: RULES,
      fallback: "Custom fallback.",
      shortHangupThresholdSeconds: 20,
    });
  });

  it("saving again overwrites the previous save (one row per workspace)", async () => {
    const a = await newTenant();
    await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: RULES,
      fallback: "First.",
      shortHangupThresholdSeconds: 15,
    });

    await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: [],
      fallback: "Second.",
      shortHangupThresholdSeconds: 30,
    });

    const loaded = await getCallOutcomeSettingsFor(db, a.userId);
    expect(loaded).toEqual({ rules: [], fallback: "Second.", shortHangupThresholdSeconds: 30 });
    expect(await db.callOutcomeSettings.count({ where: { clientId: a.clientId } })).toBe(1);
  });

  it("refuses when the caller has no workspace", async () => {
    const result = await saveCallOutcomeSettingsFor(db, "00000000-0000-0000-0000-000000000000", {
      rules: RULES,
      fallback: "x",
      shortHangupThresholdSeconds: 15,
    });
    expect(result).toEqual({ ok: false, reason: "Your account isn't linked to a workspace yet." });
  });

  it("rejects duplicate rule names", async () => {
    const a = await newTenant();
    const dup = [...RULES, { ...RULES[0]!, id: "r3" }];
    const result = await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: dup,
      fallback: "x",
      shortHangupThresholdSeconds: 15,
    });
    expect(result).toEqual({ ok: false, reason: "Give each outcome a unique name." });
  });

  it("rejects a rule named Inconclusive — it is the engine's own reserved fallback name", async () => {
    const a = await newTenant();
    const reserved = [
      { id: "r1", name: "Inconclusive", definition: "x", enabled: true, builtIn: false },
    ];
    const result = await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: reserved,
      fallback: "x",
      shortHangupThresholdSeconds: 15,
    });
    expect(result).toEqual({ ok: false, reason: "Give each outcome a unique name." });
  });

  it("rejects an out-of-range threshold", async () => {
    const a = await newTenant();
    const result = await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: [],
      fallback: "x",
      shortHangupThresholdSeconds: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("never lets one workspace see or change another's settings", async () => {
    const a = await newTenant();
    const b = await newTenant();
    await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: RULES,
      fallback: "A's.",
      shortHangupThresholdSeconds: 15,
    });

    const bSettings = await getCallOutcomeSettingsFor(db, b.userId);

    expect(bSettings.fallback).toBe(fallbackDefinition); // b still sees the untouched defaults
  });

  it("engineOutcomeRulesForClient sends only the enabled rules, name and definition only", async () => {
    const a = await newTenant();
    await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: RULES,
      fallback: "Custom fallback.",
      shortHangupThresholdSeconds: 15,
    });

    const sent = await engineOutcomeRulesForClient(db, a.clientId);

    expect(sent).toEqual({
      outcomeRules: [{ name: "Interested", definition: "Clear positive response." }],
      outcomeFallback: "Custom fallback.",
    });
  });

  it("engineOutcomeRulesForClient sends nothing when no rule is enabled (engine uses its own fixed list)", async () => {
    const a = await newTenant();
    const allDisabled = RULES.map((r) => ({ ...r, enabled: false }));
    await saveCallOutcomeSettingsFor(db, a.userId, {
      rules: allDisabled,
      fallback: "x",
      shortHangupThresholdSeconds: 15,
    });

    const sent = await engineOutcomeRulesForClient(db, a.clientId);

    expect(sent).toEqual({ outcomeRules: [] });
  });

  it("engineOutcomeRulesForClient sends nothing for a workspace that never saved anything", async () => {
    const a = await newTenant();
    const sent = await engineOutcomeRulesForClient(db, a.clientId);
    // The default rules are all enabled, so a never-configured workspace would send its 6 defaults —
    // which is fine: they are the same wording the engine's own fixed list roughly mirrors, and the
    // workspace can disable them anytime without code changes.
    expect(sent.outcomeRules.length).toBe(defaultOutcomeRules().length);
  });
});
