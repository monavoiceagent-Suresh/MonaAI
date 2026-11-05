import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import {
  getInboundRoute,
  getUnroutedInbound,
  publishInboundRoute,
  VoiceEngineUnavailableError,
} from "@/lib/voice-engine/client";
import type { InboundRoutePublishRequest } from "@/lib/voice-engine/types";
import {
  listInboundNumbersFor,
  listUnroutedNumbersFor,
  publishInboundNumberFor,
  refreshInboundNumberFor,
  saveInboundNumberFor,
} from "./inbound.functions";
import { deletePromptFor } from "./prompts.functions";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return {
    ...actual,
    publishInboundRoute: vi.fn(),
    getInboundRoute: vi.fn(),
    getUnroutedInbound: vi.fn(),
  };
});

const publishMock = vi.mocked(publishInboundRoute);
const getRouteMock = vi.mocked(getInboundRoute);
const unroutedMock = vi.mocked(getUnroutedInbound);
const tenants: Tenant[] = [];
afterAll(async () => {
  await db.phoneNumber.deleteMany({ where: { clientId: { in: tenants.map((t) => t.clientId) } } });
  await deleteTenants(db, tenants);
});

/** A stand-in engine that remembers what it was sent, so a publish can be read back the way the real one is. */
function trackEngine() {
  const routes = new Map<string, InboundRoutePublishRequest>();
  publishMock.mockReset().mockImplementation(async (body) => {
    routes.set(body.phone, body);
    return { kind: "applied" };
  });
  getRouteMock.mockReset().mockImplementation(async (phone) => {
    const sent = routes.get(phone);
    return sent
      ? {
          phone: phone.replace("+", ""),
          clientId: sent.clientId,
          version: sent.version,
          active: sent.active,
          personaKey: sent.persona.key,
          personaVersion: sent.persona.version,
          workflow: sent.persona.workflow,
          status: "current" as const,
        }
      : null;
  });
}
beforeEach(() => {
  trackEngine();
  unroutedMock.mockReset();
});

const newPhone = () => `+91${8_000_000_000 + Math.floor(Math.random() * 999_999_999)}`;

