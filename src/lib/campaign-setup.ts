import { campaignOutcomes, defaultCallingRules, type CampaignSetup, type Lead } from "./campaigns";

export const services = ["Sales", "Lead qualification", "Notification / Reminder", "Survey campaigns", "Loan", "Recruitment"];
export interface CampaignDraft { name: string; purpose: string; rules: typeof defaultCallingRules; setup: CampaignSetup; rows: Lead[]; persona: string; voice: string; voiceId: string; voiceModelId: string; ambience: boolean }
export function newCampaignDraft(): CampaignDraft {
  return { name: "", purpose: "", rules: { ...defaultCallingRules }, setup: { startMode: "immediate", scheduledAt: "", retryMode: "immediate", retryStart: "09:00", retryEnd: "18:00", retryOutcomes: ["Not picked up", "Voicemail", "Inconclusive", "Callback"], outcomes: [...campaignOutcomes], creditCap: null }, rows: [], persona: "", voice: "", voiceId: "", voiceModelId: "", ambience: false };
}
export function validateCampaignDraft(d: CampaignDraft, step: number, now = new Date()): string {
  if (step === 0) {
    if (d.name.trim().length < 2) return "Enter a campaign name with at least two characters.";
    if (!services.includes(d.purpose)) return "Choose a service.";
    if (!d.rules.start || !d.rules.end || d.rules.end <= d.rules.start) return "Calling hours must end after they start.";
    if (d.setup.startMode === "scheduled" && (!d.setup.scheduledAt || !Number.isFinite(new Date(d.setup.scheduledAt).getTime()) || new Date(d.setup.scheduledAt) <= now)) return "Choose a future start date and time.";
    if (d.setup.retryMode === "scheduled" && (!d.setup.retryStart || !d.setup.retryEnd || d.setup.retryEnd <= d.setup.retryStart || d.setup.retryStart < d.rules.start || d.setup.retryEnd > d.rules.end)) return "Keep the retry window within calling hours, with an end after its start.";
    if (![d.rules.maxTries, d.rules.retryGap, d.rules.callbackWindow].every(n => Number.isInteger(n) && n >= 1)) return "Attempts, retry delay and callback days must be positive whole numbers.";
    if (!d.setup.outcomes.length) return "Choose at least one campaign outcome.";
    if (d.setup.retryOutcomes.some(s => !d.setup.outcomes.includes(s))) return "Retry outcomes must also be selected as campaign outcomes.";
    if (d.setup.creditCap !== null && (!Number.isFinite(d.setup.creditCap) || d.setup.creditCap <= 0)) return "Enter a positive credit cap, or leave it empty for no cap.";
  }
  if (step === 1 && !d.rows.length) return "Upload at least one valid contact before continuing.";
  if (step === 2 && (!d.persona.trim() || !d.voice)) return "Choose an agent persona and a voice.";
  return "";
}
