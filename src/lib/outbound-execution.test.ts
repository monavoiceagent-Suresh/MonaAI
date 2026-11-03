import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCampaignFor, dispatchCampaign } from "./campaigns.functions";
import { placeTestOutboundCall } from "./outbound-test-call.functions";
import { currentWorkspaceClient } from "./workspace.functions";
import { dispatchCampaignToEngine, placeTestCall } from "./voice-engine/client";
import { processWebhookEvent } from "./voice-engine/webhook";
import { campaignStartInstant } from "./campaign-setup";
import { campaignFromRow } from "./campaigns.adapter";

vi.mock("./db.server", () => ({ db: {} }));
vi.mock("./auth.server", () => ({ requireAuth: {}, requireSuperAdmin: {} }));
vi.mock("./workspace.functions", () => ({ currentWorkspaceClient: vi.fn() }));
vi.mock("./voice-engine/client", async () => ({
  ...await vi.importActual<typeof import("./voice-engine/client")>("./voice-engine/client"),
  dispatchCampaignToEngine: vi.fn(), placeTestCall: vi.fn(),
}));
vi.mock("./call-outcome-settings.functions", () => ({
  engineOutcomeRulesForClient: vi.fn().mockResolvedValue({ outcomeRules: [] }),
}));
vi.mock("./voice-provider-settings.functions", () => ({
  engineProviderConfigForPersona: vi.fn().mockResolvedValue({}),
}));

const key = "2afbd424-0795-4bd8-a994-643635c7ef77";
const campaign = {
  id: "campaign", clientId: "tenant", status: "Scheduled", name: "Scheduled outreach",
  personaKey: "sales", purpose: "Lead qualification", voice: "Voice", voiceId: "voice-1",
  voiceModelId: "m1", callingStart: "09:00", callingEnd: "18:00", maxTries: 3,
  retryGapMinutes: 30, callbackWindowDays: 3, scheduledAt: new Date("2027-01-04T05:00:00Z"),
  createdAt: new Date(), ambience: false,
};
const prompt = { personaKey: "sales", name: "Sales", language: "English", instructions: "Saved instructions",
  greeting: "Saved greeting", knowledge: "Saved knowledge", currentVersion: 7, active: true };
function database() {
  const database = {
    campaign: { findFirst: vi.fn().mockResolvedValue(campaign), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    client: { findUnique: vi.fn().mockResolvedValue({ creditBalance: 100, status: "active" }) },
    prompt: { findFirst: vi.fn().mockResolvedValue(prompt) },
    lead: { findMany: vi.fn().mockResolvedValue([{ id: "lead", phone: "+919876543210", name: "Asha", attempts: 0, followUpAt: null }]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    voiceEngineJob: {
      findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "job", idempotencyKey: key, clientId: "tenant", campaignId: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
  };
  return database;
}
const asDb = (value: unknown) => value as Parameters<typeof dispatchCampaign>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://mona.example");
  vi.mocked(currentWorkspaceClient).mockResolvedValue({ id: "tenant", name: "Tenant", status: "active", creditBalance: 100 });
  vi.mocked(dispatchCampaignToEngine).mockResolvedValue({ status: "accepted", engineJobId: "engine-job" });
  vi.mocked(placeTestCall).mockResolvedValue({ kind: "queued", engineJobId: "engine-test" });
});

describe("outbound execution contract", () => {
  it("persists the schedule and imported leads in the campaign creation transaction", async () => {
    const d = database();
    const create = vi.fn().mockResolvedValue(campaign);
    await createCampaignFor(asDb({ ...d, campaign: { ...d.campaign, create } }), "user", {
      name: "Scheduled outreach", purpose: "Lead qualification", callingStart: "09:00", callingEnd: "18:00",
      maxTries: 3, retryGapMinutes: 30, callbackWindowDays: 3, personaKey: "sales", voice: "Voice",
      ambience: false, creditCap: null, scheduledAt: "2027-01-04T05:00:00Z",
      rows: [{ name: "Asha", phone: "+919876543210" }],
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      scheduledAt: new Date("2027-01-04T05:00:00Z"),
      leads: { createMany: { data: [{ clientId: "tenant", name: "Asha", phone: "+919876543210" }], skipDuplicates: true } },
    }) });
  });
  it("converts India wall time into a UTC instant and restores the saved display", () => {
    expect(campaignStartInstant("2027-01-04T10:30").toISOString()).toBe("2027-01-04T05:00:00.000Z");
    expect(campaignFromRow(campaign, 1, { calls: 0, minutes: 0, interested: 0 }).setup)
      .toMatchObject({ startMode: "scheduled", scheduledAt: "2027-01-04T10:30" });
  });

  it("dispatches the tenant's saved persona, voice, leads and UTC schedule", async () => {
    const d = database();
    expect(await dispatchCampaign(asDb(d), { campaignId: "campaign", clientId: "tenant", webhookUrl: "https://mona.example/api/webhooks/voice-engine" })).toEqual({ ok: true, jobId: "job" });
    expect(dispatchCampaignToEngine).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "tenant", campaignId: "campaign", idempotencyKey: key,
      notBefore: "2027-01-04T05:00:00.000Z", voiceId: "voice-1", ttsModelId: "m1",
      persona: expect.objectContaining({ instructions: "Saved instructions", version: 7, workflow: "lead_qualification" }),
      leads: [{ id: "lead", phone: "+919876543210", name: "Asha", attempts: 0 }],
    }));
    expect(d.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: "tenant", queueState: { in: ["Queued", "Retry scheduled"] } }) }));
  });

  it("reuses the pending key after an ambiguous dispatch rather than opening another batch", async () => {
    const d = database();
    d.voiceEngineJob.findFirst.mockResolvedValue({ id: "job", idempotencyKey: key } as never);
    await dispatchCampaign(asDb(d), { campaignId: "campaign", clientId: "tenant", webhookUrl: "https://mona.example/hook" });
    expect(d.voiceEngineJob.create).not.toHaveBeenCalled();
    expect(dispatchCampaignToEngine).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: key }));
  });

  it("pins a campaign test to the server-resolved campaign persona and voice", async () => {
    const d = database();
    expect(await placeTestOutboundCall(asDb(d), "user", { campaignId: "campaign", personaKey: "tampered", idempotencyKey: key, to: "+919876543210" })).toEqual({ ok: true, jobId: "job", status: "queued" });
    expect(d.campaign.findFirst).toHaveBeenCalledWith({ where: { id: "campaign", clientId: "tenant" } });
    expect(d.prompt.findFirst).toHaveBeenCalledWith({ where: { clientId: "tenant", personaKey: "sales" } });
    expect(placeTestCall).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: key, webhookUrl: "https://mona.example/api/webhooks/voice-engine", clientId: "tenant",
      voiceId: "voice-1", ttsModelId: "m1",
    }));
  });

  it("refuses another tenant's campaign before dispatch", async () => {
    const d = database();
    d.campaign.findFirst.mockResolvedValue(null as never);
    expect(await placeTestOutboundCall(asDb(d), "user", { campaignId: "foreign", idempotencyKey: key, to: "+919876543210" })).toEqual({ ok: false, reason: "Campaign not found." });
    expect(placeTestCall).not.toHaveBeenCalled();
  });

  it("does not redial an already accepted test request", async () => {
    const d = database();
    d.voiceEngineJob.findUnique.mockResolvedValue({ id: "job", clientId: "tenant", campaignId: null, engineJobId: "engine-test" } as never);
    expect(await placeTestOutboundCall(asDb(d), "user", { personaKey: "sales", idempotencyKey: key, to: "+919876543210" })).toMatchObject({ ok: true });
    expect(placeTestCall).not.toHaveBeenCalled();
  });
});

