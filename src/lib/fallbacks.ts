import { Clue, FollowUpQuestion } from "../types";

type FallbackShape = { question: string; options: string[] };

export const fallbackQuestions: Record<string, FallbackShape> = {
  sleep: {
    question: "How did this affect you today?",
    options: ["Lower energy", "Harder to focus", "Did not affect me", "Not sure"],
  },
  workload: {
    question: "How did this workload feel?",
    options: ["Manageable", "Energizing", "Draining", "Not sure"],
  },
  social: {
    question: "How did this interaction feel?",
    options: ["Supportive", "Draining", "Neutral", "Not sure"],
  },
  recovery: {
    question: "What did this moment mean?",
    options: ["Helped me recover", "Felt isolating", "Felt neutral", "Not sure"],
  },
};

const genericFallback: FallbackShape = {
  question: "What did this moment mean to you?",
  options: ["Positive", "Neutral", "Difficult", "Not sure"],
};

/**
 * Maps a clue's category to one of the four curated fallback questions,
 * falling back to a generic (but still safe, non-diagnostic) question for
 * categories that don't map cleanly (movement, environment, physical, neutral).
 */
export function getFallbackQuestion(clueCategory: Clue["category"]): FollowUpQuestion {
  const shape = fallbackQuestions[clueCategory] ?? genericFallback;
  return {
    question: shape.question,
    answerType: "single_select",
    options: shape.options,
    purpose: "fallback_clarification",
    safetyCheck: "passed",
  };
}
