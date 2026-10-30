import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { savePromptVersionFor } from "./prompts.functions";
import { newPromptContent } from "./prompts";
import {
  createCampaignFor,
  dispatchCampaign,
  listCampaignsFor,
  stopCampaignDispatch,
  updateCampaignDetailsFor,
  updateCampaignStatusFor,
  type CreateCampaignInput,
} from "./campaigns.functions";
import {
  cancelEngineJob,
  dispatchCampaignToEngine,
  VoiceEngineUnavailableError,
} from "@/lib/voice-engine/client";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, dispatchCampaignToEngine: vi.fn(), cancelEngineJob: vi.fn() };
});

const WEBHOOK_URL = "https://app.test/api/webhooks/voice-engine";
const tenants: Tenant[] = [];
afterAll(() => deleteTenants(db, tenants));
beforeEach(() => {
  vi.mocked(dispatchCampaignToEngine).mockReset();
  vi.mocked(cancelEngineJob).mockReset();
});

async function newTenant(credits = 100) {
  const tenant = await createTenant(db, credits);
  tenants.push(tenant);
  return tenant;
}

const input: CreateCampaignInput = {
  name: "October follow-ups",
  purpose: "Lead qualification",
  callingStart: "09:00",
  callingEnd: "18:00",
  maxTries: 3,
  retryGapMinutes: 30,
  callbackWindowDays: 3,
  personaKey: "october-14",
  voice: "Voice 8",
  ambience: false,
  creditCap: null,
};

/** The saved persona a campaign speaks; created once per workspace (key matches `input.personaKey`). */
async function ensurePersona(
  clientId: string,
  overrides: Partial<Prisma.PromptUncheckedCreateInput> = {},
) {
  return db.prompt.upsert({
    where: { clientId_personaKey: { clientId, personaKey: input.personaKey } },
    update: {},
    create: {
      clientId,
      personaKey: input.personaKey,
      name: "October follow-ups",
      language: "English",
      instructions: "You are a helpful assistant. [[KNOWLEDGE]]",
      knowledge: "Open nine to six.",
      greeting: "Hello, is this a good time?",
      ...overrides,
    },
  });
}

async function addLeads(clientId: string, campaignId: string, count: number) {
  await ensurePersona(clientId);
  await db.lead.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      clientId,
      campaignId,
      phone: `+9198765${String(10000 + i)}`,
      name: `Lead ${i}`,
    })),
  });
}

