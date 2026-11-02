import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  CheckCircle2,
  PauseCircle,
  Bot,
  Megaphone,
  Coins,
  AlertTriangle,
  TrendingDown,
} from "lucide-react";
import { getSuperAdminOverview } from "@/lib/super-admin.functions";

const fmt = (n: number) => n.toLocaleString("en-IN");

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-6 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </section>
  );
}

export function SuperAdminOverview() {
  const overview = useQuery({
    queryKey: ["super-admin-overview"],
    queryFn: () => getSuperAdminOverview(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Platform Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Totals across every tenant on Mona.</p>
      </div>

      {overview.isError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn't load platform stats.
          <button className="font-semibold underline" onClick={() => overview.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {!overview.isLoading && (overview.data?.tenantsWithNegativeBalance ?? 0) > 0 && (
            <Link
              to="/super-admin/credits"
              className="flex items-center gap-3 rounded-2xl border border-tint-6/30 bg-tint-6-soft px-4 py-3 text-sm text-tint-6 transition hover:brightness-95"
            >
              <TrendingDown className="h-4 w-4 shrink-0" />
              <span>
                <strong>{fmt(overview.data?.tenantsWithNegativeBalance ?? 0)}</strong>{" "}
                {overview.data?.tenantsWithNegativeBalance === 1 ? "tenant has" : "tenants have"} a
                negative credit balance, totalling{" "}
                <strong>{fmt(overview.data?.totalOutstandingNegative ?? 0)}</strong> credits
                outstanding.
              </span>
            </Link>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              icon={Building2}
              label="Total Tenants"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalTenants ?? 0)}
              sub="Workspaces on the platform"
            />
            <StatCard
              icon={CheckCircle2}
              label="Active Tenants"
              value={overview.isLoading ? "…" : fmt(overview.data?.activeTenants ?? 0)}
              sub="Currently able to place calls"
            />
            <StatCard
              icon={PauseCircle}
              label="Suspended Tenants"
              value={overview.isLoading ? "…" : fmt(overview.data?.suspendedTenants ?? 0)}
              sub="Access currently paused"
            />
            <StatCard
              icon={Bot}
              label="Agents"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalAgents ?? 0)}
              sub="Active personas across all tenants"
            />
            <StatCard
              icon={Megaphone}
              label="Total Campaigns"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalCampaigns ?? 0)}
              sub="Across every tenant, any status"
            />
            <StatCard
              icon={Coins}
              label="Platform Credits"
              value={overview.isLoading ? "…" : fmt(overview.data?.totalCreditsAcrossTenants ?? 0)}
              sub="Summed across every tenant's balance"
            />
          </div>
        </>
      )}

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-foreground">More coming soon</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Phone number provisioning and platform-wide analytics are being built in upcoming phases.
          The navigation on the left is already in place for them.
        </p>
      </section>
    </div>
  );
}
