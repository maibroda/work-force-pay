/**
 * Pure rules for financial years and accounting periods. No database here.
 *
 * A financial year is twelve calendar months starting in the organization's first fiscal month (1 = January). Each
 * month is an accounting period, and the period's status decides whether anything can be posted into it.
 */

export type PeriodStatus = "OPEN" | "SOFT_CLOSED" | "CLOSED" | "LOCKED";
export type PeriodAction = "SOFT_CLOSE" | "CLOSE" | "LOCK" | "REOPEN";

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: "Open",
  SOFT_CLOSED: "Soft closed",
  CLOSED: "Closed",
  LOCKED: "Locked",
};

export const PERIOD_ACTION_LABELS: Record<PeriodAction, string> = {
  SOFT_CLOSE: "Soft close",
  CLOSE: "Close",
  LOCK: "Lock",
  REOPEN: "Reopen",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utc = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));

export interface FiscalYearSpec {
  name: string;
  startDate: Date;
  endDate: Date;
}

export interface PeriodSpec {
  number: number;
  name: string;
  startDate: Date;
  endDate: Date;
}

/** The financial year that contains `date`, for a year starting in `startMonth` (1–12). */
export function fiscalYearFor(date: Date, startMonth: number): FiscalYearSpec {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error("The first month of the financial year must be 1–12.");
  const m0 = startMonth - 1;
  const startYear = date.getUTCMonth() >= m0 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const startDate = utc(startYear, m0, 1);
  const endDate = utc(startYear + 1, m0, 0); // the day before the next year starts
  const name = startMonth === 1 ? `FY${startYear}` : `FY${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { name, startDate, endDate };
}

/** The twelve monthly periods of a financial year that starts on `yearStart`. */
export function monthlyPeriods(yearStart: Date): PeriodSpec[] {
  const y = yearStart.getUTCFullYear();
  const m0 = yearStart.getUTCMonth();
  return Array.from({ length: 12 }, (_, i) => {
    const startDate = utc(y, m0 + i, 1);
    return { number: i + 1, name: `${MONTHS[startDate.getUTCMonth()]} ${startDate.getUTCFullYear()}`, startDate, endDate: utc(y, m0 + i + 1, 0) };
  });
}

export interface PostingCheck {
  ok: boolean;
  reason?: string;
}

/** May something be posted into a period with this status? Soft-closed periods still accept finance's adjustments. */
export function postingAllowed(status: PeriodStatus, periodName: string, canPostWhenSoftClosed: boolean): PostingCheck {
  switch (status) {
    case "OPEN":
      return { ok: true };
    case "SOFT_CLOSED":
      return canPostWhenSoftClosed
        ? { ok: true }
        : { ok: false, reason: `${periodName} is soft closed: only finance staff with the close permission can still post into it.` };
    case "CLOSED":
      return { ok: false, reason: `${periodName} is closed. Posting needs it reopened, with a reason, by someone authorised.` };
    case "LOCKED":
      return { ok: false, reason: `${periodName} is locked and cannot be posted to or reopened.` };
  }
}

/** The status an action leads to, or null when the action isn't allowed from the current status. */
export function nextStatus(action: PeriodAction, from: PeriodStatus): PeriodStatus | null {
  switch (action) {
    case "SOFT_CLOSE":
      return from === "OPEN" ? "SOFT_CLOSED" : null;
    case "CLOSE":
      return from === "SOFT_CLOSED" ? "CLOSED" : null;
    case "LOCK":
      return from === "CLOSED" ? "LOCKED" : null;
    case "REOPEN":
      return from === "SOFT_CLOSED" || from === "CLOSED" ? "OPEN" : null;
  }
}

/** Why an action isn't possible from a status, for the message. */
export function whyNot(action: PeriodAction, from: PeriodStatus): string {
  if (from === "LOCKED") return "A locked period is final.";
  const needs = { SOFT_CLOSE: "open", CLOSE: "soft closed", LOCK: "closed", REOPEN: "soft closed or closed" }[action];
  return `Only a period that is ${needs} can be ${PERIOD_ACTION_LABELS[action].toLowerCase()}d; this one is ${PERIOD_STATUS_LABELS[from].toLowerCase()}.`;
}
