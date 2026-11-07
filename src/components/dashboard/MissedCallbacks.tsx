import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  Download,
  Megaphone,
  PhoneMissed,
  PhoneCall,
  Search,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Picker } from "./CampaignControls";
import { NoteDialog, RecordPagination, dateOptions } from "./CallRecordControls";
import { downloadCsv } from "@/lib/campaigns";
import { formatCallDate, type CallRecordView, type DateRange } from "@/lib/call-records";
import { CALLBACK_OUTCOME } from "@/lib/outcomes";
import { exportCalls, listCalls } from "@/lib/calls.functions";

const callbackFilters = {
  direction: "all",
  outcome: CALLBACK_OUTCOME,
  duration: "All",
  campaignId: "All",
} as const;

/** Contacts whose conversation ended with a request to be called back, from inbound calls and campaigns alike. */
export function MissedCallbacks() {
  const [range, setRange] = useState<DateRange>("All");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [number, setNumber] = useState("All");
  const [page, setPage] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<CallRecordView | null>(null);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = { ...callbackFilters, range, query, dialled: number };
  const calls = useQuery({
    queryKey: ["calls", "callbacks", filters, page],
    queryFn: () => listCalls({ data: { ...filters, page } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const data = calls.data;
  const filtered = range !== "All" || query !== "" || number !== "All";
  const clear = () => {
    setRange("All");
    setSearch("");
    setQuery("");
    setNumber("All");
    setPage(0);
  };

  const download = async () => {
    setExportError("");
    try {
      const rows = await exportCalls({ data: filters });
      downloadCsv("mona-callback-requests.csv", [
        [
          "Contact",
          "Name",
          "Source",
          "Number dialled",
          "Campaign",
          "What they said",
          "Note",
          "Time",
        ],
        ...rows.map((r) => [
          r.contact,
          r.name === "—" ? "" : r.name,
          r.direction,
          r.dialled ?? "",
          r.campaign ?? "",
          r.summary,
          notes[r.id] ?? "",
          r.date,
        ]),
      ]);
    } catch {
      setExportError("The download couldn't be prepared. Try again in a moment.");
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Return conversations</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Missed Callbacks<span className="text-primary">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-xs text-muted-foreground">
            People who asked to be called back, from calls to your numbers and from your campaigns.
            Calls that were refused before connecting (no free line, a number switched off) are not
            recorded yet.
          </p>
        </div>
        <Button variant="outline" disabled={!data?.total} onClick={download}>
          <Download />
          Download CSV
        </Button>
      </header>
      {exportError && (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      )}

      {calls.isPending ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Loading callback requests…
        </p>
      ) : calls.isError || !data ? (
        <div className="py-16 text-center">
          <p role="alert" className="text-sm text-destructive">
            Couldn't load your callback requests.
          </p>
          <Button variant="link" onClick={() => calls.refetch()}>
            Try again
          </Button>
        </div>
      ) : !data.client ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Your account isn't linked to a workspace yet.
        </p>
      ) : (
        <>
          <section className="grid gap-8 border-y border-border py-6 xl:grid-cols-[1fr_1.5fr]">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-tint-5-soft text-tint-5">
                <PhoneMissed className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">Keep the context ready.</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Each request shows what was said, so the next conversation can pick up where it
                  stopped.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                {
                  label: "Callback requests",
                  value: data.total,
                  icon: PhoneCall,
                  tint: "text-primary",
                },
                {
                  label: "From inbound calls",
                  value: data.byDirection.inbound,
                  icon: ArrowDownLeft,
                  tint: "text-tint-2",
                },
                {
                  label: "From campaigns",
                  value: data.byDirection.outbound,
                  icon: Megaphone,
                  tint: "text-tint-4",
                },
              ].map(({ label, value, icon: Icon, tint }) => (
                <div key={label}>
                  <Icon className={`mb-3 h-4 w-4 ${tint}`} />
                  <p className="text-3xl font-semibold tabular-nums">{value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Follow-up inbox</h2>
              <span className="text-xs text-muted-foreground">
                Newest first · notes stay on this page only
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="relative min-w-40 flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search callback requests"
                  className="bg-card pl-9"
                  placeholder="Find a name or number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Picker
                label="Callback date range"
                value={range}
                onChange={(v) => {
                  setRange(v as DateRange);
                  setPage(0);
                }}
                options={dateOptions}
                className="w-full sm:w-40"
              />
              <Picker
                label="Number dialled"
                value={number}
                onChange={(v) => {
                  setNumber(v);
                  setPage(0);
                }}
                options={[["All", "All your numbers"], ...data.numbers.map((n) => [n, n])]}
                className="w-full sm:w-52"
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    {["Contact", "From", "Received", "What they said", "Notes"].map((h) => (
                      <th key={h} className="px-5 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border transition-colors hover:bg-muted/30"
                    >
                      <td className="px-5 py-5">
                        <p className="font-medium">{r.name === "—" ? "Unknown contact" : r.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{r.contact || "—"}</p>
                      </td>
                      <td className="px-5 py-5 text-xs text-muted-foreground">
                        {r.direction === "inbound"
                          ? `Call to ${r.dialled ?? "your number"}`
                          : `Campaign ${r.campaign ?? ""}`.trim()}
                      </td>
                      <td className="px-5 py-5 text-xs">{formatCallDate(r.date)}</td>
                      <td className="max-w-72 px-5 py-5">
                        <p className="line-clamp-3 text-xs text-muted-foreground">
                          {r.summary || "No summary was recorded."}
                        </p>
                      </td>
                      <td className="w-56 px-5 py-5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {notes[r.id] || "No note yet"}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={notes[r.id] ? "Edit note" : "Add note"}
                            aria-label={`${notes[r.id] ? "Edit" : "Add"} note for ${r.contact}`}
                            onClick={() => setEditing(r)}
                          >
                            <StickyNote className="h-4 w-4 text-primary" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.total === 0 && (
                <div className="py-12 text-center">
                  <PhoneMissed className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
                  {filtered ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        No callback requests match your filters.
                      </p>
                      <Button variant="link" onClick={clear}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                      No callback requests yet. They appear here when a conversation ends with a
                      request to be called back.
                    </p>
                  )}
                </div>
              )}
            </div>
            <RecordPagination
              page={Math.min(page, Math.max(0, Math.ceil(data.total / 10) - 1))}
              total={data.total}
              onChange={setPage}
            />
          </section>
        </>
      )}

      {editing && (
        <NoteDialog
          key={editing.id}
          initial={notes[editing.id] ?? ""}
          contact={editing.contact || "this contact"}
          onClose={() => setEditing(null)}
          onSave={(note) => {
            setNotes((n) => ({ ...n, [editing.id]: note }));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
