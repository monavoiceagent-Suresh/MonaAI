import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { processWebhookEvent } from "./webhook";
import type { VoiceEngineEvent } from "./types";
import { cancelEngineJob } from "@/lib/voice-engine/client";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, cancelEngineJob: vi.fn() };
});

const tenants: Tenant[] = [];
afterAll(() => deleteTenants(db, tenants));
beforeEach(() => {
  vi.mocked(cancelEngineJob).mockReset();
  vi.mocked(cancelEngineJob).mockResolvedValue({ status: "cancelled" });
});

async function dispatchedJob(credits: number) {
  const tenant = await createTenant(db, credits);
  tenants.push(tenant);
  const campaign = await db.campaign.create({
    data: {
      clientId: tenant.clientId,
      name: "Webhook campaign",
      purpose: "Sales",
      status: "Active",
    },
  });
  const engineJobId = `engine-${randomUUID()}`;
  const job = await db.voiceEngineJob.create({
    data: { clientId: tenant.clientId, campaignId: campaign.id, status: "dispatched", engineJobId },
  });
  return { tenant, campaign, job, engineJobId };
}

function event(
  engineJobId: string,
  eventType: VoiceEngineEvent["eventType"],
  data: VoiceEngineEvent["data"] = {},
  eventId = `evt-${randomUUID()}`,
): VoiceEngineEvent {
  return { eventId, eventType, engineJobId, occurredAt: new Date().toISOString(), data };
}

const creditBalance = async (clientId: string) =>
  (await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { creditBalance: true } }))
    .creditBalance;

