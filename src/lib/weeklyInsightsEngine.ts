import {
  WeeklyDay,
  WeeklyInsights,
  WeeklyPatternInsight,
  WeeklyHelpingInsight,
  WeeklyTheme,
  WeeklyConfidence,
} from "../types";
import {
  getAzureOpenAIClient,
  isAzureOpenAIConfigured,
  withTimeout,
  AZURE_OPENAI_DEPLOYMENT,
} from "./azureOpenAIClient";
import { containsPhrase, CAUSAL_PHRASES, DIAGNOSTIC_PHRASES } from "./textSafety";

const TIMEOUT_MS = 12000;

const SYSTEM_PROMPT = `You are an AI reflection-analysis assistant for Seen, a wellness reflection application.

Your role is to identify possible patterns across a user's daily context and written reflections. You are not a therapist, clinician, or diagnostic system.

You will receive a structured dataset containing up to seven days of:

- Sleep duration
- Movement or step count
- Weather
- Calendar activity
- Selected visual clues
- The meaning the user assigned to each clue
- The user's final saved reflection

Analyze the dataset and return:

1. One emerging pattern connecting daily context with reflection content
2. One factor that may have supported or helped the user
3. Two or three recurring themes from the user's reflections

Follow these rules:

GENERAL ANALYSIS RULES

- Treat the user's final saved reflection as the strongest source of meaning.
- Use clue meanings and selected clues as supporting context.
- Use sleep, movement, weather, and calendar activity only as contextual signals.
- Never infer emotions from passive data alone.
- Never claim that one variable caused another.
- Use tentative language such as:
  - "may be connected"
  - "appeared alongside"
  - "seemed to coincide with"
  - "may be worth noticing"
  - "your reflections more often mentioned"
- Do not diagnose, label, or imply a mental health condition.
- Do not prescribe actions or tell the user what they should do.
- Do not describe a day as good, bad, healthy, or unhealthy unless the user used that language.
- Compare days only within the provided dataset.
- Do not assume that more movement, longer sleep, sunny weather, or a lighter calendar is automatically better.
- Respect the user's own interpretation. Rest, low movement, solitude, or a busy day may be experienced positively.
- Do not force a pattern when the evidence is weak.
- A pattern should generally be supported by at least two reflected days.
- Prefer one clear and meaningful pattern over several weak correlations.
- Avoid repeating the same observation across multiple sections.

PATTERN WORTH NOTICING

Identify one emerging relationship between:

- Passive context, such as sleep, movement, weather, or calendar activity
- Repeated ideas expressed in the user's reflections or clue meanings

The pattern must:

- Be supported by at least two reflected days
- Explain what repeated across those days
- Mention only signals supported by the provided data
- Avoid causal language
- Include the dates of the supporting reflections

WHAT MAY BE HELPING

Identify one experience, action, condition, or form of support that repeatedly appeared alongside relief, clarity, connection, accomplishment, calm, acceptance, or another shift described positively by the user.

The potentially helpful factor may come from:

- Reflection content
- Clue meanings
- Movement
- Calendar context
- Social interaction mentioned in the reflection
- Rest or reduced demands
- Another repeated experience explicitly supported by the user's words

Do not assume movement is helpful merely because it is higher.

Only identify a helpful factor when the user's reflection language supports it.

THEMES

Generate two or three recurring themes based primarily on:

- Final saved reflections
- User-entered clue meanings
- Selected clues

Each theme must:

- Represent an idea appearing across at least two reflections
- Have a short, human, experience-based title
- Include a concise interpretation
- Include one to three exact excerpts from the user's final reflections
- Include related clues when relevant
- Include supporting dates

Theme titles should describe lived experiences, such as:

- "Feeling behind before starting"
- "Connection helped me feel less alone"
- "Resting without guilt"

Avoid generic category labels such as:

- "Work"
- "Mood"
- "Sleep"
- "Positive emotions"
- "Negative feelings"

QUOTE RULES

- Quotes must be exact extracts from the final saved reflection text.
- Never invent, rewrite, paraphrase, or combine quotes.
- Keep each excerpt brief.
- If no suitable exact quote exists, return an empty quotes array.
- Do not place quotation marks inside the quote string unless they appeared in the original reflection.

OUTPUT RULES

- Return valid JSON only.
- Do not include markdown.
- Do not include commentary before or after the JSON.
- Use the exact output schema provided.
- Use empty values rather than inventing unsupported information.
`;

