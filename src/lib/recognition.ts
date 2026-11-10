/**
 * Pure rules for recognition awards: the life of an award, who may approve it, the company's long-service years, and which anniversaries are coming up.
 * No database and no clock here (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * Who may nominate whom is the same rule as for feedback (a manager about a direct report, HR about anyone, nobody about themselves), so it is reused from
 * src/lib/feedback.ts (`mayGiveFeedback`), not written a second time. A recognition award handles no money: a cash or gift value is not part of this step.
 */
import { d, iso } from "@/lib/dates";

export const AWARD_STATUSES = ["NOMINATED", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];
export const AWARD_STATUS_LABELS: Record<AwardStatus, string> = { NOMINATED: "Nominated", APPROVED: "Approved", REJECTED: "Rejected", WITHDRAWN: "Withdrawn" };

export type AwardEvent = "APPROVE" | "REJECT" | "WITHDRAW";
/** Where an award goes after an event, or null if the event does not apply. An approved award can only be withdrawn (a correction). */
export function awardStatusAfter(from: AwardStatus, event: AwardEvent): AwardStatus | null {
  if (from === "NOMINATED") return event === "APPROVE" ? "APPROVED" : event === "REJECT" ? "REJECTED" : "WITHDRAWN";
  if (from === "APPROVED" && event === "WITHDRAW") return "WITHDRAWN";
  return null;
}

/** The person who nominated an award does not also approve or reject it. Returns why not, or null. */
export const nominatorConflict = (userId: string, nominatorUserId: string): string | null =>
  userId === nominatorUserId ? "You nominated this person: someone else has to decide." : null;

/** The company's long-service years from a comma-separated list: whole numbers 1 to 60, at most ten, sorted and without repeats. Null if it is not valid. */
export function parseMilestoneYears(input: string): number[] | null {
  const parts = input.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 10) return null;
  const years: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 1 || n > 60) return null;
    years.push(n);
  }
  return [...new Set(years)].sort((a, b) => a - b);
}

/** The anniversary of a date in a later year: the same month and day, or 28 February for a 29 February joiner in a year without one. */
function anniversary(employmentDate: string, years: number): string {
  const e = d(employmentDate);
  const y = e.getUTCFullYear() + years;
  const m = e.getUTCMonth();
  const day = e.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

/** Employees reaching one of the company's milestone years within the next `withinDays` days (today included), soonest first. A prompt only: never an award. */
export function upcomingMilestones(employees: Array<{ id: string; employmentDate: string }>, today: string, years: number[], withinDays: number): Array<{ employeeId: string; years: number; on: string }> {
  const last = iso(new Date(d(today).getTime() + withinDays * 86_400_000));
  const out: Array<{ employeeId: string; years: number; on: string }> = [];
  for (const e of employees)
    for (const y of years) {
      const on = anniversary(e.employmentDate, y);
      if (on >= today && on <= last) out.push({ employeeId: e.id, years: y, on });
    }
  return out.sort((a, b) => a.on.localeCompare(b.on) || a.employeeId.localeCompare(b.employeeId));
}
