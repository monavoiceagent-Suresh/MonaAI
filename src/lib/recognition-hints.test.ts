import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Prompt } from "@prisma/client";
import { contentOf } from "./prompts.functions";
import { newPromptContent, validatePrompt } from "./prompts";
import {
  DEEPGRAM_LIMITS,
  RECOGNITION_HINTS_MAX_CHARS,
  RECOGNITION_MAX_TERM_CHARS,
  RECOGNITION_MAX_TERMS,
  SCRIBE_LIMITS,
  previewRecognitionHints,
} from "./recognition-hints";

vi.mock("@/lib/auth.server", () => ({ requireAuth: {} }));
vi.mock("@/lib/db.server", () => ({ db: {} }));

const terms = (hints: string) => previewRecognitionHints(hints).terms;

// The cases agent/tests/test_recognition.py runs too: the editor preview must match what the engine sends.
const sharedCases = path.resolve(__dirname, "../../../agent/tests/fixtures/recognition_cases.json");
type SharedCase = {
  name: string;
  hints: string;
  elevenlabs_scribe: string[];
  deepgram_nova3: string[];
};
const cases: SharedCase[] = existsSync(sharedCases)
  ? (JSON.parse(readFileSync(sharedCases, "utf8")) as SharedCase[])
  : [];

describe("speech recognition hints preview (mirror of agent/app/recognition.py)", () => {
  it("previews ElevenLabs Scribe Realtime's limits: 50 terms of at most 20 characters and 5 words", () => {
    expect(RECOGNITION_MAX_TERMS).toBe(50);
    expect(RECOGNITION_MAX_TERM_CHARS).toBe(20);
    expect(SCRIBE_LIMITS.maxTermWords).toBe(5);
  });

  it.each([
    [20, true, true],
    [21, false, true],
    [50, false, true],
    [51, false, false],
    [500, false, false],
  ])("a %i-character term: Scribe keeps it %s, Deepgram %s", (length, scribe, deepgram) => {
    const term = "x".repeat(length);
    expect(terms(`${term}, ok`)).toEqual(scribe ? [term, "ok"] : ["ok"]);
    expect(previewRecognitionHints(`${term}, ok`, DEEPGRAM_LIMITS).terms).toEqual(
      deepgram ? [term, "ok"] : ["ok"],
    );
  });

  it("drops, never truncates, terms over the per-term limits, and reports them", () => {
    const preview = previewRecognitionHints(
      "abcdefghijklmnopqrstu, one two three four five six, ok term",
    );
    expect(preview.terms).toEqual(["ok term"]);
    expect(preview.tooLong).toEqual(["abcdefghijklmnopqrstu", "one two three four five six"]);
  });

  it("drops terms with unsupported characters whole, and reports them", () => {
    const preview = previewRecognitionHints("<b>Mona</b>, {Acme}, back\\slash, ok");
    expect(preview.terms).toEqual(["ok"]);
    expect(preview.invalid).toEqual(["<b>Mona</b>", "{Acme}", "back\\slash"]);
  });

  it("counts characters as code points, like the engine", () => {
    expect(terms("😀".repeat(20))).toHaveLength(1);
    expect(terms("😀".repeat(21))).toEqual([]);
  });

  it("caps the term count, reporting what didn't fit", () => {
    const many = previewRecognitionHints(
      Array.from({ length: RECOGNITION_MAX_TERMS + 20 }, (_, i) => `t${i}`).join(", "),
    );
    expect(many.terms).toHaveLength(RECOGNITION_MAX_TERMS);
    expect(many.overBudget).toBe(20);
  });

  it.skipIf(cases.length === 0).each(cases.map((c) => [c.name, c] as const))(
    "matches the engine on the shared case: %s",
    (_name, c) => {
      expect(previewRecognitionHints(c.hints, SCRIBE_LIMITS).terms).toEqual(c.elevenlabs_scribe);
      expect(previewRecognitionHints(c.hints, DEEPGRAM_LIMITS).terms).toEqual(c.deepgram_nova3);
    },
  );
});

describe("recognition hints on a persona", () => {
  it("are empty by default and bounded in size", () => {
    const content = newPromptContent("Hints");
    expect(content.recognitionHints).toBe("");
    expect(validatePrompt({ ...content, recognitionHints: "RFID, UHF" })).toBeUndefined();
    expect(
      validatePrompt({ ...content, recognitionHints: "x".repeat(RECOGNITION_HINTS_MAX_CHARS + 1) }),
    ).toBeDefined();
  });

  it("read back as empty from a revision saved before they existed", () => {
    const { recognitionHints: _omit, ...oldRevision } = {
      ...newPromptContent("Old"),
      instructions: "Kept.",
    };
    const content = contentOf(oldRevision, {} as Prompt);
    expect(content.recognitionHints).toBe("");
    expect(content.instructions).toBe("Kept.");
  });

  it("round-trip through a saved revision", () => {
    const saved = { ...newPromptContent("New"), recognitionHints: "Apollo Clinic, ECG" };
    expect(contentOf(saved, {} as Prompt).recognitionHints).toBe("Apollo Clinic, ECG");
  });
});