const USER_PROMPT_TEMPLATE = `Analyze the following seven-day Seen dataset.

The dataset may contain days without completed reflections. Use passive context from those days only for visual comparison. Do not use a day without a reflection as evidence of the user's emotional experience.

DATASET:

{{SEVEN_DAY_DATASET}}

Return JSON using this exact structure:

{
  "patternWorthNoticing": {
    "title": "A pattern worth noticing",
    "summary": "",
    "supportingDayCount": 0,
    "supportingDates": [],
    "signals": [],
    "commonClues": [],
    "confidence": "low"
  },
  "whatMayBeHelping": {
    "title": "",
    "summary": "",
    "supportingReflectionCount": 0,
    "supportingDates": [],
    "signals": [],
    "confidence": "low"
  },
  "themes": [
    {
      "title": "",
      "description": "",
      "quotes": [],
      "reflectionCount": 0,
      "supportingDates": [],
      "relatedClues": []
    }
  ]
}

FIELD REQUIREMENTS

patternWorthNoticing.title:
Always return "A pattern worth noticing".

patternWorthNoticing.summary:
Write two or three concise sentences. Describe a possible relationship between context and the user's reflection content.

patternWorthNoticing.supportingDayCount:
Return the number of reflected days that directly support the pattern.

patternWorthNoticing.supportingDates:
Return only dates that directly support the pattern.

patternWorthNoticing.signals:
Return concise labels such as:
- "Shorter sleep"
- "Lower movement"
- "Busier calendar"
- "Rainy weather"
- "Feeling overwhelmed before starting"

patternWorthNoticing.commonClues:
Return only clues that appeared on supporting days and are relevant to the pattern.

whatMayBeHelping.title:
Create a brief title describing the possible support, such as:
- "Movement may be helping"
- "Small steps brought relief"
- "Connection offered support"
- "Rest created some space"

whatMayBeHelping.summary:
Write two or three concise sentences grounded in the user's own reflection language.

whatMayBeHelping.supportingReflectionCount:
Return the number of reflections that directly support the observation.

whatMayBeHelping.supportingDates:
Return only supporting reflection dates.

whatMayBeHelping.signals:
Return concise labels describing the supportive factor and the user-described shift.

themes:
Return two or three themes.

themes.title:
Use a specific human experience rather than a broad category.

themes.description:
Write one or two sentences explaining what repeated across the reflections.

themes.quotes:
Return one to three exact excerpts copied from final saved reflections.

themes.reflectionCount:
Return the number of reflections in which the theme appeared.

themes.supportingDates:
Return the dates of the reflections supporting the theme.

themes.relatedClues:
Return relevant clue names only when supported.

confidence:
Use:
- "high" when supported by four or more reflected days
- "medium" when supported by three reflected days
- "low" when supported by two reflected days

If no valid pattern is supported by at least two reflected days, return:

{
  "patternWorthNoticing": {
    "title": "A pattern worth noticing",
    "summary": "Your reflections contain meaningful moments, but a consistent connection has not emerged across this week yet.",
    "supportingDayCount": 0,
    "supportingDates": [],
    "signals": [],
    "commonClues": [],
    "confidence": "low"
  }
}

If no helpful factor is supported by at least two reflections, return:

{
  "whatMayBeHelping": {
    "title": "",
    "summary": "",
    "supportingReflectionCount": 0,
    "supportingDates": [],
    "signals": [],
    "confidence": "low"
  }
}
`;

const WEEKLY_INSIGHTS_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_weekly_insights",
    description:
      "Submit the generated weekly reflection insights in the required structured shape.",
    parameters: {
      type: "object",
      properties: {
        patternWorthNoticing: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            supportingDayCount: { type: "integer" },
            supportingDates: { type: "array", items: { type: "string" } },
            signals: { type: "array", items: { type: "string" } },
            commonClues: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: [
            "title",
            "summary",
            "supportingDayCount",
            "supportingDates",
            "signals",
            "commonClues",
            "confidence",
          ],
          additionalProperties: false,
        },
        whatMayBeHelping: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            supportingReflectionCount: { type: "integer" },
            supportingDates: { type: "array", items: { type: "string" } },
            signals: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: [
            "title",
            "summary",
            "supportingReflectionCount",
            "supportingDates",
            "signals",
            "confidence",
          ],
          additionalProperties: false,
        },
        themes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              quotes: { type: "array", items: { type: "string" } },
              reflectionCount: { type: "integer" },
              supportingDates: { type: "array", items: { type: "string" } },
              relatedClues: { type: "array", items: { type: "string" } },
            },
            required: [
              "title",
              "description",
              "quotes",
              "reflectionCount",
              "supportingDates",
              "relatedClues",
            ],
            additionalProperties: false,
          },
          minItems: 0,
          maxItems: 3,
        },
      },
      required: ["patternWorthNoticing", "whatMayBeHelping", "themes"],
      additionalProperties: false,
    },
  },
};

const FALLBACK_PATTERN: WeeklyPatternInsight = {
  title: "A pattern worth noticing",
  summary:
    "Your reflections contain meaningful moments, but a consistent connection has not emerged across this week yet.",
  supportingDayCount: 0,
  supportingDates: [],
  signals: [],
  commonClues: [],
  confidence: "low",
};

const FALLBACK_HELPING: WeeklyHelpingInsight = {
  title: "",
  summary: "",
  supportingReflectionCount: 0,
  supportingDates: [],
  signals: [],
  confidence: "low",
};