describe("voice engine webhook: idempotent ingestion and credit reconciliation", () => {
  it("returns unknown-job for an event that matches no dispatched job", async () => {
    const result = await processWebhookEvent(
      db,
      event(`engine-missing-${randomUUID()}`, "call.started"),
    );
    expect(result).toEqual({ processed: false, reason: "unknown engine job id" });
  });

  it("records a completed call linked to the campaign and job", async () => {
    const { tenant, campaign, job, engineJobId } = await dispatchedJob(100);
    const result = await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", {
        engineCallId: `call-${randomUUID()}`,
        outcome: "Interested",
        durationSeconds: 42,
      }),
    );
    expect(result).toEqual({ processed: true });
    const calls = await db.call.findMany({ where: { jobId: job.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      clientId: tenant.clientId,
      campaignId: campaign.id,
      outcome: "Interested",
      durationSeconds: 42,
    });
  });

  it("treats a redelivered event as a duplicate and does not record the call twice", async () => {
    const { job, engineJobId } = await dispatchedJob(100);
    const delivered = event(engineJobId, "call.completed", {
      engineCallId: `call-${randomUUID()}`,
      outcome: "Voicemail",
    });
    await processWebhookEvent(db, delivered);

    const replay = await processWebhookEvent(db, delivered);
    expect(replay).toEqual({ processed: false, reason: "duplicate event" });
    expect(await db.call.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("debits credits exactly once when job completion is delivered twice", async () => {
    const { tenant, job, engineJobId } = await dispatchedJob(50);
    const completed = event(engineJobId, "job.completed", { minutesUsed: 12.5 });
    await processWebhookEvent(db, completed);
    expect(await creditBalance(tenant.clientId)).toBe(37);

    expect((await processWebhookEvent(db, completed)).reason).toBe("duplicate event");
    expect(await creditBalance(tenant.clientId)).toBe(37);

    const ledger = await db.creditTransaction.findMany({ where: { clientId: tenant.clientId } });
    expect(ledger.map((row) => row.amount)).toEqual([-13]);
    const updated = await db.voiceEngineJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("completed");
  });

  it("ignores a late event for a job that already finished, but still records it", async () => {
    const { tenant, engineJobId } = await dispatchedJob(50);
    await processWebhookEvent(db, event(engineJobId, "job.completed", { minutesUsed: 5 }));

    const late = await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", { engineCallId: `call-${randomUUID()}` }),
    );
    expect(late).toEqual({ processed: true, reason: "job already terminal; event recorded only" });
    expect(await creditBalance(tenant.clientId)).toBe(45);
  });

  it("updates the lead from a finished call and links the call to it", async () => {
    const { tenant, campaign, job, engineJobId } = await dispatchedJob(100);
    const lead = await db.lead.create({
      data: { clientId: tenant.clientId, campaignId: campaign.id, phone: "+919876543210" },
    });
    await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", {
        engineCallId: `call-${randomUUID()}`,
        leadId: lead.id,
        outcome: "appointment_requested",
        durationSeconds: 61,
        attempt: 1,
        leadState: "done",
      }),
    );
    expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      outcome: "Meeting booked",
      queueState: "Done",
      attempts: 1,
      followUpAt: null,
    });
    const call = await db.call.findFirstOrThrow({ where: { jobId: job.id } });
    expect(call).toMatchObject({
      leadId: lead.id,
      outcome: "Meeting booked",
      outcomeRaw: "appointment_requested",
      direction: "outbound",
      status: "completed",
    });
  });

  it("keeps the engine's original outcome, the contact's number and the transcript reference on a campaign call", async () => {
    const { job, engineJobId } = await dispatchedJob(100);
    await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", {
        engineCallId: `call-${randomUUID()}`,
        leadPhone: "+919876543299",
        outcome: "some_new_engine_word",
        transcriptRef: "4321",
      }),
    );
    expect(await db.call.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({
      outcome: "Inconclusive",
      outcomeRaw: "some_new_engine_word",
      dialledNumber: "+919876543299",
      transcriptRef: "4321",
    });
  });

  it("ignores a transcript reference or number that is not in the expected shape", async () => {
    const { job, engineJobId } = await dispatchedJob(100);
    await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", {
        engineCallId: `call-${randomUUID()}`,
        leadPhone: "call me maybe",
        transcriptRef: "https://engine.example/calls/9",
      }),
    );
    expect(await db.call.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({
      dialledNumber: null,
      transcriptRef: null,
    });
  });

  it("schedules a retry for an unanswered call, with the dashboard's wording", async () => {
    const { tenant, campaign, engineJobId } = await dispatchedJob(100);
    const lead = await db.lead.create({
      data: { clientId: tenant.clientId, campaignId: campaign.id, phone: "+919876543211" },
    });
    const nextAttemptAt = new Date(Date.now() + 30 * 60_000);
    await processWebhookEvent(
      db,
      event(engineJobId, "call.failed", {
        engineCallId: `call-${randomUUID()}`,
        leadId: lead.id,
        outcome: "no_answer",
        attempt: 1,
        leadState: "retry",
        nextAttemptAt: nextAttemptAt.toISOString(),
      }),
    );
    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([updated.outcome, updated.queueState, updated.attempts]).toEqual([
      "Not picked up",
      "Retry scheduled",
      1,
    ]);
    expect(updated.followUpAt?.getTime()).toBe(nextAttemptAt.getTime());

    await processWebhookEvent(
      db,
      event(engineJobId, "call.failed", {
        engineCallId: `call-${randomUUID()}`,
        leadId: lead.id,
        outcome: "no_answer",
        attempt: 2,
        leadState: "exhausted",
      }),
    );
    const exhausted = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([exhausted.queueState, exhausted.attempts, exhausted.followUpAt]).toEqual([
      "Exhausted",
      2,
      null,
    ]);
  });

  it("never touches a lead that belongs to another workspace's campaign", async () => {
    const { engineJobId } = await dispatchedJob(100);
    const { tenant: other, campaign: otherCampaign } = await dispatchedJob(100);
    const foreign = await db.lead.create({
      data: { clientId: other.clientId, campaignId: otherCampaign.id, phone: "+919876543212" },
    });
    await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", {
        engineCallId: `call-${randomUUID()}`,
        leadId: foreign.id,
        outcome: "interested",
        leadState: "done",
      }),
    );
    expect(await db.lead.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({
      outcome: "Not called",
      queueState: "Queued",
      attempts: 0,
    });
    expect(await db.call.count({ where: { leadId: foreign.id } })).toBe(0);
  });

  it("ignores a lead id that is not a UUID instead of failing the delivery", async () => {
    const { job, engineJobId } = await dispatchedJob(100);
    const result = await processWebhookEvent(
      db,
      event(engineJobId, "call.completed", {
        engineCallId: `call-${randomUUID()}`,
        leadId: "not-a-uuid",
      }),
    );
    expect(result).toEqual({ processed: true });
    expect((await db.call.findFirstOrThrow({ where: { jobId: job.id } })).leadId).toBeNull();
  });

  it("completes an active campaign when its job completes", async () => {
    const { campaign, engineJobId } = await dispatchedJob(100);
    await processWebhookEvent(db, event(engineJobId, "job.completed", { minutesUsed: 1 }));
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      "Completed",
    );
  });

  it("keeps a paused campaign paused when its cancelled job reports, and still bills the usage", async () => {
    const { tenant, campaign, job, engineJobId } = await dispatchedJob(50);
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "Paused" } });
    await processWebhookEvent(db, event(engineJobId, "job.cancelled", { minutesUsed: 2 }));
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      "Paused",
    );
    expect((await db.voiceEngineJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "cancelled",
    );
    expect(await creditBalance(tenant.clientId)).toBe(48);
  });

  it("pauses an active campaign when its job fails, so it can be resumed", async () => {
    const { campaign, engineJobId } = await dispatchedJob(100);
    await processWebhookEvent(db, event(engineJobId, "job.failed", { errorMessage: "boom" }));
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      "Paused",
    );
  });

  it("records actual overrun once and still closes the completed job", async () => {
    const { tenant, job, engineJobId } = await dispatchedJob(5);
    const completed = event(engineJobId, "job.completed", { minutesUsed: 10 });

    expect((await processWebhookEvent(db, completed)).processed).toBe(true);
    expect(await db.voiceEngineWebhookEvent.count({ where: { eventId: completed.eventId } })).toBe(
      1,
    );
    expect((await db.voiceEngineJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "completed",
    );
    expect(await creditBalance(tenant.clientId)).toBe(-5);
    expect((await processWebhookEvent(db, completed)).reason).toBe("duplicate event");
    expect(await creditBalance(tenant.clientId)).toBe(-5);
  });

  it("M3: halts the tenant's other active campaign the moment a debit drives its balance to zero or below", async () => {
    const { tenant, campaign: depletingCampaign, engineJobId } = await dispatchedJob(5);
    const other = await db.campaign.create({
      data: {
        clientId: tenant.clientId,
        name: "Still running",
        purpose: "Sales",
        status: "Active",
      },
    });
    await db.voiceEngineJob.create({
      data: {
        clientId: tenant.clientId,
        campaignId: other.id,
        status: "dispatched",
        engineJobId: `engine-${randomUUID()}`,
      },
    });

    await processWebhookEvent(db, event(engineJobId, "job.completed", { minutesUsed: 10 }));

    expect(await creditBalance(tenant.clientId)).toBe(-5);
    expect(cancelEngineJob).toHaveBeenCalledTimes(1);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "Out of credits",
    );
    // The campaign whose own job just completed keeps its normal "Completed" outcome — it is
    // not re-touched by the depletion halt, which only ever targets OTHER active campaigns.
    expect(
      (await db.campaign.findUniqueOrThrow({ where: { id: depletingCampaign.id } })).status,
    ).toBe("Completed");
  });

  it("M3: does not touch other campaigns when the balance stays positive", async () => {
    const { tenant, engineJobId } = await dispatchedJob(100);
    const other = await db.campaign.create({
      data: {
        clientId: tenant.clientId,
        name: "Still running",
        purpose: "Sales",
        status: "Active",
      },
    });
    await db.voiceEngineJob.create({
      data: {
        clientId: tenant.clientId,
        campaignId: other.id,
        status: "dispatched",
        engineJobId: `engine-${randomUUID()}`,
      },
    });

    await processWebhookEvent(db, event(engineJobId, "job.completed", { minutesUsed: 2 }));

    expect(await creditBalance(tenant.clientId)).toBe(98);
    expect(cancelEngineJob).not.toHaveBeenCalled();
    expect((await db.campaign.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "Active",
    );
  });
});

