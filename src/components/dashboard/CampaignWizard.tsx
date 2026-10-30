import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Headphones,
  Settings2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Picker, PersonaPicker, VoicePicker } from "./CampaignControls";
import {
  campaignOutcomes,
  contactTemplate,
  downloadCsv,
  inspectLeadCsv,
  type Campaign,
} from "@/lib/campaigns";
import {
  newCampaignDraft,
  services,
  validateCampaignDraft,
  type CampaignDraft,
} from "@/lib/campaign-setup";
import { campaignFromRow } from "@/lib/campaigns.adapter";
import { createCampaign } from "@/lib/campaigns.functions";
import { importLeads } from "@/lib/leads.functions";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}
function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={onChange}
      className="flex flex-wrap gap-x-6 gap-y-3"
    >
      {options.map(([v, text]) => (
        <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
          <RadioGroupItem value={v ?? ""} />
          {text}
        </label>
      ))}
    </RadioGroup>
  );
}
function OutcomeSelection({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {options.map((s) => (
        <label key={s} className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            checked={selected.includes(s)}
            onCheckedChange={(v) =>
              onChange(v ? [...selected, s] : selected.filter((x) => x !== s))
            }
          />
          {s}
        </label>
      ))}
    </div>
  );
}

export function CampaignWizard({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (c: Campaign) => void;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(newCampaignDraft);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploadErrors, setUploadErrors] = useState<ReturnType<typeof inspectLeadCsv>["errors"]>([]);
  const [preview, setPreview] = useState("valid");
  const [sampleOpen, setSampleOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const patch = (p: Partial<CampaignDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setError("");
  };
  const rules = (p: Partial<CampaignDraft["rules"]>) => patch({ rules: { ...draft.rules, ...p } });
  const setup = (p: Partial<CampaignDraft["setup"]>) => patch({ setup: { ...draft.setup, ...p } });
  const go = (next: number) => {
    setStep(next);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  };
  const upload = async (file: File) => {
    setError("");
    setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Please choose a CSV file.");
      const result = inspectLeadCsv(await file.text());
      patch({ rows: result.rows });
      setUploadErrors(result.errors);
      setFileName(file.name);
      setPreview(result.rows.length ? "valid" : "errors");
      if (!result.rows.length)
        setError("No valid contacts found. Review the errors or choose another file.");
    } catch (err) {
      patch({ rows: [] });
      setUploadErrors([]);
      setFileName("");
      setError(err instanceof Error ? err.message : "Could not read this file.");
    } finally {
      setReading(false);
    }
  };
  const steps = [
    { label: "Campaign details", icon: Settings2 },
    { label: "Contacts", icon: Users },
    { label: "Agent & voice", icon: Headphones },
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <Button variant="ghost" className="-ml-3 text-muted-foreground" onClick={onCancel}>
        <ArrowLeft />
        All campaigns
      </Button>
      <header>
        <p className="mb-2 text-sm text-primary">New outreach</p>
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold outline-none sm:text-4xl">
          Create new campaign<span className="text-primary">.</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Saved to your workspace · dialling starts only once you start the campaign.
        </p>
      </header>
      <nav
        aria-label="Campaign setup progress"
        className="grid grid-cols-3 gap-2 border-y border-border py-5 sm:gap-5"
      >
        {steps.map(({ label, icon: Icon }, i) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            disabled={i > step}
            aria-current={step === i ? "step" : undefined}
            onClick={() => go(i)}
            className={`h-auto min-h-14 justify-start gap-3 whitespace-normal px-2 text-left ${i === step ? "bg-primary/5 text-primary" : "text-muted-foreground"}`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${i <= step ? "bg-primary/10 text-primary" : "bg-muted"}`}
            >
              {i < step ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </span>
            <span className="hidden text-sm sm:block">
              <span className="block text-xs font-normal text-muted-foreground">0{i + 1}</span>
              {label}
            </span>
            <span className="text-xs sm:hidden">{i + 1}</span>
          </Button>
        ))}
      </nav>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const message = validateCampaignDraft(draft, step);
          if (message) {
            setError(message);
            return;
          }
          if (step < 2) {
            go(step + 1);
            return;
          }
          setSubmitting(true);
          try {
            const row = await createCampaign({
              data: {
                name: draft.name,
                purpose: draft.purpose,
                callingStart: draft.rules.start,
                callingEnd: draft.rules.end,
                maxTries: draft.rules.maxTries,
                retryGapMinutes: draft.rules.retryGap,
                callbackWindowDays: draft.rules.callbackWindow,
                personaKey: draft.persona,
                voice: draft.voice,
                voiceId: draft.voiceId || undefined,
                voiceModelId: draft.voiceModelId || undefined,
                ambience: draft.ambience,
                creditCap: draft.setup.creditCap,
              },
            });
            if (draft.rows.length) {
              await importLeads({
                data: {
                  campaignId: row.id,
                  rows: draft.rows.map((r) => ({ name: r.name, phone: r.phone })),
                },
              });
            }
            onCreate(
              campaignFromRow(
                row,
                draft.rows.length,
                { calls: 0, minutes: 0, interested: 0 },
                draft.rows,
              ),
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "Please review the campaign.");
          } finally {
            setSubmitting(false);
          }
        }}
        className="space-y-8"
      >
        {step === 0 && (
          <div className="space-y-8">
            <section className="grid gap-6 lg:grid-cols-[210px_1fr]">
              <div>
                <h2 className="text-lg font-semibold">The essentials</h2>
                <p className="mt-1 text-sm text-muted-foreground">Name & service</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Campaign name *">
                  <Input
                    aria-label="Campaign name"
                    maxLength={100}
                    placeholder="e.g. October follow-ups"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
                <Field label="Service *">
                  <Picker
                    label="Service"
                    value={draft.purpose}
                    onChange={(purpose) => patch({ purpose })}
                    options={services.map((s) => [s, s])}
                  />
                </Field>
              </div>
            </section>
            <section className="grid gap-6 border-t border-border pt-7 lg:grid-cols-[210px_1fr]">
              <div>
                <h2 className="text-lg font-semibold">When to call</h2>
                <p className="mt-1 text-sm text-muted-foreground">Start & calling window</p>
              </div>
              <div className="space-y-5">
                <Choice
                  label="Campaign start"
                  value={draft.setup.startMode}
                  onChange={(v) =>
                    setup({ startMode: v === "scheduled" ? "scheduled" : "immediate" })
                  }
                  options={[
                    ["immediate", "Start immediately"],
                    ["scheduled", "Schedule a start"],
                  ]}
                />
                {draft.setup.startMode === "scheduled" && (
                  <Field label="Start date & time (your local time)">
                    <Input
                      aria-label="Scheduled start"
                      type="datetime-local"
                      value={draft.setup.scheduledAt}
                      onChange={(e) => setup({ scheduledAt: e.target.value })}
                    />
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Calling starts">
                    <Input
                      aria-label="Calling starts"
                      type="time"
                      value={draft.rules.start}
                      onChange={(e) => rules({ start: e.target.value })}
                    />
                  </Field>
                  <Field label="Calling ends">
                    <Input
                      aria-label="Calling ends"
                      type="time"
                      value={draft.rules.end}
                      onChange={(e) => rules({ end: e.target.value })}
                    />
                  </Field>
                  <Field label="Calling days">
                    <Picker
                      label="Calling days"
                      value={draft.rules.days}
                      onChange={(days) => rules({ days })}
                      options={[
                        ["All days", "All days"],
                        ["Weekdays", "Weekdays"],
                        ["Weekends", "Weekends"],
                      ]}
                    />
                  </Field>
                </div>
              </div>
            </section>
            <section className="grid gap-6 border-t border-border pt-7 lg:grid-cols-[210px_1fr]">
              <div>
                <h2 className="text-lg font-semibold">Follow-up rhythm</h2>
                <p className="mt-1 text-sm text-muted-foreground">Retries & callbacks</p>
              </div>
              <div className="space-y-6">
                <Choice
                  label="Retry mode"
                  value={draft.setup.retryMode}
                  onChange={(v) =>
                    setup({ retryMode: v === "scheduled" ? "scheduled" : "immediate" })
                  }
                  options={[
                    ["immediate", "Immediate retries"],
                    ["scheduled", "Scheduled retries"],
                  ]}
                />
                {draft.setup.retryMode === "scheduled" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Retry window starts">
                      <Input
                        aria-label="Retry window starts"
                        type="time"
                        value={draft.setup.retryStart}
                        onChange={(e) => setup({ retryStart: e.target.value })}
                      />
                    </Field>
                    <Field label="Retry window ends">
                      <Input
                        aria-label="Retry window ends"
                        type="time"
                        value={draft.setup.retryEnd}
                        onChange={(e) => setup({ retryEnd: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
                <Field label="Retry these outcomes">
                  <OutcomeSelection
                    options={campaignOutcomes.slice(0, 6)}
                    selected={draft.setup.retryOutcomes}
                    onChange={(retryOutcomes) =>
                      setup({
                        retryOutcomes,
                        outcomes: Array.from(new Set([...draft.setup.outcomes, ...retryOutcomes])),
                      })
                    }
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Maximum tries *">
                    <Input
                      aria-label="Maximum tries"
                      type="number"
                      min={1}
                      step={1}
                      value={draft.rules.maxTries}
                      onChange={(e) => rules({ maxTries: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Retry delay (minutes) *">
                    <Input
                      aria-label="Retry delay"
                      type="number"
                      min={1}
                      step={1}
                      value={draft.rules.retryGap}
                      onChange={(e) => rules({ retryGap: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Callback window (days) *">
                    <Input
                      aria-label="Callback window"
                      type="number"
                      min={1}
                      step={1}
                      value={draft.rules.callbackWindow}
                      onChange={(e) => rules({ callbackWindow: Number(e.target.value) })}
                    />
                  </Field>
                </div>
              </div>
            </section>
            <section className="grid gap-6 border-t border-border pt-7 lg:grid-cols-[210px_1fr]">
              <div>
                <h2 className="text-lg font-semibold">Outcomes & usage</h2>
                <p className="mt-1 text-sm text-muted-foreground">Tracking & minute cap</p>
              </div>
              <div className="space-y-5">
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  All campaign outcomes
                  <Switch
                    checked={draft.setup.outcomes.length === campaignOutcomes.length}
                    onCheckedChange={(on) =>
                      setup({
                        outcomes: on ? [...campaignOutcomes] : [],
                        retryOutcomes: on ? draft.setup.retryOutcomes : [],
                      })
                    }
                  />
                </label>
                <OutcomeSelection
                  options={campaignOutcomes}
                  selected={draft.setup.outcomes}
                  onChange={(outcomes) =>
                    setup({
                      outcomes,
                      retryOutcomes: draft.setup.retryOutcomes.filter((s) => outcomes.includes(s)),
                    })
                  }
                />
                <Field label="Credit cap (AI minutes)">
                  <Input
                    aria-label="Credit cap"
                    type="number"
                    min={1}
                    placeholder="No cap"
                    value={draft.setup.creditCap ?? ""}
                    onChange={(e) =>
                      setup({ creditCap: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
            </section>
          </div>
        )}
        {step === 1 && (
          <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Who’s on your list?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Contacts · name & number</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setSampleOpen(true)}>
                <FileSpreadsheet />
                View sample sheet
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="Upload campaign contacts"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            {!fileName ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file && !reading) void upload(file);
                }}
                className={`flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed px-5 py-8 ${dragging ? "border-primary bg-primary/5" : "border-border bg-card"}`}
              >
                <Upload className="h-8 w-8 text-primary" />
                <Button type="button" disabled={reading} onClick={() => fileInput.current?.click()}>
                  {reading ? "Reading contacts…" : "Choose CSV file"}
                </Button>
                <p className="text-sm text-muted-foreground">or drop your file here</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 border-y border-border py-4">
                <FileSpreadsheet className="h-6 w-6 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-medium">{fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {draft.rows.length} contacts ready
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove contact file"
                  onClick={() => {
                    patch({ rows: [] });
                    setFileName("");
                    setUploadErrors([]);
                  }}
                >
                  <X />
                </Button>
              </div>
            )}
            {fileName && (
              <>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant={preview === "valid" ? "default" : "outline"}
                    onClick={() => setPreview("valid")}
                  >
                    Valid contacts · {draft.rows.length}
                  </Button>
                  <Button
                    type="button"
                    variant={preview === "errors" ? "default" : "outline"}
                    onClick={() => setPreview("errors")}
                  >
                    Errors · {uploadErrors.length}
                  </Button>
                </div>
                <div className="max-h-80 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Number</th>
                        {preview === "errors" && <th className="px-4 py-3 font-medium">Issue</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {preview === "valid"
                        ? draft.rows.slice(0, 50).map((l) => (
                            <tr key={l.id} className="border-t border-border">
                              <td className="break-words px-4 py-3">{l.name}</td>
                              <td className="whitespace-nowrap px-4 py-3">{l.phone}</td>
                            </tr>
                          ))
                        : uploadErrors.slice(0, 50).map((l) => (
                            <tr key={l.row} className="border-t border-border">
                              <td className="px-4 py-3">{l.name}</td>
                              <td className="px-4 py-3">{l.number || "—"}</td>
                              <td className="px-4 py-3 text-destructive">
                                Row {l.row}: {l.reason}
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                  {preview === "errors" && !uploadErrors.length && (
                    <p className="p-6 text-sm text-muted-foreground">No errors found.</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Only valid contacts are included. Preview shows up to 50 rows.
                </p>
              </>
            )}
          </section>
        )}
        {step === 2 && (
          <div className="grid gap-8 lg:grid-cols-[1fr_270px]">
            <section className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">Give your campaign a voice</h2>
              </div>
              <Field label="Agent persona *">
                <PersonaPicker value={draft.persona} onChange={(persona) => patch({ persona })} />
              </Field>
              <Field label="Voice *">
                <VoicePicker voiceId={draft.voiceId} onChange={(choice) => patch(choice)} />
              </Field>
            </section>
            <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
              <h2 className="mb-5 text-lg font-semibold">Campaign at a glance</h2>
              <dl className="space-y-4 text-sm">
                {[
                  ["Name", draft.name],
                  ["Service", draft.purpose],
                  ["Contacts", String(draft.rows.length)],
                  [
                    "Start",
                    draft.setup.startMode === "immediate"
                      ? "Immediately (sample)"
                      : draft.setup.scheduledAt.replace("T", " · "),
                  ],
                  ["Calling hours", `${draft.rules.start} – ${draft.rules.end}`],
                  ["Retries", `${draft.rules.maxTries} tries · ${draft.rules.retryGap} min gap`],
                  [
                    "Credit cap",
                    draft.setup.creditCap === null ? "No cap" : `${draft.setup.creditCap} minutes`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <footer className="flex items-center justify-between gap-3 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => (step ? go(step - 1) : onCancel())}
          >
            <ArrowLeft />
            {step ? "Back" : "Cancel"}
          </Button>
          <Button type="submit" disabled={reading || submitting}>
            {step === 2 ? (submitting ? "Creating…" : "Create campaign") : "Continue"}
            {step === 2 ? <Check /> : <ArrowRight />}
          </Button>
        </footer>
      </form>
      <Dialog open={sampleOpen} onOpenChange={setSampleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact sample sheet</DialogTitle>
            <DialogDescription>Sample data · replace with your contacts.</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {contactTemplate[0]?.map((s) => (
                    <th key={s} className="border-b border-border py-3 font-medium">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {contactTemplate[1]?.map((s) => (
                    <td key={s} className="py-3">
                      {s}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <Button onClick={() => downloadCsv("mona-contacts-sample.csv", contactTemplate)}>
            <Download />
            Download sample CSV
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
