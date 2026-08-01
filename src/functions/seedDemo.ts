import { app } from "@azure/functions";
import { v4 as uuidv4 } from "uuid";
import { json } from "../lib/httpHelpers";
import { buildDayPreview, findClue } from "../lib/dayPreview";
import { generateFollowUpQuestion } from "../lib/followUpEngine";
import { generateDailySummary } from "../lib/summaryEngine";
import { saveEntry } from "../lib/store";
import { DEMO_PROFILES, DemoProfileKey } from "../data/profiles";
import { ClueSelection, DailyEntry, SIMULATED_DATA_DISCLAIMER } from "../types";

const DEMO_USER_IDS: Record<DemoProfileKey, string> = {
  A: "demo-profile-a",
  B: "demo-profile-b",
  C: "demo-profile-c",
};

// Runs all three demo profiles through the full pipeline (auto-selecting the
// top-ranked clues and a deterministic answer) and saves them as DailyEntry
// records, so the co-occurrence endpoint has something to read across days.
app.http("seedDemo", {
  methods: ["POST"],
  authLevel: "function",
  route: "seed-demo",
  handler: async () => {
    const savedEntries: DailyEntry[] = [];

    for (const profileKey of Object.keys(DEMO_PROFILES) as DemoProfileKey[]) {
      const context = DEMO_PROFILES[profileKey].context;
      const userId = DEMO_USER_IDS[profileKey];
      const preview = await buildDayPreview(context, userId);
      const topClueIds = preview.rankedClues.slice(0, 3).map((c) => c.id);

      const selectedClues: ClueSelection[] = [];
      for (const clueId of topClueIds) {
        const clue = findClue(clueId);
        if (!clue) continue;
        const question = await generateFollowUpQuestion({
          clue,
          context,
          interpretedSignals: preview.interpretedSignals,
        });
        const answerOption =
          question.options.find((o) => o.toLowerCase() !== "not sure") ?? question.options[0];
        selectedClues.push({
          clueId,
          selectedAt: `${context.date}T12:00:00.000Z`,
          dailyContextDate: context.date,
          userMeaning: answerOption,
          followUpQuestion: question.question,
          answerOption,
          confidence: "clear",
        });
      }

      const confirmedClues = selectedClues.map((s) => {
        const clue = findClue(s.clueId);
        return { clue: clue?.title ?? s.clueId, meaning: s.answerOption as string };
      });
      const generatedSummary = await generateDailySummary(confirmedClues);

      const entry: DailyEntry = {
        id: uuidv4(),
        userId,
        date: context.date,
        context,
        interpretedSignals: preview.interpretedSignals,
        displayedClueIds: preview.displayedClueIds,
        selectedClues,
        generatedSummary,
      };
      await saveEntry(userId, entry);
      savedEntries.push(entry);
    }

    return json(200, { disclaimer: SIMULATED_DATA_DISCLAIMER, entries: savedEntries });
  },
});
