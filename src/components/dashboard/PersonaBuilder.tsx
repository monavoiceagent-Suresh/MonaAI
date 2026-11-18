import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ClipboardPaste, Copy, MessagesSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PERSONA_BUILDER_OUTPUTS, PERSONA_BUILDER_PROMPT, copyText } from "@/lib/persona-builder";

const steps = [
  { icon: Copy, title: "Copy prompt", text: "Copy the master prompt below." },
  {
    icon: MessagesSquare,
    title: "Complete AI interview",
    text: "Paste it into ChatGPT, Claude, Gemini or any AI assistant and answer its 10 questions.",
  },
  {
    icon: ClipboardPaste,
    title: "Paste generated outputs",
    text: "Paste each of its three outputs into the matching field below.",
  },
];

/** AI Persona Builder: a copyable master prompt for any external AI assistant. No API calls, no cost. */
export function PersonaBuilder() {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (await copyText(PERSONA_BUILDER_PROMPT)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
      toast.success("Master prompt copied. Paste it into your AI assistant.");
    } else {
      setPreview(true);
      toast.error("Couldn't copy automatically. Select the prompt in the preview and copy it.");
    }
  };
  return (
    <section
      aria-labelledby="persona-builder-title"
      className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id="persona-builder-title" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Persona Builder
          </h3>
          <p className="text-xs text-muted-foreground">
            Let any AI assistant interview you about your business and write this persona for you.
            Works with your own AI account; Mona makes no AI calls for this.
          </p>
        </div>
        <Button type="button" size="sm" onClick={copy} aria-live="polite">
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy master prompt"}
        </Button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-md border border-border bg-card p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 space-y-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <s.icon className="h-3.5 w-3.5 text-primary" />
                {s.title}
              </span>
              <span className="block text-xs text-muted-foreground">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="space-y-2">
        <p className="text-xs font-medium">Where each output goes</p>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {PERSONA_BUILDER_OUTPUTS.map((o) => (
            <li key={o.output}>
              <span className="font-medium text-foreground">{o.output}</span> →{" "}
              <span className="font-medium text-foreground">{o.field}</span>: {o.hint}
            </li>
          ))}
          <li>
            Also set <span className="font-medium text-foreground">Language</span> to the one the AI
            recommends, then save and run a test call.
          </li>
        </ul>
      </div>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 text-xs"
          aria-expanded={preview}
          aria-controls="persona-builder-prompt"
          onClick={() => setPreview((v) => !v)}
        >
          <ChevronDown className={`transition-transform ${preview ? "rotate-180" : ""}`} />
          {preview ? "Hide prompt" : "Preview prompt"}
        </Button>
        {preview && (
          <Textarea
            id="persona-builder-prompt"
            aria-label="Master prompt"
            readOnly
            rows={10}
            value={PERSONA_BUILDER_PROMPT}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 bg-card font-mono text-xs leading-relaxed"
          />
        )}
      </div>
    </section>
  );
}
