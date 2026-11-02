import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { SUPER_ADMIN_SESSION_QUERY_KEY, superAdminSignInWithPassword } from "@/lib/super-admin";
import { monaLogoUrl } from "@/lib/branding";

export const Route = createFileRoute("/super-admin/login")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Super Admin — Mona" }, { name: "robots", content: "noindex" }],
  }),
  component: SuperAdminLoginPage,
});

function SuperAdminLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const result = await superAdminSignInWithPassword(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    queryClient.setQueryData(SUPER_ADMIN_SESSION_QUERY_KEY, { user: result.user });
    void navigate({ to: "/super-admin" });
  };

  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={monaLogoUrl} alt="Mona — AI Voice Agent" className="h-14 w-auto" />
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Super Admin
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Platform sign-in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Restricted to the platform owner account
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="sa-email"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Email
            </label>
            <input
              id="sa-email"
              type="email"
              className={field}
              value={email}
              autoComplete="username"
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
            />
          </div>
          <div>
            <label
              htmlFor="sa-password"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="sa-password"
                type={show ? "text" : "password"}
                className={`${field} pr-11`}
                value={password}
                autoComplete="current-password"
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
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <Link
          to="/login"
          className="mt-6 block text-center text-xs text-muted-foreground hover:text-primary"
        >
          Looking for the tenant dashboard instead?
        </Link>
      </div>
    </div>
  );
}
