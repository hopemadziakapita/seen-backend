import {
  getAzureOpenAIClient,
  isAzureOpenAIConfigured,
  withTimeout,
  AZURE_OPENAI_DEPLOYMENT,
} from "./azureOpenAIClient";
import { CAUSAL_PHRASES, DIAGNOSTIC_PHRASES, CRISIS_PHRASES, containsPhrase } from "./textSafety";

const TIMEOUT_MS = 8000;

export type Moment = { clue: string; text: string };

const GENERATE_SYSTEM_PROMPT = `You write a short, warm daily reflection (3 to 5 sentences) for a health-data annotation app, in first person ("I"), as if the user is writing it about their own day.
You are given only the moments the user captured today and what they personally said each one brought to mind.

Rules:
- Use only the moments provided. Never restate a passive-data signal (sleep, steps, calendar, weather) that the user did not connect to a moment themselves.
- Never use causal language: do not write "caused", "because of", "led to", "resulted in", "due to", or similar.
- Never diagnose or suggest a clinical or therapist-reviewed conclusion.
- Do not add information the user did not provide.
- Weave the moments into one short, cohesive narrative — not a list or bullet points.
- Write in first person ("I"), warm and reflective in tone — never second person ("you") or third person ("they").
- Return only the reflection text, nothing else (no preamble, no JSON).`;

const REFINE_SYSTEM_PROMPT = `You rewrite an existing daily reflection for a health-data annotation app, based on the user's own note about how it should sound.
You are given the original reflection, the moments it was built from, and the user's free-text steering note.

Rules:
- Keep every fact grounded in the moments provided — never introduce new facts, events, or interpretations the user didn't state.
- Apply the user's steering note only to tone, wording, phrasing, and emphasis — never to invent new content.
- Never use causal language: do not write "caused", "because of", "led to", "resulted in", "due to", or similar.
- Never diagnose or suggest a clinical or therapist-reviewed conclusion.
- Write in first person ("I"), warm and reflective, as one short cohesive narrative — not a list. Never second person ("you") or third person ("they").
- Return only the rewritten reflection text, nothing else (no preamble, no JSON).`;

const CRISIS_RESPONSE_TEXT =
  "It sounds like today may have been really hard. If you're in immediate " +
  "danger or thinking about harming yourself, please reach out right now — " +
  "you can call or text 988 (Suicide & Crisis Lifeline) in the US, or " +
  "contact someone you trust.";

export async function generateReflection(moments: Moment[]): Promise<string> {
  if (moments.length === 0) {
    return "No moments were captured today — this entry was saved with no reflection.";
  }

  // Defense-in-depth: a plain-string pre-check ahead of the AI call, kept
  // even in this simplified engine, so crisis handling never depends on the
  // model's own compliance.
  if (mentionsCrisisLanguage(moments)) {
    return CRISIS_RESPONSE_TEXT;
  }

  if (!isAzureOpenAIConfigured()) {
    return buildDeterministicReflection(moments);
  }

  try {
    const text = await withTimeout(callGenerate(moments), TIMEOUT_MS);
    return isSafeText(text) ? text.trim() : buildDeterministicReflection(moments);
  } catch {
    return buildDeterministicReflection(moments);
  }
}

export async function refineReflection(
  originalReflection: string,
  moments: Moment[],
  steeringText: string
): Promise<string> {
  if (!isAzureOpenAIConfigured()) {
    // No safe deterministic way to apply arbitrary steering — keep the
    // existing reflection rather than silently dropping the user's edit.
    return originalReflection;
  }

  try {
    const text = await withTimeout(
      callRefine(originalReflection, moments, steeringText),
      TIMEOUT_MS
    );
    return isSafeText(text) ? text.trim() : originalReflection;
  } catch {
    return originalReflection;
  }
}

function mentionsCrisisLanguage(moments: Moment[]): boolean {
  const combined = moments
    .map((m) => m.text)
    .join(" ")
    .toLowerCase();
  return containsPhrase(combined, CRISIS_PHRASES);
}

async function callGenerate(moments: Moment[]): Promise<string> {
  const client = getAzureOpenAIClient();
  if (!client) throw new Error("Azure OpenAI client not configured");

  const completion = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    max_completion_tokens: 400,
    // See followUpEngine.ts — "minimal" is a valid API value not yet in this SDK's types.
    reasoning_effort: "minimal" as unknown as "low",
    messages: [
      { role: "system", content: GENERATE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ moments }) },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("No text content returned by Azure OpenAI");
  return text;
}

async function callRefine(
  originalReflection: string,
  moments: Moment[],
  steeringText: string
): Promise<string> {
  const client = getAzureOpenAIClient();
  if (!client) throw new Error("Azure OpenAI client not configured");

  const completion = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    max_completion_tokens: 400,
    reasoning_effort: "minimal" as unknown as "low",
    messages: [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ originalReflection, moments, steeringText }),
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("No text content returned by Azure OpenAI");
  return text;
}

function isSafeText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  if (containsPhrase(text, CAUSAL_PHRASES)) return false;
  if (containsPhrase(text, DIAGNOSTIC_PHRASES)) return false;
  return true;
}

function buildDeterministicReflection(moments: Moment[]): string {
  const fragments = moments.map((m) => `${lowerFirst(m.clue)} brought to mind ${lowerFirst(m.text)}`);
  return `Today, I noticed ${joinWithAnd(fragments)}.`;
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

function joinWithAnd(items: string[]): string {
  if (items.length === 1) return capitalize(items[0]);
  if (items.length === 2) return capitalize(`${items[0]} and ${items[1]}`);
  return capitalize(`${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
