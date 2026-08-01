import { app, HttpRequest } from "@azure/functions";
import { json, badRequest } from "../lib/httpHelpers";
import { generateWeeklyInsights } from "../lib/weeklyInsightsEngine";
import { WeeklyDay } from "../types";

// Analyzes a 7-day dataset (passive context + reflections) in one Azure
// OpenAI call and returns structured pattern/helping/theme insights. The
// passive-context timeline and reflection-habit stats shown alongside this
// on the client are calculated directly from the same dataset — not by
// this endpoint — per the "AI only where AI adds value" rule already used
// throughout this backend.
app.http("weekInsights", {
  methods: ["POST"],
  authLevel: "function",
  route: "week/insights",
  handler: async (request: HttpRequest) => {
    const body = (await request.json().catch(() => null)) as { days?: WeeklyDay[] } | null;

    if (!Array.isArray(body?.days) || body.days.length === 0) {
      return badRequest("days is required and must be a non-empty array.");
    }
    if (!body.days.every((d) => typeof d?.date === "string")) {
      return badRequest("each day must include a date.");
    }

    const insights = await generateWeeklyInsights(body.days);
    return json(200, insights);
  },
});
