import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { PhoneNumbers } from "@/components/super-admin/PhoneNumbers";

export const Route = createFileRoute("/super-admin/phone-numbers")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Phone Numbers — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <SuperAdminShell active="Phone Numbers">
      <PhoneNumbers />
    </SuperAdminShell>
  ),
});
