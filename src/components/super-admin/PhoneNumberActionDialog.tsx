import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { suspendPhoneNumber, unassignPhoneNumber } from "@/lib/phone-numbers.functions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Reason-required actions that leave an audit trail: Assigned -> Unassigned or Assigned ->
 * Suspended. Unassigning that would take an active inbound route offline asks for confirmation
 * once (force), surfacing exactly what the server refused rather than retrying blindly. */
export function PhoneNumberActionDialog({
  action,
  phoneNumberId,
  e164,
  onClose,
  onDone,
}: {
  action: "unassign" | "suspend";
  phoneNumberId: string;
  e164: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [needsForce, setNeedsForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const submit = async (force = false) => {
    if (reason.trim().length < 3 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result =
        action === "unassign"
          ? await unassignPhoneNumber({
              data: { phoneNumberId, reason: reason.trim(), idempotencyKey, force },
            })
          : await suspendPhoneNumber({
              data: { phoneNumberId, reason: reason.trim(), idempotencyKey },
            });
      if (!result.ok) {
        setError(result.reason);
        setNeedsForce(action === "unassign" && "needsForce" in result && !!result.needsForce);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this action.");
    } finally {
      setSubmitting(false);
    }
  };

  const title = action === "unassign" ? `Unassign ${e164}` : `Suspend ${e164}`;
  const description =
    action === "unassign"
      ? "Returns this number to the available pool. It can no longer be used as any tenant's caller ID or inbound route until reassigned."
      : "Keeps the tenant assignment on record but immediately invalidates this number as a caller ID. Reactivate later to restore it.";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5 text-sm font-medium">
          Reason <span className="font-normal text-muted-foreground">(required)</span>
          <Textarea
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
              setNeedsForce(false);
            }}
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
          {needsForce ? (
            <Button variant="destructive" disabled={submitting} onClick={() => void submit(true)}>
              {submitting ? "Confirming…" : "Unassign anyway"}
            </Button>
          ) : (
            <Button
              variant={action === "unassign" ? "destructive" : "default"}
              disabled={reason.trim().length < 3 || submitting}
              onClick={() => void submit(false)}
            >
              {submitting ? "Saving…" : action === "unassign" ? "Unassign" : "Suspend"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
