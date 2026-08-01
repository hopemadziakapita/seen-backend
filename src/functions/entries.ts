import { app, HttpRequest } from "@azure/functions";
import { json, badRequest } from "../lib/httpHelpers";
import { loadEntries } from "../lib/store";
import { SIMULATED_DATA_DISCLAIMER } from "../types";

app.http("entries", {
  methods: ["GET"],
  authLevel: "function",
  route: "entries",
  handler: async (request: HttpRequest) => {
    const userId = request.query.get("userId");
    if (!userId) {
      return badRequest("userId query param is required.");
    }
    return json(200, { disclaimer: SIMULATED_DATA_DISCLAIMER, entries: await loadEntries(userId) });
  },
});
