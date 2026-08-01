import cluesData from "../data/clues.json";
import { Clue, DailyContext, SIMULATED_DATA_DISCLAIMER } from "../types";
import { interpretSignals } from "./signals";
import { selectDisplayClues } from "./scoring";
import { getRecentClueIds } from "./recentClues";

const clues = cluesData as Clue[];

export async function buildDayPreview(context: DailyContext, userId: string) {
  const interpretedSignals = interpretSignals(context);
  const recentClueIds = await getRecentClueIds(userId, context.date);
  const ranked = selectDisplayClues(clues, interpretedSignals, recentClueIds);

  return {
    disclaimer: SIMULATED_DATA_DISCLAIMER,
    context,
    interpretedSignals,
    rankedClues: ranked.map((r) => ({
      id: r.clue.id,
      title: r.clue.title,
      category: r.clue.category,
      clueType: r.clue.clueType,
      score: Math.round(r.score * 100) / 100,
    })),
    displayedClueIds: ranked.map((r) => r.clue.id),
  };
}

export function findClue(clueId: string): Clue | undefined {
  return clues.find((c) => c.id === clueId);
}

export function allClues(): Clue[] {
  return clues;
}
