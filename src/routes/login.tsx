import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { SESSION_QUERY_KEY, signInWithPassword } from "@/lib/auth";
import { monaLogoUrl } from "@/lib/branding";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Mona" },
      {
        name: "description",
        content: "Sign in to your Mona workspace to manage voice agents, campaigns and leads.",
      },
      { property: "og:title", content: "Log in — Mona" },
      { property: "og:description", content: "Sign in to your Mona workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
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
    const result = await signInWithPassword(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
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
          <h1 className="mt-5 text-2xl font-semibold text-foreground">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your Mona workspace</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="u" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="u"
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
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="p" className="block text-xs font-medium text-muted-foreground">
                Password
              </label>
              <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="p"
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
            {submitting ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
