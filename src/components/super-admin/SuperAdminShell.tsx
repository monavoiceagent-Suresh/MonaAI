import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Building2,
  Phone,
  Coins,
  Bot,
  Megaphone,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { monaLogoUrl } from "@/lib/branding";
import {
  SUPER_ADMIN_SESSION_QUERY_KEY,
  superAdminSignOut,
  useSuperAdminSession,
} from "@/lib/super-admin";

const menu = [
  { label: "Overview", icon: LayoutDashboard, to: "/super-admin" },
  { label: "Tenants", icon: Building2, to: "/super-admin/tenants" },
  { label: "Phone Numbers", icon: Phone, to: "/super-admin/phone-numbers" },
  { label: "Credits & Billing", icon: Coins, to: "/super-admin/credits" },
  { label: "Agents", icon: Bot, to: "/super-admin/agents" },
  { label: "Campaigns", icon: Megaphone, to: "/super-admin/campaigns" },
  { label: "Analytics", icon: BarChart3, to: "/super-admin/analytics" },
  { label: "Settings", icon: Settings, to: "/super-admin/settings" },
] as const;

/** Mirrors WorkspaceShell's layout/guard pattern, but gates on the Super Admin session instead
 * of the tenant one, and sends an unauthorized visitor to /super-admin/login, never /login. */
export function SuperAdminShell({ active, children }: { active: string; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const { status, user } = useSuperAdminSession();

  useEffect(() => {
    if (status === "signed-out") void navigate({ to: "/super-admin/login", replace: true });
  }, [status, navigate]);

  if (status !== "signed-in") return null;
  const name = user?.fullName || user?.email.split("@")[0] || "Super Admin";
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-all duration-300 ${collapsed ? "w-20" : "w-20 lg:w-64"}`}
      >
        <div className="relative flex items-center justify-center gap-3 border-b border-border px-4 py-5">
          {collapsed ? (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orb text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
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
            className="absolute -right-4 top-7 hidden h-7 w-7 rounded-full border border-border bg-card lg:flex"
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        {!collapsed && (
          <div className="mx-3 mt-3 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-primary">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="hidden text-xs font-semibold lg:inline">Super Admin</span>
          </div>
        )}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="Super Admin">
          {menu.map(({ label, icon: Icon, to }) => {
            const content = (
              <>
                <Icon className="h-5 w-5 shrink-0" />
                <span
                  className={
                    collapsed
                      ? "sr-only"
                      : "hidden min-w-0 whitespace-normal text-left leading-tight lg:inline"
                  }
                >
                  {label}
                </span>
              </>
            );
            const cls = `h-12 w-full justify-start gap-3 rounded-xl px-3.5 ${collapsed ? "justify-center" : ""} ${active === label ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`;
            return (
              <Button key={label} variant="ghost" asChild className={cls}>
                <Link to={to} title={label}>
                  {content}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 border-t border-border px-4 py-4">
          {!collapsed && (
            <>
              <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground lg:grid">
                {initial}
              </span>
              <div className="hidden min-w-0 flex-1 lg:block">
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
              void superAdminSignOut().then(() => {
                queryClient.setQueryData(SUPER_ADMIN_SESSION_QUERY_KEY, { user: null });
                return navigate({ to: "/super-admin/login", replace: true });
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
