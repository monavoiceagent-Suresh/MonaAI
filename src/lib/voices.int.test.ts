import { afterAll, describe, expect, it, vi } from "vitest";
import { previewEngineVoice } from "@/lib/voice-engine/client";
import { db } from "@/lib/db.server";
import { createTenant, deleteTenants, type Tenant } from "@/test/tenant-fixtures";
import { previewVoiceFor } from "./voices.functions";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, previewEngineVoice: vi.fn() };
});

const tenants: Tenant[] = [];
afterAll(async () => {
  await deleteTenants(db, tenants);
  await db.voicePreviewCache.deleteMany({ where: { voiceId: { in: ["v-cached", "v-fresh"] } } });
});

async function newTenant() {
  const tenant = await createTenant(db);
  tenants.push(tenant);
  return tenant;
}

function audioResponse(bytes: string) {
  return new Response(new TextEncoder().encode(bytes), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

describe("previewVoiceFor", () => {
  it("calls the engine once and serves every later preview of that voice from the cache", async () => {
    const tenant = await newTenant();
    vi.mocked(previewEngineVoice).mockResolvedValue(audioResponse("sample-bytes"));

    const first = await previewVoiceFor(db, tenant.userId, "v-cached");
    const second = await previewVoiceFor(db, tenant.userId, "v-cached");

    expect(await first.arrayBuffer()).toEqual(await audioResponse("sample-bytes").arrayBuffer());
    expect(await second.arrayBuffer()).toEqual(await audioResponse("sample-bytes").arrayBuffer());
    expect(second.headers.get("content-type")).toBe("audio/mpeg");
    expect(previewEngineVoice).toHaveBeenCalledTimes(1);
  });

  it("does not cache an engine failure, so the next preview retries the engine", async () => {
    const tenant = await newTenant();
    vi.mocked(previewEngineVoice).mockResolvedValue(new Response(null, { status: 502 }));

    const result = await previewVoiceFor(db, tenant.userId, "v-fresh");

    expect(result.status).toBe(502);
    expect(await db.voicePreviewCache.findUnique({ where: { voiceId: "v-fresh" } })).toBeNull();
  });

  it("refuses a caller with no workspace, without touching the engine or the cache", async () => {
    const result = await previewVoiceFor(db, crypto.randomUUID(), "v-cached");

    expect(result.status).toBe(404);
  });
});
