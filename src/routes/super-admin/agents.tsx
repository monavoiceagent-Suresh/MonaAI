import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { Agents } from "@/components/super-admin/Agents";

export const Route = createFileRoute("/super-admin/agents")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Agents — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Agents">
      <Agents />
    </SuperAdminShell>
  ),
});
