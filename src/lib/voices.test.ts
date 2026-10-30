import { describe, expect, it, vi } from "vitest";
import { listEngineVoices } from "@/lib/voice-engine/client";
import { listVoiceOptions } from "./voices.functions";

vi.mock("@/lib/voice-engine/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice-engine/client")>(
    "@/lib/voice-engine/client",
  );
  return { ...actual, listEngineVoices: vi.fn() };
});

describe("listVoiceOptions", () => {
  it("passes through the engine's real voices", async () => {
    vi.mocked(listEngineVoices).mockResolvedValue({
      provider: "bakbak",
      voices: [{ voiceId: "v1", name: "Anitha", language: "ta", modelId: "standard" }],
    });

    const result = await listVoiceOptions();

    expect(result).toEqual({
      ok: true,
      provider: "bakbak",
      voices: [{ voiceId: "v1", name: "Anitha", language: "ta", modelId: "standard" }],
    });
  });

  it("passes through an empty list as-is (not an error)", async () => {
    vi.mocked(listEngineVoices).mockResolvedValue({ provider: "bakbak", voices: [] });

    const result = await listVoiceOptions();

    expect(result).toEqual({ ok: true, provider: "bakbak", voices: [] });
  });
});
