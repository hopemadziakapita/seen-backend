import { app } from "@azure/functions";
import { json } from "../lib/httpHelpers";
import { DEMO_PROFILES } from "../data/profiles";
import { SIMULATED_DATA_DISCLAIMER } from "../types";

app.http("profiles", {
  methods: ["GET"],
  authLevel: "function",
  route: "profiles",
  handler: async () =>
    json(200, {
      disclaimer: SIMULATED_DATA_DISCLAIMER,
      profiles: Object.values(DEMO_PROFILES),
    }),
});
