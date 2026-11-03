import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Clock3,
  Download,
  FileText,
  Headphones,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  Search,
  StickyNote,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Picker } from "./CampaignControls";
import { NoteDialog, RecordPagination, dateOptions } from "./CallRecordControls";
import { downloadCsv } from "@/lib/campaigns";
import {
  callOutcomes,
  formatCallDate,
  formatDuration,
  type CallRecordView,
  type DateRange,
  type DurationBucket,
} from "@/lib/call-records";
import { exportCalls, getCallRecording, getCallTranscript, listCalls } from "@/lib/calls.functions";
import { AudioAction } from "./AudioAction";

type Direction = "inbound" | "outbound";

interface Filters {
  query: string;
  outcome: string;
  duration: DurationBucket;
  range: DateRange;
  campaignId: string;
  dialled: string;
}
const initialFilters: Filters = {
  query: "",
  outcome: "All",
  duration: "All",
  range: "All",
  campaignId: "All",
  dialled: "All",
};

const statusLabel = (status: string) =>
  status === "completed"
    ? "Completed"
    : status.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

function OutcomeBadge({ call }: { call: CallRecordView }) {
  const tone = ["Interested", "Meeting booked"].includes(call.outcome)
    ? "bg-tint-3-soft text-tint-3"
    : call.outcome === "Callback"
      ? "bg-tint-5-soft text-tint-5"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs ${tone}`}
      title={call.outcomeRaw ? `Reported by the voice engine as: ${call.outcomeRaw}` : undefined}
    >
      {call.outcome}
    </span>
  );
}

function Transcript({ call }: { call: CallRecordView }) {
  const transcript = useQuery({
    queryKey: ["call-transcript", call.id],
    queryFn: () => getCallTranscript({ data: { callId: call.id } }),
    enabled: call.transcriptAvailable,
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (!call.transcriptAvailable) {
    return <p className="text-sm text-muted-foreground">No transcript was kept for this call.</p>;
  }
  if (transcript.isPending)
    return <p className="text-sm text-muted-foreground">Loading transcript…</p>;
  if (transcript.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {transcript.error instanceof Error
          ? transcript.error.message
          : "The transcript couldn't be loaded."}
      </p>
    );
  }
  if (!transcript.data.available) {
    return (
      <p className="text-sm text-muted-foreground">The transcript isn't available for this call.</p>
    );
  }
  return (
    <ol className="max-h-72 space-y-3 overflow-y-auto text-sm">
      {transcript.data.turns.map((turn) => (
        <li key={turn.index} className="space-y-1">
          {turn.caller && (
            <p>
              <span className="font-medium">Caller:</span> {turn.caller}
            </p>
          )}
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Agent:</span> {turn.agent}
          </p>
        </li>
      ))}
    </ol>
  );
}

function CallDetails({ call, onClose }: { call: CallRecordView | null; onClose: () => void }) {
  return (
    <Dialog open={call !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        {call && (
          <>
            <DialogHeader>
              <DialogTitle>Conversation record</DialogTitle>
              <DialogDescription>
                {call.contact || "Unknown number"} · {formatCallDate(call.date)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 text-sm">
              <dl className="grid grid-cols-2 gap-4">
                {[
                  ["Direction", call.direction === "inbound" ? "Inbound" : "Outbound"],
                  ["Outcome", call.outcome],
                  ["Reported by the engine", call.outcomeRaw ?? "—"],
                  ["Status", statusLabel(call.status)],
                  ["Duration", formatDuration(call.duration)],
                  [
                    call.direction === "inbound" ? "Number dialled" : "Campaign",
                    (call.direction === "inbound" ? call.dialled : call.campaign) ?? "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-border pt-4">
                <h3 className="mb-2 font-medium">Summary</h3>
                <p className="text-muted-foreground">
                  {call.summary || "No summary was recorded for this call."}
                </p>
              </div>
              {call.collectedFields.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 font-medium">Details collected</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {call.collectedFields.map((field) => (
                      <div key={field.key} className="contents">
                        <dt className="text-muted-foreground">{field.key}</dt>
                        <dd className="break-words">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <div className="border-t border-border pt-4">
                <h3 className="mb-2 font-medium">Transcript</h3>
                <Transcript call={call} />
                <AudioAction key={call.id} label="Play recording" unavailable="Recording unavailable. Try again later."
                  load={() => getCallRecording({ data: { callId: call.id } })} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CallJournal({ direction }: { direction: Direction }) {
  const inbound = direction === "inbound";
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<CallRecordView | null>(null);
  const [detail, setDetail] = useState<CallRecordView | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // Search waits for a pause in typing so each keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.query === search.trim() ? f : { ...f, query: search.trim() }));
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };
  const reset = () => {
    setFilters(initialFilters);
    setSearch("");
    setPage(0);
  };
  const filtered = JSON.stringify(filters) !== JSON.stringify(initialFilters);

  const calls = useQuery({
    queryKey: ["calls", direction, filters, page],
    queryFn: () => listCalls({ data: { direction, ...filters, page } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const title = inbound ? "Inbound Calls" : "Outbound Calls";
  const Icon = inbound ? PhoneIncoming : PhoneOutgoing;
  const data = calls.data;

  const runExport = async () => {
    setExporting(true);
    setExportError("");
    try {
      const rows = await exportCalls({ data: { direction, ...filters } });
      downloadCsv(`mona-${direction}-calls.csv`, [
        [
          "Direction",
          "Contact",
          "Lead",
          "Campaign",
          "Number dialled",
          "Outcome",
          "Reported outcome",
          "Status",
          "Duration (seconds)",
          "Summary",
          "Note",
          "Date",
        ],
        ...rows.map((r) => [
          r.direction,
          r.contact,
          r.name === "—" ? "" : r.name,
          r.campaign ?? "",
          r.dialled ?? "",
          r.outcome,
          r.outcomeRaw ?? "",
          r.status,
          String(r.duration),
          r.summary,
          notes[r.id] ?? "",
          r.date,
        ]),
      ]);
    } catch {
      setExportError("The export couldn't be prepared. Try again in a moment.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Conversation history</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            {title}
            <span className="text-primary">.</span>
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Live records from your workspace. A call appears here once it has finished.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Picker
            label="Call date range"
            value={filters.range}
            onChange={(v) => change("range", v as DateRange)}
            options={dateOptions}
            className="w-40"
          />
          <Button variant="outline" disabled={exporting || !data?.total} onClick={runExport}>
            <Download />
            {exporting ? "Preparing…" : "Export"}
          </Button>
        </div>
      </header>
      {exportError && (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      )}

      {calls.isPending ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading calls…</p>
      ) : calls.isError || !data ? (
        <div className="py-16 text-center">
          <p role="alert" className="text-sm text-destructive">
            Couldn't load your calls.
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
          <section
            aria-label="Call summary"
            className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-border py-6 xl:grid-cols-4"
          >
            {[
              {
                label: inbound ? "Calls received" : "Calls made",
                value: data.stats.total,
                detail: "Matching your filters",
                icon: Icon,
                tint: "text-primary",
              },
              {
                label: "Connected",
                value: `${data.stats.rate}%`,
                detail: `${data.stats.connected} conversations`,
                icon: ArrowUpRight,
                tint: "text-tint-2",
              },
              {
                label: "Average talk time",
                value: formatDuration(data.stats.average),
                detail: "Per connected call",
                icon: Clock3,
                tint: "text-tint-4",
              },
              {
                label: "Interested",
                value: data.stats.interested,
                detail: "Positive conversations",
                icon: ThumbsUp,
                tint: "text-tint-3",
              },
            ].map(({ label, value, detail, icon: StatIcon, tint }) => (
              <div key={label}>
                <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <StatIcon className={`h-4 w-4 ${tint}`} />
                  {label}
                </div>
                <p className="text-3xl font-semibold tabular-nums">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
              </div>
            ))}
          </section>

          <section className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Call journal</h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={calls.isFetching}
                onClick={() => calls.refetch()}
              >
                <RefreshCw className={calls.isFetching ? "animate-spin" : ""} />
                Refresh
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search calls"
                  placeholder="Find a name or number…"
                  className="bg-card pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {inbound ? (
                <Picker
                  label="Number dialled"
                  value={filters.dialled}
                  onChange={(v) => change("dialled", v)}
                  options={[["All", "All your numbers"], ...data.numbers.map((n) => [n, n])]}
                />
              ) : (
                <Picker
                  label="Call campaign"
                  value={filters.campaignId}
                  onChange={(v) => change("campaignId", v)}
                  options={[["All", "All campaigns"], ...data.campaigns.map((c) => [c.id, c.name])]}
                />
              )}
              <Picker
                label="Call outcome"
                value={filters.outcome}
                onChange={(v) => change("outcome", v)}
                options={[["All", "All outcomes"], ...callOutcomes.map((o) => [o, o])]}
              />
              <Picker
                label="Call duration"
                value={filters.duration}
                onChange={(v) => change("duration", v as DurationBucket)}
                options={[
                  ["All", "Any duration"],
                  ["Short", "Under 30 seconds"],
                  ["Medium", "30–60 seconds"],
                  ["Long", "Over 60 seconds"],
                ]}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Notes are kept on this page only and are not saved.
            </p>

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Contact",
                      inbound ? "Number dialled" : "Campaign",
                      "Outcome",
                      "Status",
                      "Transcript",
                      "Notes",
                      "Date / time",
                      "Duration",
                      "Actions",
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
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
                      <td className="px-4 py-4">
                        <p className="font-medium">
                          {r.name === "—"
                            ? r.contact
                              ? "Unknown contact"
                              : "Withheld number"
                            : r.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{r.contact || "—"}</p>
                      </td>
                      <td className="px-4 py-4 text-xs">
                        {(inbound ? r.dialled : r.campaign) ?? "—"}
                      </td>
                      <td className="px-4 py-4">
                        <OutcomeBadge call={r} />
                      </td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">
                        {statusLabel(r.status)}
                      </td>
                      <td className="px-4 py-4">
                        {r.transcriptAvailable ? (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => setDetail(r)}
                          >
                            <Headphones className="h-3.5 w-3.5" />
                            Available
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </td>
                      <td className="max-w-40 px-4 py-4">
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {notes[r.id] || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">
                        {formatCallDate(r.date)}
                      </td>
                      <td className="px-4 py-4 tabular-nums">{formatDuration(r.duration)}</td>
                      <td className="px-3 py-4">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit note"
                            aria-label={`Edit note for ${r.contact}`}
                            onClick={() => setEditing(r)}
                          >
                            <StickyNote className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Call details"
                            aria-label={`Call details for ${r.contact}`}
                            onClick={() => setDetail(r)}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.total === 0 && (
                <div className="py-12 text-center">
                  <Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
                  {filtered ? (
                    <>
                      <p className="text-sm text-muted-foreground">No calls match these filters.</p>
                      <Button variant="link" onClick={reset}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                      {inbound
                        ? "No inbound calls yet. Calls to a published number appear here once they finish."
                        : "No outbound calls yet. Calls placed by a started campaign appear here as they finish."}
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
          contact={editing.contact || "this call"}
          onClose={() => setEditing(null)}
          onSave={(note) => {
            setNotes((n) => ({ ...n, [editing.id]: note }));
            setEditing(null);
          }}
        />
      )}
      <CallDetails call={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
