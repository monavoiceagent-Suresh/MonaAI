import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Phone, PhoneIncoming, PhoneOutgoing, Radio } from "lucide-react";
import { getCapacitySnapshot } from "@/lib/super-admin-capacity.functions";

// Live, like every other "live" view in this dashboard: conditional polling via TanStack Query,
// not a websocket/SSE connection — there is no push infrastructure in this codebase to plug into
// (see docs/MULTI_TENANT_TELEPHONY_PLAN.md's M4 notes), and this matches house convention exactly.
const POLL_MS = 10_000;

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Phone;
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

/** M3 Super Admin operational visibility: live channel utilization, active-call breakdown,
 * tenant-level allocations and outbound queue depth, plus a health check for stuck allocations —
 * all read from the engine's own M2 allocator (GET /capacity), never a second source of truth. */
export function ChannelCapacity() {
  const snapshot = useQuery({
    queryKey: ["super-admin-capacity"],
    queryFn: () => getCapacitySnapshot(),
    refetchInterval: POLL_MS,
  });

  if (snapshot.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading channel capacity…</p>;
  }
  if (snapshot.isError || !snapshot.data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn't load channel capacity.
      </div>
    );
  }
  if (!snapshot.data.ok) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" /> {snapshot.data.reason}
      </div>
    );
  }

  const c = snapshot.data.capacity;
  const outboundLimit = c.maxConcurrentCalls - c.inboundReservedCalls;
  const needsAttention = c.staleReserved > 0 || c.stuckReleasing > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Radio}
          label="Occupied / limit"
          value={`${c.occupied} / ${c.maxConcurrentCalls}`}
        />
        <StatCard icon={PhoneIncoming} label="Inbound in use" value={String(c.inboundOccupied)} />
        <StatCard
          icon={PhoneOutgoing}
          label="Outbound in use"
          value={`${c.outboundOccupied} / ${outboundLimit}`}
        />
        <StatCard
          icon={AlertTriangle}
          tone={needsAttention ? "destructive" : undefined}
          label="Stale / stuck allocations"
          value={String(c.staleReserved + c.stuckReleasing)}
        />
      </div>

      {(c.unattributed ?? 0) > 0 && (
        <p className="text-sm text-muted-foreground">
          {c.unattributed} occupied channels have no tenant attribution.
        </p>
      )}
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Tenant-level allocations</h2>
        </div>
        {c.tenants.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No tenant currently holds a channel.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Tenant</th>
                <th className="px-5 py-3 font-medium">Connected</th>
                <th className="px-5 py-3 font-medium">Reserved</th>
                <th className="px-5 py-3 font-medium">Queued leads</th>
              </tr>
            </thead>
            <tbody>
              {c.tenants.map((t) => (
                <tr key={t.clientId} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium text-foreground">
                    {t.clientName ?? t.clientId}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{t.connected}</td>
                  <td className="px-5 py-3 text-muted-foreground">{t.reserved}</td>
                  <td className="px-5 py-3 text-muted-foreground">{t.queuedLeads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
