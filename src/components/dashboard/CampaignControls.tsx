import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { defaultCallingRules, type Campaign } from "@/lib/campaigns";
import { listPrompts } from "@/lib/prompts.functions";
import { getVoiceOptions, previewVoice } from "@/lib/voices.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AudioAction } from "./AudioAction";

export function Picker({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={`bg-card ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, name]) => (
          <SelectItem key={v} value={v ?? ""}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
/** Lists the personas saved on the Prompts page; a campaign speaks the one chosen here. */
export function PersonaPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const prompts = useQuery({ queryKey: ["prompts"], queryFn: () => listPrompts() });
  const options = (prompts.data?.prompts ?? [])
    .filter((p) => p.content.active)
    .map((p) => [p.content.personaKey, p.content.name]);
  const first = options[0]?.[0];
  useEffect(() => {
    if (!value && first) onChange(first);
  }, [value, first, onChange]);

  if (prompts.isLoading) return <p className="text-sm text-muted-foreground">Loading personas…</p>;
  if (!options.length && !value) {
    return (
      <p className="text-sm text-muted-foreground">
        No active personas yet. Create one on the Prompts page first.
      </p>
    );
  }
  // A campaign may still point at a persona that was switched off or removed; keep it visible.
  if (value && !options.some(([key]) => key === value)) {
    options.unshift([value, `${value} (switched off or removed)`]);
  }
  return <Picker label="Agent persona" value={value} onChange={onChange} options={options} />;
}

/** Lists the TTS provider's own real voices (GET /voices on the engine) — never a fixed/fabricated list. */
/** Lists the TTS provider's own real voices (GET /voices on the engine) — never a fixed/fabricated list. */
export function VoicePicker({
  voiceId,
  onChange,
}: {
  voiceId: string;
  onChange: (choice: { voice: string; voiceId: string; voiceModelId: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const result = useQuery({ queryKey: ["voice-options"], queryFn: () => getVoiceOptions() });
  const voices = result.data?.ok ? result.data.voices : [];
  const first = voices[0];
  useEffect(() => {
    if (!voiceId && first) onChange({ voice: first.name, voiceId: first.voiceId, voiceModelId: first.modelId ?? "" });
  }, [voiceId, first, onChange]);

  if (result.isLoading) return <p className="text-sm text-muted-foreground">Loading voices…</p>;
  if (result.isError || result.data?.ok === false) {
    const reason = result.data && !result.data.ok ? result.data.reason : "Could not load voices.";
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{reason}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => result.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!voices.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No voices were returned by the {result.data?.ok ? result.data.provider : "configured"} account on the
        voice engine yet.
      </p>
    );
  }
  const selected = voices.find((voice) => voice.voiceId === voiceId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label="Voice" className="min-w-0 flex-1 justify-start">
          {selected?.name ?? "Choose a voice"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-80 max-w-[90vw] overflow-y-auto p-2" aria-label="Voices">
        {voices.map((voice) => (
          <div key={voice.voiceId} className="flex items-start justify-between gap-2 border-b p-2 last:border-0">
            <Button type="button" variant="ghost" aria-pressed={voice.voiceId === voiceId}
              className="h-auto min-w-0 whitespace-normal text-left"
              onClick={() => {
                onChange({ voice: voice.name, voiceId: voice.voiceId, voiceModelId: voice.modelId ?? "" });
                setOpen(false);
              }}>
              {voice.name}{voice.language ? ` · ${voice.language}` : ""}
            </Button>
            <AudioAction label="Preview" unavailable="Voice preview unavailable."
              load={() => previewVoice({ data: { voiceId: voice.voiceId } })} />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function CampaignForm({
  campaign,
  onClose,
  onSave,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onSave: (c: Campaign) => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [purpose, setPurpose] = useState(campaign?.purpose ?? "Lead qualification");
  const [persona, setPersona] = useState(campaign?.persona ?? "");
  const [start, setStart] = useState(campaign?.rules.start ?? defaultCallingRules.start);
  const [end, setEnd] = useState(campaign?.rules.end ?? defaultCallingRules.end);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign ? "Edit campaign" : "Create a campaign"}</DialogTitle>
          <DialogDescription>Saved to your workspace.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (end <= start) {
              setError("Choose an end time after the start time.");
              return;
            }
            onSave({
              ...(campaign ?? {
                id: `campaign-${Date.now()}`,
                status: "Paused",
                created: new Date().toISOString().slice(0, 10),
                leads: 0,
                calls: 0,
                minutes: 0,
                interested: 0,
                rows: [],
                voice: "",
                voiceId: "",
                voiceModelId: "",
                ambience: false,
              }),
              name: name.trim(),
              purpose,
              persona,
              rules: { ...(campaign?.rules ?? defaultCallingRules), start, end },
            });
          }}
        >
          <label className="block space-y-2 text-sm font-medium">
            Campaign name
            <Input
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. October follow-ups"
            />
          </label>
          <div className="space-y-2">
            <p className="text-sm font-medium">Campaign purpose</p>
            <Picker
              label="Campaign purpose"
              value={purpose}
              onChange={setPurpose}
              options={["Lead qualification", "Notification / Reminder", "Appointment booking"].map(
                (s) => [s, s],
              )}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Agent persona</p>
            <PersonaPicker value={persona} onChange={setPersona} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2 text-sm font-medium">
              Calling starts
              <Input
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              Calling ends
              <Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{campaign ? "Save changes" : "Create campaign"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
