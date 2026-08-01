import {
  getAzureOpenAIClient,
  isAzureOpenAIConfigured,
  withTimeout,
  AZURE_OPENAI_DEPLOYMENT,
} from "./azureOpenAIClient";
import { CAUSAL_PHRASES, DIAGNOSTIC_PHRASES, containsPhrase } from "./textSafety";

const TIMEOUT_MS = 5000;

const SYSTEM_PROMPT = `You write a short daily summary (one or two plain sentences) for a health-data annotation app.
You are given only the clues the user selected and the meaning they confirmed for each one.

Rules:
- Use only the confirmed clue/meaning pairs provided. Never restate a passive-data signal (sleep, steps, calendar, weather) that the user did not confirm a meaning for.
- Never use causal language: do not write "caused", "because of", "led to", "resulted in", "due to", or similar.
- Never diagnose or suggest a clinical or therapist-reviewed conclusion.
- Do not add information the user did not confirm.
- Keep it warm, neutral, and factual — describe what the user said, don't interpret it further.
- Return only the summary text, nothing else (no preamble, no JSON).`;

export type ConfirmedClue = { clue: string; meaning: string };

export async function generateDailySummary(confirmedClues: ConfirmedClue[]): Promise<string> {
  if (confirmedClues.length === 0) {
    return "No clues were selected today — this entry was saved with no confirmed details.";
  }

  if (!isAzureOpenAIConfigured()) {
    return buildDeterministicSummary(confirmedClues);
  }

  try {
    const text = await withTimeout(callAzureOpenAI(confirmedClues), TIMEOUT_MS);
    return validateSummaryText(text) ? text.trim() : buildDeterministicSummary(confirmedClues);
  } catch {
    return buildDeterministicSummary(confirmedClues);
  }
}

async function callAzureOpenAI(confirmedClues: ConfirmedClue[]): Promise<string> {
  const client = getAzureOpenAIClient();
  if (!client) throw new Error("Azure OpenAI client not configured");

  const completion = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    max_completion_tokens: 200,
    // See followUpEngine.ts — "minimal" is a valid API value not yet in this SDK's types.
    reasoning_effort: "minimal" as unknown as "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ confirmedClues }) },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("No text content returned by Azure OpenAI");
  return text;
}

function validateSummaryText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  if (containsPhrase(text, CAUSAL_PHRASES)) return false;
  if (containsPhrase(text, DIAGNOSTIC_PHRASES)) return false;
  return true;
}

function buildDeterministicSummary(confirmedClues: ConfirmedClue[]): string {
  const fragments = confirmedClues.map(
    (c) => `${lowerFirst(c.clue)} felt like ${lowerFirst(c.meaning)}`
  );
  return `${joinWithAnd(fragments)}.`;
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
