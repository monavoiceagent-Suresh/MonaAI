import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListOrdered,
  LockKeyhole,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  defaultOutcomeRules,
  fallbackDefinition,
  moveOutcomeRule,
  validateOutcomeRules,
  type OutcomeRule,
} from "@/lib/call-outcome-rules";
import {
  getCallOutcomeSettings,
  saveCallOutcomeSettings,
} from "@/lib/call-outcome-settings.functions";
import { outcomeBadgeClass } from "@/lib/outcome-colors";

const networkOutcomes = [
  {
    name: "Not picked up",
    description: "No person answered: the line rang out, was busy, or could not be reached.",
  },
  {
    name: "Voicemail",
    description: "An answering system, voicemail, or automated call screen responded.",
  },
  { name: "Short hangup", description: "The call ended quickly without a meaningful exchange." },
];
export function CallOutcomeRules() {
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: ["call-outcome-settings"],
    queryFn: () => getCallOutcomeSettings(),
  });

  const [rules, setRules] = useState<OutcomeRule[]>(defaultOutcomeRules);
  const [fallback, setFallback] = useState(fallbackDefinition);
  const [saved, setSaved] = useState(() =>
    JSON.stringify({ rules: defaultOutcomeRules(), fallback: fallbackDefinition }),
  );
  // Not editable here; round-tripped from what was last saved so saving rules never changes it.
  const [shortHangupThresholdSeconds, setShortHangupThresholdSeconds] = useState(15);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDefinition, setNewDefinition] = useState("");
  const [removing, setRemoving] = useState<OutcomeRule | null>(null);

  // Seed the draft from what was actually saved, once it loads (or reloads after a refetch).
  useEffect(() => {
    if (!result.data) return;
    setRules(result.data.rules);
    setFallback(result.data.fallback);
    setSaved(JSON.stringify({ rules: result.data.rules, fallback: result.data.fallback }));
    setShortHangupThresholdSeconds(result.data.shortHangupThresholdSeconds);
  }, [result.data]);

  const customCount = rules.filter((r) => !r.builtIn).length;
  const dirty = JSON.stringify({ rules, fallback }) !== saved;
  const error = validateOutcomeRules(rules, fallback);
  const update = (id: string, patch: Partial<OutcomeRule>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const restore = (id: string) => {
    const original = defaultOutcomeRules().find((r) => r.id === id);
    if (original) update(id, original);
  };
  const candidate: OutcomeRule = {
    id: "new-rule",
    name: newName,
    definition: newDefinition,
    enabled: true,
    builtIn: false,
  };
  const addError = validateOutcomeRules([...rules, candidate], fallback);

  if (result.isLoading)
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Loading your call outcome rules…
      </p>
    );
  if (result.isError) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-destructive">
          Couldn't load your call outcome rules. Try again in a moment.
        </p>
        <Button variant="outline" onClick={() => result.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  async function saveRules() {
    if (error) return;
    setSaving(true);
    try {
      const outcome = await saveCallOutcomeSettings({
        data: { rules, fallback, shortHangupThresholdSeconds },
      });
      if (!outcome.ok) {
        toast.error(outcome.reason);
        return;
      }
      setSaved(JSON.stringify({ rules, fallback }));
      await queryClient.invalidateQueries({ queryKey: ["call-outcome-settings"] });
      setNotice("Rules saved. Campaigns and calls started from now on use this wording.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 pb-4">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">Conversation settings</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Call Outcome Rules<span className="text-primary">.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A clear definition for every conversation, from the first ring to the next step.
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4 text-xs">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Check className="h-4 w-4 text-primary" />
          Saved for your workspace · Sent with every campaign and test call from now on.
        </span>
        <span className="font-medium text-primary">
          {rules.filter((r) => r.enabled).length + 1} conversation rules enabled
        </span>
      </div>
      {notice && (
        <p
          role="status"
          className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm text-primary"
        >
          {notice}
        </p>
      )}
      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <Phone className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Connection outcomes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Based on the call connection, not the conversation.
            </p>
          </div>
        </div>
        <div className="divide-y divide-border">
          {networkOutcomes.map((o) => (
            <div key={o.name} className="flex items-start gap-3 py-4">
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${outcomeBadgeClass(o.name)}`}
              >
                {o.name}
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">{o.description}</p>
              <LockKeyhole
                className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label="Fixed outcome"
              />
            </div>
          ))}
          <p className="pt-3 text-xs text-muted-foreground">
            Always enabled. Retry choices stay with each campaign.
          </p>
        </div>
      </section>
      <section className="space-y-5 border-t border-border pt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <ListOrdered className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Conversation outcomes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Highest matching rule wins. The fallback stays last.
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{customCount} of 10 custom rules</span>
        </div>
        <p className="border-l-2 border-tint-5 bg-tint-5-soft px-4 py-3 text-sm leading-relaxed text-foreground">
          Keep definitions specific and distinct. These definitions are sent to the voice engine so
          it can classify each call this way.
        </p>
        <div className="space-y-4">
          {rules.map((rule, index) => (
            <article
              key={rule.id}
              className={`rounded-lg border border-border bg-card p-4 sm:p-5 ${!rule.enabled ? "opacity-65" : ""}`}
            >
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 w-5 text-sm font-semibold tabular-nums text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Move rule up"
                    aria-label={`Move ${rule.name} up`}
                    disabled={index === 0}
                    onClick={() => setRules((rs) => moveOutcomeRule(rs, rule.id, -1))}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Move rule down"
                    aria-label={`Move ${rule.name} down`}
                    disabled={index === rules.length - 1}
                    onClick={() => setRules((rs) => moveOutcomeRule(rs, rule.id, 1))}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  aria-label={`Outcome name ${rule.id}`}
                  maxLength={60}
                  value={rule.name}
                  onChange={(e) => update(rule.id, { name: e.target.value })}
                  className="min-w-36 flex-1 font-medium"
                />
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${outcomeBadgeClass(rule.name)}`}
                >
                  {rule.name}
                </span>
                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                  {rule.builtIn ? "Built-in" : "Custom"}
                </span>
                <div className="ml-auto flex items-center gap-3">
                  {rule.builtIn ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Restore default"
                      aria-label={`Restore ${rule.name} default`}
                      onClick={() => restore(rule.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remove custom rule"
                      aria-label={`Remove ${rule.name}`}
                      onClick={() => setRemoving(rule)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(enabled) => update(rule.id, { enabled })}
                    aria-label={`Enable ${rule.name}`}
                  />
                  <span className="w-6 text-xs text-muted-foreground">
                    {rule.enabled ? "On" : "Off"}
                  </span>
                </div>
              </div>
              <Textarea
                aria-label={`Definition for ${rule.name}`}
                value={rule.definition}
                onChange={(e) => update(rule.id, { definition: e.target.value })}
                maxLength={600}
                className="min-h-32 bg-background text-sm leading-relaxed"
              />
              <p className="mt-2 text-right text-xs tabular-nums text-muted-foreground">
                {rule.definition.length}/600
              </p>
            </article>
          ))}
          <article className="rounded-lg border border-primary/25 bg-primary/5 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">Inconclusive</h3>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${outcomeBadgeClass("Inconclusive")}`}
                >
                  Inconclusive
                </span>
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase text-primary">
                  <LockKeyhole className="h-3 w-3" />
                  Always on · Always last
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Restore fallback default"
                aria-label="Restore Inconclusive default"
                onClick={() => setFallback(fallbackDefinition)}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <Textarea
              aria-label="Definition for Inconclusive"
              maxLength={600}
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              className="min-h-32 bg-card text-sm leading-relaxed"
            />
            <p className="mt-2 text-right text-xs tabular-nums text-muted-foreground">
              {fallback.length}/600
            </p>
          </article>
        </div>
        <Button
          variant="outline"
          disabled={customCount >= 10}
          className="h-auto min-h-12 w-full gap-2 whitespace-normal border-dashed py-3 text-primary"
          onClick={() => {
            setNewName("");
            setNewDefinition("");
            setAdding(true);
          }}
        >
          <Plus className="shrink-0" />
          <span>Add your own call outcome rule</span>
        </Button>
      </section>
      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-4 backdrop-blur-sm">
        <Button
          variant="ghost"
          className="px-0"
          onClick={() => {
            const defaults = defaultOutcomeRules();
            setRules((rs) => [...defaults, ...rs.filter((r) => !r.builtIn)]);
            setFallback(fallbackDefinition);
            setNotice("Built-in defaults restored in your draft. Save changes to keep them.");
          }}
        >
          <RotateCcw />
          Reset built-ins
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : "Up to date"}
          </span>
          <Button disabled={!dirty || Boolean(error) || saving} onClick={saveRules}>
            <Save />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        )}
      </footer>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add your own call outcome rule</DialogTitle>
            <DialogDescription>
              Define a distinct, clear result your agents can be classified into.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (addError) return;
              setRules((rs) => [...rs, { ...candidate, id: `custom-${Date.now()}` }]);
              setAdding(false);
            }}
          >
            <label className="block space-y-2 text-sm font-medium">
              Outcome name
              <Input
                autoFocus
                required
                maxLength={60}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Follow-up material sent"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              When this outcome applies
              <Textarea
                required
                maxLength={600}
                value={newDefinition}
                onChange={(e) => setNewDefinition(e.target.value)}
                placeholder="Describe the clear signals that qualify…"
                className="min-h-36"
              />
            </label>
            <p className="text-right text-xs text-muted-foreground">{newDefinition.length}/600</p>
            {newName && addError && (
              <p role="alert" className="text-xs text-destructive">
                {addError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={Boolean(addError)}>
                <Plus />
                Add rule
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              This removes the custom rule from your draft. Save changes to make the removal
              permanent.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRules((rs) => rs.filter((r) => r.id !== removing?.id));
                setRemoving(null);
              }}
            >
              <Trash2 />
              Remove rule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
