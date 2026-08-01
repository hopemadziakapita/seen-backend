import { DailyEntry } from "../types";
import { loadEntries } from "./store";

const LOOKBACK_DAYS = 3;

/** Clue ids shown recently, used to apply scoreClue's repeat penalty. */
export async function getRecentClueIds(excludeDate?: string): Promise<string[]> {
  const entries = (await loadEntries())
    .filter((e) => e.date !== excludeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, LOOKBACK_DAYS);

  const ids = new Set<string>();
  for (const entry of entries as DailyEntry[]) {
    for (const id of entry.displayedClueIds) ids.add(id);
  }
  return Array.from(ids);
}
