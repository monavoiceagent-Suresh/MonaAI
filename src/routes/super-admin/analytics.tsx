import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { Analytics } from "@/components/super-admin/Analytics";

export const Route = createFileRoute("/super-admin/analytics")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Analytics — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Analytics">
      <Analytics />
    </SuperAdminShell>
  ),
});
