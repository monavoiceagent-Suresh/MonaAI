// Speech Recognition Prompting: a persona's business vocabulary, sent to the voice engine's ASR provider as
// keyterms. The engine's agent/app/recognition.py is the authority (it parses and enforces each provider's limits
// on every call); this mirror only previews, in the editor, which terms will actually be used.
// The normalisation and limits must stay identical to agent/app/recognition.py. Both are tested against the same
// cases: agent/tests/fixtures/recognition_cases.json.

export interface RecognitionLimits {
  maxTerms: number;
  /** Unicode code points, after normalisation. */
  maxTermChars: number;
  maxTermWords: number;
  /** null: no total budget beyond maxTerms * maxTermChars. */
  maxTotalChars: number | null;
}

/** ElevenLabs Scribe Realtime, the default speech recognizer: "Maximum 50 keyterms, each up to 20 characters". */
export const SCRIBE_LIMITS: RecognitionLimits = {
  maxTerms: 50,
  maxTermChars: 20,
  maxTermWords: 5,
  maxTotalChars: null,
};
/** Deepgram Nova-3, the fallback: a 500-token request limit, no documented per-term limit. */
export const DEEPGRAM_LIMITS: RecognitionLimits = {
  maxTerms: 50,
  maxTermChars: 50,
  maxTermWords: 5,
  maxTotalChars: 500,
};

// The editor previews the default recognizer, which is also the strictest per term.
export const RECOGNITION_MAX_TERMS = SCRIBE_LIMITS.maxTerms;
export const RECOGNITION_MAX_TERM_CHARS = SCRIBE_LIMITS.maxTermChars;
export const RECOGNITION_MAX_TERM_WORDS = SCRIBE_LIMITS.maxTermWords;
/** What a persona may store. The engine accepts up to 4000; the terms that fit the limits above are used. */
export const RECOGNITION_HINTS_MAX_CHARS = 2000;

const SEPARATORS = /[,;\n\r]+/;
// A term containing any of these is invalid and dropped whole: the characters Scribe rejects, C0/C1 control
// characters other than the whitespace ones (tab, VT, FF), and the byte-order mark.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>{}[\]\\\x00-\x08\x0e-\x1f\x7f-\x9f\ufeff]/;
// Whitespace, spelled out so that JavaScript and Python agree exactly on what separates words.
// eslint-disable-next-line no-control-regex
const WHITESPACE = /[\t\x0b\x0c \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

export interface RecognitionPreview {
  terms: string[];
  /** Entries dropped for breaking a per-term limit (too many characters or words). */
  tooLong: string[];
  /** Entries dropped for containing characters the recognizer does not accept. */
  invalid: string[];
  /** Valid entries left out because the term-count or total-size budget was already used. */
  overBudget: number;
}

/** One entry as a term: NFC, single spaces, trimmed. "" for an empty entry, null for an invalid one. */
function normalise(raw: string): string | null {
  const text = raw.normalize("NFC");
  if (FORBIDDEN.test(text)) return null;
  return text.replace(WHITESPACE, " ").replace(/^ +| +$/g, "");
}

const codePoints = (text: string) => Array.from(text).length;

export function previewRecognitionHints(
  hints: string,
  limits: RecognitionLimits = SCRIBE_LIMITS,
): RecognitionPreview {
  const preview: RecognitionPreview = { terms: [], tooLong: [], invalid: [], overBudget: 0 };
  const seen = new Set<string>();
  let total = 0;
  let full = false;
  for (const raw of hints.split(SEPARATORS)) {
    const term = normalise(raw);
    if (term === null) {
      if (!full && raw.trim()) preview.invalid.push(raw.trim());
      continue;
    }
    if (!term) continue;
    const length = codePoints(term);
    if (length > limits.maxTermChars || term.split(" ").length > limits.maxTermWords) {
      if (!full) preview.tooLong.push(term);
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (
      full ||
      preview.terms.length >= limits.maxTerms ||
      (limits.maxTotalChars !== null && total + length > limits.maxTotalChars)
    ) {
      full = true;
      seen.add(key);
      preview.overBudget += 1;
      continue;
    }
    seen.add(key);
    preview.terms.push(term);
    total += length;
  }
  return preview;
}
