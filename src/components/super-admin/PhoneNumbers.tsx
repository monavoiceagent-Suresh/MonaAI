import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  History,
  Phone,
  Plus,
  Search,
  Star,
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
  listPhoneNumbers,
  phoneNumberStatuses,
  reactivatePhoneNumber,
  setDefaultOutboundCallerId,
  type PhoneNumberListItem,
  type PhoneNumberStatus,
} from "@/lib/phone-numbers.functions";
import { AddPhoneNumberDialog } from "./AddPhoneNumberDialog";
import { AssignPhoneNumberDialog } from "./AssignPhoneNumberDialog";
import { PhoneNumberActionDialog } from "./PhoneNumberActionDialog";
import { PhoneNumberHistoryDialog } from "./PhoneNumberHistoryDialog";
import { ChannelCapacity } from "./ChannelCapacity";

const STATUS_LABELS: Record<PhoneNumberStatus, string> = {
  UNASSIGNED: "Available",
  ASSIGNED: "Assigned",
  SUSPENDED: "Suspended",
  RELEASED: "Released",
  DISABLED: "Disabled",
};

const STATUS_TONE: Record<PhoneNumberStatus, string> = {
  UNASSIGNED: "bg-muted text-muted-foreground",
  ASSIGNED: "bg-tint-3-soft text-tint-3",
  SUSPENDED: "bg-tint-6-soft text-tint-6",
  RELEASED: "bg-muted text-muted-foreground",
  DISABLED: "bg-muted text-muted-foreground",
};

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function StatusBadge({ status }: { status: PhoneNumberStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

type DialogState =
  | { kind: "add" }
  | { kind: "assign"; id: string; e164: string }
  | { kind: "unassign" | "suspend" | "history"; id: string; e164: string }
  | null;

export function PhoneNumbers() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PhoneNumberStatus>("all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const numbers = useQuery({
    queryKey: ["super-admin-phone-numbers", query, status, page],
    queryFn: () => listPhoneNumbers({ data: { search: query || undefined, status, page } }),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["super-admin-phone-numbers"] });
  const totalPages = numbers.data
    ? Math.max(1, Math.ceil(numbers.data.total / numbers.data.pageSize))
    : 1;

  const reactivate = async (n: PhoneNumberListItem) => {
    try {
      const result = await reactivatePhoneNumber({
        data: { phoneNumberId: n.id, idempotencyKey: newIdempotencyKey() },
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(`${n.e164} reactivated.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reactivate this number.");
    }
  };

  const setDefault = async (n: PhoneNumberListItem) => {
    try {
      const result = await setDefaultOutboundCallerId({
        data: { phoneNumberId: n.id, idempotencyKey: newIdempotencyKey() },
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(`${n.e164} is now the default outbound caller ID for ${n.clientName}.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't set the default caller ID.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Phone Numbers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Central inventory of Exotel numbers and their tenant assignment. Inbound routing is
            managed per workspace from Inbound Numbers; this is the account-wide ownership layer.
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: "add" })}>
          <Plus /> Add number
        </Button>
      </div>

      <ChannelCapacity />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by number or tenant"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search phone numbers"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as "all" | PhoneNumberStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {phoneNumberStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {numbers.isLoading ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading numbers…</p>
        ) : numbers.isError ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" /> Couldn't load phone numbers.
            <button className="font-semibold underline" onClick={() => numbers.refetch()}>
              Try again
            </button>
          </div>
        ) : !numbers.data || numbers.data.numbers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-muted-foreground">
            <Phone className="h-6 w-6" />
            {query || status !== "all"
              ? "No numbers match your filters."
              : "No numbers in the inventory yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Number</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Tenant</th>
                  <th className="px-5 py-3 font-medium">Capability</th>
                  <th className="px-5 py-3 font-medium">Default caller ID</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {numbers.data.numbers.map((n) => (
                  <tr key={n.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-4 font-medium text-foreground">{n.e164}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={n.status} />
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{n.clientName ?? "—"}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {n.capability === "VOICE_BOTH"
                        ? "In + Out"
                        : n.capability === "VOICE_IN"
                          ? "Inbound"
                          : "Outbound"}
                    </td>
                    <td className="px-5 py-4">
                      {n.isDefaultOutboundCallerId ? (
                        <span className="inline-flex items-center gap-1 text-tint-3">
                          <Star className="h-3.5 w-3.5 fill-current" /> Default
                        </span>
                      ) : n.status === "ASSIGNED" ? (
                        <button
                          className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
                          onClick={() => void setDefault(n)}
                        >
                          Make default
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Assignment history"
                          onClick={() => setDialog({ kind: "history", id: n.id, e164: n.e164 })}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        {n.status === "UNASSIGNED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDialog({ kind: "assign", id: n.id, e164: n.e164 })}
                          >
                            Assign
                          </Button>
                        )}
                        {n.status === "ASSIGNED" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDialog({ kind: "suspend", id: n.id, e164: n.e164 })}
                            >
                              Suspend
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDialog({ kind: "unassign", id: n.id, e164: n.e164 })
                              }
                            >
                              Unassign
                            </Button>
                          </>
                        )}
                        {n.status === "SUSPENDED" && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => void reactivate(n)}>
                              Reactivate
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDialog({ kind: "unassign", id: n.id, e164: n.e164 })
                              }
                            >
                              Unassign
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {numbers.data && numbers.data.total > numbers.data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {numbers.data.total} numbers
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

      {dialog?.kind === "add" && (
        <AddPhoneNumberDialog
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null);
            toast.success("Number added to the inventory.");
            refresh();
          }}
        />
      )}
      {dialog?.kind === "assign" && (
        <AssignPhoneNumberDialog
          phoneNumberId={dialog.id}
          e164={dialog.e164}
          onClose={() => setDialog(null)}
          onAssigned={() => {
            setDialog(null);
            toast.success(`${dialog.e164} assigned.`);
            refresh();
          }}
        />
      )}
      {(dialog?.kind === "unassign" || dialog?.kind === "suspend") && (
        <PhoneNumberActionDialog
          action={dialog.kind}
          phoneNumberId={dialog.id}
          e164={dialog.e164}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toast.success(
              `${dialog.e164} ${dialog.kind === "unassign" ? "unassigned" : "suspended"}.`,
            );
            refresh();
          }}
        />
      )}
      {dialog?.kind === "history" && (
        <PhoneNumberHistoryDialog
          phoneNumberId={dialog.id}
          e164={dialog.e164}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
