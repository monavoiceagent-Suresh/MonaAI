import { describe, expect, it } from "vitest";
import { personaSnapshot, workflowForPurpose } from "./persona";

const prompt = {
  personaKey: "october-14",
  name: "October follow-ups",
  language: "Tamil",
  instructions: "You are a helpful assistant. [[KNOWLEDGE]]",
  greeting: "Vanakkam.",
  knowledge: "Open nine to six.",
  currentVersion: 4,
};

describe("persona snapshot sent to the voice engine", () => {
  it("carries the saved text and version, with the language as the engine's code", () => {
    expect(personaSnapshot(prompt, "general")).toEqual({
      key: "october-14",
      name: "October follow-ups",
      language: "ta",
      workflow: "general",
      instructions: "You are a helpful assistant. [[KNOWLEDGE]]",
      greeting: "Vanakkam.",
      knowledge: "Open nine to six.",
      version: 4,
    });
  });

  it("maps every language the Prompts page offers", () => {
    const codes = ["English", "Hindi", "Tamil", "Telugu"].map(
      (language) => personaSnapshot({ ...prompt, language }, "general")?.language,
    );
    expect(codes).toEqual(["en", "hi", "ta", "te"]);
  });

  it("refuses a language the engine cannot speak", () => {
    expect(personaSnapshot({ ...prompt, language: "French" }, "general")).toBeNull();
  });

  it("uses the qualifying goal only for lead-qualification campaigns", () => {
    expect(workflowForPurpose("Lead qualification")).toBe("lead_qualification");
    expect(workflowForPurpose("Notification / Reminder")).toBe("general");
  });
});

describe("speech recognition hints in the persona snapshot", () => {
  it("are sent, trimmed, when the persona has them", () => {
    expect(
      personaSnapshot({ ...prompt, recognitionHints: "  RFID, UHF\n" }, "general"),
    ).toMatchObject({
      recognitionHints: "RFID, UHF",
    });
  });

  it("are omitted when empty, so the snapshot is exactly what it was before they existed", () => {
    for (const recognitionHints of [undefined, "", "  \n "]) {
      expect(personaSnapshot({ ...prompt, recognitionHints }, "general")).not.toHaveProperty(
        "recognitionHints",
      );
    }
  });
});
