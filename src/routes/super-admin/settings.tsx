import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { ComingSoon } from "@/components/super-admin/ComingSoon";

export const Route = createFileRoute("/super-admin/settings")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Settings — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Settings">
      <ComingSoon
        icon={Settings}
        title="Settings"
        description="Platform-wide configuration for the Super Admin console."
      />
    </SuperAdminShell>
  ),
});
