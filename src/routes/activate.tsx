import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { SESSION_QUERY_KEY } from "@/lib/auth";
import { activateAccount, getInvitationPreview } from "@/lib/invitations.functions";
import { monaLogoUrl } from "@/lib/branding";

const MIN_PASSWORD_LENGTH = 12;

export const Route = createFileRoute("/activate")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Activate your account — Mona" },
      { name: "description", content: "Set your password to activate your Mona workspace." },
    ],
  }),
  component: ActivatePage,
});

function ActivatePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [preview, setPreview] = useState<
    | { status: "loading" }
    | { status: "ready"; email: string; businessName: string }
    | { status: "invalid"; reason: string }
  >({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview({ status: "invalid", reason: "This activation link is missing its token." });
      return;
    }
    let cancelled = false;
    void getInvitationPreview({ data: { token } }).then((result) => {
      if (cancelled) return;
      setPreview(
        result.ok
          ? {
              status: "ready",
              email: result.preview.email,
              businessName: result.preview.businessName,
            }
          : { status: "invalid", reason: result.reason },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canSubmit =
    preview.status === "ready" && password.length >= MIN_PASSWORD_LENGTH && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    const result = await activateAccount({ data: { token, password } });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    queryClient.setQueryData(SESSION_QUERY_KEY, { user: result.user });
    void navigate({ to: "/dashboard" });
  };

  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <Link
        to="/"
        className="absolute left-6 top-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to site
      </Link>
      <div className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={monaLogoUrl} alt="Mona — AI Voice Agent" className="h-14 w-auto" />
          <h1 className="mt-5 text-2xl font-semibold text-foreground">Activate your account</h1>
          {preview.status === "ready" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Set a password for <strong className="text-foreground">{preview.email}</strong> to
              join {preview.businessName}
            </p>
          )}
        </div>

        {preview.status === "loading" && (
          <p className="text-center text-sm text-muted-foreground">Checking your invitation…</p>
        )}

        {preview.status === "invalid" && (
          <div className="text-center">
            <p className="text-sm text-destructive">{preview.reason}</p>
            <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
              Go to sign in
            </Link>
          </div>
        )}

        {preview.status === "ready" && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label
                htmlFor="pw"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="pw"
                  type={show ? "text" : "password"}
                  className={`${field} pr-11`}
                  value={password}
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={200}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>
            <div>
              <label
                htmlFor="pw2"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Confirm password
              </label>
              <input
                id="pw2"
                type={show ? "text" : "password"}
                className={field}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError("");
                }}
              />
              {confirm.length > 0 && confirm !== password && (
                <p className="mt-1.5 text-xs text-destructive">Passwords don't match.</p>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Activating…" : "Activate account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
