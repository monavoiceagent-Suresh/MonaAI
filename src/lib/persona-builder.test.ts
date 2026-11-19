import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RECOGNITION_MAX_TERM_CHARS } from "./recognition-hints";
import { describe, expect, it } from "vitest";
import { engineWorkflows } from "@/lib/voice-engine/types";
import { promptLanguages } from "./prompts";
import {
  ENGINE_PLACEHOLDERS,
  PERSONA_BUILDER_OUTPUTS,
  PERSONA_BUILDER_PROMPT,
} from "./persona-builder";

const prompt = PERSONA_BUILDER_PROMPT;
// The engine lives beside the dashboard in the monorepo checkout; skip the cross-check where it doesn't.
const enginePrompts = path.resolve(__dirname, "../../../agent/app/prompts.py");

describe("AI Persona Builder master prompt", () => {
  it("mentions only the placeholders the engine fills", () => {
    const used = new Set(prompt.match(/\[\[[A-Z_]+\]\]/g));
    expect([...used].sort()).toEqual([...ENGINE_PLACEHOLDERS].sort());
  });

  it.skipIf(!existsSync(enginePrompts))("matches the engine's placeholder list", () => {
    const source = readFileSync(enginePrompts, "utf8");
    const names = /PLACEHOLDER = re\.compile\(r"\\\[\\\[\(([A-Z_|]+)\)\\\]\\\]"\)/
      .exec(source)?.[1]
      ?.split("|");
    expect(names?.map((n) => `[[${n}]]`).sort()).toEqual([...ENGINE_PLACEHOLDERS].sort());
  });

  it("offers exactly the languages a persona can be created in", () => {
    for (const language of promptLanguages) expect(prompt).toContain(language);
    for (const other of ["Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati"])
      expect(prompt).not.toContain(other);
  });

  it("describes the engine's exact caller-context sentences", () => {
    expect(prompt).toContain("Inbound call; the caller's name is not known.");
    expect(prompt).toContain("Outbound call to <contact name>.");
    expect(prompt).toContain("Outbound call; the contact's name is not known.");
  });

  it("names every inbound conversation type the engine supports", () => {
    expect(engineWorkflows).toHaveLength(5);
    for (const label of [
      "General conversation",
      "Answer questions (FAQ)",
      "Take appointment requests",
      "Take orders",
      "Qualify leads",
    ])
      expect(prompt).toContain(label);
  });

  it("runs a one-at-a-time, 10-question adaptive interview without inventing facts", () => {
    expect(prompt).toContain("exactly 10 questions, ONE AT A TIME");
    expect(prompt).toContain("Question 3 of 10");
    expect(prompt).toMatch(/based on my previous answers/);
    expect(prompt).toMatch(/clarifying follow-up/);
    expect(prompt).toMatch(/Never invent business facts/);
    for (const topic of [
      "business context",
      "agent identity",
      "callers",
      "objective",
      "services",
      "operational knowledge",
      "tone",
      "restrictions",
      "escalation",
      "scenarios",
    ])
      expect(prompt.toLowerCase()).toContain(topic);
  });

  it("asks for the three outputs, each mapped to an existing persona field", () => {
    for (const heading of [
      "OUTPUT 1 - KNOWLEDGE BASE",
      "OUTPUT 2 - SYSTEM INSTRUCTIONS",
      "OUTPUT 3 - OPENING GREETING",
    ])
      expect(prompt).toContain(heading);
    expect(PERSONA_BUILDER_OUTPUTS.map((o) => o.field)).toEqual([
      "Knowledge base",
      "System instructions",
      "Opening greeting",
    ]);
    for (const { field } of PERSONA_BUILDER_OUTPUTS) expect(prompt).toContain(`"${field}"`);
  });

  it("rules out capabilities the engine does not have", () => {
    for (const limit of [
      "cannot transfer or forward the call",
      "cannot send SMS, WhatsApp, email",
      "cannot look up or change any record",
      "cannot schedule a callback itself",
    ])
      expect(prompt).toContain(limit);
    expect(prompt).toMatch(/Placeholders are NOT replaced in it/);
    // The end-call marker is the engine's own business; a persona must never be told to emit it.
    expect(prompt).not.toContain("<end_call>");
  });

  it("is provider independent", () => {
    expect(prompt).not.toMatch(
      /\b(as ChatGPT|as Claude|as Gemini|OpenAI|Anthropic|function call|tool_call)\b/i,
    );
  });
});

describe("AI Persona Builder speech recognition guidance", () => {
  it("states the recognizer's per-term limit, so suggested terms are not silently dropped", () => {
    expect(prompt).toContain(`at most ${RECOGNITION_MAX_TERM_CHARS} characters and 5 words`);
    expect(prompt).toContain(`each at most ${RECOGNITION_MAX_TERM_CHARS} characters`);
  });
});
