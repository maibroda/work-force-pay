import { describe, expect, it } from "vitest";
import { d, eachDay, iso } from "@/lib/dates";
import { calculateEmployeePayroll, type RateInfo, type WorkDay } from "@/lib/payroll/engine";
import { monthProration } from "@/lib/paid-days";
import { NTA_2025_BANDS, type TaxRuleDef } from "@/lib/payroll/paye";
import { DEFAULT_EARNINGS, splitAgreedRate, type StructureDef } from "@/lib/payroll/structure";

/**
 * The pay engine with the paid-days basis (docs/plans/paid-days-basis.md). The engine is given the month's divisor (basisDays) and the ISO dates that add no basic pay (weekends and, if
 * the contract excludes them, public holidays, on the working-days basis). Only paid days that are NOT in that list count towards basic pay, so pay on the working-days basis never exceeds one
 * full gross: extra days are paid only as overtime. With nothing set aside the engine behaves exactly as it always has (the characterization and golden tests pin that).
 * Worked month: November 2026 has 30 days, of which 21 are Monday-to-Friday working days; a guard's operative gross is ₦70,000 (agreed rate ₦100,000 at the 70% share).
 */
const STD: StructureDef = { id: "std", code: "STD", name: "Standard", isPartial: false, components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })) };
const TAX: TaxRuleDef = { code: "NTA", version: "t", bands: NTA_2025_BANDS, reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true }], exemptions: [{ code: "MIN_WAGE", description: "min wage", annualGrossCeiling: 840000, active: true }] };
const PENSION = { employeeRate: 8, employerRate: 10, version: "v" };
const RATE: RateInfo = { key: "r1", source: "CONTRACT_RATE", agreedRate: 100000, operativeSharePct: 70, monthlyGross: splitAgreedRate(100000, 70).operativeGross, structure: STD };

const NOV = eachDay(d("2026-11-01"), d("2026-11-30"));
const isWeekend = (x: Date) => x.getUTCDay() === 0 || x.getUTCDay() === 6;
const day = (date: Date, status: WorkDay["status"] = "PRESENT", overtimeHours = 0): WorkDay => ({ date, clientId: "ABC", clientName: "ABC Bank", contractId: "K1", beatId: "B1", beatName: "HQ", categoryId: "GUARD", status, overtimeHours });
const work = (dates: Date[], status: WorkDay["status"] = "PRESENT") => dates.map((x) => day(x, status));
const pay = (days: WorkDay[], basisDays: number, nonProratedDates?: string[], extra: Record<string, unknown> = {}) =>
  calculateEmployeePayroll({ basisDays, days, resolveRate: () => RATE, pension: PENSION, taxRule: TAX, ...(nonProratedDates ? { nonProratedDates } : {}), ...extra });
const WORKING = monthProration(2026, 11, { basis: "WORKING_DAYS", excludePublicHolidays: false, workingDaysPerWeek: null }, { companyBasisDays: 30, leaveWorkingDaysPerWeek: 5, holidays: [] });

