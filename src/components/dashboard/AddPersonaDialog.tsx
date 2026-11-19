import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Picker } from "./CampaignControls";
import { PersonaBuilder } from "./PersonaBuilder";
import { RecognitionHintsField } from "./RecognitionHintsField";
import { newPromptContent, personaKeyFromName, promptLanguages, validatePersonaKey, type PromptContent } from "@/lib/prompts";

export function AddPersonaDialog({ onClose, onCreate, existingKeys }: { onClose: () => void; onCreate: (content: PromptContent) => Promise<void>; existingKeys: string[] }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [customKey, setCustomKey] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [language, setLanguage] = useState("English");
  const [instructions, setInstructions] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [greeting, setGreeting] = useState("");
  const [recognitionHints, setRecognitionHints] = useState("");
  const [error, setError] = useState("");
  const keyError = validatePersonaKey(key, existingKeys);
  const canCreate = name.trim().length >= 2 && !keyError && instructions.trim().length > 0;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col overflow-hidden p-0">
    <DialogHeader className="shrink-0 border-b border-border px-6 py-5 text-left"><DialogTitle className="text-xl">Add a new persona</DialogTitle><DialogDescription>Saved to your workspace. Campaigns can use it once it is created.</DialogDescription></DialogHeader>
    <form className="flex min-h-0 flex-col" onSubmit={e => { e.preventDefault(); if (!canCreate) { setError(keyError ?? "Add a display name and system instructions."); return; } onCreate({ ...newPromptContent(name.trim()), personaKey: key, purpose: purpose.trim(), language, languages: [language], instructions: instructions.trim(), knowledge: knowledge.trim(), greeting: greeting.trim(), recognitionHints: recognitionHints.trim() }).catch(err => setError(err instanceof Error ? err.message : "Couldn't create this persona.")); }}>
      <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
        <PersonaBuilder />
        <label className="block space-y-2 text-sm font-medium">Display name<Input required minLength={2} maxLength={100} value={name} placeholder="e.g. Customer enquiry assistant" onChange={e => { setName(e.target.value); if (!customKey) setKey(personaKeyFromName(e.target.value)); setError(""); }} /></label>
        <label className="block space-y-2 text-sm font-medium">Persona key<Input required minLength={2} maxLength={40} pattern="[a-z0-9-]{2,40}" value={key} placeholder="customer-enquiry-assistant" onChange={e => { setKey(e.target.value); setCustomKey(e.target.value !== ""); if (!e.target.value) setKey(personaKeyFromName(name)); setError(""); }} aria-describedby="persona-key-note" /><span id="persona-key-note" className={`block text-xs font-normal ${key && keyError ? "text-destructive" : "text-muted-foreground"}`}>{key && keyError ? keyError : "2–40 lowercase letters, numbers, or hyphens"}</span></label>
        <label className="block space-y-2 text-sm font-medium">Call purpose <span className="font-normal text-muted-foreground">(optional)</span><Textarea rows={3} maxLength={500} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Follow up on a recent enquiry, understand the customer’s needs, and agree on a useful next step." /><span className="block text-right text-xs font-normal text-muted-foreground">{purpose.length}/500</span></label>
        <div className="space-y-2"><p className="text-sm font-medium">Language</p><Picker label="Persona language" value={language} onChange={setLanguage} options={promptLanguages.map(l => [l, l])} /></div>
        <label className="block space-y-2 text-sm font-medium">System instructions<Textarea required rows={8} value={instructions} onChange={e => { setInstructions(e.target.value); setError(""); }} placeholder="You are a helpful AI voice assistant. Ask whether this is a convenient time, listen carefully, and ask one question at a time. Share only verified information and respect a request to end the call." className="font-mono text-sm leading-relaxed" /></label>
        <label className="block space-y-2 text-sm font-medium">Knowledge base <span className="font-normal text-muted-foreground">(optional)</span><Textarea rows={6} value={knowledge} onChange={e => setKnowledge(e.target.value)} placeholder="Facts the agent may use: services, hours, policies and FAQs." className="font-mono text-sm leading-relaxed" /></label>
        <label className="block space-y-2 text-sm font-medium">Opening greeting <span className="font-normal text-muted-foreground">(optional · a default greeting is used if empty)</span><Textarea rows={2} value={greeting} onChange={e => setGreeting(e.target.value)} placeholder="Hello, this is the AI assistant from your business. How can I help you today?" /></label>
        <RecognitionHintsField value={recognitionHints} onChange={setRecognitionHints} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card px-6 py-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!canCreate}><Plus />Create persona</Button></div>
    </form>
  </DialogContent></Dialog>;
}