describe("campaigns: persistence and tenant isolation", () => {
  it("creates a campaign in the caller's workspace and lists it there", async () => {
    const a = await newTenant();
    const created = await createCampaignFor(db, a.userId, input);
    expect(created.clientId).toBe(a.clientId);
    expect(created.status).toBe("Scheduled");

    const listed = await listCampaignsFor(db, a.userId);
    expect(listed.campaigns.map((c) => c.id)).toEqual([created.id]);
  });

  it("never shows one tenant's campaigns to another tenant", async () => {
    const a = await newTenant();
    const b = await newTenant();
    await createCampaignFor(db, a.userId, input);

    const otherView = await listCampaignsFor(db, b.userId);
    expect(otherView.campaigns).toEqual([]);
  });

  it("refuses to change another tenant's campaign and leaves it untouched", async () => {
    const a = await newTenant();
    const b = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);

    await expect(
      updateCampaignStatusFor(db, b.userId, { campaignId: campaign.id, nextStatus: "Paused" }),
    ).rejects.toThrow("Campaign not found.");
    await expect(
      updateCampaignDetailsFor(db, b.userId, {
        campaignId: campaign.id,
        name: "Hijacked",
        purpose: "Sales",
        personaKey: "x-persona",
        callingStart: "09:00",
        callingEnd: "18:00",
      }),
    ).rejects.toThrow("Campaign not found.");

    const unchanged = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(unchanged.status).toBe("Scheduled");
    expect(unchanged.name).toBe(input.name);
  });

  it("rejects calling hours that end before they start", async () => {
    const a = await newTenant();
    await expect(
      createCampaignFor(db, a.userId, { ...input, callingStart: "18:00", callingEnd: "09:00" }),
    ).rejects.toThrow(/end after they start/);
  });

  it("rejects a status change that the transition table forbids", async () => {
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await updateCampaignStatusFor(db, a.userId, {
      campaignId: campaign.id,
      nextStatus: "Completed",
    });
    await expect(
      updateCampaignStatusFor(db, a.userId, { campaignId: campaign.id, nextStatus: "Active" }),
    ).rejects.toThrow(/Cannot move a campaign from "Completed"/);
  });

  it("allows Scheduled -> Active -> Paused -> Active", async () => {
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    for (const nextStatus of ["Active", "Paused", "Active"] as const) {
      await updateCampaignStatusFor(db, a.userId, { campaignId: campaign.id, nextStatus });
    }
    const row = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row.status).toBe("Active");
  });

  it("lets exactly one of two concurrent status changes succeed", async () => {
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await updateCampaignStatusFor(db, a.userId, { campaignId: campaign.id, nextStatus: "Active" });

    const results = await Promise.allSettled([
      updateCampaignStatusFor(db, a.userId, { campaignId: campaign.id, nextStatus: "Paused" }),
      updateCampaignStatusFor(db, a.userId, { campaignId: campaign.id, nextStatus: "Paused" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row.status).toBe("Paused");
  });
});

describe("campaigns: voice engine dispatch", () => {
  it("refuses to dispatch a campaign with no queued leads", async () => {
    const a = await newTenant();
    await ensurePersona(a.clientId);
    const campaign = await createCampaignFor(db, a.userId, input);
    const result = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(result).toEqual({ ok: false, reason: "No queued leads to call." });
    expect(dispatchCampaignToEngine).not.toHaveBeenCalled();
  });

  it("reports success only after the engine accepts, and records the engine job id", async () => {
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: "engine-accepted-1",
      status: "accepted",
    });
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 2);

    const result = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(result.ok).toBe(true);
    const job = await db.voiceEngineJob.findUniqueOrThrow({ where: { id: result.jobId! } });
    expect(job.status).toBe("dispatched");
    expect(job.engineJobId).toBe("engine-accepted-1");
    expect(vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0].idempotencyKey).toBe(
      job.idempotencyKey,
    );
  });

  it("refuses a second dispatch while one is still active", async () => {
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    });
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);

    const first = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    const second = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      reason: "This campaign already has a dispatch in progress.",
    });
    expect(vi.mocked(dispatchCampaignToEngine)).toHaveBeenCalledTimes(1);
  });

  it("marks the job failed when the engine is unavailable, and allows a later retry", async () => {
    vi.mocked(dispatchCampaignToEngine).mockRejectedValueOnce(
      new VoiceEngineUnavailableError("Voice engine unreachable"),
    );
    vi.mocked(dispatchCampaignToEngine).mockResolvedValueOnce({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    });
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);

    const failed = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(failed).toEqual({ ok: false, reason: "Voice engine unreachable" });
    const failedJob = await db.voiceEngineJob.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    expect(failedJob.status).toBe("failed");
    expect(failedJob.lastError).toBe("Voice engine unreachable");

    const retried = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(retried.ok).toBe(true);
  });

  it("marks the campaign Active only after the engine accepts the dispatch", async () => {
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    });
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);

    await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      "Active",
    );
  });

  it("records a rejection from the engine with its reason and leaves the campaign unchanged", async () => {
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: null,
      status: "rejected",
      reason: "No voice engine agent is set up for persona 'october-14'",
    });
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);

    const result = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(result).toEqual({
      ok: false,
      reason: "No voice engine agent is set up for persona 'october-14'",
    });
    const job = await db.voiceEngineJob.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(job.status).toBe("failed");
    expect(job.engineJobId).toBeNull();
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      "Scheduled",
    );
  });

  it("does not dispatch a completed campaign or a workspace with no credits", async () => {
    const broke = await newTenant(0);
    const stalled = await createCampaignFor(db, broke.userId, input);
    await addLeads(broke.clientId, stalled.id, 1);
    expect(
      await dispatchCampaign(db, {
        campaignId: stalled.id,
        clientId: broke.clientId,
        webhookUrl: WEBHOOK_URL,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("no credits") });

    const a = await newTenant();
    const done = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, done.id, 1);
    await db.campaign.update({ where: { id: done.id }, data: { status: "Completed" } });
    expect(
      await dispatchCampaign(db, {
        campaignId: done.id,
        clientId: a.clientId,
        webhookUrl: WEBHOOK_URL,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("completed") });
    expect(dispatchCampaignToEngine).not.toHaveBeenCalled();
  });

  it("sends only numbers the engine can dial and marks the others as invalid", async () => {
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    });
    const a = await newTenant();
    await ensurePersona(a.clientId);
    const campaign = await createCampaignFor(db, a.userId, input);
    await db.lead.createMany({
      data: [
        { clientId: a.clientId, campaignId: campaign.id, phone: "+919876543210", name: "Good" },
        { clientId: a.clientId, campaignId: campaign.id, phone: "1234567", name: "Too short" },
      ],
    });

    const result = await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    expect(result.ok).toBe(true);
    expect(
      vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0].leads.map((l) => l.phone),
    ).toEqual(["+919876543210"]);
    const short = await db.lead.findFirstOrThrow({
      where: { campaignId: campaign.id, phone: "1234567" },
    });
    expect([short.queueState, short.outcome]).toEqual(["Exhausted", "Invalid number"]);
  });
});

