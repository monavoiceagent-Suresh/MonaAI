import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listPhoneNumberAssignmentHistory } from "@/lib/phone-numbers.functions";

const ACTION_LABELS: Record<string, string> = {
  ASSIGNED: "Assigned",
  UNASSIGNED: "Unassigned",
  SUSPENDED: "Suspended",
  REACTIVATED: "Reactivated",
  SET_DEFAULT_OUTBOUND: "Set as default outbound caller ID",
};

/** The full append-only audit trail for one number (phone-numbers.functions.ts
 * listPhoneNumberAssignmentHistoryFor) — completes the Phone Numbers management UI by surfacing
 * the history every lifecycle action already records but nothing previously displayed. */
export function PhoneNumberHistoryDialog({
  phoneNumberId,
  e164,
  onClose,
}: {
  phoneNumberId: string;
  e164: string;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: ["super-admin-phone-number-history", phoneNumberId],
    queryFn: () => listPhoneNumberAssignmentHistory({ data: { phoneNumberId } }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>History — {e164}</DialogTitle>
          <DialogDescription>
            Every assignment-lifecycle change, most recent first.
          </DialogDescription>
        </DialogHeader>
        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.isError ? (
          <p className="text-sm text-destructive">Couldn't load history.</p>
        ) : !history.data || history.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {history.data.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-muted/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString("en-IN")}
                  </span>
                </div>
                {entry.reason && <p className="mt-1 text-muted-foreground">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
