import { DailyContext } from "../types";

export type DemoProfileKey = "A" | "B" | "C" |"D";

export type DemoProfile = {
  key: DemoProfileKey;
  label: string;
  description: string;
  context: DailyContext;
};

/**
 * The four demo passive-context profiles from the team's requirements doc.
 * Profile C deliberately shows that low activity is not automatically a
 * negative signal — it's a quiet recovery day, not a bad one.
 */
export const DEMO_PROFILES: Record<DemoProfileKey, DemoProfile> = {
  A: {
    key: "A",
    label: "Overloaded day",
    description: "Short sleep, low movement, a packed calendar, and rain.",
    context: {
      date: "2026-07-27",
      sleepHours: 5.4,
      sleepComparison: "lower",
      steps: 2100,
      activityComparison: "lower",
      calendarEventCount: 7,
      calendarLoad: "high",
      weather: "rain",
      locationPattern: "mostly_home",
    },
  },
  B: {
    key: "B",
    label: "Active day",
    description: "Good sleep, high movement, a light calendar, and sun.",
    context: {
      date: "2026-07-28",
      sleepHours: 7.8,
      sleepComparison: "typical",
      steps: 10300,
      activityComparison: "higher",
      calendarEventCount: 2,
      calendarLoad: "low",
      weather: "sunny",
      locationPattern: "mostly_out",
    },
  },
  C: {
    key: "C",
    label: "Quiet recovery day",
    description: "Full sleep, low movement, an empty calendar, and clouds.",
    context: {
      date: "2026-07-29",
      sleepHours: 8.1,
      sleepComparison: "typical",
      steps: 3200,
      activityComparison: "lower",
      calendarEventCount: 0,
      calendarLoad: "low",
      weather: "cloudy",
      locationPattern: "mostly_home",
    },
  },
  D: {
    key: "D",
    label: "Busy day",
    description: "Good sleep, high movement, a packed calendar, and sun.",
    context: {
      date: "2026-07-30",
      sleepHours: 7.2,
      sleepComparison: "typical",
      steps: 9500,
      activityComparison: "higher",
      calendarEventCount: 5,
      calendarLoad: "high",
      weather: "sunny",
      locationPattern: "mostly_out",
    },
  },
};