describe("campaigns: the persona a dispatch sends", () => {
  const dispatchArgs = (clientId: string, campaignId: string) => ({
    campaignId,
    clientId,
    webhookUrl: WEBHOOK_URL,
  });
  // A fresh id per call, like the real engine: two campaigns dispatched in the same test must not collide
  // on VoiceEngineJob's unique engine_job_id, the way a single fixed mockResolvedValue would.
  const accept = () =>
    vi.mocked(dispatchCampaignToEngine).mockImplementation(async () => ({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    }));

  it("sends the saved persona text, language and version, and records the version on the job", async () => {
    accept();
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, {
      ...input,
      purpose: "Lead qualification",
    });
    await ensurePersona(a.clientId, {
      language: "Hindi",
      currentVersion: 3,
      instructions: "Be brief. [[CALLER_CONTEXT]]",
    });
    await addLeads(a.clientId, campaign.id, 1);

    const result = await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));
    expect(result.ok).toBe(true);
    expect(vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0].persona).toEqual({
      key: "october-14",
      name: "October follow-ups",
      language: "hi",
      workflow: "lead_qualification",
      instructions: "Be brief. [[CALLER_CONTEXT]]",
      greeting: "Hello, is this a good time?",
      knowledge: "Open nine to six.",
      version: 3,
    });
    const job = await db.voiceEngineJob.findUniqueOrThrow({ where: { id: result.jobId! } });
    expect(job.personaVersion).toBe(3);
  });

  it("sends the campaign's own voice choice to the engine when it has one", async () => {
    accept();
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, { ...input, voiceId: "v1", voiceModelId: "m1" });
    await ensurePersona(a.clientId);
    await addLeads(a.clientId, campaign.id, 1);

    await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));

    const sent = vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0];
    expect(sent?.voiceId).toBe("v1");
    expect(sent?.ttsModelId).toBe("m1");
  });

  it("sends no voice override when the campaign never chose one", async () => {
    accept();
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await ensurePersona(a.clientId);
    await addLeads(a.clientId, campaign.id, 1);
    expect(campaign.voiceId).toBe("");
    expect(campaign.voiceModelId).toBe("");

    await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));

    const sent = vi.mocked(dispatchCampaignToEngine).mock.calls[0]?.[0];
    expect(sent?.voiceId).toBeUndefined();
    expect(sent?.ttsModelId).toBeUndefined();
  });

  it("sends the latest saved revision each time a campaign is started", async () => {
    accept();
    const a = await newTenant();
    const created = await savePromptVersionFor(db, a.userId, {
      promptId: null,
      content: {
        ...newPromptContent("Editable persona"),
        personaKey: input.personaKey,
        greeting: "First greeting.",
      },
    });
    const first = await createCampaignFor(db, a.userId, input);
    const second = await createCampaignFor(db, a.userId, { ...input, name: "Second campaign" });
    await addLeads(a.clientId, first.id, 1);
    await addLeads(a.clientId, second.id, 1);

    await dispatchCampaign(db, dispatchArgs(a.clientId, first.id));
    await savePromptVersionFor(db, a.userId, {
      promptId: created.promptId,
      content: {
        ...newPromptContent("Editable persona"),
        personaKey: input.personaKey,
        greeting: "Second greeting.",
      },
    });
    await dispatchCampaign(db, dispatchArgs(a.clientId, second.id));

    const sent = vi.mocked(dispatchCampaignToEngine).mock.calls.map((call) => call[0].persona);
    expect(sent.map((p) => [p.version, p.greeting])).toEqual([
      [1, "First greeting."],
      [2, "Second greeting."],
    ]);
  });

  it("does not dispatch when the persona was removed, switched off or is in an unsupported language", async () => {
    const a = await newTenant();
    const missing = await createCampaignFor(db, a.userId, input);
    await db.lead.createMany({
      data: [{ clientId: a.clientId, campaignId: missing.id, phone: "+919876543210" }],
    });
    expect(await dispatchCampaign(db, dispatchArgs(a.clientId, missing.id))).toEqual({
      ok: false,
      reason: `The persona "october-14" doesn't exist. Choose another persona in the campaign settings.`,
    });

    const persona = await ensurePersona(a.clientId, { active: false });
    expect(await dispatchCampaign(db, dispatchArgs(a.clientId, missing.id))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("switched off"),
    });

    await db.prompt.update({
      where: { id: persona.id },
      data: { active: true, language: "French" },
    });
    expect(await dispatchCampaign(db, dispatchArgs(a.clientId, missing.id))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("uses French"),
    });
    expect(dispatchCampaignToEngine).not.toHaveBeenCalled();
    expect(await db.voiceEngineJob.count({ where: { campaignId: missing.id } })).toBe(0);
  });

  it("never reads another workspace's persona that has the same key", async () => {
    accept();
    const a = await newTenant();
    const b = await newTenant();
    await ensurePersona(b.clientId, { greeting: "Workspace B only." });
    const campaign = await createCampaignFor(db, a.userId, input);
    await db.lead.createMany({
      data: [{ clientId: a.clientId, campaignId: campaign.id, phone: "+919876543210" }],
    });
    const result = await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));
    expect(result.ok).toBe(false);
    expect(dispatchCampaignToEngine).not.toHaveBeenCalled();
  });
});

