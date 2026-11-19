import { useId } from "react";
import { AudioLines } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  RECOGNITION_HINTS_MAX_CHARS,
  RECOGNITION_MAX_TERM_CHARS,
  RECOGNITION_MAX_TERM_WORDS,
  RECOGNITION_MAX_TERMS,
  previewRecognitionHints,
} from "@/lib/recognition-hints";

const PLACEHOLDER =
  "Enter business names, product names, technical terminology, acronyms, and words that callers may pronounce differently. Example: RFID, UHF, EPC Gen2, GreenFuturz.";

const EXAMPLES: [string, string][] = [
  ["Healthcare", "Dr. Ananya Rao, cardiology, ECG, Apollo Clinic, MRI scan"],
  ["Real estate", "BHK, carpet area, RERA, Prestige Lakeside, Whitefield"],
  ["Retail", "GreenFuturz, Pro Max, EMI, cash on delivery"],
  ["Finance", "KYC, CIBIL score, NACH, top-up loan"],
];

/** Speech Recognition Prompting: per-persona vocabulary for the ASR provider. Empty keeps plain recognition. */
export function RecognitionHintsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const preview = previewRecognitionHints(value);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold">
        <AudioLines className="h-4 w-4 text-primary" />
        Speech recognition prompting{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Words the speech recognizer should expect on this persona's calls: company, product, people
        and place names, acronyms, technical terms and short phrases of up to{" "}
        {RECOGNITION_MAX_TERM_CHARS} characters. Separate them with commas or new lines. These go
        only to speech recognition, not to the agent's instructions. Leave empty to keep standard
        recognition.
      </p>
      <Textarea
        id={id}
        rows={3}
        maxLength={RECOGNITION_HINTS_MAX_CHARS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER}
        aria-describedby={`${id}-help ${id}-status`}
        className="bg-card font-mono text-xs sm:text-sm"
      />
      <div
        id={`${id}-status`}
        className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"
      >
        <span>
          {preview.terms.length
            ? `${preview.terms.length} of up to ${RECOGNITION_MAX_TERMS} terms will be used`
            : "No terms: standard recognition"}
        </span>
        <span>
          {value.length}/{RECOGNITION_HINTS_MAX_CHARS}
        </span>
      </div>
      {(preview.tooLong.length > 0 || preview.invalid.length > 0 || preview.overBudget > 0) && (
        <p role="status" className="text-xs text-destructive">
          {preview.tooLong.length > 0 &&
            `Skipped ${preview.tooLong.length} entr${preview.tooLong.length === 1 ? "y" : "ies"} longer than ${RECOGNITION_MAX_TERM_CHARS} characters or ${RECOGNITION_MAX_TERM_WORDS} words. `}
          {preview.invalid.length > 0 &&
            `Skipped ${preview.invalid.length} entr${preview.invalid.length === 1 ? "y" : "ies"} containing < > { } [ ] \\ or control characters. `}
          {preview.overBudget > 0 &&
            `${preview.overBudget} more term${preview.overBudget === 1 ? "" : "s"} won't fit the recognizer's limit; put the most important terms first.`}
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Examples by industry</summary>
        <ul className="mt-2 space-y-1">
          {EXAMPLES.map(([industry, terms]) => (
            <li key={industry}>
              <span className="font-medium text-foreground">{industry}:</span> {terms}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
