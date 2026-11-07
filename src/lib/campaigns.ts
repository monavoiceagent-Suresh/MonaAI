import Papa from "papaparse";

export const campaignStatuses = ["Active", "Paused", "Scheduled", "Out of credits", "Credit cap reached", "Completed"] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];
export const queueStates = ["Queued", "Retry scheduled", "Callback scheduled", "Done", "Exhausted"] as const;
export type QueueState = (typeof queueStates)[number];
export const defaultCallingRules = { start: "09:00", end: "18:00", days: "All days", maxTries: 3, retryGap: 30, callbackWindow: 3 };
export const campaignOutcomes = ["Not picked up", "Voicemail", "Short hangup", "Inconclusive", "Not interested", "Callback", "Interested", "Info requested", "Meeting booked"];
export const contactTemplate = [["name", "number"], ["Sample contact", "+919876500001"]];
export interface CampaignSetup {
  startMode: "immediate" | "scheduled"; scheduledAt: string;
  retryMode: "immediate" | "scheduled"; retryStart: string; retryEnd: string;
  retryOutcomes: string[]; outcomes: string[]; creditCap: number | null;
}
export interface Lead { id: string; name: string; phone: string; outcome: string; endedBy: string; queue: QueueState; lastCall: string; attempts: number; followUp: string }
export interface Campaign {
  id: string; name: string; purpose: string; status: CampaignStatus; created: string; leads: number; calls: number;
  minutes: number; interested: number; persona: string; voice: string; voiceId: string; voiceModelId: string; ambience: boolean;
  // ElevenLabs' own expressiveness controls (0-1) for that voice; null/undefined keeps the engine's fixed default.
  voiceStability?: number | null; voiceSimilarityBoost?: number | null; voiceStyle?: number | null;
  rules: typeof defaultCallingRules; rows: Lead[]; setup?: CampaignSetup;
}
const sampleLeads: Lead[] = [
  { id: "l1", name: "—", phone: "+919171803361", outcome: "Not picked up", endedBy: "—", queue: "Exhausted", lastCall: "Oct 13, 2026 · 4:24 PM", attempts: 3, followUp: "—" },
  { id: "l2", name: "—", phone: "+918675578238", outcome: "Not picked up", endedBy: "—", queue: "Exhausted", lastCall: "Oct 13, 2026 · 4:16 PM", attempts: 3, followUp: "—" },
  { id: "l3", name: "—", phone: "+919094030478", outcome: "Info requested", endedBy: "Call failed", queue: "Done", lastCall: "Oct 13, 2026 · 3:16 PM", attempts: 1, followUp: "—" },
  { id: "l4", name: "—", phone: "+919884033672", outcome: "Callback", endedBy: "Customer", queue: "Callback scheduled", lastCall: "Oct 13, 2026 · 3:08 PM", attempts: 2, followUp: "Oct 14 · 10:00 AM" },
  { id: "l5", name: "—", phone: "+919940177311", outcome: "Voicemail", endedBy: "Agent", queue: "Retry scheduled", lastCall: "Oct 13, 2026 · 2:45 PM", attempts: 1, followUp: "Oct 14 · 9:30 AM" },
  { id: "l6", name: "—", phone: "+919876500101", outcome: "Not called", endedBy: "—", queue: "Queued", lastCall: "—", attempts: 0, followUp: "—" },
  { id: "l7", name: "—", phone: "+919876500102", outcome: "Interested", endedBy: "Customer", queue: "Done", lastCall: "Oct 13, 2026 · 2:15 PM", attempts: 1, followUp: "—" },
];
export const sampleCampaigns: Campaign[] = [
  { id: "visitors", name: "Visitors", purpose: "Notification / Reminder", status: "Paused", created: "2026-10-12", leads: 1208, calls: 1390, minutes: 163, interested: 10, rows: sampleLeads },
  { id: "franchise", name: "franchise", purpose: "Lead qualification", status: "Completed", created: "2026-10-07", leads: 238, calls: 624, minutes: 0, interested: 0, rows: [] },
  { id: "tnepl", name: "TNEPL – NEW", purpose: "Notification / Reminder", status: "Paused", created: "2026-09-30", leads: 1468, calls: 2149, minutes: 0, interested: 0, rows: [] },
  { id: "tnepl2", name: "Tnepl 2", purpose: "Lead qualification", status: "Paused", created: "2026-09-29", leads: 5, calls: 6, minutes: 0, interested: 0, rows: [] },
].map(c => ({ ...c, status: c.status as CampaignStatus, persona: "october 14", voice: "Voice 8 · Reflective Women · Female", voiceId: "", voiceModelId: "", ambience: false, rules: { ...defaultCallingRules } }));
export function filterCampaigns(campaigns: Campaign[], query: string, status: string, sort: string) {
  return campaigns.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) && (status === "All" || c.status === status))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "oldest" ? a.created.localeCompare(b.created) : b.created.localeCompare(a.created));
}
export function inspectLeadCsv(text: string) {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  if (parsed.errors.length) throw new Error("The CSV has broken rows or quotes. Please check the file and try again.");
  const [first, ...data] = parsed.data;
  const header = first?.map(s => s.trim().toLowerCase()) ?? [];
  const phoneIndex = header.findIndex(s => ["number", "phone", "phone number", "phone_number"].includes(s));
  const nameIndex = header.indexOf("name");
  if (phoneIndex < 0) throw new Error("Your CSV needs a number column. You can also use phone.");
  const errors: { row: number; name: string; number: string; reason: string }[] = [];
  const rows: Lead[] = [];
  const seen = new Set<string>();
  data.forEach((cells, i) => {
    const phone = (cells[phoneIndex] ?? "").trim();
    const name = cells[nameIndex]?.trim() || "—";
    const normalized = phone.replace(/[\s()-]/g, "");
    const reason = cells.length !== header.length ? "Column count does not match" : !/^\+?\d{7,15}$/.test(normalized) ? "Invalid number" : seen.has(normalized.replace(/^\+/, "")) ? "Duplicate number" : "";
    if (reason) { errors.push({ row: i + 2, name, number: phone, reason }); return; }
    seen.add(normalized.replace(/^\+/, ""));
    rows.push({ id: `import-${Date.now()}-${i}`, name, phone, outcome: "Not called", endedBy: "—", queue: "Queued", lastCall: "—", attempts: 0, followUp: "—" });
  });
  return { rows, errors };
}
export function parseLeadCsv(text: string): Lead[] { return inspectLeadCsv(text).rows; }
export function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}