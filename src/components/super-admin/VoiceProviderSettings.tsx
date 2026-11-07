import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  asrProviders,
  ttsProviders,
  getVoiceProviderSettingsForTenant,
  saveVoiceProviderSettingsForTenant,
  type AsrProvider,
  type TtsProvider,
  type VoiceProviderSettingsView,
} from "@/lib/voice-provider-settings.functions";

const ENGINE_DEFAULT = "__engine_default__";

const asrLabels: Record<AsrProvider, string> = {
  elevenlabs_scribe: "ElevenLabs Scribe",
  deepgram_nova3: "Deepgram Nova-3",
};
const ttsLabels: Record<TtsProvider, string> = {
  elevenlabs_premium: "ElevenLabs Premium",
  elevenlabs_standard: "ElevenLabs Standard",
  deepgram_aura: "Deepgram Aura",
  bakbak: "Bakbak",
};

const empty: VoiceProviderSettingsView = {
  asrProvider: null,
  asrFallbackProvider: null,
  ttsProvider: null,
  ttsFallbackProvider: null,
};

function ProviderField<T extends string>({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  options: readonly T[];
  labels: Record<T, string>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={value ?? ENGINE_DEFAULT}
        onValueChange={(v) => onChange(v === ENGINE_DEFAULT ? null : (v as T))}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ENGINE_DEFAULT}>Engine default</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Super Admin only: a tenant's ASR/TTS provider choice. Workspace users never see this page. */
export function VoiceProviderSettings({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["super-admin-voice-provider-settings", clientId];
  const result = useQuery({
    queryKey,
    queryFn: () => getVoiceProviderSettingsForTenant({ data: { clientId } }),
  });

  const [draft, setDraft] = useState<VoiceProviderSettingsView>(empty);
  const [saved, setSaved] = useState(() => JSON.stringify(empty));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!result.data) return;
    setDraft(result.data);
    setSaved(JSON.stringify(result.data));
  }, [result.data]);

  const dirty = JSON.stringify(draft) !== saved;
  const sameAsrPair = draft.asrProvider !== null && draft.asrProvider === draft.asrFallbackProvider;
  const sameTtsPair = draft.ttsProvider !== null && draft.ttsProvider === draft.ttsFallbackProvider;
  const error = sameAsrPair
    ? "The ASR fallback must be different from the primary."
    : sameTtsPair
      ? "The TTS fallback must be different from the primary."
      : null;

  if (result.isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Loading voice provider settings…
      </p>
    );
  }
  if (result.isError) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-sm text-destructive">
          Couldn't load this tenant's voice provider settings. Try again in a moment.
        </p>
        <Button variant="outline" onClick={() => result.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  async function save() {
    if (error) return;
    setSaving(true);
    try {
      const outcome = await saveVoiceProviderSettingsForTenant({ data: { clientId, ...draft } });
      if (!outcome.ok) {
        toast.error(outcome.reason);
        return;
      }
      setSaved(JSON.stringify(outcome.settings));
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Voice provider settings saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Speech-to-text (ASR)</CardTitle>
          <CardDescription>
            The engine transcribes the caller's speech with this provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ProviderField
            label="Primary"
            value={draft.asrProvider}
            onChange={(v) => setDraft((d) => ({ ...d, asrProvider: v }))}
            options={asrProviders}
            labels={asrLabels}
          />
          <ProviderField
            label="Fallback"
            value={draft.asrFallbackProvider}
            onChange={(v) => setDraft((d) => ({ ...d, asrFallbackProvider: v }))}
            options={asrProviders}
            labels={asrLabels}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Text-to-speech (TTS)</CardTitle>
          <CardDescription>
            The engine speaks the agent's replies with this provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ProviderField
            label="Primary"
            value={draft.ttsProvider}
            onChange={(v) => setDraft((d) => ({ ...d, ttsProvider: v }))}
            options={ttsProviders}
            labels={ttsLabels}
          />
          <ProviderField
            label="Fallback"
            value={draft.ttsFallbackProvider}
            onChange={(v) => setDraft((d) => ({ ...d, ttsFallbackProvider: v }))}
            options={ttsProviders}
            labels={ttsLabels}
          />
        </CardContent>
      </Card>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={save} disabled={!dirty || !!error || saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
