import { DailyContext, InterpretedSignal } from "../types";

/**
 * Transforms raw passive-context values into semantic tags only.
 * Must never produce a psychological label (e.g. "depressed") — only
 * observational tags like "low_activity". Possible explanations are
 * surfaced later, by the AI layer, and only ever as user-selectable
 * options — never asserted here.
 */
export function interpretSignals(context: DailyContext): InterpretedSignal[] {
  const signals: InterpretedSignal[] = [];

  if (context.sleepHours !== null && context.sleepHours < 6.5) {
    signals.push({
      tag: "short_sleep",
      strength: Math.min((6.5 - context.sleepHours) / 2, 1),
      source: "sleep_hours",
      explanation: "Sleep was shorter than the configured threshold.",
    });
  }

  if (context.calendarLoad === "high") {
    signals.push({
      tag: "high_calendar_load",
      strength: 0.9,
      source: "calendar",
      explanation: "The day included several scheduled events.",
    });
  }

  if (context.calendarLoad === "low") {
    signals.push({
      tag: "low_calendar_load",
      strength: 0.5,
      source: "calendar",
      explanation: "The day included few or no scheduled events.",
    });
  }

  if (context.activityComparison === "lower") {
    signals.push({
      tag: "low_activity",
      strength: 0.75,
      source: "steps",
      explanation: "Movement was lower than the simulated baseline.",
    });
  }

  if (context.activityComparison === "higher") {
    signals.push({
      tag: "high_activity",
      strength: 0.75,
      source: "steps",
      explanation: "Movement was higher than the simulated baseline.",
    });
  }

  if (context.weather === "rain") {
    signals.push({
      tag: "rainy_environment",
      strength: 0.65,
      source: "weather",
      explanation: "Rain was recorded for this day.",
    });
  }

  if (context.weather === "sunny") {
    signals.push({
      tag: "sunny_environment",
      strength: 0.5,
      source: "weather",
      explanation: "Sunny weather was recorded for this day.",
    });
  }

  if (context.weather === "cloudy") {
    signals.push({
      tag: "overcast_environment",
      strength: 0.4,
      source: "weather",
      explanation: "Overcast weather was recorded for this day.",
    });
  }

  if (context.weather === "cold" || context.weather === "snow") {
    signals.push({
      tag: "cold_environment",
      strength: 0.5,
      source: "weather",
      explanation: "Cold or snowy weather was recorded for this day.",
    });
  }

  if (context.locationPattern === "mostly_home") {
    signals.push({
      tag: "mostly_home_pattern",
      strength: 0.4,
      source: "location_pattern",
      explanation: "Most of the day was spent at a single, familiar location.",
    });
  }

  if (context.locationPattern === "mostly_out") {
    signals.push({
      tag: "mostly_out_pattern",
      strength: 0.4,
      source: "location_pattern",
      explanation: "Most of the day was spent away from home.",
    });
  }

  return signals;
}
