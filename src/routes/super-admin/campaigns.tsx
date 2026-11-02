import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { CampaignsOverview } from "@/components/super-admin/CampaignsOverview";

export const Route = createFileRoute("/super-admin/campaigns")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Campaigns — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Campaigns">
      <CampaignsOverview />
    </SuperAdminShell>
  ),
});
