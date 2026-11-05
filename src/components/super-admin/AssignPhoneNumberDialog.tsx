import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listTenants } from "@/lib/super-admin-tenants.functions";
import { assignPhoneNumberToTenant } from "@/lib/phone-numbers.functions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Available (UNASSIGNED) -> Assigned. Search picks an existing tenant; there is no "create tenant
 * from here" shortcut, since Tenants already owns that flow. */
export function AssignPhoneNumberDialog({
  phoneNumberId,
  e164,
  onClose,
  onAssigned,
}: {
  phoneNumberId: string;
  e164: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const tenants = useQuery({
    queryKey: ["super-admin-tenants-picker", query],
    queryFn: () => listTenants({ data: { search: query || undefined, status: "active", page: 1 } }),
    enabled: !selected,
  });

  const submit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await assignPhoneNumberToTenant({
        data: { phoneNumberId, clientId: selected.id, idempotencyKey },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't assign this number.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign {e164}</DialogTitle>
          <DialogDescription>Choose the tenant this number belongs to.</DialogDescription>
        </DialogHeader>
        {selected ? (
          <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
            <span className="font-medium text-foreground">{selected.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(null);
                setIdempotencyKey(newIdempotencyKey());
                setError("");
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search tenants by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {tenants.isLoading ? (
                <p className="p-3 text-sm text-muted-foreground">Loading…</p>
              ) : !tenants.data || tenants.data.tenants.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No active tenants match.</p>
              ) : (
                tenants.data.tenants.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="block w-full rounded-xl p-3 text-left text-sm hover:bg-muted/40"
                    onClick={() => setSelected({ id: t.id, name: t.name })}
                  >
                    {t.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected || submitting} onClick={() => void submit()}>
            {submitting ? "Assigning…" : "Assign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
