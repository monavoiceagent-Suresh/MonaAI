import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  AudioLines,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Tags,
  PanelLeftClose,
  PanelLeftOpen,
  Coins,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SESSION_QUERY_KEY, signOutCurrentUser, useAuthSession } from "@/lib/auth";
import { monaLogoUrl } from "@/lib/branding";
import { getWorkspaceCredits } from "@/lib/workspace.functions";

const menu = [
  { label: "Dashboard", icon: LayoutGrid },
  { label: "Campaigns", icon: Megaphone },
  { label: "Prompts", icon: MessageSquareText },
  { label: "Inbound Numbers", icon: PhoneIncoming },
  { label: "Outbound Calls", icon: PhoneOutgoing },
  { label: "Missed Callbacks", icon: PhoneMissed },
  { label: "Call Outcome Rules", icon: Tags },
];
export function WorkspaceShell({ active, children }: { active: string; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const { status, user } = useAuthSession();
  useEffect(() => {
    if (status === "signed-out") void navigate({ to: "/login", replace: true });
  }, [status, navigate]);
  const credits = useQuery({
    queryKey: ["workspace-credits"],
    queryFn: () => getWorkspaceCredits(),
    enabled: status === "signed-in",
  });
  if (status !== "signed-in") return null;
  const name = user?.fullName || user?.email.split("@")[0] || "Signed in";
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-all duration-300 ${collapsed ? "w-20" : "w-20 md:w-64"}`}
      >
        <div className="relative flex items-center justify-center gap-3 border-b border-border px-4 py-5">
          {collapsed ? (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orb text-primary-foreground">
              <AudioLines className="h-5 w-5" />
            </span>
          ) : (
            <img src={monaLogoUrl} alt="Mona — AI Voice Agent" className="h-9 w-auto" />
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle menu"
            title="Toggle menu"
            className="absolute -right-4 top-7 hidden h-7 w-7 rounded-full border border-border bg-card md:flex"
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="Workspace">
          {menu.map(({ label, icon: Icon }) => {
            const content = (
              <>
                <Icon className="h-5 w-5 shrink-0" />
                <span
                  className={
                    collapsed
                      ? "sr-only"
                      : "hidden min-w-0 whitespace-normal text-left leading-tight md:inline"
                  }
                >
                  {label}
                </span>
              </>
            );
            const cls = `h-12 w-full justify-start gap-3 rounded-xl px-3.5 ${collapsed ? "justify-center" : ""} ${active === label ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`;
            return (
              <Button key={label} variant="ghost" asChild className={cls}>
                <Link
                  to={
                    label === "Campaigns"
                      ? "/campaigns"
                      : label === "Prompts"
                        ? "/prompts"
                        : label === "Inbound Numbers"
                          ? "/inbound"
                          : label === "Outbound Calls"
                            ? "/outbound-calls"
                            : label === "Missed Callbacks"
                              ? "/missed-callbacks"
                              : label === "Call Outcome Rules"
                                ? "/call-outcome-rules"
                                : "/dashboard"
                  }
                  title={label}
                >
                  {content}
                </Link>
              </Button>
            );
          })}
        </nav>
        {!collapsed && (
          <div className="mx-3 mb-4 hidden rounded-2xl border border-border bg-background p-4 text-center md:block">
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Coins className="h-3.5 w-3.5" /> AI Credits
            </p>
            {credits.isLoading ? (
              <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
            ) : credits.isError ? (
              <p className="mt-1 text-xs text-destructive">Couldn't load credits</p>
            ) : credits.data?.client ? (
              <>
                <p className="mt-1 text-3xl font-semibold text-primary">
                  {credits.data.client.creditBalance.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-muted-foreground">minutes remaining</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No workspace linked to this account
              </p>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 border-t border-border px-4 py-4">
          {!collapsed && (
            <>
              <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground md:grid">
                {initial}
              </span>
              <div className="hidden min-w-0 flex-1 md:block">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Log out"
            title="Log out"
            onClick={() => {
              void signOutCurrentUser().then(() => {
                queryClient.setQueryData(SESSION_QUERY_KEY, { user: null });
                return navigate({ to: "/login", replace: true });
              });
            }}
          >
            <LogOut />
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-7 xl:p-10">{children}</main>
    </div>
  );
}
