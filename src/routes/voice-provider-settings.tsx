import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/dashboard/WorkspaceShell";
import { VoiceProviderSettings } from "@/components/dashboard/VoiceProviderSettings";

export const Route = createFileRoute("/voice-provider-settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Voice Providers — Mona" },
      {
        name: "description",
        content: "Choose which ASR and TTS providers your Mona workspace uses.",
      },
      { property: "og:title", content: "Voice Providers — Mona" },
      { property: "og:description", content: "Your ASR and TTS provider choices in Mona." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <WorkspaceShell active="Voice Providers">
      <VoiceProviderSettings />
    </WorkspaceShell>
  ),
});
