import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  ListOrdered,
  Megaphone,
  PhoneCall,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Picker } from "./CampaignControls";
import { Status } from "./CampaignDetail";
import { downloadCsv, queueStates, type Campaign } from "@/lib/campaigns";
import { campaignFromRow, leadFromRow } from "@/lib/campaigns.adapter";
import { listCampaigns, type CampaignCallStats } from "@/lib/campaigns.functions";
import { listLeads } from "@/lib/leads.functions";
import {
  filterVoiceLeads,
  outcomeBreakdown,
  pendingVoiceLeads,
  voiceOutcomes,
} from "@/lib/voice-leads";

const fmt = (n: number) => n.toLocaleString("en-IN");
const emptyStats: CampaignCallStats = { calls: 0, minutes: 0, interested: 0 };
const outcomeTint: Record<string, string> = {
  Interested: "bg-tint-3",
  "Meeting booked": "bg-tint-4",
  Callback: "bg-tint-5",
  "Info requested": "bg-tint-2",
  "No requirement": "bg-tint-2",
  "Not picked up": "bg-tint-5",
  Voicemail: "bg-tint-4",
  "Short hangup": "bg-tint-6",
  "Not interested": "bg-tint-6",
  Inconclusive: "bg-primary",
  "Call failed": "bg-destructive",
  "Not called": "bg-muted-foreground/30",
};

/** The pipeline of every campaign: who was called, how it ended and who is waiting. Read-only;
 * campaigns themselves are created/edited on the Campaigns tab of this same page. */
