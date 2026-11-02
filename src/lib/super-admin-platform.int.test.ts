// Focused checks for Phase 2B: credit ledger adjustments + pricing, agent management
// (including the active/version-sync subtlety), and that the campaign overview is read data
// only. Not exhaustive — one test per behavior the brief calls out explicitly.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db.server";
import {
  adjustTenantCreditFor,
  getCreditOverviewFor,
  getCreditPricingFor,
  getTenantCreditHistoryFor,
  listTenantCreditsFor,
  setCreditPricingFor,
} from "@/lib/super-admin-credits.functions";
import { applyCreditTransaction } from "@/lib/voice-engine/webhook";
import {
  createAgentFor,
  getAgentDetailFor,
  listAgentsFor,
  setAgentActiveFor,
  updateAgentFor,
} from "@/lib/super-admin-agents.functions";
import {
  getCampaignSummaryFor,
  getTenantCampaignCountsFor,
  listAllCampaignsFor,
} from "@/lib/super-admin-campaigns.functions";

const SUPER_ADMIN_ID = randomUUID();
const clientIds: string[] = [];

afterAll(async () => {
  await db.client.deleteMany({ where: { id: { in: clientIds } } });
});

async function makeTenant(name?: string) {
  const client = await db.client.create({
    data: { name: name ?? `Test tenant ${randomUUID().slice(0, 8)}` },
    select: { id: true, name: true },
  });
  clientIds.push(client.id);
  return client;
}

describe("credit ledger adjustments", () => {
  it("adding credits writes a ledger row and increments the balance together", async () => {
    const tenant = await makeTenant();
    const result = await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 500,
      reason: "Initial top-up",
      idempotencyKey: randomUUID(),
    });
    expect(result).toEqual({ ok: true, newBalance: 500 });
    const client = await db.client.findUnique({ where: { id: tenant.id } });
    expect(client?.creditBalance).toBe(500);
    const history = await getTenantCreditHistoryFor(db, tenant.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ amount: 500, note: "Initial top-up" });
  });

  it("deducting credits can take the balance negative, with a matching ledger row", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 100,
      reason: "Top-up",
      idempotencyKey: randomUUID(),
    });
    const result = await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: -150,
      reason: "Correction for overbilled minutes",
      idempotencyKey: randomUUID(),
    });
    expect(result).toEqual({ ok: true, newBalance: -50 });
  });

  it("retrying the same idempotency key does not apply the adjustment twice", async () => {
    const tenant = await makeTenant();
    const key = randomUUID();
    const first = await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 200,
      reason: "Top-up",
      idempotencyKey: key,
    });
    const retry = await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 200,
      reason: "Top-up",
      idempotencyKey: key,
    });
    expect(first).toEqual({ ok: true, newBalance: 200 });
    expect(retry).toEqual({ ok: true, newBalance: 200 });
    expect(await db.creditTransaction.count({ where: { clientId: tenant.id } })).toBe(1);
  });

  it("returns a clear error for an unknown tenant", async () => {
    const result = await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: randomUUID(),
      amount: 100,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    expect(result).toEqual({ ok: false, reason: "Tenant not found." });
  });

  it("the platform overview sums manual additions/deductions from the ledger and negative balances from clients", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: a.id,
      amount: 300,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: a.id,
      amount: -400,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: b.id,
      amount: -20,
      reason: "x",
      idempotencyKey: randomUUID(),
    });

    const overview = await getCreditOverviewFor(db);
    expect(overview.totalManualAdditions).toBeGreaterThanOrEqual(300);
    expect(overview.totalManualDeductions).toBeGreaterThanOrEqual(420);
    expect(overview.tenantsWithNegativeBalance).toBeGreaterThanOrEqual(2);
  });

  it("tenant-wise listing finds a tenant by name and can filter to negative balances only", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: -10,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    const bySearch = await listTenantCreditsFor(db, {
      page: 1,
      search: tenant.name,
      negativeOnly: false,
    });
    expect(bySearch.tenants.some((t) => t.clientId === tenant.id)).toBe(true);
    const negativeOnly = await listTenantCreditsFor(db, { page: 1, negativeOnly: true });
    expect(negativeOnly.tenants.every((t) => t.creditBalance < 0)).toBe(true);
    expect(negativeOnly.tenants.some((t) => t.clientId === tenant.id)).toBe(true);
  });
});

