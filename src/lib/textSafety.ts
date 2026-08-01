/**
 * Shared safety-language checks used by every AI-generated text (follow-up
 * questions, summaries, reflections). Centralized so a fix here — like the
 * word-boundary bug below — applies everywhere instead of drifting out of
 * sync across copy-pasted lists.
 */

export const CAUSAL_PHRASES = [
  "caused",
  "because of",
  "led to",
  "resulted in",
  "due to",
  "as a result of",
  "made you feel",
  "made me feel",
];

// "diagnos" is a deliberate prefix match (diagnose/diagnosed/diagnosis/
// diagnostic). Every other entry must match as a whole phrase — a plain
// substring check on "you have" also matches inside "you haven't", which is
// a completely benign contraction and was silently triggering the fallback.
export const DIAGNOSTIC_PHRASES = ["diagnos", "disorder", "you have", "clinical", "you suffer from"];

// Deliberately narrow and literal — this is a pre-AI-call safety net, not a
// clinical screening tool. False negatives fall through to the model's own
// judgment (see the system prompt's safety instructions); false positives
// here just mean an ordinary reflection gets the crisis-resources response
// instead, which is the safer failure direction.
export const CRISIS_PHRASES = [
  "kill myself",
  "want to die",
  "wanted to die",
  "end my life",
  "ending my life",
  "suicid",
  "self-harm",
  "self harm",
  "hurt myself",
  "hurting myself",
  "harm myself",
  "harming myself",
  "hurt someone",
  "hurt others",
  "kill someone",
];

const PREFIX_PHRASES = new Set(["diagnos", "suicid"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseRegex(phrase: string): RegExp {
  const escaped = escapeRegExp(phrase);
  return PREFIX_PHRASES.has(phrase)
    ? new RegExp(escaped, "i")
    : new RegExp(`\\b${escaped}\\b`, "i");
}

export function containsPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => phraseRegex(phrase).test(text));
}
