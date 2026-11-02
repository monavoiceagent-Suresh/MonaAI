import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createTenant } from "@/lib/super-admin-tenants.functions";

const MIN_PASSWORD_LENGTH = 12;

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
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    businessName.trim().length >= 2 &&
    adminFullName.trim().length > 0 &&
    /^\S+@\S+\.\S+$/.test(adminEmail.trim()) &&
    adminPassword.length >= MIN_PASSWORD_LENGTH;

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
          adminPassword,
        },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
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
        <DialogHeader>
          <DialogTitle>Create tenant</DialogTitle>
          <DialogDescription>
            Creates a new workspace and its first admin account.
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
            Admin full name
            <Input
              required
              maxLength={100}
              value={adminFullName}
              onChange={(e) => setAdminFullName(e.target.value)}
              placeholder="Jane Doe"
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Admin email
            <Input
              required
              type="email"
              maxLength={255}
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="jane@acme.com"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Initial password
            <Input
              required
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={200}
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              autoComplete="new-password"
            />
            <span className="block text-xs font-normal text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters. Share it with the tenant admin yourself —
              it is never shown again.
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
      </DialogContent>
    </Dialog>
  );
}
