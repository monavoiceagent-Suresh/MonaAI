import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  AlertTriangle,
  Bot,
  Megaphone,
  Coins,
  PauseCircle,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteTenantPermanently,
  getTenantDetail,
  setTenantStatus,
  updateTenant,
  type CampaignSuspensionFailure,
  type InboundSuspensionFailure,
} from "@/lib/super-admin-tenants.functions";
import { VoiceProviderSettings } from "@/components/super-admin/VoiceProviderSettings";

const fmt = (n: number) => n.toLocaleString("en-IN");

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function TenantDetail({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [businessName, setBusinessName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [statusWarnings, setStatusWarnings] = useState<{
    inboundFailures: InboundSuspensionFailure[];
    campaignFailures: CampaignSuspensionFailure[];
  } | null>(null);

  const detail = useQuery({
    queryKey: ["super-admin-tenant", tenantId],
    queryFn: () => getTenantDetail({ data: { clientId: tenantId } }),
  });

  useEffect(() => {
    if (detail.data) setBusinessName(detail.data.name);
  }, [detail.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["super-admin-tenant", tenantId] });
    void queryClient.invalidateQueries({ queryKey: ["super-admin-tenants"] });
    void queryClient.invalidateQueries({ queryKey: ["super-admin-overview"] });
  };

  const saveName = async () => {
    if (!detail.data || businessName.trim().length < 2 || businessName === detail.data.name) return;
    setSavingName(true);
    try {
      const result = await updateTenant({
        data: { clientId: tenantId, businessName: businessName.trim() },
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success("Business name updated.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that change.");
    } finally {
      setSavingName(false);
    }
  };

  // Shared by the toggle button (flips to the opposite of the current status) and the retry
  // button in the warning banner (re-applies the SAME status, to finish what didn't settle —
  // see setTenantStatusFor's own doc comment on why re-running it is safe and sufficient).
  const applyStatus = async (nextStatus: "active" | "suspended") => {
    setStatusBusy(true);
    setStatusWarnings(null);
    try {
      const result = await setTenantStatus({ data: { clientId: tenantId, status: nextStatus } });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      const failed = result.inboundFailures.length > 0 || result.campaignFailures.length > 0;
      if (failed) {
        // Never a plain success when something didn't actually take effect — surfaced as a
        // persistent banner below, not just a toast that disappears.
        setStatusWarnings({
          inboundFailures: result.inboundFailures,
          campaignFailures: result.campaignFailures,
        });
        toast.error(
          `Tenant ${nextStatus}, but ${result.inboundFailures.length + result.campaignFailures.length} ` +
            `item(s) could not be fully applied. See the warning below to retry.`,
        );
      } else {
        toast.success(
          nextStatus === "suspended"
            ? "Tenant suspended. Logins, new calls, in-progress campaign dispatch and inbound numbers for this workspace are now blocked."
            : "Tenant reactivated.",
        );
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change that tenant's status.");
    } finally {
      setStatusBusy(false);
    }
  };

  const toggleStatus = () => {
    if (!detail.data) return;
    void applyStatus(detail.data.status === "active" ? "suspended" : "active");
  };

  if (detail.isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading tenant…</p>;
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">Couldn't load this tenant.</p>
        <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const t = detail.data;
  const suspended = t.status === "suspended";

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        className="gap-2 px-0 text-muted-foreground hover:text-foreground"
        onClick={() => void navigate({ to: "/super-admin/tenants" })}
      >
        <ArrowLeft className="h-4 w-4" /> Back to tenants
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Created {new Date(t.createdAt).toLocaleDateString("en-IN")}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            suspended ? "bg-tint-6-soft text-tint-6" : "bg-tint-3-soft text-tint-3"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {suspended ? "Suspended" : "Active"}
        </span>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard icon={Coins} label="Credit balance" value={fmt(t.creditBalance)} />
        <StatCard icon={Bot} label="Active agents" value={fmt(t.agentCount)} />
        <StatCard icon={Megaphone} label="Campaigns" value={fmt(t.campaignCount)} />
      </div>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-foreground">Business details</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1 space-y-1.5 text-sm font-medium">
            Business name
            <Input
              minLength={2}
              maxLength={100}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            disabled={savingName || businessName.trim().length < 2 || businessName === t.name}
            onClick={() => void saveName()}
          >
            {savingName ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-foreground">Tenant admin</h2>
        {t.adminEmail ? (
          <div className="mt-3 text-sm">
            <p className="text-foreground">{t.adminFullName || t.adminEmail}</p>
            <p className="text-muted-foreground">{t.adminEmail}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No admin account found for this tenant.
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-foreground">Access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {suspended
            ? "This tenant's logins, outbound dispatch, test calls and inbound numbers are all blocked."
            : "This tenant has normal access to their workspace."}
        </p>
        <Button
          className="mt-4"
          variant={suspended ? "default" : "outline"}
          disabled={statusBusy}
          onClick={() => void toggleStatus()}
        >
          {suspended ? <PlayCircle /> : <PauseCircle />}
          {statusBusy ? "Working…" : suspended ? "Reactivate tenant" : "Suspend tenant"}
        </Button>
        {statusWarnings &&
          (statusWarnings.inboundFailures.length > 0 ||
            statusWarnings.campaignFailures.length > 0) && (
            <div className="mt-4 rounded-2xl border border-tint-6/30 bg-tint-6-soft p-4 text-sm text-tint-6">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Not fully applied — retry needed
              </p>
              {statusWarnings.inboundFailures.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-1">
                  {statusWarnings.inboundFailures.map((f) => (
                    <li key={f.phone}>
                      Inbound number {f.phone}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
              {statusWarnings.campaignFailures.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-1">
                  {statusWarnings.campaignFailures.map((f) => (
                    <li key={f.campaignId}>
                      Campaign "{f.name}": {f.error}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs">
                Anything already settled is skipped, so retrying only touches what failed above.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={statusBusy}
                onClick={() => void applyStatus(suspended ? "suspended" : "active")}
              >
                {statusBusy ? "Retrying…" : "Retry"}
              </Button>
            </div>
          )}
      </section>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-foreground">Voice providers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The ASR and TTS providers this tenant's workspace uses. A persona can override these;
          leaving a field on "Engine default" uses the voice engine's own configured default.
        </p>
        <div className="mt-4">
          <VoiceProviderSettings clientId={tenantId} />
        </div>
      </section>

      <section className="rounded-3xl border border-destructive/30 bg-card p-6 shadow-soft">
        <h2 className="font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently deletes this tenant and every campaign, lead, call, prompt and inbound number
          it owns. This cannot be undone.
        </p>
        <Button variant="destructive" className="mt-4" onClick={() => setShowDelete(true)}>
          <Trash2 /> Delete tenant permanently
        </Button>
      </section>

      {showDelete && (
        <DeleteTenantDialog
          tenantId={tenantId}
          tenantName={t.name}
          onClose={() => setShowDelete(false)}
          onDeleted={() => void navigate({ to: "/super-admin/tenants" })}
        />
      )}
    </div>
  );
}

function DeleteTenantDialog({
  tenantId,
  tenantName,
  onClose,
  onDeleted,
}: {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canDelete = confirmName === tenantName;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const result = await deleteTenantPermanently({ data: { clientId: tenantId, confirmName } });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      toast.success(`"${tenantName}" was permanently deleted.`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete this tenant.");
    } finally {
      setDeleting(false);
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
          <DialogTitle className="text-destructive">Delete tenant permanently</DialogTitle>
          <DialogDescription>
            This removes every campaign, lead, call, prompt, inbound number and credit record for "
            {tenantName}". There is no undo.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5 text-sm font-medium">
            Type "{tenantName}" to confirm
            <Input
              value={confirmName}
              onChange={(e) => {
                setConfirmName(e.target.value);
                setError("");
              }}
              autoComplete="off"
            />
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
            <Button type="submit" variant="destructive" disabled={!canDelete || deleting}>
              <Trash2 /> {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
