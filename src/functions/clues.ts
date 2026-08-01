import { app } from "@azure/functions";
import { json } from "../lib/httpHelpers";
import cluesData from "../data/clues.json";
import { Clue } from "../types";

const clues = cluesData as Clue[];

app.http("clues", {
  methods: ["GET"],
  authLevel: "function",
  route: "clues",
  handler: async () => json(200, { clues }),
});
