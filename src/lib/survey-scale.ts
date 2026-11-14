/** The five-point scale's labels. Kept apart from `survey.ts` because that file uses Node's crypto (for access codes) and a browser component must never reach it. */
/** Shown beside every comment box. A comment is read word for word (from five answers, unnamed), so the guidance is to write nothing that points at a person, including the writer. */
export const COMMENT_GUIDANCE = "Please do not write names, your site, your shift or anything else that could point to you or to someone else. Your comment is shown word for word, without your name, to HR once at least five people have answered.";

export const SCALE_LABELS: Record<number, string> = { 1: "Strongly disagree", 2: "Disagree", 3: "Neither agree nor disagree", 4: "Agree", 5: "Strongly agree" };
