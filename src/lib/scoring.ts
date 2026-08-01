import { Clue, InterpretedSignal } from "../types";

const MIN_SCORE_THRESHOLD = 0.25;
const MIN_DISPLAY_COUNT = 8;

// Used only when literally nothing clears MIN_SCORE_THRESHOLD (e.g. a
// degenerate context with no signals and a stripped-down clue library) —
// guarantees the user is never shown an empty scene.
const DEFAULT_BALANCED_CLUE_IDS = [
  "still_legs_01",
  "quiet_corner_01",
  "meeting_overload_01",
  "stretch_break_01",
  "cup_of_coffee_01",
  "half_read_book_01",
];

export function scoreClue(
  clue: Clue,
  signals: InterpretedSignal[],
  recentClueIds: string[]
): number {
  const matchingSignals = signals.filter((signal) =>
    clue.signalTags.includes(signal.tag)
  );
  const signalScore = matchingSignals.reduce(
    (sum, signal) => sum + signal.strength,
    0
  );
  const repetitionPenalty = recentClueIds.includes(clue.id)
    ? clue.recentRepeatPenalty
    : 0;
  return clue.baseWeight + signalScore - repetitionPenalty;
}

export type ScoredClue = { clue: Clue; score: number };

export function rankClues(
  clues: Clue[],
  signals: InterpretedSignal[],
  recentClueIds: string[]
): ScoredClue[] {
  return clues
    .map((clue) => ({ clue, score: scoreClue(clue, signals, recentClueIds) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Ranks and selects the clue set to display, aiming for a rough composition
 * of 4 signal-informed clues, 3 possible explanations, 2 helpful/restorative
 * clues, plus a few neutral distractors. Returns the ranked selection rather
 * than a hard split — the exact counts flex with what the clue library and
 * the day's signals actually support.
 */
export function selectDisplayClues(
  clues: Clue[],
  signals: InterpretedSignal[],
  recentClueIds: string[]
): ScoredClue[] {
  const ranked = rankClues(clues, signals, recentClueIds);
  const aboveThreshold = ranked.filter((r) => r.score >= MIN_SCORE_THRESHOLD);

  if (aboveThreshold.length === 0) {
    const defaults = clues.filter((c) => DEFAULT_BALANCED_CLUE_IDS.includes(c.id));
    return defaults.map((clue) => ({
      clue,
      score: scoreClue(clue, signals, recentClueIds),
    }));
  }

  const byType = (type: Clue["clueType"]) =>
    aboveThreshold.filter((r) => r.clue.clueType === type);

  const signalInformed = byType("signal_informed").slice(0, 4);
  const possibleExplanation = byType("possible_explanation").slice(0, 3);
  const helpfulAction = byType("helpful_action").slice(0, 2);
  const distractors = byType("neutral_distractor").slice(0, 3);

  const selected = [
    ...signalInformed,
    ...possibleExplanation,
    ...helpfulAction,
    ...distractors,
  ];
  const selectedIds = new Set(selected.map((s) => s.clue.id));

  if (selected.length < MIN_DISPLAY_COUNT) {
    for (const r of ranked) {
      if (selected.length >= MIN_DISPLAY_COUNT) break;
      if (!selectedIds.has(r.clue.id)) {
        selected.push(r);
        selectedIds.add(r.clue.id);
      }
    }
  }

  return selected.sort((a, b) => b.score - a.score);
}
