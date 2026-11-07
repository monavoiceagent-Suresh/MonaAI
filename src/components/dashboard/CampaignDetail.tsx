import { useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Upload,
  Pencil,
  Play,
  Pause,
  Phone,
  Timer,
  Users,
  UserCheck,
  Mic,
  CalendarClock,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  PhoneCall,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Picker } from "./CampaignControls";
import { TestOutboundCallCard } from "./TestOutboundCallCard";
import { downloadCsv, parseLeadCsv, queueStates, type Campaign } from "@/lib/campaigns";
import { outcomeBadgeClass } from "@/lib/outcome-colors";

const fmt = (n: number) => n.toLocaleString("en-IN");
export const stateStyle: Record<string, string> = {
  Active: "bg-tint-3-soft text-tint-3",
  Paused: "bg-tint-5-soft text-tint-5",
  Completed: "bg-muted text-muted-foreground",
  Scheduled: "bg-tint-2-soft text-tint-2",
  "Out of credits": "bg-tint-6-soft text-tint-6",
  "Credit cap reached": "bg-tint-6-soft text-tint-6",
  Queued: "bg-muted text-muted-foreground",
  "Retry scheduled": "bg-tint-5-soft text-tint-5",
  "Callback scheduled": "bg-tint-2-soft text-tint-2",
  Done: "bg-tint-3-soft text-tint-3",
  Exhausted: "bg-tint-6-soft text-tint-6",
};
export function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${stateStyle[value] ?? "bg-muted text-muted-foreground"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-5 text-lg font-semibold">{children}</h2>;
}

