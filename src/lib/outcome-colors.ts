// A single, consistent color per outcome label, used anywhere an outcome is drawn as a bar or a badge.
// Positive outcomes read green/blue/purple, pending ones amber, negative ones red; anything unmapped
// (a custom rule, or a label we don't recognise) falls back to a neutral muted tone.
// Class names are written out in full (not built with template strings) so Tailwind's content scanner
// can find and generate them.
const outcomeClasses: Record<string, { bar: string; badge: string }> = {
  Interested: { bar: "bg-tint-3", badge: "bg-tint-3-soft text-tint-3" },
  "Meeting booked": { bar: "bg-tint-4", badge: "bg-tint-4-soft text-tint-4" },
  Callback: { bar: "bg-tint-5", badge: "bg-tint-5-soft text-tint-5" },
  "Info requested": { bar: "bg-tint-2", badge: "bg-tint-2-soft text-tint-2" },
  "No requirement": { bar: "bg-tint-2", badge: "bg-tint-2-soft text-tint-2" },
  "Not picked up": { bar: "bg-tint-5", badge: "bg-tint-5-soft text-tint-5" },
  Voicemail: { bar: "bg-tint-4", badge: "bg-tint-4-soft text-tint-4" },
  "Short hangup": { bar: "bg-tint-6", badge: "bg-tint-6-soft text-tint-6" },
  "Not interested": { bar: "bg-tint-6", badge: "bg-tint-6-soft text-tint-6" },
  "Invalid number": { bar: "bg-tint-6", badge: "bg-tint-6-soft text-tint-6" },
  Inconclusive: { bar: "bg-primary", badge: "bg-primary/10 text-primary" },
  "Call failed": { bar: "bg-destructive", badge: "bg-destructive/10 text-destructive" },
};
const unmapped = { bar: "bg-muted-foreground/30", badge: "bg-muted text-muted-foreground" };

/** Solid fill for a progress bar / chart segment. */
export function outcomeBarClass(outcome: string): string {
  return (outcomeClasses[outcome] ?? unmapped).bar;
}

/** Soft pill background + matching text color for a badge. */
export function outcomeBadgeClass(outcome: string): string {
  return (outcomeClasses[outcome] ?? unmapped).badge;
}
