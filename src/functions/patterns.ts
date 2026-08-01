import { app, HttpRequest } from "@azure/functions";
import { json, badRequest } from "../lib/httpHelpers";
import { loadEntries } from "../lib/store";
import { calculateCoOccurrence, describePattern, buildClueTitleLookup } from "../lib/patterns";
import { allClues } from "../lib/dayPreview";

app.http("patterns", {
  methods: ["GET"],
  authLevel: "function",
  route: "patterns",
  handler: async (request: HttpRequest) => {
    const clueA = request.query.get("clueA");
    const clueB = request.query.get("clueB");
    if (!clueA || !clueB) {
      return badRequest("clueA and clueB query params are required.");
    }

    const entries = await loadEntries();
    const observation = calculateCoOccurrence(entries, clueA, clueB);
    const text = describePattern(observation, buildClueTitleLookup(allClues()));
    return json(200, { observation, text });
  },
});