export function CampaignDetail({
  campaign: c,
  onBack,
  onEdit,
  onUpdate,
}: {
  campaign: Campaign;
  onBack: () => void;
  onEdit: () => void;
  onUpdate: (c: Campaign) => void;
}) {
  const [tab, setTab] = useState("results");
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState("All");
  const [outcome, setOutcome] = useState("All");
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [test, setTest] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reference = c.id === "visitors";
  const filtered = c.rows.filter(
    (l) =>
      `${l.name} ${l.phone}`.toLowerCase().includes(search.toLowerCase()) &&
      (queue === "All" || l.queue === queue) &&
      (outcome === "All" || l.outcome === outcome),
  );
  const visible = filtered.slice(page * 5, page * 5 + 5);
  const queueCounts = reference
    ? [635 + Math.max(0, c.leads - 1208), 25, 5, 220, 323]
    : queueStates.map((s) => c.rows.filter((l) => l.queue === s).length);
  const report = () =>
    downloadCsv(`${c.name}-report.csv`, [
      ["Campaign", "Status", "Total leads", "Calls made", "AI minutes", "Interested leads"],
      [c.name, c.status, String(c.leads), String(c.calls), String(c.minutes), String(c.interested)],
      [],
      ["Name", "Phone", "Outcome", "Ended by", "Queue", "Last call", "Attempts", "Next follow-up"],
      ...c.rows.map((l) => [
        l.name,
        l.phone,
        l.outcome,
        l.endedBy,
        l.queue,
        l.lastCall,
        String(l.attempts),
        l.followUp,
      ]),
    ]);
  return (
    <div className="space-y-7">
      <Button variant="ghost" className="-ml-3 text-muted-foreground" onClick={onBack}>
        <ArrowLeft />
        All campaigns
      </Button>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Status value={c.status} />
            <span className="text-xs text-muted-foreground">Standard calling</span>
          </div>
          <h1 className="text-3xl font-semibold sm:text-4xl">{c.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {c.purpose} <span className="mx-2">·</span> Created{" "}
            {new Date(`${c.created}T12:00:00`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
          <Button variant="outline" onClick={() => setTest(true)}>
            <Phone />
            Test call
          </Button>
          <Button
            disabled={c.status === "Completed" || c.leads === 0}
            onClick={() => {
              onUpdate({ ...c, status: c.status === "Active" ? "Paused" : "Active" });
              setNotice(
                c.status === "Active"
                  ? "Pausing the campaign. A call already in progress will finish."
                  : "Starting the campaign. Queued leads are called within your calling hours.",
              );
            }}
          >
            {c.status === "Active" ? <Pause /> : <Play />}
            {c.status === "Active" ? "Pause" : c.status === "Scheduled" ? "Start" : "Resume"}
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-4 border-y border-border py-6 xl:grid-cols-4">
        {[
          {
            icon: Timer,
            label: "AI minutes used",
            value: c.minutes,
            tint: "text-tint-2 bg-tint-2-soft",
          },
          {
            icon: UserCheck,
            label: "Interested leads",
            value: c.interested,
            tint: "text-tint-3 bg-tint-3-soft",
          },
          {
            icon: PhoneCall,
            label: "Calls made",
            value: c.calls,
            tint: "text-primary bg-primary/10",
          },
          { icon: Users, label: "Total leads", value: c.leads, tint: "text-tint-5 bg-tint-5-soft" },
        ].map(({ icon: Icon, label, value, tint }) => (
          <div key={label} className="flex items-center gap-3">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${tint}`}>
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold">{fmt(value)}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Saved to your workspace</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload />
            Upload leads
          </Button>
          <Button variant="outline" onClick={report}>
            <Download />
            Report
          </Button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="Upload leads CSV"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const rows = parseLeadCsv(await file.text());
            if (!rows.length) throw new Error("No valid phone numbers found.");
            onUpdate({ ...c, rows: [...c.rows, ...rows], leads: c.leads + rows.length });
            setNotice(`${rows.length} leads added to this campaign.`);
          } catch (err) {
            setNotice(err instanceof Error ? err.message : "Could not read your file.");
          }
          e.target.value = "";
        }}
      />
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"
        >
          {notice}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 h-auto max-w-full justify-start overflow-x-auto">
          {[
            ["results", "Results"],
            ["pipeline", "Call pipeline"],
            ["leads", "Leads"],
            ["settings", "Voice & rules"],
          ].map(([v, label]) => (
            <TabsTrigger key={v} value={v ?? ""}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="results" className="space-y-8">
          <section>
            <SectionTitle>Conversation outcomes</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                [
                  "Pick-up rate",
                  reference ? "49%" : "—",
                  reference ? "279 of 573 dialled leads answered" : "No result breakdown available",
                ],
                [
                  "Positive leads",
                  reference ? "33" : "—",
                  reference ? "60% of 55 conversations" : "No result breakdown available",
                ],
                [
                  "Meetings booked",
                  reference ? "4" : "—",
                  reference ? "7% of 55 conversations" : "No result breakdown available",
                ],
                [
                  "Average conversation",
                  reference ? "0:25" : "—",
                  reference ? "151 minutes of talk time" : "No duration data available",
                ],
                [
                  "Calls per positive lead",
                  reference ? "42.1" : "—",
                  reference ? "1,390 calls placed" : "No result breakdown available",
                ],
                [
                  "Connected AI minutes",
                  reference ? "153" : "—",
                  reference ? "369 calls connected" : "No connected-call data available",
                ],
              ].map(([label, value, note]) => (
                <article key={label} className="rounded-lg border border-border bg-card p-5">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="my-2 text-3xl font-semibold">{value}</p>
                  <p className="text-xs text-muted-foreground">{note}</p>
                </article>
              ))}
            </div>
          </section>
          <div className="grid gap-8 xl:grid-cols-[1.3fr_1fr]">
            <section>
              <SectionTitle>From first dial to follow-up</SectionTitle>
              <div className="space-y-4">
                {[
                  ["On the list", c.leads],
                  ["Dialled", reference ? 573 : 0],
                  ["Picked up", reference ? 279 : 0],
                  ["Real conversations", reference ? 55 : 0],
                  ["Positive leads", reference ? 33 : 0],
                  ["Meetings booked", reference ? 4 : 0],
                ].map(([label, count], i) => (
                  <div key={label}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="font-semibold tabular-nums">{fmt(Number(count))}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${i > 3 ? "bg-tint-3" : "bg-primary"}`}
                        style={{ width: `${c.leads ? (Number(count) / c.leads) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <SectionTitle>Retry pick-up rates</SectionTitle>
              <div className="space-y-5">
                {[
                  ["First attempt", 33, "190 / 573"],
                  ["Second attempt", 24, "109 / 445"],
                  ["Third or later", 19, "70 / 372"],
                ].map(([label, rate, count]) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="font-semibold">{reference ? `${rate}%` : "—"}</span>
                    </div>
                    <div className="my-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-tint-2"
                        style={{ width: `${reference ? rate : 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {reference ? count : "No retry data"}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="border-t border-border pt-6">
            <SectionTitle>Today’s activity</SectionTitle>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              {["Calls today", "Answered today", "AI minutes today", "Calls in the last hour"].map(
                (label) => (
                  <div key={label}>
                    <p className="text-2xl font-semibold">0</p>
                    <p className="text-sm text-muted-foreground">{label}</p>
                  </div>
                ),
              )}
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              {reference ? "1,954 calls remaining · " : ""}No recent calling activity to estimate
              completion.
            </p>
          </section>
          <section className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Phone />
            </span>
            <div className="flex-1">
              <p className="font-medium">Outbound number distribution</p>
              <p className="text-sm text-muted-foreground">+91 95138 86363</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold">{fmt(c.calls)} calls</p>
              <p className="text-xs text-muted-foreground">100% across 1 number</p>
            </div>
          </section>
        </TabsContent>
        <TabsContent value="pipeline" className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
            <p className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-tint-5" />
              {c.status === "Active"
                ? "Active · live dialling not connected yet"
                : `Campaign ${c.status.toLowerCase()}`}
            </p>
            <span className="text-xs text-muted-foreground">0 of 1 calling line busy</span>
          </div>
          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <SectionTitle>On a call now</SectionTitle>
              <div className="flex h-48 flex-col items-center justify-center gap-3 border-y border-dashed border-border text-muted-foreground">
                <PhoneCall className="h-8 w-8 text-primary/40" />
                <p className="text-sm">No call in progress</p>
              </div>
            </section>
            <section>
              <div className="flex justify-between">
                <SectionTitle>Next in line</SectionTitle>
                <span className="text-sm text-primary">
                  {reference
                    ? 665
                    : c.rows.filter((l) => l.queue !== "Done" && l.queue !== "Exhausted")
                        .length}{" "}
                  waiting
                </span>
              </div>
              {c.rows
                .filter(
                  (l) =>
                    l.queue === "Retry scheduled" ||
                    l.queue === "Callback scheduled" ||
                    l.queue === "Queued",
                )
                .slice(0, 3)
                .map((l) => (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-4"
                  >
                    <div>
                      <p className="text-sm font-medium">{l.phone}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {l.queue} · attempt {l.attempts + 1} of {c.rules.maxTries}
                      </p>
                    </div>
                    <CalendarClock className="h-4 w-4 text-primary" />
                  </div>
                ))}
            </section>
          </div>
          <section>
            <SectionTitle>Queue overview</SectionTitle>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              {queueStates.map((s, i) => (
                <Button
                  key={s}
                  variant="outline"
                  className="h-auto min-h-24 flex-col items-start gap-3 whitespace-normal bg-card p-4"
                  onClick={() => {
                    setQueue(s);
                    setPage(0);
                    setTab("leads");
                  }}
                >
                  <span className="text-xs text-muted-foreground">{s}</span>
                  <span className="text-2xl font-semibold">{fmt(queueCounts[i] ?? 0)}</span>
                </Button>
              ))}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="leads" className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <Input
              aria-label="Search leads"
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="min-w-40 flex-1 bg-card"
            />
            <Picker
              label="Lead outcome"
              value={outcome}
              onChange={(v) => {
                setOutcome(v);
                setPage(0);
              }}
              options={[
                ["All", "Any outcome"],
                ...Array.from(new Set(c.rows.map((l) => l.outcome))).map((s) => [s, s]),
              ]}
              className="w-44"
            />
            <Picker
              label="Lead queue"
              value={queue}
              onChange={(v) => {
                setQueue(v);
                setPage(0);
              }}
              options={[["All", "Any queue state"], ...queueStates.map((s) => [s, s])]}
              className="w-48"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} lead records available · {fmt(c.leads)} total leads
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Lead / phone",
                    "Outcome",
                    "Ended by",
                    "Queue",
                    "Last call",
                    "Attempts",
                    "Next follow-up",
                  ].map((s) => (
                    <th key={s} className="px-4 py-3 font-medium">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-4">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.phone}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs ${outcomeBadgeClass(l.outcome)}`}
                      >
                        {l.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{l.endedBy}</td>
                    <td className="px-4 py-4">
                      <Status value={l.queue} />
                    </td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">{l.lastCall}</td>
                    <td className="px-4 py-4">
                      {l.attempts} / {c.rules.maxTries}
                    </td>
                    <td className="px-4 py-4 text-xs">{l.followUp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="p-10 text-center text-sm text-muted-foreground">
                No leads match these filters.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 5))}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous leads"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next leads"
                disabled={(page + 1) * 5 >= filtered.length}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionTitle>
                <span className="flex items-center gap-2">
                  <Mic className="h-5 w-5 text-primary" />
                  AI voice settings
                </span>
              </SectionTitle>
              <dl className="space-y-5">
                {[
                  ["Agent persona", c.persona],
                  ["Voice", c.voice],
                  ["Outcomes used", c.setup?.outcomes.join(", ") ?? "All outcomes"],
                ].map(([k, v]) => (
                  <div key={k} className="space-y-1 border-b border-border pb-4">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-sm font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <SectionTitle>
                <span className="flex items-center gap-2">
                  <ListOrdered className="h-5 w-5 text-primary" />
                  Calling rules
                </span>
              </SectionTitle>
              <dl className="space-y-4">
                {[
                  ["Calling hours", `${c.rules.start} – ${c.rules.end}`],
                  ["Working days", c.rules.days],
                  [
                    "Retry outcomes",
                    c.setup?.retryOutcomes.join(", ") ||
                      (c.setup ? "None" : "Not picked up, Voicemail, Inconclusive, Callback"),
                  ],
                  ["Maximum attempts", `${c.rules.maxTries} tries`],
                  ["Retry gap", `${c.rules.retryGap} minutes`],
                  ["Callback window", `${c.rules.callbackWindow} days`],
                  [
                    "Campaign start",
                    c.setup?.startMode === "scheduled"
                      ? `${c.setup.scheduledAt.replace("T", " · ")} IST`
                      : "Immediate",
                  ],
                  [
                    "Retry mode",
                    c.setup?.retryMode === "scheduled"
                      ? `Scheduled · ${c.setup.retryStart} – ${c.setup.retryEnd}`
                      : "Immediate",
                  ],
                  [
                    "Credit cap",
                    c.setup?.creditCap != null ? `${c.setup.creditCap} minutes` : "No cap",
                  ],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex flex-wrap justify-between gap-2 border-b border-border pb-3 text-sm"
                  >
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="max-w-64 text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={test} onOpenChange={setTest}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test your campaign</DialogTitle>
            <DialogDescription>
              Test the campaign’s saved persona and voice on a number you choose.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Agent: {c.persona}
            <br />
            Voice: {c.voice}
          </p>
          <TestOutboundCallCard campaignId={c.id} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