describe("credit transaction classification", () => {
  it("tags a Super Admin manual adjustment as MANUAL_ADJUSTMENT", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 50,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    const row = await db.creditTransaction.findFirst({ where: { clientId: tenant.id } });
    expect(row?.type).toBe("MANUAL_ADJUSTMENT");
  });

  it("tags an automated voice-usage debit as VOICE_USAGE, distinct from a manual adjustment", async () => {
    const tenant = await makeTenant();
    await db.client.update({ where: { id: tenant.id }, data: { creditBalance: 1000 } });
    await db.$transaction((tx) =>
      applyCreditTransaction(tx, tenant.id, -25, "Voice engine usage for job test (5 min)"),
    );
    const row = await db.creditTransaction.findFirst({ where: { clientId: tenant.id } });
    expect(row?.type).toBe("VOICE_USAGE");
  });

  it("a pre-existing row with no type set defaults to UNKNOWN, never guessed from its note", async () => {
    const tenant = await makeTenant();
    // Simulates a historical row written before the type column existed: no type is passed,
    // so the column's own default applies — never inferred from the note text, even though
    // this note looks exactly like a manual adjustment's.
    await db.creditTransaction.create({
      data: { clientId: tenant.id, amount: 10, note: "Looks like a manual top-up" },
    });
    const row = await db.creditTransaction.findFirst({ where: { clientId: tenant.id } });
    expect(row?.type).toBe("UNKNOWN");
  });

  it("the credit overview reports manual additions, manual deductions and voice usage as separate totals", async () => {
    const tenant = await makeTenant();
    await db.client.update({ where: { id: tenant.id }, data: { creditBalance: 1000 } });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 200,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await db.$transaction((tx) => applyCreditTransaction(tx, tenant.id, -60, "usage"));

    const overview = await getCreditOverviewFor(db);
    expect(overview.totalManualAdditions).toBeGreaterThanOrEqual(200);
    expect(overview.totalVoiceUsage).toBeGreaterThanOrEqual(60);
  });

  it("tenant-wise listing never folds voice usage into the manual-adjustment columns", async () => {
    const tenant = await makeTenant();
    await db.client.update({ where: { id: tenant.id }, data: { creditBalance: 1000 } });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 100,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await db.$transaction((tx) => applyCreditTransaction(tx, tenant.id, -40, "usage"));

    const result = await listTenantCreditsFor(db, {
      page: 1,
      search: tenant.name,
      negativeOnly: false,
    });
    const row = result.tenants.find((t) => t.clientId === tenant.id);
    expect(row).toMatchObject({
      totalManualAdditions: 100,
      totalManualDeductions: 0,
      totalVoiceUsage: 40,
    });
  });

  it("history entries carry their type so the console can label manual vs. automated", async () => {
    const tenant = await makeTenant();
    await db.client.update({ where: { id: tenant.id }, data: { creditBalance: 1000 } });
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 30,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    await db.$transaction((tx) => applyCreditTransaction(tx, tenant.id, -10, "usage"));

    const history = await getTenantCreditHistoryFor(db, tenant.id);
    expect(history.map((h) => h.type).sort()).toEqual(["MANUAL_ADJUSTMENT", "VOICE_USAGE"]);
  });
});

describe("credit pricing", () => {
  it("has a default price before anything is ever set", async () => {
    const pricing = await getCreditPricingFor(db);
    expect(pricing.pricePerCredit).toBeGreaterThan(0);
  });

  it("updating the price does not change amounts already recorded in the ledger", async () => {
    const tenant = await makeTenant();
    await adjustTenantCreditFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      amount: 77,
      reason: "x",
      idempotencyKey: randomUUID(),
    });
    const before = await getTenantCreditHistoryFor(db, tenant.id);

    await setCreditPricingFor(db, SUPER_ADMIN_ID, { pricePerCredit: 2.5 });
    const updated = await getCreditPricingFor(db);
    expect(updated.pricePerCredit).toBe(2.5);

    const after = await getTenantCreditHistoryFor(db, tenant.id);
    expect(after.find((e) => e.id === before[0]!.id)?.amount).toBe(77);
  });
});

