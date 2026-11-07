import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  PauseCircle,
  Coins,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  PhoneCall,
  PhoneMissed,
  Megaphone,
  Search,
  Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getBusinessOverview,
  getCreditAnalytics,
  getFinancialAnalytics,
  getOperationalSummary,
  getTenantBusinessAnalytics,
} from "@/lib/super-admin-analytics.functions";

const fmt = (n: number) => n.toLocaleString("en-IN");
const fmtSeconds = (s: number) => `${fmt(Math.round(s / 60))} min`;

function toISOStartOfDay(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}
function toISOEndOfDay(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  tone?: "destructive" | undefined;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <span
        className={`grid h-10 w-10 place-items-center rounded-2xl ${tone === "destructive" ? "bg-tint-6-soft text-tint-6" : "bg-primary/10 text-primary"}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-6 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
    </section>
  );
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

export function Analytics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const range = {
    from: from ? toISOStartOfDay(from) : undefined,
    to: to ? toISOEndOfDay(to) : undefined,
  };

  const overview = useQuery({
    queryKey: ["super-admin-business-overview", from, to],
    queryFn: () => getBusinessOverview({ data: range }),
  });
  const financial = useQuery({
    queryKey: ["super-admin-financial-analytics"],
    queryFn: () => getFinancialAnalytics(),
  });
  const credits = useQuery({
    queryKey: ["super-admin-credit-analytics", from, to],
    queryFn: () => getCreditAnalytics({ data: range }),
  });
  const operations = useQuery({
    queryKey: ["super-admin-operational-summary", from, to],
    queryFn: () => getOperationalSummary({ data: range }),
  });
  const tenants = useQuery({
    queryKey: ["super-admin-tenant-business-analytics", query, page],
    queryFn: () => getTenantBusinessAnalytics({ data: { search: query || undefined, page } }),
  });

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Business Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform performance, computed from real records. No number here is estimated or
            invented.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block text-xs font-medium text-muted-foreground">
            From
            <Input
              type="date"
              className="mt-1"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            To
            <Input
              type="date"
              className="mt-1"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {(from || to) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The date range affects activity figures below (adjustments, calls, campaigns created, the
        credit trend). Current balances and tenant counts are always as of right now.
      </p>

      {/* Step 2: Business Overview */}
      <section className="space-y-4">
        <SectionHeading
          title="Business Overview"
          sub="Tenants and platform-wide credit position."
        />
        {overview.isError ? (
          <p className="text-sm text-destructive">Couldn't load the business overview.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={Building2}
              label="Total tenants"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalTenants ?? 0)}
            />
            <KpiCard
              icon={CheckCircle2}
              label="Active tenants"
              value={overview.isLoading ? "…" : fmt(overview.data?.activeTenants ?? 0)}
            />
            <KpiCard
              icon={PauseCircle}
              label="Suspended tenants"
              value={overview.isLoading ? "…" : fmt(overview.data?.suspendedTenants ?? 0)}
            />
            <KpiCard
              icon={Coins}
              label="Total credit balance"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalCreditBalance ?? 0)}
            />
            <KpiCard
              icon={AlertTriangle}
              tone="destructive"
              label="Total negative balance"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalNegativeBalance ?? 0)}
            />
            <KpiCard
              icon={AlertTriangle}
              tone={
                overview.data && overview.data.tenantsWithNegativeBalance > 0
                  ? "destructive"
                  : undefined
              }
              label="Tenants with negative balance"
              value={overview.isLoading ? "…" : fmt(overview.data?.tenantsWithNegativeBalance ?? 0)}
            />
            <KpiCard
              icon={Coins}
              label="Credit adjustments"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalCreditAdjustments ?? 0)}
            />
          </div>
        )}
      </section>

      {/* Step 3: Financial Analytics */}
      <section className="space-y-4">
        <SectionHeading title="Financial Analytics" sub="Revenue, expenses and profitability." />
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 translate-y-0.5" />
          <p>
            {financial.data?.reason ??
              "No payment, purchase or expense records exist in this system."}
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {["Revenue", "Expenses", "Net profit"].map((label) => (
            <section
              key={label}
              className="rounded-3xl border border-dashed border-border bg-card p-6 text-center shadow-soft"
            >
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="mt-2 text-sm text-muted-foreground">Not available</p>
            </section>
          ))}
        </div>
      </section>

      {/* Step 5: Credit Analytics */}
      <section className="space-y-4">
        <SectionHeading
          title="Credit Analytics"
          sub="Manual ledger adjustments — never purchases or call consumption."
        />
        {credits.isError ? (
          <p className="text-sm text-destructive">Couldn't load credit analytics.</p>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={Coins}
                label="Total current balance"
                value={credits.isLoading ? "…" : fmt(credits.data?.totalCurrentBalance ?? 0)}
              />
              <KpiCard
                icon={AlertTriangle}
                tone="destructive"
                label="Total negative balance"
                value={credits.isLoading ? "…" : fmt(credits.data?.totalNegativeBalance ?? 0)}
              />
              <KpiCard
                icon={ArrowUpCircle}
                label="Manual additions"
                value={credits.isLoading ? "…" : fmt(credits.data?.totalPositiveAdjustments ?? 0)}
              />
              <KpiCard
                icon={ArrowDownCircle}
                label="Manual deductions"
                value={credits.isLoading ? "…" : fmt(credits.data?.totalNegativeAdjustments ?? 0)}
              />
              <KpiCard
                icon={ArrowDownCircle}
                label="Voice usage (automated)"
                value={credits.isLoading ? "…" : fmt(credits.data?.totalVoiceUsage ?? 0)}
              />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                <h3 className="text-sm font-semibold text-foreground">Tenant balance comparison</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  5 lowest and 5 highest current balances.
                </p>
                {credits.isLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {credits.data?.tenantComparison.map((t) => (
                      <li
                        key={t.tenantId}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <span className="text-foreground">{t.tenantName}</span>
                        <span
                          className={`font-medium ${t.creditBalance < 0 ? "text-tint-6" : "text-muted-foreground"}`}
                        >
                          {fmt(t.creditBalance)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                <h3 className="text-sm font-semibold text-foreground">Adjustment trend</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Daily totals within the selected range. Manual adjustments and automated voice
                  usage are shown separately — never combined.
                </p>
                {credits.isLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
                ) : !credits.data ||
                  credits.data.trend.every(
                    (p) => p.positive === 0 && p.negative === 0 && p.voiceUsage === 0,
                  ) ? (
                  <p className="mt-3 text-sm text-muted-foreground">No activity in this range.</p>
                ) : (
                  <div className="mt-3 max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="py-1 font-medium">Day</th>
                          <th className="py-1 font-medium">Manual +</th>
                          <th className="py-1 font-medium">Manual −</th>
                          <th className="py-1 font-medium">Voice usage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {credits.data.trend
                          .filter((p) => p.positive !== 0 || p.negative !== 0 || p.voiceUsage !== 0)
                          .map((p) => (
                            <tr key={p.label} className="border-t border-border">
                              <td className="py-1.5 text-muted-foreground">{p.label}</td>
                              <td className="py-1.5 text-tint-3">
                                {p.positive ? `+${fmt(p.positive)}` : "—"}
                              </td>
                              <td className="py-1.5 text-tint-6">
                                {p.negative ? `-${fmt(p.negative)}` : "—"}
                              </td>
                              <td className="py-1.5 text-muted-foreground">
                                {p.voiceUsage ? `-${fmt(p.voiceUsage)}` : "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </section>

      {/* Step 6: Operational Business Summary */}
      <section className="space-y-4">
        <SectionHeading
          title="Operational Summary"
          sub="Call and campaign activity — aggregates only, no transcripts or individual records."
        />
        {operations.isError ? (
          <p className="text-sm text-destructive">Couldn't load operational metrics.</p>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={PhoneCall}
                label="Total calls"
                value={operations.isLoading ? "…" : fmt(operations.data?.totalCalls ?? 0)}
              />
              <KpiCard
                icon={PhoneCall}
                label="Connected calls"
                value={operations.isLoading ? "…" : fmt(operations.data?.successfulCalls ?? 0)}
              />
              <KpiCard
                icon={PhoneMissed}
                label="Not connected"
                value={operations.isLoading ? "…" : fmt(operations.data?.failedCalls ?? 0)}
              />
              <KpiCard
                icon={Megaphone}
                label="Total call time"
                value={
                  operations.isLoading
                    ? "…"
                    : fmtSeconds(operations.data?.totalCallDurationSeconds ?? 0)
                }
              />
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={Megaphone}
                label="Campaigns"
                value={
                  operations.isLoading ? "…" : fmt(operations.data?.campaignSummary.total ?? 0)
                }
              />
              <KpiCard
                icon={Megaphone}
                label="Active campaigns"
                value={
                  operations.isLoading ? "…" : fmt(operations.data?.campaignSummary.active ?? 0)
                }
              />
              <KpiCard
                icon={Megaphone}
                label="Paused campaigns"
                value={
                  operations.isLoading ? "…" : fmt(operations.data?.campaignSummary.paused ?? 0)
                }
              />
              <KpiCard
                icon={Megaphone}
                label="Completed campaigns"
                value={
                  operations.isLoading ? "…" : fmt(operations.data?.campaignSummary.completed ?? 0)
                }
              />
            </div>
            <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
              <h3 className="text-sm font-semibold text-foreground">Call activity by tenant</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Top 10 by call count in the selected range.
              </p>
              {operations.isLoading ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
              ) : !operations.data || operations.data.tenantCallActivity.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No calls in this range.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {operations.data.tenantCallActivity.map((t) => (
                    <li key={t.tenantId} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-foreground">{t.tenantName}</span>
                      <span className="font-medium text-muted-foreground">{fmt(t.callCount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>

      {/* Step 4: Tenant Business Analytics */}
      <section className="space-y-4">
        <SectionHeading
          title="Tenant Business Analytics"
          sub="Credit position per tenant. Revenue and expenses are not available."
        />
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search tenants"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tenants"
          />
        </div>
        <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {tenants.isLoading ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : tenants.isError ? (
            <p className="p-10 text-center text-sm text-destructive">
              Couldn't load tenant analytics.
            </p>
          ) : !tenants.data || tenants.data.tenants.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {query ? "No tenants match your search." : "No tenants yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Tenant</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Balance</th>
                    <th className="px-5 py-3 font-medium">Manual +</th>
                    <th className="px-5 py-3 font-medium">Manual −</th>
                    <th className="px-5 py-3 font-medium">Voice usage</th>
                    <th className="px-5 py-3 font-medium">Negative exposure</th>
                    <th className="px-5 py-3 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.data.tenants.map((t) => (
                    <tr
                      key={t.tenantId}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-4 font-medium text-foreground">{t.name}</td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {t.status === "active" ? "Active" : "Suspended"}
                      </td>
                      <td
                        className={`px-5 py-4 font-medium ${t.creditBalance < 0 ? "text-tint-6" : "text-foreground"}`}
                      >
                        {fmt(t.creditBalance)}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {fmt(t.totalPositiveAdjustments)}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {fmt(t.totalNegativeAdjustments)}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{fmt(t.totalVoiceUsage)}</td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {t.negativeBalanceExposure > 0 ? fmt(t.negativeBalanceExposure) : "—"}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">Not available</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tenants.data && tenants.data.total > tenants.data.pageSize && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
              <span>
                Page {page} of {Math.max(1, Math.ceil(tenants.data.total / tenants.data.pageSize))}{" "}
                · {fmt(tenants.data.total)} tenants
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    page >= Math.max(1, Math.ceil(tenants.data.total / tenants.data.pageSize))
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
