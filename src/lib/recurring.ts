/**
 * Pure rules for recurring journals. No database here.
 *
 * A recurring journal is a template, not an entry: each period it generates an ordinary journal draft (rent, insurance
 * amortisation, a standing accrual) which then goes through the usual submit, approve and post path. The template
 * itself never touches the ledger.
 */
import { addDays, daysInMonth, MONTHS } from "./dates";
import { draftProblems, type DraftLine, type JournalKind } from "./journals";

export type Frequency = "MONTHLY" | "QUARTERLY" | "YEARLY";

export const FREQUENCY_LABELS: Record<Frequency, string> = { MONTHLY: "Every month", QUARTERLY: "Every quarter", YEARLY: "Every year" };
const STEP: Record<Frequency, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** The most journals one run will generate for one template, so a template left idle for years can't flood the drafts. */
export const MAX_CATCH_UP = 24;

const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day));
const isMonthEnd = (date: Date) => date.getUTCDate() === daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);

/**
 * The posting date of the nth journal (0 = the first). Counted from the start date every time, so a template that
 * starts on the 31st posts on the last day of shorter months and is back on the 31st afterwards, not stuck on the 28th.
 */
export function occurrence(start: Date, n: number, frequency: Frequency, monthEnd: boolean): Date {
  const total = start.getUTCMonth() + n * STEP[frequency];
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = daysInMonth(year, month + 1);
  return utc(year, month, monthEnd ? last : Math.min(start.getUTCDate(), last));
}

/** The next posting date after the nth, or null when it would fall after the end date. */
export function nextAfter(start: Date, n: number, frequency: Frequency, monthEnd: boolean, end: Date | null): Date | null {
  const next = occurrence(start, n + 1, frequency, monthEnd);
  return end && next > end ? null : next;
}

/** Fills {month}, {quarter} and {year} in a description with the period the journal posts in. */
export function renderDescription(template: string, date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return template
    .replaceAll("{month}", `${MONTHS[m]} ${y}`)
    .replaceAll("{quarter}", `Q${Math.floor(m / 3) + 1} ${y}`)
    .replaceAll("{year}", String(y));
}

export interface TemplateFacts {
  name: string;
  kind: JournalKind;
  description: string;
  frequency: Frequency;
  monthEnd: boolean;
  startDate: Date | null;
  endDate: Date | null;
  reverseAfterDays: number | null;
  lines: DraftLine[];
}

/** Everything wrong with a template that stops it being saved, as plain sentences. Empty = fine. */
export function templateProblems(t: TemplateFacts): string[] {
  const out: string[] = [];
  if (t.name.trim().length < 3) out.push("Give the template a name.");
  if (t.description.trim().length < 3) out.push("Say what the journals are for.");
  const start = t.startDate && !Number.isNaN(t.startDate.getTime()) ? t.startDate : null;
  if (!start) out.push("Choose the date of the first journal.");
  if (start && t.monthEnd && !isMonthEnd(start)) out.push("Posting on the last day of the month needs the first date to be a month end.");
  if (start && t.endDate && t.endDate < start) out.push("The end date is before the first journal.");
  const reverseAfter = t.kind === "ACCRUAL" ? t.reverseAfterDays : null;
  if (t.kind === "ACCRUAL" && (!reverseAfter || !Number.isInteger(reverseAfter) || reverseAfter < 1 || reverseAfter > 90)) out.push("An accrual needs the number of days after which it reverses (1 to 90).");
  // the lines are held to the same rules as any journal, judged on the first journal
  const problems = draftProblems({ kind: t.kind, postingDate: start, reverseOn: start && reverseAfter ? addDays(start, reverseAfter) : null, lines: t.lines });
  return [...out, ...problems.filter((p) => !out.includes(p))];
}