const FALLBACK_INSIGHTS: WeeklyInsights = {
  patternWorthNoticing: FALLBACK_PATTERN,
  whatMayBeHelping: FALLBACK_HELPING,
  themes: [],
};

export async function generateWeeklyInsights(days: WeeklyDay[]): Promise<WeeklyInsights> {
  if (!isAzureOpenAIConfigured()) return FALLBACK_INSIGHTS;

  try {
    const raw = await withTimeout(callAzureOpenAI(days), TIMEOUT_MS);
    const validated = validate(raw, days);
    return validated ?? FALLBACK_INSIGHTS;
  } catch {
    return FALLBACK_INSIGHTS;
  }
}

async function callAzureOpenAI(days: WeeklyDay[]): Promise<unknown> {
  const client = getAzureOpenAIClient();
  if (!client) throw new Error("Azure OpenAI client not configured");

  const userContent = USER_PROMPT_TEMPLATE.replace(
    "{{SEVEN_DAY_DATASET}}",
    JSON.stringify(days)
  );

  const completion = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    max_completion_tokens: 1200,
    // Same gpt-5-mini reasoning-family workaround used by every other engine
    // in this codebase — "low" still burns the whole budget on hidden
    // reasoning tokens and returns no visible output.
    reasoning_effort: "minimal" as unknown as "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    tools: [WEEKLY_INSIGHTS_TOOL],
    tool_choice: { type: "function", function: { name: "submit_weekly_insights" } },
  });

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") {
    throw new Error("No tool call returned by Azure OpenAI");
  }

  return JSON.parse(toolCall.function.arguments);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isConfidence(v: unknown): v is WeeklyConfidence {
  return v === "low" || v === "medium" || v === "high";
}

function isSafeText(text: string): boolean {
  return !containsPhrase(text, CAUSAL_PHRASES) && !containsPhrase(text, DIAGNOSTIC_PHRASES);
}

function validate(raw: unknown, days: WeeklyDay[]): WeeklyInsights | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const pattern = validatePattern(obj.patternWorthNoticing);
  const helping = validateHelping(obj.whatMayBeHelping);
  if (!pattern || !helping || !Array.isArray(obj.themes)) return null;

  const finalTexts = days
    .map((d) => d.reflection?.finalText)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  const themes: WeeklyTheme[] = [];
  for (const t of obj.themes) {
    const theme = validateTheme(t, finalTexts);
    if (theme) themes.push(theme);
  }
  if (themes.length > 3) themes.length = 3;

  return { patternWorthNoticing: pattern, whatMayBeHelping: helping, themes };
}

function validatePattern(raw: unknown): WeeklyPatternInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== "string") return null;
  if (typeof o.summary !== "string" || !isSafeText(o.summary)) return null;
  if (typeof o.supportingDayCount !== "number") return null;
  if (!isStringArray(o.supportingDates)) return null;
  if (!isStringArray(o.signals)) return null;
  if (!isStringArray(o.commonClues)) return null;
  if (!isConfidence(o.confidence)) return null;

  return {
    title: o.title.trim(),
    summary: o.summary.trim(),
    supportingDayCount: o.supportingDayCount,
    supportingDates: o.supportingDates,
    signals: o.signals,
    commonClues: o.commonClues,
    confidence: o.confidence,
  };
}

function validateHelping(raw: unknown): WeeklyHelpingInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== "string") return null;
  if (typeof o.summary !== "string" || !isSafeText(o.summary)) return null;
  if (typeof o.supportingReflectionCount !== "number") return null;
  if (!isStringArray(o.supportingDates)) return null;
  if (!isStringArray(o.signals)) return null;
  if (!isConfidence(o.confidence)) return null;

  return {
    title: o.title.trim(),
    summary: o.summary.trim(),
    supportingReflectionCount: o.supportingReflectionCount,
    supportingDates: o.supportingDates,
    signals: o.signals,
    confidence: o.confidence,
  };
}

function validateTheme(raw: unknown, finalTexts: string[]): WeeklyTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== "string" || o.title.trim().length === 0) return null;
  if (typeof o.description !== "string" || !isSafeText(o.description)) return null;
  if (!isStringArray(o.quotes)) return null;
  if (typeof o.reflectionCount !== "number") return null;
  if (!isStringArray(o.supportingDates)) return null;
  if (!isStringArray(o.relatedClues)) return null;

  // Quote-integrity rule: only trust quotes that are an exact substring of
  // some submitted day's final reflection text — never take the model's
  // word that it copied verbatim.
  const verifiedQuotes = o.quotes.filter(
    (q) => q.trim().length > 0 && finalTexts.some((text) => text.includes(q))
  );

  return {
    title: o.title.trim(),
    description: o.description.trim(),
    quotes: verifiedQuotes,
    reflectionCount: o.reflectionCount,
    supportingDates: o.supportingDates,
    relatedClues: o.relatedClues,
  };
}