export function VoiceLeads({ onManageCampaigns }: { onManageCampaigns: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState("All");
  const [outcome, setOutcome] = useState("All");
  const [page, setPage] = useState(0);

  const list = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaigns(),
    refetchInterval: (q) =>
      q.state.data?.campaigns.some((c) => c.status === "Active") ? 10_000 : false,
  });
  const rowsFor = list.data?.campaigns ?? [];
  const activeId = rowsFor.some((c) => c.id === selected) ? selected : (rowsFor[0]?.id ?? null);
  const leadsQuery = useQuery({
    queryKey: ["leads", activeId],
    queryFn: () => listLeads({ data: { campaignId: activeId! } }),
    enabled: activeId !== null,
    refetchInterval: rowsFor.some((c) => c.status === "Active") ? 10_000 : false,
  });

  const toCampaign = (rowId: string, withLeads = false): Campaign | undefined => {
    const row = rowsFor.find((c) => c.id === rowId);
    if (!row) return undefined;
    return campaignFromRow(
      row,
      list.data?.leadCounts[row.id] ?? 0,
      list.data?.callStats[row.id] ?? emptyStats,
      withLeads ? (leadsQuery.data?.leads ?? []).map(leadFromRow) : [],
    );
  };
  const reset = () => {
    setQuery("");
    setQueue("All");
    setOutcome("All");
    setPage(0);
  };

  if (list.isLoading)
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">Loading your voice leads…</p>
    );
  if (list.isError) {
    return (
      <div className="py-16 text-center">
        <p role="alert" className="text-sm text-destructive">
          Couldn't load your campaigns.
        </p>
        <Button variant="link" onClick={() => list.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!list.data?.client) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Your account isn't linked to a workspace yet.
      </p>
    );
  }

  const campaigns = rowsFor.map((row) => toCampaign(row.id)!);
  const c = activeId ? toCampaign(activeId, true) : undefined;

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Your conversation pipeline</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Voice Leads<span className="text-primary">.</span>
        </h1>
      </div>
      <Button variant="outline" onClick={onManageCampaigns}>
        <Megaphone />
        Manage campaigns
      </Button>
    </header>
  );

  if (!c) {
    return (
      <div className="space-y-8">
        {header}
        <div className="py-16 text-center">
          <Megaphone className="mx-auto mb-3 h-7 w-7 text-primary/50" />
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Create a campaign and add leads on the Campaigns page. Their progress appears here.
          </p>
        </div>
      </div>
    );
  }

  const leadsLoading = leadsQuery.isPending;
  const pending = pendingVoiceLeads(c.rows);
  const filtered = filterVoiceLeads(c.rows, query, outcome, queue);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const count = (o: string) => c.rows.filter((l) => l.outcome === o).length;
  const called = c.rows.filter((l) => l.attempts > 0).length;
  const total = c.rows.length;

  return (
    <div className="space-y-8">
      {header}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Campaigns</h2>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search voice campaigns"
              className="bg-card pl-9"
              placeholder="Find a campaign…"
              value={campaignQuery}
              onChange={(e) => setCampaignQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {campaigns
            .filter((item) => item.name.toLowerCase().includes(campaignQuery.toLowerCase()))
            .map((item) => (
              <Button
                key={item.id}
                variant="outline"
                aria-pressed={activeId === item.id}
                onClick={() => {
                  setSelected(item.id);
                  reset();
                }}
                className={`h-auto w-60 shrink-0 flex-col items-start gap-3 whitespace-normal p-4 text-left ${activeId === item.id ? "border-primary bg-primary/5" : "bg-card"}`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-base font-semibold">{item.name}</span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${item.status === "Active" ? "bg-tint-3" : item.status === "Completed" ? "bg-muted-foreground" : "bg-tint-5"}`}
                  />
                </div>
                <span className="text-xs font-normal text-muted-foreground">{item.purpose}</span>
                <span className="flex w-full justify-between gap-2 text-xs font-normal">
                  <span>{fmt(item.leads)} leads</span>
                  <span>{fmt(item.calls)} calls</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.status} · {item.created}
                </span>
              </Button>
            ))}
        </div>
      </section>

      <section className="space-y-5 border-t border-border pt-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">{c.name}</h2>
            <Status value={c.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {c.purpose} · Created {c.created}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 xl:grid-cols-4">
          {[
            { label: "Total leads", value: c.leads, icon: Users, color: "text-primary" },
            { label: "Called", value: called, icon: PhoneCall, color: "text-tint-2" },
            {
              label: "Interested",
              value: count("Interested"),
              icon: UserCheck,
              color: "text-tint-3",
            },
            {
              label: "Appointments",
              value: count("Meeting booked"),
              icon: CalendarClock,
              color: "text-tint-4",
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="flex gap-3">
              <Icon className={`mt-1 h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {leadsLoading ? "…" : fmt(value)}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {leadsQuery.isError ? (
        <div className="py-8 text-center">
          <p role="alert" className="text-sm text-destructive">
            Couldn't load this campaign's leads.
          </p>
          <Button variant="link" onClick={() => leadsQuery.refetch()}>
            Try again
          </Button>
        </div>
      ) : leadsLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading leads…</p>
      ) : total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          This campaign has no leads yet. Add them on the Campaigns page.
        </p>
      ) : (
        <>
          <section className="grid gap-8 xl:grid-cols-[1fr_1.25fr]">
            <div>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <ListOrdered className="h-5 w-5 text-tint-2" />
                  Next in line
                </h2>
                <span className="text-sm font-semibold text-primary">
                  {fmt(pending.length)} waiting
                </span>
              </div>
              <ol>
                {pending.slice(0, 4).map((l, i) => (
                  <li key={l.id} className="flex items-center gap-3 border-b border-border py-3">
                    <span className="w-5 shrink-0 text-xs text-muted-foreground">0{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {l.name === "—" ? l.phone : l.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {l.queue} · try {Math.min(l.attempts + 1, c.rules.maxTries)} of{" "}
                        {c.rules.maxTries}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {l.followUp === "—" ? "Waiting" : l.followUp}
                    </span>
                  </li>
                ))}
              </ol>
              {!pending.length && (
                <p className="py-8 text-sm text-muted-foreground">No leads are waiting.</p>
              )}
              <Button
                variant="link"
                className="mt-2 px-0"
                disabled={!pending.length}
                onClick={() => {
                  setQueue("Pending");
                  setOutcome("All");
                  setQuery("");
                  setPage(0);
                }}
              >
                View all waiting leads <ChevronRight />
              </Button>
            </div>
            <div>
              <h2 className="mb-4 text-lg font-semibold">Queue overview</h2>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {queueStates.map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    aria-pressed={queue === q}
                    className={`h-auto min-h-20 flex-col items-start gap-2 whitespace-normal p-4 text-left ${queue === q ? "border-primary bg-primary/5" : "bg-card"}`}
                    onClick={() => {
                      setQueue(q);
                      setOutcome("All");
                      setQuery("");
                      setPage(0);
                    }}
                  >
                    <span className="text-xs text-muted-foreground">{q}</span>
                    <span className="text-2xl font-semibold">
                      {fmt(c.rows.filter((l) => l.queue === q).length)}
                    </span>
                  </Button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {c.rules.maxTries} maximum tries per lead
              </p>
            </div>
          </section>

          <section className="border-t border-border pt-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">How conversations ended</h2>
              <span className="text-xs text-muted-foreground">Latest result per lead</span>
            </div>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              {outcomeBreakdown(c.rows).map((o) => (
                <div key={o.name}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span>{o.name}</span>
                    <span className="font-medium tabular-nums">
                      {fmt(o.value)}
                      <span className="ml-3 text-xs font-normal text-muted-foreground">
                        {Math.round((o.value / total) * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${outcomeTint[o.name] ?? "bg-primary"}`}
                      style={{ width: `${(o.value / total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="scroll-mt-6 space-y-4 border-t border-border pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Lead directory</h2>
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv(`${c.name}-voice-leads.csv`, [
                    ["Name", "Number", "Outcome", "Queue", "Attempts", "Next follow-up"],
                    ...filtered.map((l) => [
                      l.name,
                      l.phone,
                      l.outcome,
                      l.queue,
                      String(l.attempts),
                      l.followUp,
                    ]),
                  ])
                }
              >
                <Download />
                Export leads
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="relative min-w-40 flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search voice leads"
                  className="bg-card pl-9"
                  placeholder="Search name or number…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <Picker
                label="Voice lead outcome"
                value={outcome}
                onChange={(v) => {
                  setOutcome(v);
                  setPage(0);
                }}
                options={[["All", "Any outcome"], ...voiceOutcomes.map((o) => [o, o])]}
                className="w-full sm:w-44"
              />
              <Picker
                label="Voice lead queue"
                value={queue}
                onChange={(v) => {
                  setQueue(v);
                  setPage(0);
                }}
                options={[
                  ["All", "Any queue"],
                  ["Pending", "All waiting"],
                  ...queueStates.map((q) => [q, q]),
                ]}
                className="w-full sm:w-48"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {filtered.length
                ? `Showing ${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, filtered.length)} of ${fmt(filtered.length)} leads`
                : "No matching leads"}
            </p>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    {["Lead / number", "Outcome", "Queue", "Attempts", "Next follow-up"].map(
                      (h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-4 py-4">
                        <p className="font-medium">{l.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{l.phone}</p>
                      </td>
                      <td className="px-4 py-4">{l.outcome}</td>
                      <td className="px-4 py-4">
                        <Status value={l.queue} />
                      </td>
                      <td className="px-4 py-4 tabular-nums">
                        {l.attempts} / {c.rules.maxTries}
                      </td>
                      <td className="px-4 py-4 text-xs">{l.followUp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <div className="p-10 text-center">
                  <p className="text-sm text-muted-foreground">No leads match these filters.</p>
                  <Button variant="link" onClick={reset}>
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={queue === "All" && outcome === "All" && !query}
              >
                Clear filters
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Page {currentPage + 1} of {pages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous voice leads"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next voice leads"
                  disabled={currentPage + 1 >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