async function workspace(personaKey = "front-desk") {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  const prompt = await db.prompt.create({
    data: {
      clientId: tenant.clientId,
      personaKey,
      name: "Front desk",
      language: "English",
      instructions: "You are the front desk of Sunrise Clinic. [[CALLER_CONTEXT]]",
      knowledge: "Open nine to six.",
      greeting: "Welcome to Sunrise Clinic.",
    },
  });
  return { tenant, prompt };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

async function mapNumber(
  w: Workspace,
  overrides: Partial<Parameters<typeof saveInboundNumberFor>[2]> = {},
) {
  const saved = await saveInboundNumberFor(db, w.tenant.userId, {
    numberId: null,
    phone: newPhone(),
    personaKey: w.prompt.personaKey,
    workflow: "appointment",
    active: true,
    ...overrides,
  });
  await db.phoneNumber.upsert({
    where: { e164: saved.phone },
    update: {},
    create: {
      e164: saved.phone,
      clientId: w.tenant.clientId,
      status: "ASSIGNED",
      capability: "VOICE_BOTH",
    },
  });
  return saved;
}

const publish = (w: Workspace, numberId: string, rollbackToPublicationId?: string) =>
  publishInboundNumberFor(db, w.tenant.userId, { numberId, rollbackToPublicationId });

const sent = (call = 0): InboundRoutePublishRequest => publishMock.mock.calls[call]![0];
const listed = async (w: Workspace) => (await listInboundNumbersFor(db, w.tenant.userId)).numbers;

describe("inbound numbers: draft mapping and tenant isolation", () => {
  it("saves a mapping as an unpublished draft in the caller's workspace", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    const [view] = await listed(w);
    expect(view).toMatchObject({
      id: number.id,
      personaKey: "front-desk",
      workflow: "appointment",
      active: true,
      live: null,
      unpublished: true,
      attention: null,
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("refuses a persona that does not exist in the caller's own workspace", async () => {
    const a = await workspace("only-in-a");
    const b = await workspace("only-in-b");
    await expect(mapNumber(b, { personaKey: a.prompt.personaKey })).rejects.toThrow(
      "Choose a persona that exists in this workspace.",
    );
  });

  it("gives a phone number to one workspace only, without saying who has it", async () => {
    const a = await workspace();
    const b = await workspace();
    const phone = newPhone();
    await mapNumber(a, { phone });
    await expect(mapNumber(b, { phone })).rejects.toThrow("This number is already in use.");
    expect(await listed(b)).toEqual([]);
  });

  it("enforces the number format and the known workflows in the database itself", async () => {
    const w = await workspace();
    const base = { clientId: w.tenant.clientId, personaKey: "front-desk" };
    await expect(
      db.inboundNumber.create({ data: { ...base, phone: "8047491899" } }),
    ).rejects.toThrow(/inbound_numbers_phone_format/);
    await expect(
      db.inboundNumber.create({ data: { ...base, phone: newPhone(), workflow: "support" } }),
    ).rejects.toThrow(/inbound_numbers_workflow_known/);
  });

  it("keeps other workspaces' numbers invisible and untouchable", async () => {
    const a = await workspace();
    const b = await workspace();
    const number = await mapNumber(a);

    expect(await listed(b)).toEqual([]);
    await expect(mapNumber(b, { numberId: number.id })).rejects.toThrow("Number not found.");
    await expect(publish(b, number.id)).rejects.toThrow("Number not found.");
    await expect(
      refreshInboundNumberFor(db, b.tenant.userId, { numberId: number.id }),
    ).rejects.toThrow("Number not found.");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("lets the phone change only until the number has been published", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    const moved = newPhone();
    await mapNumber(w, { numberId: number.id, phone: moved });
    await publish(w, number.id);
    await expect(mapNumber(w, { numberId: number.id, phone: newPhone() })).rejects.toThrow(
      /can't be changed/,
    );
    await mapNumber(w, { numberId: number.id, phone: moved, workflow: "faq" }); // other edits stay possible
  });

  it("will not delete a persona that an inbound number uses", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    await expect(deletePromptFor(db, w.tenant.userId, { promptId: w.prompt.id })).rejects.toThrow(
      /inbound number .* still uses this persona/,
    );
    await db.inboundNumber.delete({ where: { id: number.id } });
    await deletePromptFor(db, w.tenant.userId, { promptId: w.prompt.id });
  });
});

describe("inbound numbers: publishing", () => {
  it("sends the saved persona with the number's workflow, then shows it as live", async () => {
    const w = await workspace();
    const number = await mapNumber(w, { workflow: "faq" });

    expect(await publish(w, number.id)).toEqual({ ok: true, version: 1 });
    expect(sent()).toEqual({
      phone: number.phone,
      clientId: w.tenant.clientId,
      version: 1,
      active: true,
      persona: {
        key: "front-desk",
        name: "Front desk",
        language: "en",
        workflow: "faq",
        instructions: "You are the front desk of Sunrise Clinic. [[CALLER_CONTEXT]]",
        greeting: "Welcome to Sunrise Clinic.",
        knowledge: "Open nine to six.",
        version: 1,
      },
    });
    const [view] = await listed(w);
    expect(view).toMatchObject({ unpublished: false, attention: null });
    expect(view?.live).toMatchObject({
      version: 1,
      status: "synced",
      personaVersion: 1,
      workflow: "faq",
    });
  });

  it("keeps saved edits out of live calls until Publish is pressed", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    await publish(w, number.id);

    await db.prompt.update({
      where: { id: w.prompt.id },
      data: { greeting: "A different greeting.", currentVersion: 2 },
    });
    await mapNumber(w, { numberId: number.id, phone: number.phone, workflow: "order" });
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [draft] = await listed(w);
    expect(draft).toMatchObject({ unpublished: true });
    expect(draft?.live).toMatchObject({ version: 1, personaVersion: 1, workflow: "appointment" });

    expect(await publish(w, number.id)).toEqual({ ok: true, version: 2 });
    expect(sent(1).persona).toMatchObject({
      greeting: "A different greeting.",
      version: 2,
      workflow: "order",
    });
    expect((await listed(w))[0]).toMatchObject({ unpublished: false });
  });

  it("leaves what is live untouched when the engine cannot be reached, and recovers on retry", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    await publish(w, number.id);

    publishMock.mockRejectedValueOnce(
      new VoiceEngineUnavailableError("Voice engine unreachable: timeout"),
    );
    const failed = await publish(w, number.id);
    expect(failed).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Voice engine unreachable"),
    });
    const [view] = await listed(w);
    expect(view?.live).toMatchObject({ version: 1, status: "synced" });
    expect(view?.attention).toMatchObject({ version: 2, status: "failed" });

    expect(await publish(w, number.id)).toEqual({ ok: true, version: 3 }); // never reuses the failed version
    expect((await listed(w))[0]?.attention).toBeNull();
    expect((await listed(w))[0]?.live).toMatchObject({ version: 3 });
  });

  it("fast-forwards past a newer engine version instead of retrying below it", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    publishMock.mockResolvedValueOnce({ kind: "stale", currentVersion: 7 });

    const stale = await publish(w, number.id);
    expect(stale).toMatchObject({ ok: false, reason: expect.stringContaining("version 7") });
    expect(
      (await db.inboundNumber.findUniqueOrThrow({ where: { id: number.id } })).knownEngineVersion,
    ).toBe(7);
    expect((await listed(w))[0]?.live).toBeNull();

    expect(await publish(w, number.id)).toEqual({ ok: true, version: 8 });
  });

  it("reports a refusal from the engine and keeps the previous route live", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    await publish(w, number.id);
    publishMock.mockResolvedValueOnce({
      kind: "rejected",
      code: "number_taken",
      message: "This number is already routed for another workspace on the engine.",
    });

    const refused = await publish(w, number.id);
    expect(refused).toEqual({
      ok: false,
      reason: "This number is already routed for another workspace on the engine.",
    });
    expect((await listed(w))[0]?.live).toMatchObject({ version: 1 });
  });

  it("does not contact the engine when the persona is switched off, missing text, or unspeakable", async () => {
    const w = await workspace();
    const number = await mapNumber(w);

    await db.prompt.update({ where: { id: w.prompt.id }, data: { active: false } });
    expect(await publish(w, number.id)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("switched off"),
    });

    await db.prompt.update({
      where: { id: w.prompt.id },
      data: { active: true, language: "French" },
    });
    expect(await publish(w, number.id)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("French"),
    });

    await db.prompt.delete({ where: { id: w.prompt.id } });
    expect(await publish(w, number.id)).toEqual({
      ok: false,
      reason: "The persona for this number no longer exists.",
    });
    expect(publishMock).not.toHaveBeenCalled();
    expect(await db.inboundPublication.count({ where: { numberId: number.id } })).toBe(0);
  });

  it("can take a number offline even after its persona was removed, reusing the live persona", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    await publish(w, number.id);
    await db.prompt.delete({ where: { id: w.prompt.id } });
    await db.inboundNumber.update({ where: { id: number.id }, data: { active: false } });

    expect(await publish(w, number.id)).toEqual({ ok: true, version: 2 });
    expect(sent(1)).toMatchObject({ active: false, persona: { key: "front-desk", version: 1 } });
  });

  it("lets only one publish for a number reach the engine at a time", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    const remember = publishMock.getMockImplementation()!;
    publishMock.mockImplementation(async (body) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return remember(body);
    });

    const results = await Promise.all([publish(w, number.id), publish(w, number.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      reason: expect.stringContaining("already in progress"),
    });
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("stops a publish that never finished from blocking the number for ever", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    const stuck = await db.inboundPublication.create({
      data: {
        numberId: number.id,
        version: 1,
        status: "pending",
        snapshot: {},
        personaVersion: 1,
      },
    });
    const later = new Date(Date.now() + 120_000);
    expect(
      await publishInboundNumberFor(db, w.tenant.userId, { numberId: number.id }, later),
    ).toEqual({
      ok: true,
      version: 2,
    });
    expect(
      (await db.inboundPublication.findUniqueOrThrow({ where: { id: stuck.id } })).status,
    ).toBe("failed");
  });
});

