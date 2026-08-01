import { app, HttpRequest } from "@azure/functions";
import { v4 as uuidv4 } from "uuid";
import { json, badRequest } from "../lib/httpHelpers";
import { findClue } from "../lib/dayPreview";
import { generateDailySummary } from "../lib/summaryEngine";
import { saveEntry } from "../lib/store";
import { ClueSelection, DailyContext, DailyEntry, InterpretedSignal } from "../types";

const MAX_SELECTIONS_PER_DAY = 3;

app.http("dayComplete", {
  methods: ["POST"],
  authLevel: "function",
  route: "day/complete",
  handler: async (request: HttpRequest) => {
    const body = (await request.json().catch(() => null)) as {
      userId?: string;
      date?: string;
      context?: DailyContext;
      interpretedSignals?: InterpretedSignal[];
      displayedClueIds?: string[];
      selectedClues?: ClueSelection[];
    } | null;

    if (!body?.userId || !body.date || !body.context) {
      return badRequest("userId, date, and context are required.");
    }

    // Enforce the 3-selection cap server-side too, regardless of client behavior.
    const cappedSelections = (body.selectedClues ?? []).slice(0, MAX_SELECTIONS_PER_DAY);

    const confirmedClues = cappedSelections
      .filter((s) => s.confidence !== "skipped" && s.answerOption)
      .map((s) => {
        const clue = findClue(s.clueId);
        return { clue: clue?.title ?? s.clueId, meaning: s.answerOption as string };
      });

    const generatedSummary = await generateDailySummary(confirmedClues);

    const entry: DailyEntry = {
      id: uuidv4(),
      userId: body.userId,
      date: body.date,
      context: body.context,
      interpretedSignals: body.interpretedSignals ?? [],
      displayedClueIds: body.displayedClueIds ?? [],
      selectedClues: cappedSelections,
      generatedSummary,
    };

    await saveEntry(body.userId, entry);
    return json(200, entry);
  },
});
