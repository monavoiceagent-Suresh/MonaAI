import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listTenants } from "@/lib/super-admin-tenants.functions";
import { CreateTenantDialog } from "./CreateTenantDialog";

const fmt = (n: number) => n.toLocaleString("en-IN");

function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        active ? "bg-tint-3-soft text-tint-3" : "bg-tint-6-soft text-tint-6"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {active ? "Active" : "Suspended"}
    </span>
  );
}

export function Tenants() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const tenants = useQuery({
    queryKey: ["super-admin-tenants", query, status, page],
    queryFn: () => listTenants({ data: { search: query || undefined, status, page } }),
  });

  const totalPages = tenants.data
    ? Math.max(1, Math.ceil(tenants.data.total / tenants.data.pageSize))
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every workspace on the platform.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus /> Create tenant
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or admin email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tenants"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as "all" | "active" | "suspended");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {tenants.isLoading ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading tenants…</p>
        ) : tenants.isError ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" /> Couldn't load tenants.
            <button className="font-semibold underline" onClick={() => tenants.refetch()}>
              Try again
            </button>
          </div>
        ) : !tenants.data || tenants.data.tenants.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query || status !== "all" ? "No tenants match your filters." : "No tenants yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-5 py-3 font-medium">Admin</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Credits</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {tenants.data.tenants.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-4">
                      <Link
                        to="/super-admin/tenants/$tenantId"
                        params={{ tenantId: t.id }}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {t.adminEmail ? (
                        <>
                          <div className="text-foreground">{t.adminFullName || t.adminEmail}</div>
                          <div className="text-xs">{t.adminEmail}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{fmt(t.creditBalance)}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tenants.data && tenants.data.total > tenants.data.pageSize && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground">
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

      {showCreate && (
        <CreateTenantDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void queryClient.invalidateQueries({ queryKey: ["super-admin-tenants"] });
            void queryClient.invalidateQueries({ queryKey: ["super-admin-overview"] });
          }}
        />
      )}
    </div>
  );
}
