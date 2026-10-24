/**
 * Pure rules for a client's payroll calendar. No database here.
 *
 * A client agrees a rhythm once: inputs by the 20th, a draft three working days later, approval two working days after that, pay on the 28th,
 * statutory remittances by the 10th of the next month. From that, each month gets its own concrete dates, which can then be adjusted for
 * a holiday or an agreed exception. Working days are Monday to Friday; public holidays are not known to the app, so adjust the month's
 * dates when one falls on a deadline. Dates are YYYY-MM-DD strings (UTC), never times.
 */

export const INPUT_KINDS = ["ATTENDANCE", "OVERTIME", "ALLOWANCES", "DEDUCTIONS", "LOANS", "JOINERS_LEAVERS"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];
export const INPUT_KIND_LABELS: Record<InputKind, string> = {
  ATTENDANCE: "Attendance / work register",
  OVERTIME: "Overtime",
  ALLOWANCES: "Allowances and bonuses",
  DEDUCTIONS: "Deductions",
  LOANS: "Loans and advances",
  JOINERS_LEAVERS: "Joiners and leavers",
};

export type CalendarRule = {
  /** Day of the pay month by which the client's inputs are due. */
  inputCutoffDay: number;
  /** Working days after the cut-off by which the bureau's draft is due. */
  draftWorkingDays: number;
  /** Working days after the draft by which the client approves. */
  approvalWorkingDays: number;
  /** Day of the month employees are paid; a weekend moves it to the working day before. */
  payDayOfMonth: number;
  /** Day of the following month statutory remittances fall due; a weekend moves it to the working day before. */
  remittanceDueDay: number;
};

export const DEFAULT_CALENDAR_RULE: CalendarRule = { inputCutoffDay: 20, draftWorkingDays: 3, approvalWorkingDays: 2, payDayOfMonth: 28, remittanceDueDay: 10 };

export type CalendarDates = { inputCutoff: string; draftDue: string; approvalDue: string; payDate: string; remittanceDue: string };

const MS = 86400000;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The date `day` of the month, or the month's last day if it has fewer days (31 in a 30-day month). */
function onDay(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, Math.min(day, daysInMonth(y, m))));
}
function previousWorkingDay(d: Date): Date {
  let x = d;
  while (isWeekend(x)) x = new Date(x.getTime() - MS);
  return x;
}
export function addWorkingDays(start: string, n: number): string {
  let d = parse(start);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + MS);
    if (!isWeekend(d)) left--;
  }
  return fmt(d);
}

export function ruleProblems(r: CalendarRule): string[] {
  const out: string[] = [];
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(r.inputCutoffDay, 1, 28)) out.push("The input cut-off day must be between 1 and 28.");
  if (!int(r.draftWorkingDays, 1, 15)) out.push("The draft is due 1 to 15 working days after the cut-off.");
  if (!int(r.approvalWorkingDays, 1, 15)) out.push("Approval is due 1 to 15 working days after the draft.");
  if (!int(r.payDayOfMonth, 1, 31)) out.push("The pay day must be between 1 and 31.");
  if (!int(r.remittanceDueDay, 1, 31)) out.push("The remittance day must be between 1 and 31.");
  return out;
}

/** The dates for one pay month (month 1-12). */
export function buildCalendar(r: CalendarRule, year: number, month: number): CalendarDates {
  const inputCutoff = fmt(previousWorkingDay(onDay(year, month, r.inputCutoffDay)));
  const draftDue = addWorkingDays(inputCutoff, r.draftWorkingDays);
  const approvalDue = addWorkingDays(draftDue, r.approvalWorkingDays);
  const payDate = fmt(previousWorkingDay(onDay(year, month, r.payDayOfMonth)));
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const remittanceDue = fmt(previousWorkingDay(onDay(ny, nm, r.remittanceDueDay)));
  return { inputCutoff, draftDue, approvalDue, payDate, remittanceDue };
}

/** Things worth saying about a month's dates: a calendar that can't work as agreed. */
export function datesProblems(d: CalendarDates): string[] {
  const out: string[] = [];
  if (!(d.inputCutoff <= d.draftDue && d.draftDue <= d.approvalDue)) out.push("The dates must run in order: inputs, then the draft, then approval.");
  if (d.approvalDue > d.payDate) out.push(`Approval is due ${d.approvalDue}, after the pay date ${d.payDate}. Move the cut-off earlier or the pay day later.`);
  if (d.payDate > d.remittanceDue) out.push("The pay date is after the remittance date.");
  return out;
}

export type MilestoneState = "DONE" | "OVERDUE" | "DUE_SOON" | "UPCOMING";
export const DUE_SOON_DAYS = 3;

/** Where a deadline stands on `today`. Done wins; otherwise by how far off it is. */
export function milestoneState(due: string, done: boolean, today: string): MilestoneState {
  if (done) return "DONE";
  if (due < today) return "OVERDUE";
  const days = Math.round((parse(due).getTime() - parse(today).getTime()) / MS);
  return days <= DUE_SOON_DAYS ? "DUE_SOON" : "UPCOMING";
}

/** Whole days from `today` to `due` (negative when late). */
export function daysUntil(due: string, today: string): number {
  return Math.round((parse(due).getTime() - parse(today).getTime()) / MS);
}

export const MILESTONES = [
  { key: "inputCutoff", label: "Inputs due from the client" },
  { key: "draftDue", label: "Draft payroll due" },
  { key: "approvalDue", label: "Client approval due" },
  { key: "payDate", label: "Pay date" },
  { key: "remittanceDue", label: "Statutory remittances due" },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]["key"];
