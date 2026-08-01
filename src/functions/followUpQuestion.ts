import { app, HttpRequest } from "@azure/functions";
import { json, badRequest } from "../lib/httpHelpers";
import { generateFollowUpQuestion } from "../lib/followUpEngine";
import { Clue, DailyContext, InterpretedSignal } from "../types";

app.http("followUpQuestion", {
  methods: ["POST"],
  authLevel: "function",
  route: "follow-up-question",
  handler: async (request: HttpRequest) => {
    const body = (await request.json().catch(() => null)) as {
      clue?: Clue;
      context?: DailyContext;
      interpretedSignals?: InterpretedSignal[];
      previousMeaning?: string;
    } | null;

    if (!body?.clue || !body.context || !body.interpretedSignals) {
      return badRequest("clue, context, and interpretedSignals are required.");
    }

    const question = await generateFollowUpQuestion({
      clue: body.clue,
      context: body.context,
      interpretedSignals: body.interpretedSignals,
      previousMeaning: body.previousMeaning,
    });

    return json(200, question);
  },
});
