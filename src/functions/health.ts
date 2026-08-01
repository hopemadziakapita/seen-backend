import { app } from "@azure/functions";
import { json } from "../lib/httpHelpers";
import { isAzureOpenAIConfigured } from "../lib/azureOpenAIClient";

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: async () => json(200, { ok: true, azureOpenAIConfigured: isAzureOpenAIConfigured() }),
});