describe("the working-days basis in the pay engine (November 2026: 21 working days, operative gross ₦70,000)", () => {
  it("the proration gives 21 working days and the nine weekend days that add no basic pay", () => {
    expect(WORKING.basisDays).toBe(21);
    expect(WORKING.nonProratedDates).toHaveLength(9);
  });

  it("someone who works every working day is paid the full gross, and a person who works only weekdays on the calendar basis is paid less (the basis matters)", () => {
    const weekdays = NOV.filter((x) => !isWeekend(x));
    expect(pay(work(weekdays), WORKING.basisDays, WORKING.nonProratedDates).earnedGross).toBe(70000);
    // on the calendar basis (30 days) the same 21 days earn 21/30 of the gross
    expect(pay(work(weekdays), 30).earnedGross).toBe(49000);
  });

  it("works every day, weekends included, and is still paid one full gross, never more: the weekend days add no basic pay (they are for overtime)", () => {
    const res = pay(work(NOV), WORKING.basisDays, WORKING.nonProratedDates);
    expect(res.earnedGross).toBe(70000);
    expect(res.allocations[0].days).toBe(21); // only the working days counted
    expect(res.daysWorked).toBe(30); // the days actually worked are still recorded
  });

  it("is paid pro rata for the working days missed, and the weekend days worked do not make up for them: 19 of 21 working days = ₦63,333.34", () => {
    const weekdays = NOV.filter((x) => !isWeekend(x));
    const present = [...weekdays.slice(0, 19), ...NOV.filter(isWeekend).slice(0, 4)]; // two weekdays missed, four weekend days worked
    const res = pay(work(present), WORKING.basisDays, WORKING.nonProratedDates);
    expect(res.earnedGross).toBe(63333.34); // each earnings line is rounded to the kobo where it is calculated (as always), so the nine lines add to ₦63,333.34, not the exact ₦63,333.3333
    expect(res.allocations[0].days).toBe(19);
  });

  it("counts leave and off days on a working day as paid days, and does not count a day that is not recorded at all", () => {
    const weekdays = NOV.filter((x) => !isWeekend(x));
    const days = [...work(weekdays.slice(0, 17)), ...work(weekdays.slice(17, 19), "LEAVE"), ...work(weekdays.slice(19, 20), "OFF")]; // 17 present + 2 leave + 1 off = 20; one weekday has no record
    expect(pay(days, WORKING.basisDays, WORKING.nonProratedDates).earnedGross).toBe(66666.66); // 70,000 x 20 / 21, the nine lines each rounded to the kobo
  });

  it("an absent working day is not paid; overtime hours are carried as before", () => {
    const weekdays = NOV.filter((x) => !isWeekend(x));
    const days = [...work(weekdays.slice(0, 20)), ...work(weekdays.slice(20, 21), "ABSENT")];
    const res = pay(days, WORKING.basisDays, WORKING.nonProratedDates);
    expect(res.earnedGross).toBe(66666.66);
    expect(res.daysAbsent).toBe(1);
    const withOt = pay(work(NOV.filter((x) => !isWeekend(x))), WORKING.basisDays, WORKING.nonProratedDates, { overtime: [{ id: "o1", beatId: "B1", clientId: "ABC", contractId: "K1", hours: 6, amount: 5000 }] });
    expect(withOt.overtimeHours).toBe(6); // approved overtime (the route for weekend and holiday work) is paid on top, as before
    expect(withOt.overtimeAmount).toBe(5000);
    expect(withOt.earnedGross).toBe(70000);
  });

  it("pension, tax and net pay follow the pay actually earned (no special rule for the working-days basis)", () => {
    const full = pay(work(NOV.filter((x) => !isWeekend(x))), WORKING.basisDays, WORKING.nonProratedDates);
    const part = pay(work(NOV.filter((x) => !isWeekend(x)).slice(0, 14)), WORKING.basisDays, WORKING.nonProratedDates); // 14 of 21
    expect(part.earnedGross).toBe(46666.66);
    expect(part.employeePension).toBeLessThan(full.employeePension);
    expect(part.netPay).toBeLessThan(full.netPay);
  });

  it("changes nothing when no day is set aside: the calendar basis and the company's rule pay exactly as before", () => {
    expect(pay(work(NOV), 30).earnedGross).toBe(70000);
    expect(pay(work(NOV.slice(0, 15)), 30).earnedGross).toBe(35000);
    expect(pay(work(NOV), 30, []).earnedGross).toBe(70000);
    expect(pay(work(NOV), 30, undefined).earnedGross).toBe(pay(work(NOV), 30, []).earnedGross);
  });

  it("a holiday set aside by the contract adds no basic pay, and the divisor is smaller (20 working days when 2026-11-10 is a holiday)", () => {
    const withHoliday = monthProration(2026, 11, { basis: "WORKING_DAYS", excludePublicHolidays: true, workingDaysPerWeek: null }, { companyBasisDays: 30, leaveWorkingDaysPerWeek: 5, holidays: ["2026-11-10"] });
    expect(withHoliday.basisDays).toBe(20);
    const weekdays = NOV.filter((x) => !isWeekend(x) && iso(x) !== "2026-11-10");
    expect(pay(work(weekdays), withHoliday.basisDays, withHoliday.nonProratedDates).earnedGross).toBe(70000); // takes the holiday off, full gross
    expect(pay(work(NOV.filter((x) => !isWeekend(x))), withHoliday.basisDays, withHoliday.nonProratedDates).earnedGross).toBe(70000); // works the holiday: no extra basic pay (overtime is separate)
  });
});