describe("inbound numbers: rollback", () => {
  async function twoRevisions() {
    const w = await workspace();
    const number = await mapNumber(w);
    await publish(w, number.id);
    await db.prompt.update({
      where: { id: w.prompt.id },
      data: { instructions: "Second text.", currentVersion: 2 },
    });
    await publish(w, number.id);
    const history = (await listed(w))[0]!.history;
    return {
      w,
      number,
      first: history.find((h) => h.version === 1)!,
      second: history.find((h) => h.version === 2)!,
    };
  }

  it("re-sends an earlier snapshot as a new, higher version", async () => {
    const { w, number, first } = await twoRevisions();
    expect(await publish(w, number.id, first.id)).toEqual({ ok: true, version: 3 });

    expect(sent(2).version).toBe(3);
    expect(sent(2).persona.instructions).toBe(
      "You are the front desk of Sunrise Clinic. [[CALLER_CONTEXT]]",
    );
    expect(sent(2).persona.version).toBe(1);
    const [view] = await listed(w);
    expect(view?.live).toMatchObject({ version: 3, personaVersion: 1 });
    expect(view?.unpublished).toBe(true); // the saved persona is revision 2, which is no longer live
  });

  it("restores only a confirmed revision of this number that is not already live", async () => {
    const { w, number, second } = await twoRevisions();
    expect(await publish(w, number.id, second.id)).toEqual({
      ok: false,
      reason: "That revision is already live.",
    });

    publishMock.mockRejectedValueOnce(new VoiceEngineUnavailableError("down"));
    await publish(w, number.id);
    const failedRow = (await listed(w))[0]!.history.find((h) => h.status === "failed")!;
    expect(await publish(w, number.id, failedRow.id)).toEqual({
      ok: false,
      reason: "That revision can't be restored.",
    });

    const other = await workspace();
    const otherNumber = await mapNumber(other);
    await publish(other, otherNumber.id);
    const foreign = (await listed(other))[0]!.live!;
    expect(await publish(w, number.id, foreign.id)).toEqual({
      ok: false,
      reason: "That revision can't be restored.",
    });
  });
});

