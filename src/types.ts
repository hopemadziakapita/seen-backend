export type DailyContext = {
  date: string;
  sleepHours: number | null;
  sleepComparison: "lower" | "typical" | "higher" | "unknown";
  steps: number | null;
  activityComparison: "lower" | "typical" | "higher" | "unknown";
  calendarEventCount: number;
  calendarLoad: "low" | "moderate" | "high";
  weather: "sunny" | "cloudy" | "rain" | "snow" | "hot" | "cold";
  locationPattern?: "mostly_home" | "mostly_out" | "mixed" | "unknown";
};

export type InterpretedSignal = {
  tag: string;
  strength: number;
  source: string;
  explanation: string;
};

export type ClueCategory =
  | "sleep"
  | "movement"
  | "workload"
  | "environment"
  | "social"
  | "physical"
  | "recovery"
  | "neutral";

export type ClueType =
  | "signal_informed"
  | "possible_explanation"
  | "helpful_action"
  | "neutral_distractor";

export type Clue = {
  id: string;
  title: string;
  assetPath: string;
  category: ClueCategory;
  signalTags: string[];
  possibleMeanings: string[];
  compatibleBackgrounds: string[];
  compatibleSlots: string[];
  clueType: ClueType;
  baseWeight: number;
  recentRepeatPenalty: number;
};

export type ClueSelection = {
  clueId: string;
  selectedAt: string;
  dailyContextDate: string;
  userMeaning: string | null;
  followUpQuestion: string | null;
  answerOption: string | null;
  confidence: "clear" | "uncertain" | "skipped";
};

export type DailyEntry = {
  id: string;
  userId: string;
  date: string;
  context: DailyContext;
  interpretedSignals: InterpretedSignal[];
  displayedClueIds: string[];
  selectedClues: ClueSelection[];
  generatedSummary: string;
};

export type FollowUpQuestion = {
  question: string;
  answerType: "single_select";
  options: string[];
  purpose: string;
  safetyCheck: "passed";
};

export type PatternObservation = {
  clueA: string;
  clueB: string;
  coOccurrenceCount: number;
  clueACount: number;
  clueBCount: number;
  windowDays: number;
};

export const SIMULATED_DATA_DISCLAIMER =
  "Simulated passive context for prototype demonstration.";

// ── Health over time (7-day weekly insights) ──────────────────────────────

export type WeeklyClueMeaning = {
  name: string;
  meaning: string;
};

export type WeeklyDay = {
  date: string;
  sleep: { durationHours: number };
  movement: { steps: number; relativeLevel: string };
  weather: { condition: string; temperatureF: number };
  calendar: { eventCount: number; load: string };
  reflection: {
    completed: boolean;
    submittedAt: string | null;
    selectedClues: WeeklyClueMeaning[];
    finalText: string | null;
  };
};

export type WeeklyConfidence = "low" | "medium" | "high";

export type WeeklyPatternInsight = {
  title: string;
  summary: string;
  supportingDayCount: number;
  supportingDates: string[];
  signals: string[];
  commonClues: string[];
  confidence: WeeklyConfidence;
};

export type WeeklyHelpingInsight = {
  title: string;
  summary: string;
  supportingReflectionCount: number;
  supportingDates: string[];
  signals: string[];
  confidence: WeeklyConfidence;
};

export type WeeklyTheme = {
  title: string;
  description: string;
  quotes: string[];
  reflectionCount: number;
  supportingDates: string[];
  relatedClues: string[];
};

export type WeeklyInsights = {
  patternWorthNoticing: WeeklyPatternInsight;
  whatMayBeHelping: WeeklyHelpingInsight;
  themes: WeeklyTheme[];
};