describe("campaigns: stopping a dispatch", () => {
  async function dispatchedCampaign() {
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    });
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);
    await dispatchCampaign(db, {
      campaignId: campaign.id,
      clientId: a.clientId,
      webhookUrl: WEBHOOK_URL,
    });
    const job = await db.voiceEngineJob.findFirstOrThrow({ where: { campaignId: campaign.id } });
    return { a, campaign, job };
  }

  it("asks the engine to cancel the campaign's active job", async () => {
    vi.mocked(cancelEngineJob).mockResolvedValue({ status: "cancelled" });
    const { a, campaign, job } = await dispatchedCampaign();
    await stopCampaignDispatch(db, { campaignId: campaign.id, clientId: a.clientId });
    expect(cancelEngineJob).toHaveBeenCalledWith(job.engineJobId);
  });

  it("refuses to report a stop when the engine cannot be reached", async () => {
    vi.mocked(cancelEngineJob).mockRejectedValue(
      new VoiceEngineUnavailableError("Voice engine unreachable"),
    );
    const { a, campaign } = await dispatchedCampaign();
    await expect(
      stopCampaignDispatch(db, { campaignId: campaign.id, clientId: a.clientId }),
    ).rejects.toThrow(/campaign was not changed.*Voice engine unreachable/);
  });

  it("does nothing for another workspace's campaign", async () => {
    const { campaign } = await dispatchedCampaign();
    const other = await newTenant();
    await stopCampaignDispatch(db, { campaignId: campaign.id, clientId: other.clientId });
    expect(cancelEngineJob).not.toHaveBeenCalled();
  });
});

