import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  History,
  PhoneIncoming,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CallJournal } from "./CallJournal";
import { Picker } from "./CampaignControls";
import { phoneProblem } from "@/lib/inbound-numbers";
import {
  listInboundNumbers,
  listUnroutedNumbers,
  publishInboundNumber,
  refreshInboundNumber,
  saveInboundNumber,
  type InboundNumberView,
  type PublicationView,
} from "@/lib/inbound.functions";
import { listPrompts } from "@/lib/prompts.functions";
import { engineWorkflows, type EngineWorkflow } from "@/lib/voice-engine/types";

const workflowLabels: Record<string, string> = {
  general: "General conversation",
  faq: "Answer questions (FAQ)",
  appointment: "Take appointment requests",
  order: "Take orders",
  lead_qualification: "Qualify leads",
};
const workflowOptions = engineWorkflows.map((w) => [w, workflowLabels[w] ?? w]);
const when = (iso: string) => new Date(iso).toLocaleString();

interface Draft {
  phone: string;
  personaKey: string;
  workflow: EngineWorkflow;
  active: boolean;
}

function PersonaSelect({
  value,
  onChange,
  personas,
}: {
  value: string;
  onChange: (key: string) => void;
  personas: string[][];
}) {
  if (!personas.length) {
    return (
      <p className="text-sm text-muted-foreground">Create a persona on the Prompts page first.</p>
    );
  }
  const options = personas.some(([key]) => key === value)
    ? personas
    : [[value, `${value} (switched off or removed)`], ...personas];
  return <Picker label="Persona" value={value} onChange={onChange} options={options} />;
}