describe("inbound numbers: checking what the engine serves", () => {
  const engineState = (
    over: Partial<Awaited<ReturnType<typeof getInboundRoute>> & object>,
    clientId: string,
  ) => ({
    phone: "918047491899",
    clientId,
    version: 1,
    active: true,
    personaKey: "front-desk",
    personaVersion: 1,
    workflow: "appointment" as const,
    status: "current" as const,
    ...over,
  });

  it("confirms a publish whose answer was lost, and learns the engine's version", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    publishMock.mockRejectedValueOnce(new VoiceEngineUnavailableError("timeout"));
    await publish(w, number.id);
    expect((await listed(w))[0]?.live).toBeNull();

    getRouteMock.mockResolvedValue(engineState({ version: 1 }, w.tenant.clientId));
    const status = await refreshInboundNumberFor(db, w.tenant.userId, { numberId: number.id });
    expect(status).toMatchObject({ reconciled: true, engine: { version: 1 } });
    expect((await listed(w))[0]?.live).toMatchObject({ version: 1, status: "synced" });
  });

  it("raises its next version above anything the engine already holds", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockResolvedValue(
      engineState({ version: 12, personaVersion: 5 }, w.tenant.clientId),
    );
    expect(
      await refreshInboundNumberFor(db, w.tenant.userId, { numberId: number.id }),
    ).toMatchObject({
      reconciled: false,
    });
    trackEngine();
    expect(await publish(w, number.id)).toEqual({ ok: true, version: 13 });
  });

  it("reports an unrouted number, a number owned by another workspace, and an unreachable engine", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockResolvedValueOnce(null);
    expect(await refreshInboundNumberFor(db, w.tenant.userId, { numberId: number.id })).toEqual({
      engine: null,
      reconciled: false,
    });

    getRouteMock.mockResolvedValueOnce(engineState({}, "someone-else"));
    await expect(
      refreshInboundNumberFor(db, w.tenant.userId, { numberId: number.id }),
    ).rejects.toThrow("The engine routes this number for a different workspace.");

    getRouteMock.mockRejectedValueOnce(
      new VoiceEngineUnavailableError("Voice engine unreachable: down"),
    );
    await expect(
      refreshInboundNumberFor(db, w.tenant.userId, { numberId: number.id }),
    ).rejects.toThrow("Voice engine unreachable");
  });
});

