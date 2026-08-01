import { app, HttpRequest } from "@azure/functions";
import { json, badRequest } from "../lib/httpHelpers";
import { generateReflection, Moment } from "../lib/reflectionEngine";
import { DailyContext, InterpretedSignal } from "../types";

// Generates the whole-day narrative reflection from free-text moments —
// additive alongside /day/complete's one-line generatedSummary, not a
// replacement for it. context/interpretedSignals are accepted for request
// consistency with the other endpoints but are NOT sent to the AI: only the
// user-confirmed moments are, per the minimum-necessary-data rule.
app.http("dayReflection", {
  methods: ["POST"],
  authLevel: "function",
  route: "day/reflection",
  handler: async (request: HttpRequest) => {
    const body = (await request.json().catch(() => null)) as {
      context?: DailyContext;
      interpretedSignals?: InterpretedSignal[];
      moments?: { clueId: string; clueTitle: string; text: string }[];
    } | null;

    if (!body?.context) {
      return badRequest("context is required.");
    }

    const moments: Moment[] = (body.moments ?? [])
      .filter((m) => typeof m?.text === "string" && m.text.trim().length > 0)
      .map((m) => ({ clue: m.clueTitle ?? m.clueId, text: m.text.trim() }));

    const reflection = await generateReflection(moments);
    return json(200, { reflection });
  },
});