function PublishHistory({
  number,
  busy,
  onRollback,
}: {
  number: InboundNumberView;
  busy: boolean;
  onRollback: (publication: PublicationView) => void;
}) {
  const liveId = number.live?.id;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4 text-muted-foreground" /> Publish history
      </p>
      {number.history.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing published yet.</p>
      )}
      {number.history.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Version {p.version} · persona revision {p.personaVersion} ·{" "}
            {workflowLabels[p.workflow] ?? p.workflow}
            {p.active ? "" : " · off"} ·{" "}
            <span className="text-muted-foreground">{when(p.createdAt)}</span>
            {" · "}
            <span
              className={
                p.status === "synced"
                  ? "text-tint-3"
                  : p.status === "failed"
                    ? "text-destructive"
                    : ""
              }
            >
              {p.id === liveId ? "live" : p.status}
            </span>
          </span>
          {p.status === "synced" && p.id !== liveId && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRollback(p)}>
              <RotateCcw />
              Publish this again
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function NumberCard({
  number,
  personas,
  onChanged,
}: {
  number: InboundNumberView;
  personas: string[][];
  onChanged: () => Promise<unknown>;
}) {
  const saved: Draft = {
    phone: number.phone,
    personaKey: number.personaKey,
    workflow: number.workflow as EngineWorkflow,
    active: number.active,
  };
  const [draft, setDraft] = useState<Draft>(saved);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const phoneIssue = draft.phone !== saved.phone ? phoneProblem(draft.phone) : null;
  const published = number.history.length > 0;
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    try {
      await work();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setProblem(message);
      toast.error(message);
    } finally {
      await onChanged();
      setBusy(false);
    }
  };
  const publish = (rollback?: PublicationView) =>
    run(async () => {
      const result = await publishInboundNumber({
        data: {
          numberId: number.id,
          ...(rollback ? { rollbackToPublicationId: rollback.id } : {}),
        },
      });
      if (result.ok) {
        toast.success(`Published version ${result.version}. New calls use it now.`);
      } else {
        setProblem(result.reason);
        toast.error(result.reason);
      }
    });

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <PhoneIncoming className="h-5 w-5" />
          </span>
          <div>
            <p className="font-mono text-lg font-semibold">{number.phone}</p>
            <p className="text-xs text-muted-foreground">
              {number.live
                ? `Live: version ${number.live.version} · persona revision ${number.live.personaVersion} · ${workflowLabels[number.live.workflow] ?? number.live.workflow} · ${number.live.active ? "answering" : "switched off"}`
                : "Not published: callers to this number are not answered by Mona yet."}
            </p>
          </div>
        </div>
        {number.unpublished && (
          <span className="rounded-full bg-tint-5-soft px-2.5 py-1 text-xs font-medium text-tint-5">
            Unpublished changes
          </span>
        )}
      </div>

      {number.attention && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {number.attention.status === "pending"
            ? `Version ${number.attention.version} is still being published.`
            : `Version ${number.attention.version} was not published: ${number.attention.error ?? "unknown error"}`}{" "}
          {number.live
            ? `Calls still follow version ${number.live.version}.`
            : "No calls are answered yet."}
        </p>
      )}
      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {problem}
        </p>
      )}
      {number.personaMissing && (
        <p role="alert" className="text-sm text-destructive">
          The persona "{number.personaKey}" no longer exists. Choose another before publishing.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium">
          Number
          <Input
            value={draft.phone}
            disabled={published}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="+918047491899"
          />
          {phoneIssue && (
            <span role="alert" className="block text-xs font-normal text-destructive">
              {phoneIssue}
            </span>
          )}
          <span className="block text-xs font-normal text-muted-foreground">
            {published
              ? "A published number can't be changed. Add a new number instead."
              : "The number your callers dial, in the form Exotel reports the called number."}
          </span>
        </label>
        <div className="space-y-2">
          <p className="text-sm font-medium">Persona</p>
          <PersonaSelect
            value={draft.personaKey}
            onChange={(personaKey) => patch({ personaKey })}
            personas={personas}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Conversation type</p>
          <Picker
            label="Conversation type"
            value={draft.workflow}
            onChange={(workflow) => patch({ workflow: workflow as EngineWorkflow })}
            options={workflowOptions}
          />
        </div>
        <label className="flex items-center gap-3 self-end py-2 text-sm">
          <Switch checked={draft.active} onCheckedChange={(active) => patch({ active })} />
          Answer calls to this number
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Saving keeps a draft. Calls change only when you publish.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const status = await refreshInboundNumber({ data: { numberId: number.id } });
                toast.info(
                  status.engine
                    ? `Engine is serving version ${status.engine.version} (persona revision ${status.engine.personaVersion})${status.engine.active ? "" : ", switched off"}.${status.reconciled ? " A publish that had no answer is now confirmed." : ""}`
                    : "The engine has no route for this number.",
                );
              })
            }
          >
            <RefreshCw />
            Check engine
          </Button>
          <Button
            variant="outline"
            disabled={busy || !dirty || phoneIssue !== null}
            onClick={() =>
              run(async () => {
                await saveInboundNumber({ data: { numberId: number.id, ...draft } });
                toast.success("Draft saved. Calls are unchanged until you publish.");
              })
            }
          >
            <Save />
            Save draft
          </Button>
          <Button
            disabled={busy || dirty || number.personaMissing}
            onClick={() => publish()}
            title={dirty ? "Save your changes first" : undefined}
          >
            <Send />
            Publish
          </Button>
        </div>
      </div>

      <PublishHistory number={number} busy={busy} onRollback={(p) => publish(p)} />
    </section>
  );
}

