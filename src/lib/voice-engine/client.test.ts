import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelEngineJob,
  checkVoiceEngineHealth,
  dispatchCampaignToEngine,
  engineErrorReason,
  placeTestCall,
  VoiceEngineNotConfiguredError,
  VoiceEngineUnavailableError,
} from "./client";

const originalBaseUrl = process.env["VOICE_ENGINE_BASE_URL"];
const originalApiKey = process.env["VOICE_ENGINE_API_KEY"];

beforeEach(() => {
  process.env["VOICE_ENGINE_BASE_URL"] = "https://engine.example.com";
  process.env["VOICE_ENGINE_API_KEY"] = "secret-key";
});

afterEach(() => {
  process.env["VOICE_ENGINE_BASE_URL"] = originalBaseUrl;
  process.env["VOICE_ENGINE_API_KEY"] = originalApiKey;
  vi.unstubAllGlobals();
});

describe("voice engine client (honest unavailable-engine handling)", () => {
  it("authenticates with a bearer token and reads the engine's real health response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "ok", active_calls: 1 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const health = await checkVoiceEngineHealth();

    expect(health).toEqual({ status: "ok", active_calls: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://engine.example.com/health");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-key");
  });

  it("refuses to call out when the engine isn't configured, instead of silently no-opting", async () => {
    delete process.env["VOICE_ENGINE_BASE_URL"];
    await expect(checkVoiceEngineHealth()).rejects.toBeInstanceOf(VoiceEngineNotConfiguredError);
  });

  it("sends the idempotency key on dispatch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", active_calls: 0, outbound_dispatch_version: 1 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ engineJobId: "j1", status: "accepted" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchCampaignToEngine({
      idempotencyKey: "idem-123",
      campaignId: "c1",
      clientId: "client-1",
      persona: {
        key: "p",
        name: "P",
        language: "en",
        workflow: "general",
        instructions: "Be helpful.",
        greeting: "Hello.",
        knowledge: "",
        version: 1,
      },
      callingWindow: { start: "09:00", end: "18:00" },
      retryPolicy: { maxTries: 3, retryGapMinutes: 30, callbackWindowDays: 3 },
      leads: [],
      webhookUrl: "https://app.example.com/api/webhooks/voice-engine",
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe("idem-123");
    expect(headers.get("authorization")).toBe("Bearer secret-key");
  });

  it("retries a 500 up to the bound, then gives up with VoiceEngineUnavailableError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkVoiceEngineHealth()).rejects.toBeInstanceOf(VoiceEngineUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it("succeeds after a transient 500 followed by a 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "cancelled" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelEngineJob("job-1");
    expect(result).toEqual({ status: "cancelled" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx — it's not a transient failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkVoiceEngineHealth()).rejects.toBeInstanceOf(VoiceEngineUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wraps a network failure (not just an HTTP error status) as VoiceEngineUnavailableError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkVoiceEngineHealth()).rejects.toBeInstanceOf(VoiceEngineUnavailableError);
  });
});

// A plain, synchronous unit test on purpose: asserting this through an actually-thrown/rejected error from a
// vi.fn() mock proved unreliable in this project's integration-test environment (an "unhandled rejection" was
// reported even though the catching code ran correctly every time, once the test file had more than one
// test) — placeTestOutboundCall and listVoiceOptions, which use this, are exercised end to end instead via
// a resolved (non-throwing) outcome in outbound-test-call.int.test.ts.
describe("reported test-call transport", () => {
  const body = { clientId: "tenant", to: "+919876543210", persona: {
    key: "sales", name: "Sales", language: "en" as const, workflow: "general" as const,
    instructions: "Help", greeting: "Hello", knowledge: "", version: 1,
  } };

  it("retries an idempotent test request and reads accepted queue status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", active_calls: 0, outbound_dispatch_version: 1 })))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "accepted", engineJobId: "job" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await placeTestCall({ ...body, idempotencyKey: "request-key", webhookUrl: "https://mona.example/hook" }))
      .toEqual({ kind: "queued", engineJobId: "job" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1].body).toBe(fetchMock.mock.calls[2]?.[1].body);
  });

  it("refuses an older engine before it can dial a test or ignore a schedule", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: "ok", active_calls: 0 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(placeTestCall({ ...body, idempotencyKey: "request-key", webhookUrl: "https://mona.example/hook" }))
      .rejects.toThrow("Upgrade the voice engine");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://engine.example.com/health");
  });

  it("does not retry legacy test calls lacking an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(placeTestCall(body)).rejects.toBeInstanceOf(VoiceEngineUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("engineErrorReason", () => {
  it("names an unconfigured engine plainly", () => {
    expect(engineErrorReason(new VoiceEngineNotConfiguredError("missing env vars"))).toBe(
      "Voice engine is not configured yet.",
    );
  });

  it("passes an unavailable engine's own message through", () => {
    expect(
      engineErrorReason(new VoiceEngineUnavailableError("Voice engine unreachable: timeout")),
    ).toBe("Voice engine unreachable: timeout");
  });

  it("falls back to a generic message for anything else", () => {
    expect(engineErrorReason(new TypeError("boom"))).toBe(
      "Unexpected error reaching the voice engine.",
    );
    expect(engineErrorReason("a string, not an Error")).toBe(
      "Unexpected error reaching the voice engine.",
    );
    expect(engineErrorReason(null)).toBe("Unexpected error reaching the voice engine.");
  });
});
