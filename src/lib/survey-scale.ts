/** The five-point scale's labels. Kept apart from `survey.ts` because that file uses Node's crypto (for access codes) and a browser component must never reach it. */
export const SCALE_LABELS: Record<number, string> = { 1: "Strongly disagree", 2: "Disagree", 3: "Neither agree nor disagree", 4: "Agree", 5: "Strongly agree" };