describe("inbound numbers: a publish is confirmed against the engine", () => {
  const stored = (w: Workspace, over: Record<string, unknown> = {}) => ({
    phone: "918047491899",
    clientId: w.tenant.clientId,
    version: 1,
    active: true,
    personaKey: "front-desk",
    personaVersion: 1,
    workflow: "appointment" as const,
    status: "current" as const,
    ...over,
  });

  it("does not call a publish successful when the engine reports something else", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockResolvedValueOnce(stored(w, { version: 7 }));

    const result = await publish(w, number.id);
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("holds version 7 instead of 1"),
    });
    const [view] = await listed(w);
    expect(view?.live).toBeNull();
    expect(view?.attention).toMatchObject({ status: "failed" });
  });

  it("names every difference: workspace, persona, revision, conversation type and on/off", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockResolvedValueOnce(
      stored(w, {
        clientId: "someone-else",
        active: false,
        personaKey: "supermarket",
        personaVersion: 9,
        workflow: "order",
      }),
    );
    const result = await publish(w, number.id);
    expect(result.ok).toBe(false);
    const reason = (result as { reason: string }).reason;
    for (const part of [
      "belongs to a different workspace",
      "number off",
      'persona "supermarket"',
      "revision 9 instead of 1",
      '"order" conversation type',
    ]) {
      expect(reason).toContain(part);
    }
  });

  it("fails when the engine accepted the publish but has no route stored", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockResolvedValueOnce(null);
    expect(await publish(w, number.id)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("has no route stored for this number"),
    });
  });

  it("still succeeds when only the read-back cannot reach the engine, because the engine accepted it", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockRejectedValueOnce(new VoiceEngineUnavailableError("timeout"));
    expect(await publish(w, number.id)).toEqual({ ok: true, version: 1 });
  });

  it("can be recovered with Check engine when the engine does hold the version", async () => {
    const w = await workspace();
    const number = await mapNumber(w);
    getRouteMock.mockResolvedValueOnce(stored(w, { version: 2 })); // a transient wrong answer during the read-back
    await publish(w, number.id);
    expect((await listed(w))[0]?.live).toBeNull();
    getRouteMock.mockResolvedValue(stored(w, { version: 1 }));
    expect(
      await refreshInboundNumberFor(db, w.tenant.userId, { numberId: number.id }),
    ).toMatchObject({
      reconciled: true,
    });
  });
});

