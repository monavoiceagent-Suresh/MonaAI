import { useState } from "react";
import { Check, Copy, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createTenant, type CreateTenantResult } from "@/lib/super-admin-tenants.functions";

export function CreateTenantDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Extract<CreateTenantResult, { ok: true }> | null>(null);

  const canSubmit =
    businessName.trim().length >= 2 &&
    adminFullName.trim().length > 0 &&
    /^\S+@\S+\.\S+$/.test(adminEmail.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await createTenant({
        data: {
          businessName: businessName.trim(),
          adminFullName: adminFullName.trim(),
          adminEmail: adminEmail.trim(),
        },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      // Email delivery may not be configured yet — don't close until the admin has seen (and
      // can copy) the activation link, or it's lost the moment this dialog closes.
      setCreated(result);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create this tenant.");
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
      <DialogContent className="max-w-md">
        {created ? (
          <ActivationResult invitation={created.invitation} onClose={onClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create tenant</DialogTitle>
              <DialogDescription>
                Creates a new workspace and emails its owner a link to set their own password.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={submit}>
              <label className="block space-y-1.5 text-sm font-medium">
                Business name
                <Input
                  required
                  minLength={2}
                  maxLength={100}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Corp"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                Owner full name
                <Input
                  required
                  maxLength={100}
                  value={adminFullName}
                  onChange={(e) => setAdminFullName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                Owner email
                <Input
                  required
                  type="email"
                  maxLength={255}
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="jane@acme.com"
                  autoComplete="off"
                />
                <span className="block text-xs font-normal text-muted-foreground">
                  They'll get an email to set their own password and activate the workspace.
                </span>
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit || submitting}>
                  <Plus /> {submitting ? "Creating…" : "Create tenant"}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActivationResult({
  invitation,
  onClose,
}: {
  invitation: Extract<CreateTenantResult, { ok: true }>["invitation"];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tenant created</DialogTitle>
        <DialogDescription>
          {invitation.emailSent
            ? "The owner's invitation email is on its way."
            : "The invitation was created, but the email could not be sent."}
        </DialogDescription>
      </DialogHeader>
      {invitation.emailSent ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-foreground">
          <Mail className="h-4 w-4 shrink-0 text-tint-3" />
          Invitation email sent.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-destructive">{invitation.reason}</p>
          <label className="block space-y-1.5 text-sm font-medium">
            Share this activation link with them yourself
            <div className="flex gap-2">
              <Input readOnly value={invitation.activationUrl} className="text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(invitation.activationUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                aria-label="Copy activation link"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          </label>
          <p className="text-xs text-muted-foreground">
            This link expires in 24 hours and works only once — it won't be shown again.
          </p>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <Button onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
