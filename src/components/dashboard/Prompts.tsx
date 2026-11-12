import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Check, FileText, History, Languages, Maximize2, MessageSquareText, Plus, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Picker } from "./CampaignControls";
import { AddPersonaDialog } from "./AddPersonaDialog";
import { newPromptContent, promptLanguages, validatePrompt, type AgentPrompt, type PromptContent, type PromptVersion } from "@/lib/prompts";
import { deletePrompt, listPrompts, savePromptVersion } from "@/lib/prompts.functions";

type TextField = "instructions" | "knowledge" | "greeting";
const textFields: { key: TextField; label: string; rows: number }[] = [
  { key: "instructions", label: "System instructions", rows: 9 }, { key: "knowledge", label: "Knowledge base", rows: 6 },
  { key: "greeting", label: "Opening greeting", rows: 3 },
];
export function Prompts() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["prompts"], queryFn: () => listPrompts() });
  const prompts: AgentPrompt[] = list.data?.prompts ?? [];
  const [chosen, setChosen] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const selected = prompts.some(p => p.id === chosen) ? chosen : prompts[0]?.id ?? "";
  const selectedPrompt = prompts.find(p => p.id === selected);
  const select = (id: string) => { setChosen(id); setNotice(""); };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["prompts"] });
  if (list.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Loading personas…</p>;
  if (list.isError) return <p className="py-16 text-center text-sm text-destructive">Couldn't load your personas. Try again in a moment.</p>;
  if (!list.data?.client) return <p className="py-16 text-center text-sm text-muted-foreground">Your account isn't linked to a workspace yet.</p>;
  return <div className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-sm text-muted-foreground">Your conversation studio</p><h1 className="text-3xl font-semibold sm:text-4xl">Prompts<span className="text-primary">.</span></h1></div><Button onClick={() => setAdding(true)}><Plus />Add persona</Button></header>
    <div className="flex flex-wrap gap-x-8 gap-y-3 border-y border-border py-4 text-sm"><span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-primary" /><strong>{prompts.length}</strong> voice personas</span><span className="flex items-center gap-2"><Check className="h-4 w-4 text-tint-3" /><strong>{prompts.filter(p => p.content.active).length}</strong> marked active</span><span className="ml-auto text-xs text-muted-foreground">Saved to your workspace · a campaign speaks the latest saved revision when it is started</span></div>
    {notice && <p role="status" className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-7 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search personas" placeholder="Find a persona…" className="bg-card pl-9" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="flex gap-2 overflow-x-auto pb-2 xl:flex-col">{prompts.filter(p => p.content.name.toLowerCase().includes(query.toLowerCase())).map(p => <Button key={p.id} variant="outline" aria-pressed={p.id === selected} className={`h-auto w-52 shrink-0 flex-col items-start gap-2 whitespace-normal rounded-lg p-4 text-left xl:w-full ${p.id === selected ? "border-primary bg-primary/5" : "bg-card"}`} onClick={() => select(p.id)}><span className="flex w-full items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 break-words font-semibold">{p.content.name}</span></span><span className="flex w-full justify-between gap-2 text-xs font-normal text-muted-foreground"><span>{p.content.language}</span><span>{p.content.active ? "Active" : "Inactive"}</span></span><span className="text-xs font-normal text-muted-foreground">{`Revision ${p.versions[0]?.version ?? 1}`}</span></Button>)}</div>{!prompts.some(p => p.content.name.toLowerCase().includes(query.toLowerCase())) && <p className="text-sm text-muted-foreground">No matching personas.</p>}</aside>
      {selectedPrompt ? <PromptEditor key={`${selected}-${selectedPrompt.versions[0]?.version ?? 0}`} prompt={selectedPrompt} onSave={async content => { const saved = await savePromptVersion({ data: { promptId: selected, content } }); await refresh(); setNotice(`Saved as revision ${saved.version}. Campaigns use it the next time they are started; calls in progress are unchanged.`); toast.success("Prompt saved successfully."); }} onDelete={async () => { try { await deletePrompt({ data: { promptId: selected } }); await refresh(); setChosen(""); setNotice("Persona deleted."); } catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't delete that persona."); } }} /> : <div className="py-16 text-center"><MessageSquareText className="mx-auto mb-4 h-9 w-9 text-primary" /><h2 className="text-lg font-semibold">No voice personas yet</h2><Button className="mt-4" onClick={() => setAdding(true)}><Plus />Add persona</Button></div>}
    </div>
    {adding && <AddPersonaDialog existingKeys={prompts.map(p => p.content.personaKey)} onClose={() => setAdding(false)} onCreate={async content => { const created = await savePromptVersion({ data: { promptId: null, content: { ...content, greeting: content.greeting || newPromptContent().greeting } } }); await refresh(); select(created.promptId); setQuery(""); setAdding(false); }} />}
  </div>;
}

function PromptEditor({ prompt, onSave, onDelete }: { prompt: AgentPrompt; onSave: (c: PromptContent) => Promise<void>; onDelete: () => Promise<void> }) {
  const [draft, setDraft] = useState<PromptContent>({ ...prompt.content, languages: [...prompt.content.languages] });
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<TextField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<PromptVersion | null>(null);
  const [tab, setTab] = useState("conversation");
  const [restored, setRestored] = useState(false);
  const change = <K extends keyof PromptContent>(key: K, value: PromptContent[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(""); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(prompt.content);
  return <section className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{prompt.content.name}</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{prompt.content.personaKey}</p><p className="mt-1 text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "No pending changes"}{restored ? " · Restored draft" : ""}</p></div><Button variant="ghost" size="icon" aria-label="Delete persona" title="Delete persona" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 /></Button></div>
    <div className="grid gap-5 border-b border-border pb-6 sm:grid-cols-[1fr_auto]"><label className="block space-y-2 text-sm font-medium">Display name<Input maxLength={100} value={draft.name} onChange={e => change("name", e.target.value)} className="bg-card" /></label><label className="flex items-center gap-3 self-end py-2 text-sm"><Switch checked={draft.active} onCheckedChange={v => change("active", v)} />Active persona</label><label className="block space-y-2 text-sm font-medium sm:col-span-2">Call purpose<Textarea maxLength={500} rows={2} value={draft.purpose} onChange={e => change("purpose", e.target.value)} className="bg-card" /><span className="block text-right text-xs font-normal text-muted-foreground">{draft.purpose.length}/500</span></label></div>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="h-auto max-w-full flex-wrap justify-start"><TabsTrigger value="conversation"><MessageSquareText className="mr-2 h-4 w-4" />Conversation</TabsTrigger><TabsTrigger value="history"><History className="mr-2 h-4 w-4" />History <span className="ml-1 text-muted-foreground">{prompt.versions.length}</span></TabsTrigger></TabsList>
      <TabsContent value="conversation" className="space-y-7 pt-5"><div className="space-y-2"><p className="flex items-center gap-2 text-sm font-medium"><Languages className="h-4 w-4 text-tint-2" />Primary language</p><Picker label="Primary language" value={draft.language} onChange={v => change("language", v)} options={promptLanguages.map(l => [l, l])} /></div>
        {textFields.map(f => <div key={f.key} className="space-y-2"><div className="flex items-center justify-between gap-2"><label htmlFor={`prompt-${f.key}`} className="text-sm font-semibold">{f.label}</label><Button variant="ghost" size="icon" aria-label={`Expand ${f.label}`} title={`Expand ${f.label}`} onClick={() => setExpanded(f.key)}><Maximize2 className="h-4 w-4" /></Button></div><Textarea id={`prompt-${f.key}`} rows={f.rows} value={draft[f.key]} onChange={e => change(f.key, e.target.value)} className={`bg-card leading-relaxed ${f.key === "instructions" || f.key === "knowledge" ? "font-mono text-xs sm:text-sm" : ""}`} /></div>)}
      </TabsContent>
      <TabsContent value="history" className="pt-5">{!prompt.versions.length ? <p className="py-10 text-sm text-muted-foreground">No saved revisions yet.</p> : <div className="divide-y divide-border">{prompt.versions.map(v => <div key={v.version} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-semibold">Revision {v.version} · {v.content.name}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(v.at).toLocaleString()}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setViewing(v)}><ArrowUpRight />View</Button><Button variant="ghost" size="sm" onClick={() => { setDraft({ ...v.content, languages: [...v.content.languages] }); setRestored(true); setError(""); setTab("conversation"); }}><RotateCcw />Restore draft</Button></div></div>)}</div>}</TabsContent>
    </Tabs>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-4"><span className="text-xs text-muted-foreground">Each save is a new revision · calls in progress are unchanged</span><div className="flex gap-2"><Button variant="outline" disabled={!dirty} onClick={() => { setDraft({ ...prompt.content, languages: [...prompt.content.languages] }); setError(""); setRestored(false); }}><RotateCcw />Discard</Button><Button onClick={async () => { const message = validatePrompt(draft); if (message) { setError(message); return; } try { await onSave(draft); setRestored(false); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save this prompt."); } }}><Save />Save prompt</Button></div></div>
    <Dialog open={expanded !== null} onOpenChange={v => { if (!v) setExpanded(null); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{textFields.find(f => f.key === expanded)?.label}</DialogTitle><DialogDescription>{draft.name}</DialogDescription></DialogHeader>{expanded && <Textarea aria-label="Expanded prompt editor" rows={18} value={draft[expanded]} onChange={e => change(expanded, e.target.value)} className="font-mono text-sm" />}<Button onClick={() => setExpanded(null)}>Done</Button></DialogContent></Dialog>
    <Dialog open={deleting} onOpenChange={setDeleting}><DialogContent><DialogHeader><DialogTitle>Delete {prompt.content.name}?</DialogTitle><DialogDescription>This removes the persona and its revision history. A persona used by a campaign that has not been completed can't be deleted.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleting(false)}>Cancel</Button><Button variant="destructive" onClick={onDelete}><Trash2 />Delete persona</Button></div></DialogContent></Dialog>
    <Dialog open={viewing !== null} onOpenChange={v => { if (!v) setViewing(null); }}><DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Revision {viewing?.version}</DialogTitle><DialogDescription>{viewing?.content.name}</DialogDescription></DialogHeader>{viewing && <div className="space-y-5"><p className="text-sm">{viewing.content.purpose}</p>{textFields.map(f => <div key={f.key}><h3 className="mb-2 text-sm font-semibold">{f.label}</h3><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{viewing.content[f.key] || "—"}</p></div>)}<div className="border-t border-border pt-4 text-sm"><p>{viewing.content.language} · {viewing.content.active ? "Active" : "Inactive"}</p></div></div>}</DialogContent></Dialog>
  </section>;
}