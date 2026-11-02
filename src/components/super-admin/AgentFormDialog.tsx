import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  newPromptContent,
  personaKeyFromName,
  promptLanguages,
  validatePersonaKey,
  type PromptContent,
} from "@/lib/prompts";
import { createAgent, getAgentDetail, updateAgent } from "@/lib/super-admin-agents.functions";
import { listTenants } from "@/lib/super-admin-tenants.functions";
import { useQuery } from "@tanstack/react-query";

/**
 * Create (promptId null) or edit (promptId set) an agent. Deliberately mirrors
 * AddPersonaDialog's minimal field set (name, persona key, purpose, language, instructions) —
 * not the full Prompts editor — per the brief's "do not build a new prompt editor." Every
 * other PromptContent field (greeting, knowledge, call-behavior tuning) is left exactly as it
 * was: defaulted by newPromptContent() on create, preserved unchanged on edit.
 */
export function AgentFormDialog({
  promptId,
  fixedClientId,
  onClose,
  onSaved,
}: {
  promptId: string | null;
  fixedClientId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = promptId !== null;
  const detail = useQuery({
    queryKey: ["super-admin-agent-detail", promptId],
    queryFn: () => getAgentDetail({ data: { promptId: promptId! } }),
    enabled: isEdit,
  });

  const [clientId, setClientId] = useState(fixedClientId ?? "");
  const [tenantSearch, setTenantSearch] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [customKey, setCustomKey] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [language, setLanguage] = useState("English");
  const [instructions, setInstructions] = useState("");
  const [active, setActive] = useState(true);
  const [baseContent, setBaseContent] = useState<PromptContent | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (detail.data) {
      setClientId(detail.data.tenantId);
      setName(detail.data.content.name);
      setKey(detail.data.content.personaKey);
      setCustomKey(true);
      setPurpose(detail.data.content.purpose);
      setLanguage(detail.data.content.language);
      setInstructions(detail.data.content.instructions);
      setActive(detail.data.content.active);
      setBaseContent(detail.data.content);
    }
  }, [detail.data]);

  const tenants = useQuery({
    queryKey: ["super-admin-agent-tenant-picker", tenantSearch],
    queryFn: () =>
      listTenants({ data: { search: tenantSearch || undefined, status: "active", page: 1 } }),
    enabled: !isEdit,
  });

  const keyError = isEdit ? undefined : validatePersonaKey(key, []);
  const canSubmit =
    clientId.length > 0 &&
    name.trim().length >= 2 &&
    !keyError &&
    instructions.trim().length > 0 &&
    (!isEdit || baseContent !== null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const content: PromptContent = isEdit
        ? {
            ...baseContent!,
            name: name.trim(),
            purpose: purpose.trim(),
            language,
            instructions: instructions.trim(),
            active,
          }
        : {
            ...newPromptContent(name.trim()),
            personaKey: key,
            purpose: purpose.trim(),
            language,
            languages: [language],
            instructions: instructions.trim(),
            active,
          };

      const result = isEdit
        ? await updateAgent({ data: { promptId: promptId!, content } })
        : await createAgent({ data: { clientId, content } });

      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this agent.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isEdit && detail.isLoading) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-lg">
          <p className="py-10 text-center text-sm text-muted-foreground">Loading agent…</p>
        </DialogContent>
      </Dialog>
    );
  }
  if (isEdit && (detail.isError || !detail.data)) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-lg">
          <p className="py-10 text-center text-sm text-destructive">Couldn't load this agent.</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <DialogTitle className="text-xl">{isEdit ? "Edit agent" : "Create agent"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Tenant: ${detail.data?.tenantName}. Greeting, knowledge and call-behavior tuning stay as they are — edit those from the tenant's own Prompts page.`
              : "Creates a persona under the selected tenant, exactly as if the tenant had created it themselves."}
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            {!isEdit && (
              <label className="block space-y-2 text-sm font-medium">
                Tenant
                {fixedClientId ? (
                  <Input disabled value={fixedClientId} />
                ) : (
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a tenant" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="p-2">
                        <Input
                          placeholder="Search tenants…"
                          value={tenantSearch}
                          onChange={(e) => setTenantSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      {tenants.data?.tenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </label>
            )}
            <label className="block space-y-2 text-sm font-medium">
              Display name
              <Input
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!isEdit && !customKey) setKey(personaKeyFromName(e.target.value));
                  setError("");
                }}
              />
            </label>
            {!isEdit && (
              <label className="block space-y-2 text-sm font-medium">
                Persona key
                <Input
                  required
                  minLength={2}
                  maxLength={40}
                  pattern="[a-z0-9-]{2,40}"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setCustomKey(e.target.value !== "");
                    setError("");
                  }}
                />
                <span
                  className={`block text-xs font-normal ${key && keyError ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {key && keyError ? keyError : "2–40 lowercase letters, numbers, or hyphens"}
                </span>
              </label>
            )}
            <label className="block space-y-2 text-sm font-medium">
              Call purpose <span className="font-normal text-muted-foreground">(optional)</span>
              <Textarea
                rows={2}
                maxLength={500}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </label>
            <div className="space-y-2">
              <p className="text-sm font-medium">Language</p>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {promptLanguages.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="block space-y-2 text-sm font-medium">
              System instructions
              <Textarea
                required
                rows={6}
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                  setError("");
                }}
                className="font-mono text-sm leading-relaxed"
              />
            </label>
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={active} onCheckedChange={setActive} />
              Active
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {isEdit ? <Save /> : <Plus />}{" "}
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Create agent"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
