import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { placeTestOutboundCall } from "./outbound-test-call.functions";
import { placeTestCall } from "@/lib/voice-engine/client";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, placeTestCall: vi.fn() };
});

const tenants: Tenant[] = [];
afterAll(() => deleteTenants(db, tenants));
beforeEach(() => vi.mocked(placeTestCall).mockReset());

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

async function ensurePersona(
  clientId: string,
  overrides: Partial<{ active: boolean; language: string }> = {},
) {
  return db.prompt.create({
    data: {
      clientId,
      personaKey: "test-call-persona",
      name: "Test Call Persona",
      language: "English",
      instructions: "You are a helpful assistant.",
      greeting: "Hello!",
      active: true,
      ...overrides,
    },
  });
}

const INPUT = { personaKey: "test-call-persona", to: "+919876543210" };

describe("placeTestOutboundCall", () => {
  it("refuses when the caller has no workspace", async () => {
    const result = await placeTestOutboundCall(db, randomUUID(), INPUT);
    expect(result).toEqual({ ok: false, reason: "Your account isn't linked to a workspace yet." });
    expect(placeTestCall).not.toHaveBeenCalled();
  });

  it("refuses when the persona does not exist", async () => {
    const a = await newTenant();
    const result = await placeTestOutboundCall(db, a.userId, INPUT);
    expect(result).toEqual({ ok: false, reason: "That persona no longer exists." });
    expect(placeTestCall).not.toHaveBeenCalled();
  });

  it("refuses when the persona is switched off", async () => {
    const a = await newTenant();
    await ensurePersona(a.clientId, { active: false });
    const result = await placeTestOutboundCall(db, a.userId, INPUT);
    expect(result).toEqual({
      ok: false,
      reason: '"Test Call Persona" is switched off. Turn it on in Prompts first.',
    });
    expect(placeTestCall).not.toHaveBeenCalled();
  });

  it("refuses a persona whose language the engine cannot speak", async () => {
    const a = await newTenant();
    await ensurePersona(a.clientId, { language: "French" });
    const result = await placeTestOutboundCall(db, a.userId, INPUT);
    expect(result).toEqual({
      ok: false,
      reason: '"Test Call Persona" uses French, which the voice engine can\'t speak yet.',
    });
    expect(placeTestCall).not.toHaveBeenCalled();
  });

  it("never lets one workspace test-call using another workspace's persona", async () => {
    const a = await newTenant();
    const b = await newTenant();
    await ensurePersona(a.clientId);
    const result = await placeTestOutboundCall(db, b.userId, INPUT);
    expect(result).toEqual({ ok: false, reason: "That persona no longer exists." });
  });

  it("places the call and returns the engine's result", async () => {
    const a = await newTenant();
    await ensurePersona(a.clientId);
    vi.mocked(placeTestCall).mockResolvedValue({
      kind: "placed",
      call: {
        id: 42,
        status: "initiated",
        exotel_call_sid: "CAtest1",
        to_number: INPUT.to,
        contact_name: null,
      },
    });

    const result = await placeTestOutboundCall(db, a.userId, INPUT);

    expect(result).toEqual({ ok: true, callId: 42, status: "initiated", exotelCallSid: "CAtest1" });
    expect(placeTestCall).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: a.clientId, to: INPUT.to, contactName: null }),
    );
  });

  it("surfaces the engine's own refusal reason (e.g. outbound disabled, capacity)", async () => {
    const a = await newTenant();
    await ensurePersona(a.clientId);
    vi.mocked(placeTestCall).mockResolvedValue({
      kind: "rejected",
      message: "Outbound calls are disabled (ENABLE_OUTBOUND_CALLS=false)",
    });

    const result = await placeTestOutboundCall(db, a.userId, INPUT);

    expect(result).toEqual({
      ok: false,
      reason: "Outbound calls are disabled (ENABLE_OUTBOUND_CALLS=false)",
    });
  });

  it("passes the contact name through, or null when none was given", async () => {
    const a = await newTenant();
    await ensurePersona(a.clientId);
    vi.mocked(placeTestCall).mockResolvedValue({
      kind: "placed",
      call: {
        id: 1,
        status: "initiated",
        exotel_call_sid: "CA1",
        to_number: INPUT.to,
        contact_name: "Asha",
      },
    });

    await placeTestOutboundCall(db, a.userId, { ...INPUT, contactName: "Asha" });
    expect(placeTestCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ contactName: "Asha" }),
    );

    await placeTestOutboundCall(db, a.userId, INPUT);
    expect(placeTestCall).toHaveBeenLastCalledWith(expect.objectContaining({ contactName: null }));
  });
});
