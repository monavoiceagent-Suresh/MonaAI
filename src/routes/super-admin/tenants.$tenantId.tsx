import { createFileRoute } from "@tanstack/react-router";
import { SuperAdminShell } from "@/components/super-admin/SuperAdminShell";
import { TenantDetail } from "@/components/super-admin/TenantDetail";

export const Route = createFileRoute("/super-admin/tenants/$tenantId")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Tenant — Super Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: TenantDetailPage,
});

function TenantDetailPage() {
  const { tenantId } = Route.useParams();
  return (
    <SuperAdminShell active="Tenants">
      <TenantDetail tenantId={tenantId} />
    </SuperAdminShell>
  );
}
