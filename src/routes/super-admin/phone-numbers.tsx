import { createFileRoute } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { ComingSoon } from "@/components/super-admin/ComingSoon";

export const Route = createFileRoute("/super-admin/phone-numbers")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Phone Numbers — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Phone Numbers">
      <ComingSoon
        icon={Phone}
        title="Phone Numbers"
        description="Provision Exotel numbers and assign them across tenants."
      />
    </SuperAdminShell>
  ),
});
