import { describe, expect, it } from "vitest";
import { voiceEngineWebhookWarnings } from "./startup-checks";

const FULLY_CONFIGURED = {
  VOICE_ENGINE_BASE_URL: "http://127.0.0.1:8000",
  VOICE_ENGINE_API_KEY: "key",
  VOICE_ENGINE_WEBHOOK_SECRET: "secret",
  APP_BASE_URL: "http://localhost:8080",
};

describe("voiceEngineWebhookWarnings", () => {
  it("warns about nothing when everything is set", () => {
    expect(voiceEngineWebhookWarnings(FULLY_CONFIGURED)).toEqual([]);
  });

  it("warns about nothing when the environment has not been read yet (empty env)", () => {
    // Not asserting the count: this only proves the function is total and never throws on a bare {}.
    expect(() => voiceEngineWebhookWarnings({})).not.toThrow();
  });

  it("warns when the base URL or API key is missing", () => {
    const warnings = voiceEngineWebhookWarnings({
      ...FULLY_CONFIGURED,
      VOICE_ENGINE_BASE_URL: undefined,
    });
    expect(warnings.some((w) => w.includes("VOICE_ENGINE_BASE_URL"))).toBe(true);

    const warnings2 = voiceEngineWebhookWarnings({
      ...FULLY_CONFIGURED,
      VOICE_ENGINE_API_KEY: undefined,
    });
    expect(warnings2.some((w) => w.includes("VOICE_ENGINE_API_KEY"))).toBe(true);
  });

  it("warns when the webhook secret is missing", () => {
    const warnings = voiceEngineWebhookWarnings({
      ...FULLY_CONFIGURED,
      VOICE_ENGINE_WEBHOOK_SECRET: undefined,
    });
    expect(warnings.some((w) => w.includes("VOICE_ENGINE_WEBHOOK_SECRET"))).toBe(true);
    expect(warnings.some((w) => w.includes("DASHBOARD_WEBHOOK_SECRET"))).toBe(true);
  });

  it("warns when APP_BASE_URL is missing", () => {
    const warnings = voiceEngineWebhookWarnings({ ...FULLY_CONFIGURED, APP_BASE_URL: undefined });
    expect(warnings.some((w) => w.includes("APP_BASE_URL"))).toBe(true);
  });

  it("never includes a configured value itself, only variable names", () => {
    const secretish = { ...FULLY_CONFIGURED, VOICE_ENGINE_API_KEY: "sk-super-secret-value" };
    const warnings = voiceEngineWebhookWarnings(secretish);
    expect(warnings.every((w) => !w.includes("sk-super-secret-value"))).toBe(true);
  });

  it("reports all three independently when nothing is set", () => {
    const warnings = voiceEngineWebhookWarnings({});
    expect(warnings).toHaveLength(3);
  });
});
