import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { Tenants } from "@/components/super-admin/Tenants";

export const Route = createFileRoute("/super-admin/tenants")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Tenants — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Tenants">
      <Tenants />
    </SuperAdminShell>
  ),
});
