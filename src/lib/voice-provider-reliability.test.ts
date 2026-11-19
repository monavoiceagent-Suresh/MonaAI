// P0 reliability: OpenRouter-only workspace LLM settings validated with the engine before saving, and
// ElevenLabs voice models limited to Flash v2.5 (default) and Multilingual v2 (no Eleven v3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { allowedVoiceModel, selectableVoiceModels } from "@/lib/campaigns";
import {
  engineProviderConfigForPersona,
  saveVoiceProviderSettingsForClient,
  type SaveVoiceProviderSettingsInput,
} from "@/lib/voice-provider-settings.functions";

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

function fakeDatabase(row: Record<string, unknown> | null = null) {
  const upsert = vi.fn().mockResolvedValue({});
  const database = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: "c1" }) },
    voiceProviderSettings: { upsert, findUnique: vi.fn().mockResolvedValue(row) },
  } as unknown as PrismaClient;
  return { database, upsert };
}

const blank: SaveVoiceProviderSettingsInput = {
  asrProvider: null,
  asrFallbackProvider: null,
  ttsProvider: null,
  ttsFallbackProvider: null,
  llmProvider: null,
  llmFallbackProvider: null,
  llmModel: null,
  llmFallbackModel: null,
};

function validation(body: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("ElevenLabs voice model choice", () => {
  it("offers Flash v2.5 and Multilingual v2 only, never Eleven v3", () => {
    expect(selectableVoiceModels).toEqual(["eleven_flash_v2_5", "eleven_multilingual_v2"]);
    expect(allowedVoiceModel("eleven_multilingual_v2")).toBe(true);
    expect(allowedVoiceModel("eleven_flash_v2_5")).toBe(true);
    expect(allowedVoiceModel("m1")).toBe(true); // a Bakbak voice's own model is passed through untouched
    // A campaign saved with Eleven v3 before this is sent without a model (the engine default applies).
    expect(allowedVoiceModel("eleven_v3")).toBe(false);
    expect(allowedVoiceModel("")).toBe(false);
    expect(allowedVoiceModel(null)).toBe(false);
  });
});

describe("workspace LLM settings (OpenRouter only)", () => {
  it("saves a primary/fallback pair only after the engine confirms both can serve calls", async () => {
    const fetchMock = validation({
      ok: true,
      primaryModel: "a/p",
      fallbackModel: "b/f",
      problems: [],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { database, upsert } = fakeDatabase();

    const result = await saveVoiceProviderSettingsForClient(database, "c1", {
      ...blank,
      llmProvider: "groq",
      llmModel: " a/p ",
      llmFallbackModel: "b/f",
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://engine.example.com/llm/validate");
    expect(JSON.parse(init.body as string)).toEqual({ primaryModel: "a/p", fallbackModel: "b/f" });
    const saved = upsert.mock.calls[0]![0].update;
    expect(saved).toMatchObject({ llmModel: "a/p", llmFallbackModel: "b/f", llmProvider: null });
  });

  it("refuses an incompatible fallback with the engine's reason and saves nothing", async () => {
    vi.stubGlobal(
      "fetch",
      validation({
        ok: false,
        primaryModel: "a/p",
        fallbackModel: "a/p",
        problems: ["The fallback model must be different from the primary model"],
      }),
    );
    const { database, upsert } = fakeDatabase();

    const result = await saveVoiceProviderSettingsForClient(database, "c1", {
      ...blank,
      llmModel: "a/p",
      llmFallbackModel: "a/p",
    });

    expect(result).toEqual({
      ok: false,
      reason: "The fallback model must be different from the primary model",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses to save models it cannot verify because the engine is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { database, upsert } = fakeDatabase();

    const result = await saveVoiceProviderSettingsForClient(database, "c1", {
      ...blank,
      llmFallbackModel: "b/f",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/could not be verified/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("saves provider-only changes without asking the engine when no model is chosen", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { database, upsert } = fakeDatabase();

    const result = await saveVoiceProviderSettingsForClient(database, "c1", {
      ...blank,
      ttsProvider: "elevenlabs_standard",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("sends the engine the workspace's models and never a provider, even an old saved Groq choice", async () => {
    const { database } = fakeDatabase({
      asrProvider: null,
      asrFallbackProvider: null,
      ttsProvider: "elevenlabs_standard",
      ttsFallbackProvider: null,
      llmProvider: "groq",
      llmFallbackProvider: "openrouter",
      llmModel: "google/gemini-2.5-flash-lite",
      llmFallbackModel: "openai/gpt-4o-mini",
    });

    const config = await engineProviderConfigForPersona(database, "c1", {
      asrProvider: null,
      asrFallbackProvider: null,
      ttsProvider: null,
      ttsFallbackProvider: null,
    });

    expect(config).toEqual({
      ttsProvider: "elevenlabs_standard",
      llmModel: "google/gemini-2.5-flash-lite",
      llmFallbackModel: "openai/gpt-4o-mini",
    });
  });
});
