import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adjustTenantCredit, getTenantCreditHistory } from "@/lib/super-admin-credits.functions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function CreditAdjustDialog({
  clientId,
  tenantName,
  onClose,
  onAdjusted,
}: {
  clientId: string;
  tenantName: string;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const history = useQuery({
    queryKey: ["super-admin-tenant-credit-history", clientId],
    queryFn: () => getTenantCreditHistory({ data: { clientId } }),
  });

  const parsedAmount = Number(amount);
  const canSubmit = Number.isInteger(parsedAmount) && parsedAmount > 0 && reason.trim().length >= 3;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const signedAmount = direction === "add" ? parsedAmount : -parsedAmount;
      const result = await adjustTenantCredit({
        data: { clientId, amount: signedAmount, reason: reason.trim(), idempotencyKey },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onAdjusted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this adjustment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <DialogTitle>Adjust credits — {tenantName}</DialogTitle>
          <DialogDescription>
            Writes a ledger entry and updates the tenant's balance in one step.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <form className="space-y-4" onSubmit={submit}>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === "add" ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setDirection("add");
                  setIdempotencyKey(newIdempotencyKey());
                }}
              >
                <Plus /> Add
              </Button>
              <Button
                type="button"
                variant={direction === "deduct" ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setDirection("deduct");
                  setIdempotencyKey(newIdempotencyKey());
                }}
              >
                <Minus /> Deduct
              </Button>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Amount (credits)
              <Input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError("");
                }}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Reason <span className="font-normal text-muted-foreground">(required)</span>
              <Textarea
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError("");
                }}
                placeholder="e.g. Goodwill credit for an outage on 2026-11-01"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || submitting}>
                {submitting ? "Saving…" : direction === "add" ? "Add credits" : "Deduct credits"}
              </Button>
            </div>
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Previous adjustments</h3>
            {history.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : history.isError ? (
              <p className="mt-2 text-sm text-destructive">Couldn't load history.</p>
            ) : !history.data || history.data.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No ledger entries yet.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {history.data.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-background p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{entry.note || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString("en-IN")} ·{" "}
                        {entry.type === "MANUAL_ADJUSTMENT"
                          ? "Manual"
                          : entry.type === "VOICE_USAGE"
                            ? "Voice usage (automated)"
                            : "Unknown origin"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-semibold ${entry.amount < 0 ? "text-tint-6" : "text-tint-3"}`}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount.toLocaleString("en-IN")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
