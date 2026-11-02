import type { LucideIcon } from "lucide-react";

/** Structure-only placeholder for a sidebar module whose business functionality is a later
 * phase (tenant CRUD, billing, Exotel, agents, campaigns, analytics). Establishes the route
 * and navigation entry now without inventing data or behavior for it. */
export function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <section className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card p-16 text-center shadow-soft">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </span>
        <p className="text-sm font-medium text-foreground">Coming in a future phase</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This section's navigation is in place; its functionality has not been built yet.
        </p>
      </section>
    </div>
  );
}
