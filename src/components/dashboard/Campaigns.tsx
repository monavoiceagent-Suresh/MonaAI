import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Contact,
  Megaphone,
  Plus,
  Search,
  Users,
  PhoneCall,
  Pause,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampaignForm, Picker } from "./CampaignControls";
import { CampaignDetail, Status } from "./CampaignDetail";
import { CampaignWizard } from "./CampaignWizard";
import { VoiceLeads } from "./VoiceLeads";
import { campaignStatuses, filterCampaigns, type Campaign } from "@/lib/campaigns";
import { campaignFromRow, leadFromRow } from "@/lib/campaigns.adapter";
import {
  listCampaigns,
  startCampaignDispatch,
  updateCampaignDetails,
  updateCampaignStatus,
  type CampaignCallStats,
} from "@/lib/campaigns.functions";
import { importLeads, listLeads } from "@/lib/leads.functions";

const LIVE_REFRESH_MS = 10_000;

export function Campaigns() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("newest");
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [tab, setTab] = useState<"campaigns" | "leads">("campaigns");

  // While a campaign is dialling, results arrive from the voice engine in the background.
  const list = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaigns(),
    refetchInterval: (query) =>
      query.state.data?.campaigns.some((c) => c.status === "Active") ? LIVE_REFRESH_MS : false,
  });
  const anyActive = list.data?.campaigns.some((c) => c.status === "Active") ?? false;
  const leadsQuery = useQuery({
    queryKey: ["leads", selected],
    queryFn: () => listLeads({ data: { campaignId: selected! } }),
    enabled: selected !== null,
    refetchInterval: anyActive ? LIVE_REFRESH_MS : false,
  });

  const noWorkspace = !list.isLoading && !list.isError && !list.data?.client;
  const emptyStats: CampaignCallStats = { calls: 0, minutes: 0, interested: 0 };
  const campaigns: Campaign[] = (list.data?.campaigns ?? []).map((row) =>
    campaignFromRow(
      row,
      list.data?.leadCounts[row.id] ?? 0,
      list.data?.callStats[row.id] ?? emptyStats,
    ),
  );
  const currentRow = list.data?.campaigns.find((c) => c.id === selected);
  const current: Campaign | undefined = currentRow
    ? campaignFromRow(
        currentRow,
        list.data?.leadCounts[currentRow.id] ?? 0,
        list.data?.callStats[currentRow.id] ?? emptyStats,
        (leadsQuery.data?.leads ?? []).map(leadFromRow),
      )
    : undefined;
  const visible = filterCampaigns(campaigns, query, status, sort);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    if (selected) void queryClient.invalidateQueries({ queryKey: ["leads", selected] });
  };

  // CampaignDetail mutates a full Campaign object locally; this translates
  // only the fields that actually changed into the matching persisted
  // mutation, so the UI's existing onUpdate contract needs no changes.
  const update = async (next: Campaign) => {
    if (!current) return;
    try {
      if (next.status !== current.status) {
        if (next.status === "Active") {
          // Starting means handing the queued leads to the voice engine, which calls them.
          const result = await startCampaignDispatch({ data: { campaignId: next.id } });
          if (!result.ok) throw new Error(result.reason ?? "Couldn't start the campaign.");
          toast.success("Campaign started. Queued leads are called within your calling hours.");
        } else {
          await updateCampaignStatus({ data: { campaignId: next.id, nextStatus: next.status } });
        }
      }
      if (next.rows.length > current.rows.length) {
        const added = next.rows.slice(current.rows.length);
        await importLeads({
          data: { campaignId: next.id, rows: added.map((r) => ({ name: r.name, phone: r.phone })) },
        });
      }
      if (
        next.name !== current.name ||
        next.purpose !== current.purpose ||
        next.persona !== current.persona ||
        next.rules.start !== current.rules.start ||
        next.rules.end !== current.rules.end ||
        next.voiceId !== current.voiceId ||
        next.voiceStability !== current.voiceStability ||
        next.voiceSimilarityBoost !== current.voiceSimilarityBoost ||
        next.voiceStyle !== current.voiceStyle
      ) {
        await updateCampaignDetails({
          data: {
            campaignId: next.id,
            name: next.name,
            purpose: next.purpose,
            personaKey: next.persona,
            callingStart: next.rules.start,
            callingEnd: next.rules.end,
            voice: next.voice || undefined,
            voiceId: next.voiceId || undefined,
            voiceModelId: next.voiceModelId || undefined,
            voiceStability: next.voiceStability,
            voiceSimilarityBoost: next.voiceSimilarityBoost,
            voiceStyle: next.voiceStyle,
          },
        });
      }
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that change.");
    }
  };

  if (form === "create") {
    return (
      <CampaignWizard
        onCancel={() => setForm(null)}
        onCreate={(c) => {
          invalidate();
          setSelected(c.id);
          setForm(null);
        }}
      />
    );
  }

  if (list.isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading campaigns…</p>;
  }
  if (list.isError) {
    return (
      <p className="py-16 text-center text-sm text-destructive">
        Couldn't load your campaigns. Try again in a moment.
      </p>
    );
  }

  return (
    <>
      {current ? (
        <CampaignDetail
          key={current.id}
          campaign={current}
          onBack={() => setSelected(null)}
          onEdit={() => setForm("edit")}
          onUpdate={update}
        />
      ) : tab === "leads" ? (
        <div className="space-y-8">
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1" role="tablist">
            <Button
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={false}
              onClick={() => setTab("campaigns")}
              className="gap-2 text-muted-foreground"
            >
              <Megaphone className="h-4 w-4" /> Campaigns
            </Button>
            <Button
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={true}
              className="gap-2 bg-primary/10 font-semibold text-primary"
            >
              <Contact className="h-4 w-4" /> Voice Leads
            </Button>
          </div>
          <VoiceLeads onManageCampaigns={() => setTab("campaigns")} />
        </div>
      ) : (
        <div className="space-y-8">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Your outreach workspace</p>
              <h1 className="text-3xl font-semibold sm:text-4xl">
                Campaigns<span className="text-primary">.</span>
              </h1>
            </div>
            <Button onClick={() => setForm("create")} className="h-10" disabled={noWorkspace}>
              <Plus />
              Create new campaign
            </Button>
          </header>
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1" role="tablist">
            <Button
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={true}
              className="gap-2 bg-primary/10 font-semibold text-primary"
            >
              <Megaphone className="h-4 w-4" /> Campaigns
            </Button>
            <Button
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={false}
              onClick={() => setTab("leads")}
              className="gap-2 text-muted-foreground"
            >
              <Contact className="h-4 w-4" /> Voice Leads
            </Button>
          </div>
          {noWorkspace && (
            <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Your account isn't linked to a workspace yet, so there are no campaigns to show.
            </p>
          )}
          <div className="grid grid-cols-2 gap-5 border-y border-border py-6 xl:grid-cols-4">
            {[
              { label: "Total campaigns", value: campaigns.length, icon: Megaphone },
              {
                label: "Active",
                value: campaigns.filter((c) => c.status === "Active").length,
                icon: PhoneCall,
              },
              {
                label: "Paused",
                value: campaigns.filter((c) => c.status === "Paused").length,
                icon: Pause,
              },
              {
                label: "Completed",
                value: campaigns.filter((c) => c.status === "Completed").length,
                icon: CheckCheck,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex gap-3">
                <Icon className="mt-1 h-5 w-5 text-primary" />
                <div>
                  <p className="text-2xl font-semibold">{value.toString().padStart(2, "0")}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search campaigns"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a campaign…"
                  className="h-10 bg-card pl-10"
                />
              </div>
              <Picker
                label="Sort campaigns"
                value={sort}
                onChange={setSort}
                options={[
                  ["newest", "Newest first"],
                  ["oldest", "Oldest first"],
                  ["name", "Name A–Z"],
                ]}
                className="h-10 w-44"
              />
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Campaign status filters">
              {["All", ...campaignStatuses].map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  className={status === s ? "bg-primary/10 text-primary" : "text-muted-foreground"}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {status === "All" ? "All campaigns" : `${status} campaigns`}
              </h2>
              <span className="text-xs text-muted-foreground">{visible.length} campaigns</span>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {visible.map((c) => (
                <article
                  key={c.id}
                  className="group relative rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <Status value={c.status} />
                    <span className="text-xs text-muted-foreground">Standard</span>
                  </div>
                  <Button
                    variant="link"
                    onClick={() => setSelected(c.id)}
                    className="mt-4 h-auto max-w-full justify-start whitespace-normal p-0 text-left text-xl font-semibold text-foreground after:absolute after:inset-0 after:content-[''] hover:no-underline"
                  >
                    <span>{c.name}</span>
                    <ArrowUpRight className="text-primary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Button>
                  <p className="mt-1 text-sm text-muted-foreground">{c.purpose}</p>
                  <div className="mt-6 flex flex-wrap items-center gap-5 border-t border-border pt-4">
                    <span className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-primary" />
                      <strong className="font-medium">{c.leads.toLocaleString("en-IN")}</strong>
                      <span className="text-muted-foreground">leads</span>
                    </span>
                    <span className="flex items-center gap-2 text-sm">
                      <PhoneCall className="h-4 w-4 text-tint-2" />
                      <strong className="font-medium">{c.calls.toLocaleString("en-IN")}</strong>
                      <span className="text-muted-foreground">calls</span>
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(`${c.created}T12:00:00`).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {!visible.length && (
              <div className="border-y border-dashed border-border py-16 text-center">
                <Megaphone className="mx-auto mb-4 h-8 w-8 text-primary/40" />
                <p className="font-medium">No campaigns found</p>
                <Button
                  variant="link"
                  onClick={() => {
                    setQuery("");
                    setStatus("All");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
      {form && current && (
        <CampaignForm
          key={`${form}-${selected}`}
          campaign={current}
          onClose={() => setForm(null)}
          onSave={(c) => {
            void update(c);
            setForm(null);
          }}
        />
      )}
    </>
  );
}