describe("inbound numbers: the number's format", () => {
  it("refuses +91 followed by a trunk 0 and suggests the corrected number", async () => {
    const w = await workspace();
    await expect(mapNumber(w, { phone: "+9109513886363" })).rejects.toThrow(
      "Did you mean +919513886363?",
    );
    await expect(mapNumber(w, { phone: "+91951388636" })).rejects.toThrow("exactly ten digits");
    expect(await db.inboundNumber.count({ where: { clientId: w.tenant.clientId } })).toBe(0);
    const ok = await mapNumber(w, { phone: "+919513886363" });
    expect(ok.phone).toBe("+919513886363");
  });

  it("checks a number that is being changed, but leaves an existing one editable", async () => {
    const w = await workspace();
    const legacy = await db.inboundNumber.create({
      data: { clientId: w.tenant.clientId, phone: "+9109513886363", personaKey: "front-desk" },
    });
    // The number saved earlier is not re-judged when something else is edited.
    await mapNumber(w, { numberId: legacy.id, phone: legacy.phone, workflow: "faq" });
    // But changing it to another malformed number is.
    await expect(mapNumber(w, { numberId: legacy.id, phone: "+9108037091588" })).rejects.toThrow(
      "Did you mean +918037091588?",
    );
    const fixed = await mapNumber(w, { numberId: legacy.id, phone: "+918037091588" });
    expect(fixed.phone).toBe("+918037091588");
  });
});

describe("inbound numbers: calls that reached the engine with no route", () => {
  const unrouted = (phone: string, over: Record<string, unknown> = {}) => ({
    phone,
    rawExample: "08037091588",
    calls: 3,
    firstSeen: "2026-10-27T22:40:15+00:00",
    lastSeen: "2026-10-28T08:00:00+00:00",
    answeredBy: "default_agent" as const,
    ...over,
  });

  it("shows an owner the numbers calls arrived on, ready to add", async () => {
    const w = await workspace();
    const phone = newPhone();
    unroutedMock.mockResolvedValue([unrouted(phone.slice(1))]);
    expect(await listUnroutedNumbersFor(db, w.tenant.userId)).toEqual({
      unavailable: false,
      numbers: [
        {
          phone,
          rawExample: "08037091588",
          calls: 3,
          lastSeen: "2026-10-28T08:00:00+00:00",
          answeredBy: "default_agent",
        },
      ],
    });
  });

  it("hides a number once any workspace has added it, and ignores what is not a number", async () => {
    const w = await workspace();
    const other = await workspace();
    const mine = await mapNumber(w);
    const theirs = await mapNumber(other);
    unroutedMock.mockResolvedValue([
      unrouted(mine.phone.slice(1)),
      unrouted(theirs.phone.slice(1)),
      unrouted("unreadable"),
      unrouted("919000000001"),
    ]);
    const { numbers } = await listUnroutedNumbersFor(db, w.tenant.userId);
    expect(numbers.map((n) => n.phone)).toEqual(["+919000000001"]);
  });

  it("is for workspace owners only", async () => {
    const w = await workspace();
    const member = await db.user.create({
      data: { email: `member-${w.tenant.userId}@example.test`, passwordHash: "x" },
    });
    await db.clientMember.create({
      data: { clientId: w.tenant.clientId, userId: member.id, role: "member" },
    });
    unroutedMock.mockResolvedValue([unrouted("919000000002")]);
    expect(await listUnroutedNumbersFor(db, member.id)).toEqual({
      numbers: [],
      unavailable: false,
    });
    expect((await listUnroutedNumbersFor(db, w.tenant.userId)).numbers).toHaveLength(1);
    await db.user.delete({ where: { id: member.id } });
  });

  it("says so when the engine cannot be asked, and shows nothing to someone with no workspace", async () => {
    const w = await workspace();
    unroutedMock.mockRejectedValueOnce(new VoiceEngineUnavailableError("down"));
    expect(await listUnroutedNumbersFor(db, w.tenant.userId)).toEqual({
      numbers: [],
      unavailable: true,
    });
    expect(await listUnroutedNumbersFor(db, "00000000-0000-4000-8000-000000000000")).toEqual({
      numbers: [],
      unavailable: false,
    });
  });
});