describe("terminal concurrency and durable depletion", () => {
  it("debits once for simultaneous terminal events with distinct event IDs", async () => {
    const { tenant, engineJobId } = await dispatchedJob(100);
    await Promise.all([
      processWebhookEvent(db, event(engineJobId, "job.completed", { minutesUsed: 7 })),
      processWebhookEvent(db, event(engineJobId, "job.failed", { minutesUsed: 7 })),
    ]);
    expect(await creditBalance(tenant.clientId)).toBe(93);
    expect(
      await db.creditTransaction.count({
        where: { clientId: tenant.clientId, type: "VOICE_USAGE" },
      }),
    ).toBe(1);
  });

  it("retries a committed stop failure on duplicate delivery without another debit", async () => {
    const { tenant, engineJobId, job } = await dispatchedJob(1);
    const other = await db.campaign.create({
      data: { clientId: tenant.clientId, name: "Other", purpose: "Sales", status: "Active" },
    });
    await db.voiceEngineJob.create({
      data: {
        clientId: tenant.clientId,
        campaignId: other.id,
        status: "dispatched",
        engineJobId: randomUUID(),
      },
    });
    const completed = event(engineJobId, "job.completed", { minutesUsed: 3 });
    vi.mocked(cancelEngineJob).mockRejectedValueOnce(new Error("engine unavailable"));
    await expect(processWebhookEvent(db, completed)).rejects.toThrow("stops pending");
    const pending = await db.$queryRaw<
      { credit_stop_pending: boolean }[]
    >`SELECT credit_stop_pending FROM voice_engine_jobs WHERE id = ${job.id}::uuid`;
    expect(pending[0]!.credit_stop_pending).toBe(true);
    expect(await creditBalance(tenant.clientId)).toBe(-2);
    await processWebhookEvent(db, completed);
    expect(await creditBalance(tenant.clientId)).toBe(-2);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "Out of credits",
    );
  });
});
