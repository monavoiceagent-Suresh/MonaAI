import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { Credits } from "@/components/super-admin/Credits";

export const Route = createFileRoute("/super-admin/credits")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Credits & Billing — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Credits & Billing">
      <Credits />
    </SuperAdminShell>
  ),
});