function AddNumber({
  personas,
  onAdded,
  initialPhone = "",
}: {
  personas: string[][];
  onAdded: () => Promise<unknown>;
  initialPhone?: string;
}) {
  const [draft, setDraft] = useState<Draft>({
    phone: initialPhone,
    personaKey: "",
    workflow: "general",
    active: true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const personaKey = draft.personaKey || personas[0]?.[0] || "";
  const phoneIssue = draft.phone ? phoneProblem(draft.phone.trim()) : null;
  return (
    <form
      id="add-inbound-number"
      className="space-y-4 rounded-xl border border-dashed border-border p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await saveInboundNumber({ data: { numberId: null, ...draft, personaKey } });
          setDraft({ phone: "", personaKey: "", workflow: "general", active: true });
          await onAdded();
          toast.success("Number added as a draft. Publish it to start answering calls.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't add this number.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-medium">Add a number</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-2 text-sm font-medium">
          Number
          <Input
            required
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="+918047491899"
          />
          {phoneIssue && (
            <span role="alert" className="block text-xs font-normal text-destructive">
              {phoneIssue}
            </span>
          )}
          <span className="block text-xs font-normal text-muted-foreground">
            The number your callers dial, in the form Exotel reports the called number.
          </span>
        </label>
        <div className="space-y-2">
          <p className="text-sm font-medium">Persona</p>
          <PersonaSelect
            value={personaKey}
            onChange={(key) => setDraft({ ...draft, personaKey: key })}
            personas={personas}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Conversation type</p>
          <Picker
            label="Conversation type"
            value={draft.workflow}
            onChange={(workflow) => setDraft({ ...draft, workflow: workflow as EngineWorkflow })}
            options={workflowOptions}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !personas.length || phoneIssue !== null}>
        <Plus />
        Add number
      </Button>
    </form>
  );
}

export function InboundNumbers() {
  const queryClient = useQueryClient();
  const numbers = useQuery({ queryKey: ["inbound-numbers"], queryFn: () => listInboundNumbers() });
  const prompts = useQuery({ queryKey: ["prompts"], queryFn: () => listPrompts() });
  const unrouted = useQuery({
    queryKey: ["unrouted-numbers"],
    queryFn: () => listUnroutedNumbers(),
    refetchInterval: 30_000,
  });
  const [prefill, setPrefill] = useState("");
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inbound-numbers"] }),
      queryClient.invalidateQueries({ queryKey: ["unrouted-numbers"] }),
    ]);
  const personas = (prompts.data?.prompts ?? [])
    .filter((p) => p.content.active)
    .map((p) => [p.content.personaKey, p.content.name]);

  if (numbers.isLoading)
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading numbers…</p>;
  if (numbers.isError) {
    return (
      <p className="py-16 text-center text-sm text-destructive">
        Couldn't load your numbers. Try again in a moment.
      </p>
    );
  }
  if (!numbers.data?.client) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Your account isn't linked to a workspace yet.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">Phone numbers that Mona answers</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Inbound numbers<span className="text-primary">.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          A caller who dials one of these numbers hears the persona assigned to it. Saving a prompt
          or a number never changes a live call: only Publish does, and a published version can be
          restored from the history.
        </p>
      </header>
      {unrouted.data && unrouted.data.numbers.length > 0 && (
        <section
          role="alert"
          className="space-y-3 rounded-xl border border-tint-5/40 bg-tint-5-soft/40 p-5"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-tint-5" />
            Calls reached your voice engine on numbers that have no route
          </p>
          <p className="text-sm text-muted-foreground">
            Mona's personas answer only the numbers you add and publish here. A call to any other
            number is answered by the engine's default agent, or refused. Add the number your
            callers actually dial:
          </p>
          <ul className="space-y-2">
            {unrouted.data.numbers.map((n) => (
              <li
                key={n.phone}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span>
                  <span className="font-mono font-semibold">{n.phone}</span>{" "}
                  <span className="text-muted-foreground">
                    (reported as {n.rawExample}) · {n.calls} {n.calls === 1 ? "call" : "calls"} ·
                    last {new Date(n.lastSeen).toLocaleString()} ·{" "}
                    {n.answeredBy === "refused"
                      ? "refused"
                      : "answered by the engine's default agent"}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPrefill(n.phone);
                    document
                      .getElementById("add-inbound-number")
                      ?.scrollIntoView({ block: "center" });
                  }}
                >
                  <Plus />
                  Add this number
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {numbers.data.numbers.map((number) => (
        <NumberCard
          key={`${number.id}-${number.live?.version ?? 0}-${number.history[0]?.version ?? 0}`}
          number={number}
          personas={personas}
          onChanged={refresh}
        />
      ))}
      <AddNumber key={prefill} initialPhone={prefill} personas={personas} onAdded={refresh} />
      <div className="border-t border-border pt-7">
        <CallJournal direction="inbound" />
      </div>
    </div>
  );
}
