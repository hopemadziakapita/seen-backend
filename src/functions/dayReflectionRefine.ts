import { app, HttpRequest } from "@azure/functions";
import { json, badRequest } from "../lib/httpHelpers";
import { refineReflection, Moment } from "../lib/reflectionEngine";

// Regenerates a reflection given the user's own steering note (the "Make it
// sound more like you" box). Never invents new facts — only restyles the
// existing moments. Falls back to returning originalReflection unchanged if
// the AI call fails, so "Restore original version" always has something
// coherent even under failure.
app.http("dayReflectionRefine", {
  methods: ["POST"],
  authLevel: "function",
  route: "day/reflection/refine",
  handler: async (request: HttpRequest) => {
    const body = (await request.json().catch(() => null)) as {
      originalReflection?: string;
      moments?: { clueId: string; clueTitle: string; text: string }[];
      steeringText?: string;
    } | null;

    if (!body?.originalReflection || !body.steeringText) {
      return badRequest("originalReflection and steeringText are required.");
    }

    const moments: Moment[] = (body.moments ?? [])
      .filter((m) => typeof m?.text === "string" && m.text.trim().length > 0)
      .map((m) => ({ clue: m.clueTitle ?? m.clueId, text: m.text.trim() }));

    const reflection = await refineReflection(
      body.originalReflection,
      moments,
      body.steeringText
    );
    return json(200, { reflection });
  },
});
