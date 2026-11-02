import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { SuperAdminOverview } from "@/components/super-admin/SuperAdminOverview";

export const Route = createFileRoute("/super-admin/")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Super Admin — Mona" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Overview">
      <SuperAdminOverview />
    </SuperAdminShell>
  ),
});
