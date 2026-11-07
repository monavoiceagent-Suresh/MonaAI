import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  PlayCircle,
  PauseCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { campaignStatuses } from "@/lib/campaigns";
import {
  getCampaignSummary,
  getTenantCampaignCounts,
  listAllCampaigns,
} from "@/lib/super-admin-campaigns.functions";

const fmt = (n: number) => n.toLocaleString("en-IN");

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Megaphone;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-6 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    Active: "bg-tint-3-soft text-tint-3",
    Paused: "bg-tint-5-soft text-tint-5",
    Completed: "bg-muted text-muted-foreground",
    Scheduled: "bg-tint-2-soft text-tint-2",
    "Out of credits": "bg-tint-6-soft text-tint-6",
    "Credit cap reached": "bg-tint-6-soft text-tint-6",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone[status] ?? "bg-muted text-muted-foreground"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/** Read-only by design: no create/edit/start/stop/lead-management action exists anywhere on
 * this page. Campaign operations stay exclusively in the Tenant Admin dashboard. */
export function CampaignsOverview() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | (typeof campaignStatuses)[number]>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const summary = useQuery({
    queryKey: ["super-admin-campaign-summary"],
    queryFn: () => getCampaignSummary(),
  });
  const tenantCounts = useQuery({
    queryKey: ["super-admin-tenant-campaign-counts"],
    queryFn: () => getTenantCampaignCounts(),
  });
  const campaigns = useQuery({
    queryKey: ["super-admin-campaigns", query, status, page],
    queryFn: () => listAllCampaigns({ data: { search: query || undefined, status, page } }),
  });

  const totalPages = campaigns.data
    ? Math.max(1, Math.ceil(campaigns.data.total / campaigns.data.pageSize))
    : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Campaigns</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only overview across every tenant. Start, pause and edit from the tenant's own
          dashboard.
        </p>
      </div>

      {summary.isError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn't load campaign totals.
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Megaphone}
            label="Total campaigns"
            value={summary.isLoading ? "…" : fmt(summary.data?.total ?? 0)}
          />
          <StatCard
            icon={PlayCircle}
            label="Active"
            value={summary.isLoading ? "…" : fmt(summary.data?.active ?? 0)}
          />
          <StatCard
            icon={PauseCircle}
            label="Paused"
            value={summary.isLoading ? "…" : fmt(summary.data?.paused ?? 0)}
          />
          <StatCard
            icon={CheckCircle2}
            label="Completed"
            value={summary.isLoading ? "…" : fmt(summary.data?.completed ?? 0)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by campaign or tenant name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search campaigns"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {campaignStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {campaigns.isLoading ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading campaigns…</p>
        ) : campaigns.isError ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" /> Couldn't load campaigns.
            <button className="font-semibold underline" onClick={() => campaigns.refetch()}>
              Try again
            </button>
          </div>
        ) : !campaigns.data || campaigns.data.campaigns.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query || status !== "all" ? "No campaigns match your filters." : "No campaigns yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-5 py-3 font-medium">Tenant</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Leads</th>
                  <th className="px-5 py-3 font-medium">Calls</th>
                  <th className="px-5 py-3 font-medium">Interested</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.data.campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-4 font-medium text-foreground">{c.name}</td>
                    <td className="px-5 py-4 text-muted-foreground">{c.tenantName}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{fmt(c.leadCount)}</td>
                    <td className="px-5 py-4 text-muted-foreground">{fmt(c.callCount)}</td>
                    <td className="px-5 py-4 text-muted-foreground">{fmt(c.interestedCount)}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {campaigns.data && campaigns.data.total > campaigns.data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {fmt(campaigns.data.total)} campaigns
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-foreground">Campaigns per tenant</h2>
        {tenantCounts.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : tenantCounts.isError ? (
          <p className="mt-3 text-sm text-destructive">Couldn't load tenant counts.</p>
        ) : !tenantCounts.data || tenantCounts.data.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {tenantCounts.data.map((t) => (
              <li key={t.tenantId} className="flex items-center justify-between py-2 text-sm">
                <span className="text-foreground">{t.tenantName}</span>
                <span className="font-medium text-muted-foreground">{fmt(t.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
