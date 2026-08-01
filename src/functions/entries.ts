import { app } from "@azure/functions";
import { json } from "../lib/httpHelpers";
import { loadEntries } from "../lib/store";
import { SIMULATED_DATA_DISCLAIMER } from "../types";

app.http("entries", {
  methods: ["GET"],
  authLevel: "function",
  route: "entries",
  handler: async () =>
    json(200, { disclaimer: SIMULATED_DATA_DISCLAIMER, entries: await loadEntries() }),
});
