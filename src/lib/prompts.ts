// Only the languages the Python voice engine can speak (the `Language` type in the engine's app/models.py).
// Offering more here would let users create personas that cannot be called; keep the two lists in sync.
import { RECOGNITION_HINTS_MAX_CHARS } from "@/lib/recognition-hints";

export const promptLanguages = ["English", "Tamil", "Hindi", "Telugu"];
export type PromptContent = {
  name: string; personaKey: string; purpose: string; active: boolean; language: string; languages: string[];
  instructions: string; knowledge: string; greeting: string; recognition: string; whatsapp: string;
  /** Speech Recognition Prompting: vocabulary for the ASR provider only (lib/recognition-hints.ts). */
  recognitionHints: string;
  silenceWait: number; silenceNudges: number; voicemail: boolean; listen: number; stop: number; confirmations: number; confidence: number;
};
export type PromptVersion = { version: number; at: string; content: PromptContent };
export type AgentPrompt = { id: string; content: PromptContent; versions: PromptVersion[] };
export function personaKeyFromName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}
export function validatePersonaKey(key: string, existingKeys: string[]): string | undefined {
  if (!/^[a-z0-9-]{2,40}$/.test(key)) return "Use 2–40 lowercase letters, numbers, or hyphens for the persona key.";
  if (existingKeys.includes(key)) return "This persona key is already in use. Choose another.";
  return undefined;
}
export function newPromptContent(name = "New voice persona"): PromptContent {
  return { name, personaKey: personaKeyFromName(name), purpose: "", active: true, language: "English", languages: ["English"],
    instructions: "You are a helpful AI voice assistant. Introduce yourself clearly and ask whether this is a convenient time. Keep responses short, listen without interrupting, and ask one question at a time. Use only verified facts from [[KNOWLEDGE]]. Consider [[CALLER_CONTEXT]] and [[CURRENT_DATETIME]] when relevant. If you do not know an answer, offer a follow-up with the team. Respect a request to end the call or stop future contact.",
    knowledge: "", recognitionHints: "", greeting: "Hello, I’m an AI assistant calling on behalf of the team about your recent enquiry. Is now a good time for a quick conversation?",
    recognition: "enquiry, appointment, availability, callback, follow-up", whatsapp: "If you’d like, the team can share a short summary on WhatsApp after this call. May we send it to this number?",
    silenceWait: 4, silenceNudges: 2, voicemail: true, listen: 3, stop: 13, confirmations: 1, confidence: 95 };
}
export function validatePrompt(c: PromptContent): string | undefined {
  if (c.name.trim().length < 2) return "Enter a display name with at least two characters.";
  if (!c.instructions.trim() || !c.greeting.trim()) return "Add system instructions and an opening greeting.";
  if (c.recognitionHints.length > RECOGNITION_HINTS_MAX_CHARS) return `Keep speech recognition prompting under ${RECOGNITION_HINTS_MAX_CHARS} characters.`;
  if (![c.silenceWait, c.silenceNudges, c.listen, c.stop, c.confirmations, c.confidence].every(Number.isFinite)) return "Enter valid numbers for call behavior.";
  if (c.silenceWait < 1 || c.silenceNudges < 0 || c.listen < 1 || c.stop <= c.listen || c.confirmations < 1 || c.confidence < 1 || c.confidence > 100) return "Check call behavior: stop checking must exceed listening time, and confidence must be between 1 and 100.";
  return undefined;
}
