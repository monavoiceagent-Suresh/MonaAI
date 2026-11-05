import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  addPhoneNumberToInventory,
  type PhoneNumberCapability,
} from "@/lib/phone-numbers.functions";

const CAPABILITY_LABELS: Record<PhoneNumberCapability, string> = {
  VOICE_IN: "Inbound only",
  VOICE_OUT: "Outbound only",
  VOICE_BOTH: "Inbound and outbound",
};

/** Manual inventory entry: records a number Exotel's own console already provisioned. There is no
 * Exotel provisioning API call here by design (see phone-numbers.functions.ts). */
export function AddPhoneNumberDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [e164, setE164] = useState("");
  const [exotelNumberSid, setExotelNumberSid] = useState("");
  const [capability, setCapability] = useState<PhoneNumberCapability>("VOICE_BOTH");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await addPhoneNumberToInventory({
        data: {
          e164: e164.trim(),
          exotelNumberSid: exotelNumberSid.trim() || undefined,
          capability,
        },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add this number.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a phone number</DialogTitle>
          <DialogDescription>
            Records a number your Exotel account already holds. This does not provision a new number
            from Exotel.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5 text-sm font-medium">
            Number (E.164)
            <Input
              value={e164}
              onChange={(e) => {
                setE164(e.target.value);
                setError("");
              }}
              placeholder="+918047491899"
              autoFocus
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Exotel number SID <span className="font-normal text-muted-foreground">(optional)</span>
            <Input value={exotelNumberSid} onChange={(e) => setExotelNumberSid(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Capability
            <Select
              value={capability}
              onValueChange={(v) => setCapability(v as PhoneNumberCapability)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CAPABILITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={!e164.trim() || submitting}>
              {submitting ? "Adding…" : "Add number"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
