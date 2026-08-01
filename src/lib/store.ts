import { getContainer } from "./cosmosClient";
import { DailyEntry } from "../types";

export async function loadEntries(userId: string): Promise<DailyEntry[]> {
  const container = getContainer();
  const { resources } = await container.items
    .query<DailyEntry>({
      query: "SELECT * FROM c WHERE c.userId = @userId ORDER BY c.date DESC",
      parameters: [{ name: "@userId", value: userId }],
    })
    .fetchAll();
  return resources;
}

export async function loadEntriesForDateRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<DailyEntry[]> {
  const container = getContainer();
  const { resources } = await container.items
    .query<DailyEntry>({
      query:
        "SELECT * FROM c WHERE c.userId = @userId AND c.date >= @start AND c.date <= @end ORDER BY c.date ASC",
      parameters: [
        { name: "@userId", value: userId },
        { name: "@start", value: startDate },
        { name: "@end", value: endDate },
      ],
    })
    .fetchAll();
  return resources;
}

export async function saveEntry(userId: string, entry: DailyEntry): Promise<DailyEntry> {
  const container = getContainer();
  const doc = { ...entry, userId };
  const { resource } = await container.items.upsert(doc);
  return (resource as unknown) as DailyEntry;
}

export async function clearEntries(userId: string): Promise<void> {
  const entries = await loadEntries(userId);
  const container = getContainer();
  for (const entry of entries) {
    await container.item(entry.id, userId).delete();
  }
}
