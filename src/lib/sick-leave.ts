/**
 * Paid sick leave for a person paid by the hour (the founder's H14, docs/plans/hourly-payroll-h14-build-plan.md). Pure: no database, no framework.
 *
 * His answers of 2026-11-20 and 2026-11-21: a set number of paid days a year (the leave policy's figure, 5), in the SAME leave year as annual leave, due only after the same service period (the leave policy's months, 12 as
 * shipped, as for monthly staff). A spell of sickness is charged to the leave year that contains its FIRST day, whenever it is recorded: a person is often ill before anyone records it. Days beyond the entitlement are not
 * refused (sickness is not optional); they are simply not paid, which is worked out where the pay is (a later step).
 */
import { leaveEligibility, type LeaveCycle } from "./leave";

/** The leave year containing `date` (the first day of a spell), or null before the service period is complete. */
export function sickCycleFor(employmentDate: Date, date: Date, eligibilityMonths: number): LeaveCycle | null {
  return leaveEligibility(employmentDate, date, eligibilityMonths).cycle;
}

export interface SickBalance {
  entitled: number;
  approved: number;
  pending: number;
  remaining: number;
}

/** The days of a leave year: approved and pending days count, rejected and cancelled ones and those of other leave years do not. */
export function sickBalance(entitled: number, spells: ReadonlyArray<{ cycleStart: Date; status: string; workingDays: number }>, cycleStart: Date): SickBalance {
  const inYear = spells.filter((s) => s.cycleStart.getTime() === cycleStart.getTime());
  const sum = (status: string) => inYear.filter((s) => s.status === status).reduce((a, s) => a + s.workingDays, 0);
  const approved = sum("APPROVED");
  const pending = sum("PENDING");
  return { entitled, approved, pending, remaining: Math.max(0, entitled - approved - pending) };
}
