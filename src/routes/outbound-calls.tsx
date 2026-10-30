import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/dashboard/WorkspaceShell";
import { CallJournal } from "@/components/dashboard/CallJournal";
import { TestOutboundCallCard } from "@/components/dashboard/TestOutboundCallCard";

export const Route = createFileRoute("/outbound-calls")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Outbound Calls — Mona" },
      {
        name: "description",
        content: "Review your campaign calls: outcomes, duration, summaries and transcripts.",
      },
      { property: "og:title", content: "Outbound Calls — Mona" },
      { property: "og:description", content: "Your outbound conversation journal in Mona." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <WorkspaceShell active="Outbound Calls">
      <div className="space-y-6">
        <TestOutboundCallCard />
        <CallJournal direction="outbound" />
      </div>
    </WorkspaceShell>
  ),
});