describe("campaigns: recovering an orphaned job", () => {
  const dispatchArgs = (clientId: string, campaignId: string) => ({
    campaignId,
    clientId,
    webhookUrl: WEBHOOK_URL,
  });
  const accept = () =>
    vi.mocked(dispatchCampaignToEngine).mockResolvedValue({
      engineJobId: `engine-${randomUUID()}`,
      status: "accepted",
    });

  /** What dispatchCampaign's own recovery leaves behind when the engine accepted a job but saving it
   * here then failed: "failed", but with the engine_job_id kept (see campaigns.functions.ts). */
  async function orphanedCampaign() {
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);
    const job = await db.voiceEngineJob.create({
      data: {
        clientId: a.clientId,
        campaignId: campaign.id,
        status: "failed",
        engineJobId: `engine-${randomUUID()}`,
        lastError: "The voice engine accepted this dispatch, but it could not be saved here.",
      },
    });
    return { a, campaign, job };
  }

  it("blocks a new dispatch while an orphan is unreconciled, without contacting the engine", async () => {
    const { a, campaign } = await orphanedCampaign();

    const result = await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));

    expect(result).toEqual({
      ok: false,
      reason:
        "This campaign has an unreconciled call batch from a previous attempt. Pause the campaign " +
        "to cancel those calls, then start it again.",
    });
    expect(dispatchCampaignToEngine).not.toHaveBeenCalled();
  });

  it("stopCampaignDispatch cancels the orphan on the engine and marks it cancelled here", async () => {
    vi.mocked(cancelEngineJob).mockResolvedValue({ status: "cancelled" });
    const { a, campaign, job } = await orphanedCampaign();

    await stopCampaignDispatch(db, { campaignId: campaign.id, clientId: a.clientId });

    expect(cancelEngineJob).toHaveBeenCalledWith(job.engineJobId);
    const reloaded = await db.voiceEngineJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(reloaded.status).toBe("cancelled");
  });

  it("a new dispatch succeeds once the orphan has been reconciled", async () => {
    vi.mocked(cancelEngineJob).mockResolvedValue({ status: "cancelled" });
    const { a, campaign } = await orphanedCampaign();
    await stopCampaignDispatch(db, { campaignId: campaign.id, clientId: a.clientId });
    accept();

    const result = await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));

    expect(result.ok).toBe(true);
  });

  it("a normally completed earlier job never blocks a new dispatch", async () => {
    const a = await newTenant();
    const campaign = await createCampaignFor(db, a.userId, input);
    await addLeads(a.clientId, campaign.id, 1);
    await db.voiceEngineJob.create({
      data: {
        clientId: a.clientId,
        campaignId: campaign.id,
        status: "completed",
        engineJobId: `engine-${randomUUID()}`,
      },
    });
    accept();

    const result = await dispatchCampaign(db, dispatchArgs(a.clientId, campaign.id));

    expect(result.ok).toBe(true);
  });
});
