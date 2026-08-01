import { Clue, DailyEntry, PatternObservation } from "../types";

/**
 * Rule-based frequency counting across saved entries — no machine learning,
 * no inference of cause. Purely "how often did these two clues get selected
 * on the same day."
 */
export function calculateCoOccurrence(
  entries: DailyEntry[],
  clueA: string,
  clueB: string
): PatternObservation {
  let clueACount = 0;
  let clueBCount = 0;
  let coOccurrenceCount = 0;

  for (const entry of entries) {
    const selectedIds = entry.selectedClues.map((item) => item.clueId);
    const hasA = selectedIds.includes(clueA);
    const hasB = selectedIds.includes(clueB);
    if (hasA) clueACount++;
    if (hasB) clueBCount++;
    if (hasA && hasB) coOccurrenceCount++;
  }

  return { clueA, clueB, coOccurrenceCount, clueACount, clueBCount, windowDays: entries.length };
}

/**
 * Renders a PatternObservation as plain associative text. Never phrases the
 * relationship as causal — "appeared together" language only.
 */
export function describePattern(observation: PatternObservation, clueTitles: Record<string, string>): string {
  const titleA = clueTitles[observation.clueA] ?? observation.clueA;
  const titleB = clueTitles[observation.clueB] ?? observation.clueB;

  if (observation.coOccurrenceCount === 0) {
    return `"${titleA}" and "${titleB}" have not appeared together in the ${observation.windowDays} relevant day(s) recorded so far.`;
  }

  return `"${titleA}" and "${titleB}" appeared together on ${observation.coOccurrenceCount} of the past ${observation.windowDays} relevant day(s).`;
}

export function buildClueTitleLookup(clues: Clue[]): Record<string, string> {
  return Object.fromEntries(clues.map((c) => [c.id, c.title]));
}
