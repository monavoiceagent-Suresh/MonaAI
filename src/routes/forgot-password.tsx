import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { requestPasswordReset } from "@/lib/password-reset.functions";
import { monaLogoUrl } from "@/lib/branding";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [{ title: "Reset your password — Mona" }],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !email.trim()) return;
    setSubmitting(true);
    await requestPasswordReset({ data: { email: email.trim() } });
    setSubmitting(false);
    setSent(true);
  };

  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <Link
        to="/login"
        className="absolute left-6 top-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </Link>
      <div className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-soft">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={monaLogoUrl} alt="Mona — AI Voice Agent" className="h-14 w-auto" />
          <h1 className="mt-5 text-2xl font-semibold text-foreground">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We'll email you a link to set a new one.
          </p>
        </div>
        {sent ? (
          <p className="text-center text-sm text-foreground">
            If an account exists for that email, a reset link is on its way. It expires in 1 hour.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="e" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input
                id="e"
                type="email"
                className={field}
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
