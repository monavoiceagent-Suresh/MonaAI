import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Coins,
  TrendingDown,
  TrendingUp,
  Users,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getCreditOverview,
  getCreditPricing,
  listTenantCredits,
  setCreditPricing,
} from "@/lib/super-admin-credits.functions";
import { CreditAdjustDialog } from "./CreditAdjustDialog";

const fmt = (n: number) => n.toLocaleString("en-IN");

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Coins;
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

function PricingCard() {
  const queryClient = useQueryClient();
  const pricing = useQuery({
    queryKey: ["super-admin-credit-pricing"],
    queryFn: () => getCreditPricing(),
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pricing.data) setValue(String(pricing.data.pricePerCredit));
  }, [pricing.data]);

  const save = async () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Enter a price greater than zero.");
      return;
    }
    setSaving(true);
    try {
      await setCreditPricing({ data: { pricePerCredit: parsed } });
      toast.success("Credit price updated. Applies to future adjustments only.");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["super-admin-credit-pricing"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the credit price.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
      <h2 className="font-semibold text-foreground">Credit price</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One global price, applied to future adjustments only. Past transactions keep whatever price
        was in effect when they were recorded.
      </p>
      {pricing.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : pricing.isError ? (
        <p className="mt-4 text-sm text-destructive">Couldn't load the current price.</p>
      ) : editing ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block space-y-1.5 text-sm font-medium">
            Price per credit
            <Input
              type="number"
              step="0.01"
              min="0.01"
              className="w-40"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-4">
          <p className="text-2xl font-semibold text-foreground">{pricing.data?.pricePerCredit}</p>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Change price
          </Button>
        </div>
      )}
    </section>
  );
}

export function Credits() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [negativeOnly, setNegativeOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<{ clientId: string; name: string } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const overview = useQuery({
    queryKey: ["super-admin-credit-overview"],
    queryFn: () => getCreditOverview(),
  });
  const tenants = useQuery({
    queryKey: ["super-admin-tenant-credits", query, negativeOnly, page],
    queryFn: () => listTenantCredits({ data: { search: query || undefined, negativeOnly, page } }),
  });

  const totalPages = tenants.data
    ? Math.max(1, Math.ceil(tenants.data.total / tenants.data.pageSize))
    : 1;

  const refreshAfterAdjust = () => {
    void queryClient.invalidateQueries({ queryKey: ["super-admin-tenant-credits"] });
    void queryClient.invalidateQueries({ queryKey: ["super-admin-credit-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["super-admin-overview"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Credits & Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-wide credit ledger and pricing.
        </p>
      </div>

      {overview.isError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn't load the credit overview.
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={TrendingUp}
            label="Manual additions"
            value={overview.isLoading ? "…" : fmt(overview.data?.totalManualAdditions ?? 0)}
          />
          <StatCard
            icon={TrendingDown}
            label="Manual deductions"
            value={overview.isLoading ? "…" : fmt(overview.data?.totalManualDeductions ?? 0)}
          />
          <StatCard
            icon={TrendingDown}
            label="Voice usage (automated)"
            value={overview.isLoading ? "…" : fmt(overview.data?.totalVoiceUsage ?? 0)}
          />
          <StatCard
            icon={AlertTriangle}
            tone="destructive"
            label="Outstanding negative"
            value={overview.isLoading ? "…" : fmt(overview.data?.totalOutstandingNegative ?? 0)}
          />
          <StatCard
            icon={Users}
            tone={
              overview.data && overview.data.tenantsWithNegativeBalance > 0
                ? "destructive"
                : undefined
            }
            label="Tenants with negative balance"
            value={overview.isLoading ? "…" : fmt(overview.data?.tenantsWithNegativeBalance ?? 0)}
          />
        </div>
      )}

      <PricingCard />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search tenants by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tenants"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={negativeOnly}
            onCheckedChange={(v) => {
              setNegativeOnly(v === true);
              setPage(1);
            }}
          />
          Negative balances only
        </label>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {tenants.isLoading ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading tenants…</p>
        ) : tenants.isError ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" /> Couldn't load tenant credits.
            <button className="font-semibold underline" onClick={() => tenants.refetch()}>
              Try again
            </button>
          </div>
        ) : !tenants.data || tenants.data.tenants.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query || negativeOnly ? "No tenants match your filters." : "No tenants yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Tenant</th>
                  <th className="px-5 py-3 font-medium">Balance</th>
                  <th className="px-5 py-3 font-medium">Manual +</th>
                  <th className="px-5 py-3 font-medium">Manual −</th>
                  <th className="px-5 py-3 font-medium">Voice usage</th>
                  <th className="px-5 py-3 font-medium">Outstanding</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {tenants.data.tenants.map((t) => (
                  <tr
                    key={t.clientId}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-4 font-medium text-foreground">{t.name}</td>
                    <td
                      className={`px-5 py-4 font-medium ${t.creditBalance < 0 ? "text-tint-6" : "text-foreground"}`}
                    >
                      {fmt(t.creditBalance)}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {fmt(t.totalManualAdditions)}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {fmt(t.totalManualDeductions)}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{fmt(t.totalVoiceUsage)}</td>
                    <td className="px-5 py-4">
                      {t.outstandingNegative > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-tint-6-soft px-2.5 py-1 text-xs font-medium text-tint-6">
                          {fmt(t.outstandingNegative)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAdjusting({ clientId: t.clientId, name: t.name })}
                      >
                        Adjust
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tenants.data && tenants.data.total > tenants.data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {fmt(tenants.data.total)} tenants
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

      {adjusting && (
        <CreditAdjustDialog
          clientId={adjusting.clientId}
          tenantName={adjusting.name}
          onClose={() => setAdjusting(null)}
          onAdjusted={() => {
            setAdjusting(null);
            refreshAfterAdjust();
          }}
        />
      )}
    </div>
  );
}
