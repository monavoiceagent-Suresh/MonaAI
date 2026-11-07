import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Plus,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  PauseCircle,
  PlayCircle,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAgentDetail, listAgents, setAgentActive } from "@/lib/super-admin-agents.functions";
import { AgentFormDialog } from "./AgentFormDialog";

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        active ? "bg-tint-3-soft text-tint-3" : "bg-muted text-muted-foreground"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function AgentViewDialog({ promptId, onClose }: { promptId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["super-admin-agent-detail", promptId],
    queryFn: () => getAgentDetail({ data: { promptId } }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        {detail.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : detail.isError || !detail.data ? (
          <p className="py-10 text-center text-sm text-destructive">Couldn't load this agent.</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{detail.data.content.name}</DialogTitle>
              <DialogDescription>
                {detail.data.tenantName} · {detail.data.content.language} · Revision{" "}
                {detail.data.currentVersion}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <p>
                <StatusBadge active={detail.data.content.active} />
              </p>
              {detail.data.content.purpose && (
                <div>
                  <h3 className="mb-1 font-semibold">Call purpose</h3>
                  <p className="text-muted-foreground">{detail.data.content.purpose}</p>
                </div>
              )}
              <div>
                <h3 className="mb-1 font-semibold">System instructions</h3>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {detail.data.content.instructions}
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-semibold">Greeting</h3>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {detail.data.content.greeting || "—"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Created {new Date(detail.data.createdAt).toLocaleDateString("en-IN")}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Agents() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const agents = useQuery({
    queryKey: ["super-admin-agents", query, status, page],
    queryFn: () => listAgents({ data: { search: query || undefined, status, page } }),
  });

  const totalPages = agents.data
    ? Math.max(1, Math.ceil(agents.data.total / agents.data.pageSize))
    : 1;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["super-admin-agents"] });
    void queryClient.invalidateQueries({ queryKey: ["super-admin-overview"] });
  };

  const toggleActive = async (promptId: string, nextActive: boolean) => {
    setTogglingId(promptId);
    try {
      const result = await setAgentActive({ data: { promptId, active: nextActive } });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(nextActive ? "Agent activated." : "Agent deactivated.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change this agent's status.");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every persona across every tenant.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Create agent
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by agent or tenant name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search agents"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as "all" | "active" | "inactive");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {agents.isLoading ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading agents…</p>
        ) : agents.isError ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" /> Couldn't load agents.
            <button className="font-semibold underline" onClick={() => agents.refetch()}>
              Try again
            </button>
          </div>
        ) : !agents.data || agents.data.agents.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query || status !== "all" ? "No agents match your filters." : "No agents yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Agent</th>
                  <th className="px-5 py-3 font-medium">Tenant</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {agents.data.agents.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-4 font-medium text-foreground">{a.name}</td>
                    <td className="px-5 py-4 text-muted-foreground">{a.tenantName}</td>
                    <td className="px-5 py-4">
                      <StatusBadge active={a.active} />
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View"
                          onClick={() => setViewing(a.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          onClick={() => setEditing(a.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={a.active ? "Deactivate" : "Activate"}
                          disabled={togglingId === a.id}
                          onClick={() => void toggleActive(a.id, !a.active)}
                        >
                          {a.active ? (
                            <PauseCircle className="h-4 w-4" />
                          ) : (
                            <PlayCircle className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {agents.data && agents.data.total > agents.data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {agents.data.total.toLocaleString("en-IN")} agents
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

      {creating && (
        <AgentFormDialog
          promptId={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
            toast.success("Agent created.");
          }}
        />
      )}
      {editing && (
        <AgentFormDialog
          promptId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
            toast.success("Agent updated.");
          }}
        />
      )}
      {viewing && <AgentViewDialog promptId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
