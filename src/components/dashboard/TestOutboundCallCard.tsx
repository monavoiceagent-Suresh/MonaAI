import { useRef, useState } from "react";
import { toast } from "sonner";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonaPicker } from "./CampaignControls";
import { testOutboundCall } from "@/lib/outbound-test-call.functions";

const DIALLABLE_PHONE = /^\+?[0-9]{10,15}$/;

/**
 * Places one real outbound call to a number you choose, outside any campaign — to check end to end that
 * outbound calling actually works (Exotel, the agent's voice, the LLM) before running a real campaign.
 */
export function TestOutboundCallCard({ campaignId }: { campaignId?: string }) {
  const requestKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [persona, setPersona] = useState("");
  const [to, setTo] = useState("");
  const [contactName, setContactName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const phoneError =
    to && !DIALLABLE_PHONE.test(to.trim()) ? "Enter a valid phone number, e.g. +919876543210." : "";
  const canCall = Boolean(campaignId || persona) && Boolean(to.trim()) && !phoneError;

  async function makeTheCall() {
    if (inFlight.current) return;
    inFlight.current = true;
    requestKey.current ??= crypto.randomUUID();
    setConfirming(false);
    setCalling(true);
    setResult(null);
    try {
      const outcome = await testOutboundCall({
        data: { campaignId, personaKey: persona || undefined, idempotencyKey: requestKey.current,
          to: to.trim(), contactName: contactName.trim() || undefined },
      });
      if (outcome.ok) {
        requestKey.current = null;
        setResult({ ok: true, message: "Test call queued. Its status will appear in Outbound Calls." });
        toast.success("Test call queued for Exotel.");
      } else {
        if (!outcome.retrySameKey) requestKey.current = null;
        setResult({ ok: false, message: outcome.reason });
        toast.error(outcome.reason);
      }
    } catch {
      const message = "Couldn't reach the server to place the call. Try again in a moment.";
      setResult({ ok: false, message });
      toast.error(message);
    } finally {
      inFlight.current = false;
      setCalling(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h3 className="font-semibold">Test outbound call</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Queues one real call, outside the campaign’s lead queue — use it to check that outbound
            calling works end to end before running a real campaign. This dials a real phone and is
            not a simulation.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium">
          Phone number to call
          <Input
            value={to}
            disabled={calling}
            onChange={(e) => { requestKey.current = null; setTo(e.target.value); }}
            placeholder="+919876543210"
            aria-invalid={Boolean(phoneError)}
            aria-describedby={phoneError ? "test-call-phone-error" : undefined}
            className="bg-background"
          />
          {phoneError && (
            <p id="test-call-phone-error" role="alert" className="text-xs text-destructive">
              {phoneError}
            </p>
          )}
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Contact name (optional)
          <Input
            value={contactName}
            disabled={calling}
            onChange={(e) => { requestKey.current = null; setContactName(e.target.value); }}
            placeholder="e.g. Asha"
            className="bg-background"
          />
        </label>
        {!campaignId && <div className="space-y-2 text-sm font-medium sm:col-span-2">
          Persona to speak as
          <PersonaPicker value={persona} onChange={(value) => { requestKey.current = null; setPersona(value); }} />
        </div>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canCall || calling} onClick={() => setConfirming(true)}>
          <PhoneCall />
          {calling ? "Calling…" : "Call now"}
        </Button>
        {result && (
          <p
            className={`text-sm ${result.ok ? "text-primary" : "text-destructive"}`}
            role={result.ok ? undefined : "alert"}
          >
            {result.message}
          </p>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place a real call?</DialogTitle>
            <DialogDescription>
              This dials <strong>{to.trim()}</strong> right now using the persona you selected. The
              call is real, not a simulation, and will be answered by whoever picks up.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={makeTheCall}>
              <PhoneCall />
              Call {to.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