describe("agent management", () => {
  it("creates an agent under the selected tenant", async () => {
    const tenant = await makeTenant();
    const result = await createAgentFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      content: {
        name: "Support Bot",
        personaKey: `support-bot-${randomUUID().slice(0, 6)}`,
        purpose: "",
        active: true,
        language: "English",
        languages: ["English"],
        instructions: "Be helpful.",
        knowledge: "",
        greeting: "Hi!",
        recognition: "",
        whatsapp: "",
        silenceWait: 4,
        silenceNudges: 2,
        voicemail: true,
        listen: 3,
        stop: 13,
        confirmations: 1,
        confidence: 95,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = await getAgentDetailFor(db, result.promptId);
    expect(detail?.tenantId).toBe(tenant.id);
    expect(detail?.content.name).toBe("Support Bot");
  });

  it("refuses to create an agent for an unknown tenant", async () => {
    const result = await createAgentFor(db, SUPER_ADMIN_ID, {
      clientId: randomUUID(),
      content: {
        name: "Ghost Bot",
        personaKey: "ghost-bot",
        purpose: "",
        active: true,
        language: "English",
        languages: ["English"],
        instructions: "x",
        knowledge: "",
        greeting: "x",
        recognition: "",
        whatsapp: "",
        silenceWait: 4,
        silenceNudges: 2,
        voicemail: true,
        listen: 3,
        stop: 13,
        confirmations: 1,
        confidence: 95,
      },
    });
    expect(result).toEqual({ ok: false, reason: "Tenant not found." });
  });

  it("editing an agent stays scoped to its own tenant and bumps the version", async () => {
    const tenant = await makeTenant();
    const created = await createAgentFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      content: {
        name: "Sales Bot",
        personaKey: `sales-bot-${randomUUID().slice(0, 6)}`,
        purpose: "",
        active: true,
        language: "English",
        languages: ["English"],
        instructions: "Sell things.",
        knowledge: "",
        greeting: "Hi!",
        recognition: "",
        whatsapp: "",
        silenceWait: 4,
        silenceNudges: 2,
        voicemail: true,
        listen: 3,
        stop: 13,
        confirmations: 1,
        confidence: 95,
      },
    });
    if (!created.ok) throw new Error("setup failed");
    const detail = await getAgentDetailFor(db, created.promptId);

    const updated = await updateAgentFor(db, SUPER_ADMIN_ID, {
      promptId: created.promptId,
      content: { ...detail!.content, name: "Sales Bot v2" },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.version).toBe(2);

    const after = await getAgentDetailFor(db, created.promptId);
    expect(after?.tenantId).toBe(tenant.id);
    expect(after?.content.name).toBe("Sales Bot v2");
  });

  it("toggling active keeps Prompt.active and the latest version's own content in agreement", async () => {
    const tenant = await makeTenant();
    const created = await createAgentFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      content: {
        name: "Toggle Bot",
        personaKey: `toggle-bot-${randomUUID().slice(0, 6)}`,
        purpose: "",
        active: true,
        language: "English",
        languages: ["English"],
        instructions: "x",
        knowledge: "",
        greeting: "x",
        recognition: "",
        whatsapp: "",
        silenceWait: 4,
        silenceNudges: 2,
        voicemail: true,
        listen: 3,
        stop: 13,
        confirmations: 1,
        confidence: 95,
      },
    });
    if (!created.ok) throw new Error("setup failed");

    await setAgentActiveFor(db, SUPER_ADMIN_ID, { promptId: created.promptId, active: false });

    const row = await db.prompt.findUnique({
      where: { id: created.promptId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    expect(row?.active).toBe(false);
    expect((row?.versions[0]?.content as { active?: boolean })?.active).toBe(false);

    const detail = await getAgentDetailFor(db, created.promptId);
    expect(detail?.content.active).toBe(false);
  });

  it("finds an agent by its tenant's name", async () => {
    const tenant = await makeTenant();
    await createAgentFor(db, SUPER_ADMIN_ID, {
      clientId: tenant.id,
      content: {
        name: "Findable Bot",
        personaKey: `findable-bot-${randomUUID().slice(0, 6)}`,
        purpose: "",
        active: true,
        language: "English",
        languages: ["English"],
        instructions: "x",
        knowledge: "",
        greeting: "x",
        recognition: "",
        whatsapp: "",
        silenceWait: 4,
        silenceNudges: 2,
        voicemail: true,
        listen: 3,
        stop: 13,
        confirmations: 1,
        confidence: 95,
      },
    });
    const found = await listAgentsFor(db, { status: "all", page: 1, search: tenant.name });
    expect(found.agents.some((a) => a.tenantId === tenant.id)).toBe(true);
  });
});

describe("campaign overview is read-only", () => {
  it("summary counts match what was created", async () => {
    const tenant = await makeTenant();
    await db.campaign.create({
      data: { clientId: tenant.id, name: "Active One", status: "Active" },
    });
    await db.campaign.create({
      data: { clientId: tenant.id, name: "Paused One", status: "Paused" },
    });

    const summary = await getCampaignSummaryFor(db);
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.active).toBeGreaterThanOrEqual(1);
    expect(summary.paused).toBeGreaterThanOrEqual(1);
  });

  it("lists a campaign found by its tenant's name, with lead and call counts", async () => {
    const tenant = await makeTenant();
    const campaign = await db.campaign.create({
      data: { clientId: tenant.id, name: "Searchable Campaign", status: "Active" },
    });
    await db.lead.create({
      data: { clientId: tenant.id, campaignId: campaign.id, phone: "+919876500001" },
    });
    await db.call.create({
      data: {
        clientId: tenant.id,
        campaignId: campaign.id,
        outcome: "Interested",
        direction: "outbound",
      },
    });

    const result = await listAllCampaignsFor(db, { status: "all", page: 1, search: tenant.name });
    const found = result.campaigns.find((c) => c.id === campaign.id);
    expect(found).toBeDefined();
    expect(found?.leadCount).toBe(1);
    expect(found?.callCount).toBe(1);
    expect(found?.interestedCount).toBe(1);
  });

  it("counts campaigns per tenant", async () => {
    const tenant = await makeTenant();
    await db.campaign.create({ data: { clientId: tenant.id, name: "One", status: "Active" } });
    await db.campaign.create({ data: { clientId: tenant.id, name: "Two", status: "Active" } });

    const counts = await getTenantCampaignCountsFor(db);
    expect(counts.find((c) => c.tenantId === tenant.id)?.count).toBe(2);
  });
});
