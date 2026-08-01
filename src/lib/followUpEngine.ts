import { Clue, DailyContext, InterpretedSignal, FollowUpQuestion } from "../types";
import {
  getAzureOpenAIClient,
  isAzureOpenAIConfigured,
  withTimeout,
  AZURE_OPENAI_DEPLOYMENT,
} from "./azureOpenAIClient";
import { getFallbackQuestion } from "./fallbacks";
import { containsPhrase } from "./textSafety";

const TIMEOUT_MS = 5000;

const SYSTEM_PROMPT = `You generate one short follow-up question for a visual health-data annotation app.
The user selected a clue from a scene representing a possible moment from their day.
Your task is to clarify what the clue meant to the user.

Rules:
- Ask exactly one question.
- Use no more than 12 words when possible.
- Provide 3 or 4 short answer options.
- Do not diagnose.
- Do not mention depression, anxiety, or another condition unless the user explicitly provided it.
- Do not assume passive data explains the clue.
- Do not imply causation.
- Do not ask for sensitive detail that is unnecessary.
- Include a neutral option.
- Include "Not sure" when appropriate.
- Avoid judgmental wording.
- Return only the required JSON schema.`;

const MENTAL_HEALTH_TERMS = [
  "depress",
  "anxi",
  "bipolar",
  "ptsd",
  "trauma",
  "adhd",
  "ocd",
  "schizo",
  "eating disorder",
  "self-harm",
  "suicid",
];

const DIAGNOSTIC_PHRASES = [
  "you have",
  "you are experiencing",
  "this means you",
  "caused by",
  "this caused",
  "diagnos",
  "you suffer from",
  "indicates that you",
  "is a sign of",
];

const FOLLOW_UP_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_follow_up_question",
    description: "Submit the generated follow-up question in the required structured shape.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 4,
        },
        purpose: { type: "string" },
      },
      required: ["question", "options", "purpose"],
      additionalProperties: false,
    },
  },
};

export type FollowUpRequest = {
  clue: Clue;
  context: DailyContext;
  interpretedSignals: InterpretedSignal[];
  previousMeaning?: string;
};

export async function generateFollowUpQuestion(
  req: FollowUpRequest
): Promise<FollowUpQuestion> {
  if (!isAzureOpenAIConfigured()) {
    return getFallbackQuestion(req.clue.category);
  }

  try {
    const raw = await withTimeout(callAzureOpenAI(req), TIMEOUT_MS);
    const validated = validate(raw, req);
    return validated ?? getFallbackQuestion(req.clue.category);
  } catch {
    return getFallbackQuestion(req.clue.category);
  }
}

async function callAzureOpenAI(req: FollowUpRequest): Promise<unknown> {
  const client = getAzureOpenAIClient();
  if (!client) throw new Error("Azure OpenAI client not configured");

  // Only the minimum structured context the model needs — never raw
  // calendar content, names, or exact location.
  const userContent = JSON.stringify({
    clueTitle: req.clue.title,
    clueCategory: req.clue.category,
    possibleMeanings: req.clue.possibleMeanings,
    interpretedSignals: req.interpretedSignals.map((s) => ({
      tag: s.tag,
      explanation: s.explanation,
    })),
    calendarLoad: req.context.calendarLoad,
    weather: req.context.weather,
    previousMeaning: req.previousMeaning ?? null,
  });

  const completion = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    max_completion_tokens: 400,
    // Reasoning-family models (e.g. gpt-5-mini) otherwise spend the whole
    // max_completion_tokens budget on hidden reasoning tokens and return no
    // visible output for a task this simple. "minimal" is a valid API value
    // the installed SDK's types don't know about yet (typed as low|medium|high) —
    // "low" still burns the full budget on reasoning in testing, so it's not a safe substitute.
    reasoning_effort: "minimal" as unknown as "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    tools: [FOLLOW_UP_TOOL],
    tool_choice: { type: "function", function: { name: "submit_follow_up_question" } },
  });

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") {
    throw new Error("No tool call returned by Azure OpenAI");
  }

  return JSON.parse(toolCall.function.arguments);
}

function validate(raw: unknown, req: FollowUpRequest): FollowUpQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const { question, options, purpose } = obj;

  if (typeof question !== "string" || question.trim().length === 0) return null;
  if (!Array.isArray(options)) return null;
  if (options.length < 3 || options.length > 4) return null;
  if (!options.every((o) => typeof o === "string" && o.trim().length > 0)) return null;
  if (typeof purpose !== "string") return null;

  const combinedText = [question, ...(options as string[])].join(" ").toLowerCase();
  const priorText = (req.previousMeaning ?? "").toLowerCase();
  const priorTermsMentioned = MENTAL_HEALTH_TERMS.filter((term) => priorText.includes(term));
  const mentionedTerms = MENTAL_HEALTH_TERMS.filter((term) => combinedText.includes(term));
  const disallowedMention = mentionedTerms.some((term) => !priorTermsMentioned.includes(term));
  if (disallowedMention) return null;

  if (containsPhrase(combinedText, DIAGNOSTIC_PHRASES)) return null;

  return {
    question: question.trim(),
    answerType: "single_select",
    options: (options as string[]).map((o) => o.trim()),
    purpose: purpose.trim(),
    safetyCheck: "passed",
  };
}
