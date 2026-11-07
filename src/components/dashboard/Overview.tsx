import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Megaphone,
  Users,
  Timer,
  PhoneMissed,
  PhoneCall,
  PhoneForwarded,
  UserCheck,
  Phone,
  CalendarClock,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { getWorkspaceOverview } from "@/lib/workspace.functions";
import { useAuthSession } from "@/lib/auth";
import { formatCallDate } from "@/lib/call-records";

const RANGES = ["Today", "7 days", "30 days"] as const;
type Range = (typeof RANGES)[number];
const rangeParam: Record<Range, "today" | "7d" | "30d"> = {
  Today: "today",
  "7 days": "7d",
  "30 days": "30d",
};

const fmt = (n: number) => n.toLocaleString("en-IN");

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-border bg-card p-6 shadow-soft ${className}`}>
      {children}
    </section>
  );
}
function Head({
  icon: Icon,
  title,
  sub,
  right,
}: {
  icon: typeof Phone;
  title: string;
  sub: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

export function Overview() {
  const [range, setRange] = useState<Range>("Today");
  const overview = useQuery({
    queryKey: ["workspace-overview", rangeParam[range]],
    queryFn: () => getWorkspaceOverview({ data: rangeParam[range] }),
  });
  const loading = overview.isLoading;
  const client = overview.data?.client ?? null;
  const calls = overview.data?.calls ?? { made: 0, connected: 0, interested: 0 };
  const bars = overview.data?.bars ?? [];
  const totals = overview.data?.totals ?? { activeCampaigns: 0, leads: 0, callbackRequests: 0 };
  const campaigns = overview.data?.campaignPerformance ?? [];
  const callbacks = overview.data?.callbacks ?? [];
  const mostCalls = Math.max(1, ...campaigns.map((c) => c.calls));
  const maxBar = Math.max(1, ...bars.map((b) => b.count));
  const connPct = calls.made ? Math.round((calls.connected / calls.made) * 100) : 0;
  const intPct = calls.connected ? Math.round((calls.interested / calls.connected) * 100) : 0;
  const ring = 2 * Math.PI * 52;
  const { user } = useAuthSession();
  const greetingName = user?.fullName || user?.email.split("@")[0] || "there";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Good evening, {greetingName}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Your calls, <span className="font-light italic text-foreground/70">at a glance.</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground sm:inline-flex">
            <Phone className="h-4 w-4 text-primary" /> +91 95138 86363
          </span>
          <div className="inline-flex rounded-full border border-border bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Bento: credits ring (real clients.credit_balance) + key totals */}
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <div className="relative h-32 w-32 shrink-0">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                strokeWidth="10"
                className="stroke-muted"
              />
              {client && (
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  className="stroke-primary transition-all duration-700"
                  strokeDasharray={ring}
                  strokeDashoffset={0}
                />
              )}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  {loading ? "…" : client ? fmt(client.creditBalance) : "—"}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  minutes
                </p>
              </div>
            </div>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Timer className="h-3.5 w-3.5" /> AI minutes left
            </p>
            {overview.isError ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Couldn't load your balance.
                <button className="font-semibold underline" onClick={() => overview.refetch()}>
                  Try again
                </button>
              </p>
            ) : !loading && !client ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Your account isn't linked to a workspace yet.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Current balance from your workspace's credit ledger.
              </p>
            )}
          </div>
        </Card>

        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              icon: Megaphone,
              value: loading ? "…" : fmt(totals.activeCampaigns),
              label: "Active campaigns",
              sub: "Started and calling now",
            },
            {
              icon: Users,
              value: loading ? "…" : fmt(totals.leads),
              label: "Leads uploaded",
              sub: "Across all your campaigns",
            },
            {
              icon: PhoneMissed,
              value: loading ? "…" : fmt(totals.callbackRequests),
              label: "Callback requests",
              sub: "People who asked to be called back",
            },
          ].map(({ icon: Icon, value, label, sub }) => (
            <Card key={label} className="group relative overflow-hidden">
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 transition-transform duration-500 group-hover:scale-150" />
              <Icon className="h-5 w-5 text-primary" />
              <p className="mt-6 text-3xl font-semibold text-foreground">{value}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Activity: funnel + chart — real rows from the `calls` table, scoped to this workspace */}
      <Card>
        <Head
          icon={BarChart3}
          title="Calling activity"
          sub={`From dialled to interested · ${range}`}
        />
        {overview.isError ? (
          <p className="flex items-center gap-2 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn't load calling activity.
            <button className="font-semibold underline" onClick={() => overview.refetch()}>
              Try again
            </button>
          </p>
        ) : !loading && !client ? (
          <p className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
            Your account isn't linked to a workspace yet, so there's no call history to show.
          </p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-3">
              {[
                { icon: PhoneCall, label: "Calls made", value: calls.made, pct: 100, note: range },
                {
                  icon: PhoneForwarded,
                  label: "Connected",
                  value: calls.connected,
                  pct: connPct,
                  note: `${connPct}% picked up`,
                },
                {
                  icon: UserCheck,
                  label: "Interested",
                  value: calls.interested,
                  pct: Math.max(intPct, calls.connected ? 6 : 0),
                  note: `${intPct}% of connected`,
                },
              ].map(({ icon: Icon, label, value, pct, note }, i) => (
                <div
                  key={label}
                  className="rounded-2xl bg-background p-4"
                  style={{ marginLeft: `${i * 6}%` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="h-4 w-4 text-primary" /> {label}
                    </span>
                    <span className="text-xs text-muted-foreground">{note}</span>
                  </div>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {loading ? "…" : fmt(value)}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col">
              <div
                className="flex flex-1 items-end gap-2 border-b border-border pb-2"
                style={{ minHeight: 220 }}
              >
                {bars.map((b, i) => (
                  <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
                    <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] text-background opacity-0 transition group-hover:opacity-100">
                      {fmt(b.count)}
                    </span>
                    <div
                      className="rounded-t-lg bg-primary/25 transition-all duration-700 group-hover:bg-primary"
                      style={{ height: `${((b.count / maxBar) * 90).toFixed(2)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2 overflow-hidden">
                {bars.map((b) => (
                  <span
                    key={b.label}
                    className="flex-1 truncate text-center text-[11px] text-muted-foreground"
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Campaigns + callbacks: real records from this workspace */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <Head
            icon={Megaphone}
            title="Campaign performance"
            sub="Your newest campaigns, from their leads and calls"
          />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No campaigns yet. Create one on the Campaigns page.
            </p>
          ) : (
            <div className="space-y-5">
              {campaigns.map((c) => {
                const rate = c.calls ? (c.interested / c.calls) * 100 : 0;
                return (
                  <div key={c.id}>
                    <div className="flex items-baseline justify-between">
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-sm">
                        <span className="font-semibold text-primary">{c.interested}</span>{" "}
                        <span className="text-muted-foreground">interested</span>
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmt(c.leads)} leads · {fmt(c.calls)} calls
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.min(100, (c.calls / mostCalls) * 100)}%`,
                          opacity: (0.4 + Math.min(rate, 1) * 0.6).toFixed(2),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <Head
            icon={CalendarClock}
            title="Callback requests"
            sub="The newest people who asked to be called back"
          />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : callbacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No callback requests yet. They appear when a conversation ends with a request to be
              called back.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-6">
              {callbacks.map((c) => (
                <li key={c.id} className="relative">
                  <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                  <div className="flex items-start justify-between gap-3 rounded-2xl bg-background p-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {c.contact || "Withheld number"}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {c.summary ||
                          (c.direction === "inbound" ? "Inbound call" : "Campaign call")}
                      </p>
                    </div>
                    <p className="shrink-0 text-right text-xs text-muted-foreground">
                      {formatCallDate(c.date)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