describe("existing call record updates", () => {
  it("updates the initiated row on failure, keeping tenant attribution and counting one attempt", async () => {
    let row: Record<string, unknown> | null = null;
    const tx = {
      voiceEngineJob: { findUnique: vi.fn().mockResolvedValue({ id: "job", clientId: "tenant", campaignId: "campaign", status: "dispatched" }) },
      voiceEngineWebhookEvent: { create: vi.fn() },
      lead: { findFirst: vi.fn().mockResolvedValue({ id: key }), update: vi.fn() },
      call: {
        findUnique: vi.fn(async () => row),
        upsert: vi.fn(async ({ create, update }) => { row = row ? { ...row, ...update } : create; }),
      },
    };
    const d = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const data = { engineCallId: "42", leadId: key, leadPhone: "+919876543210", callerNumber: "+918000000001" };
    await processWebhookEvent(asDb(d), { eventId: "start", eventType: "call.started", engineJobId: "engine", occurredAt: new Date().toISOString(), data });
    expect(row).toMatchObject({ clientId: "tenant", status: "initiated", engineCallId: "42" });
    expect(tx.lead.update).not.toHaveBeenCalled();
    await processWebhookEvent(asDb(d), { eventId: "end", eventType: "call.failed", engineJobId: "engine", occurredAt: new Date().toISOString(), data: { ...data, outcome: "no_answer", leadState: "exhausted" } });
    expect(row).toMatchObject({ clientId: "tenant", status: "failed", outcome: "Not picked up" });
    expect(tx.lead.update).toHaveBeenCalledTimes(1);
    await processWebhookEvent(asDb(d), { eventId: "another-end", eventType: "call.failed", engineJobId: "engine", occurredAt: new Date().toISOString(), data });
    expect(tx.lead.update).toHaveBeenCalledTimes(1);
  });

  it("finishes a standalone test job without touching campaigns or leads", async () => {
    const tx = {
      voiceEngineJob: { findUnique: vi.fn().mockResolvedValue({ id: "test", clientId: "tenant", campaignId: null, status: "dispatched" }), update: vi.fn() },
      voiceEngineWebhookEvent: { create: vi.fn() },
      campaign: { updateMany: vi.fn() }, lead: { updateMany: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(1), creditTransaction: { create: vi.fn() },
    };
    await processWebhookEvent(asDb({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) }), {
      eventId: "done", eventType: "job.completed", engineJobId: "engine-test", occurredAt: new Date().toISOString(), data: { minutesUsed: 2 },
    });
    expect(tx.voiceEngineJob.update).toHaveBeenCalled();
    expect(tx.creditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ clientId: "tenant", amount: -2 }) }));
    expect(tx.campaign.updateMany).not.toHaveBeenCalled();
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });
});
