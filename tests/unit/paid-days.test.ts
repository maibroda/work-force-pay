import { describe, expect, it } from "vitest";
import { d, daysInMonth, iso } from "@/lib/dates";
import { employeeProration, isWorkingDay, monthProration, resolveSetting, type BasisRow, type BasisSetting } from "@/lib/paid-days";

/**
 * The founder's decisions of 2026-11-05 (docs/plans/paid-days-basis.md and docs/plans/founder-decisions-2026-11-05.md): a month's pay is divided either by the DAYS IN THE MONTH or by the
 * WORKING DAYS in it (for example 22), "sometimes excluding public holidays", as agreed with the client and set on the contract. The working week defaults to the company's "working days per week"
 * (Monday to Friday) and a contract may override it. A day that is not a working day adds no basic pay on the working-days basis (extra days are paid only as overtime). A contract with no setting
 * keeps the company's rule exactly as before. These are the pure rules; the pay engine and the database are tested elsewhere.
 */
const working = (over: Partial<BasisSetting> = {}): BasisSetting => ({ basis: "WORKING_DAYS", excludePublicHolidays: false, workingDaysPerWeek: null, ...over });
const calendar: BasisSetting = { basis: "CALENDAR_DAYS", excludePublicHolidays: false, workingDaysPerWeek: null };
const ctx = (over: Partial<{ companyBasisDays: number; leaveWorkingDaysPerWeek: number; holidays: string[] }> = {}) => ({ companyBasisDays: 30, leaveWorkingDaysPerWeek: 5, holidays: [] as string[], ...over });

describe("which days are working days", () => {
  it("Monday to Friday for 5, Monday to Saturday for 6, every day for 7", () => {
    const sat = d("2026-11-07");
    const sun = d("2026-11-08");
    const mon = d("2026-11-09");
    expect([isWorkingDay(mon, 5), isWorkingDay(sat, 5), isWorkingDay(sun, 5)]).toEqual([true, false, false]);
    expect([isWorkingDay(mon, 6), isWorkingDay(sat, 6), isWorkingDay(sun, 6)]).toEqual([true, true, false]);
    expect([isWorkingDay(mon, 7), isWorkingDay(sat, 7), isWorkingDay(sun, 7)]).toEqual([true, true, true]);
  });
});

describe("the month's divisor and the days that add no basic pay", () => {
  it("a contract with no setting keeps the company's rule exactly: its basis days, and no day set aside", () => {
    expect(monthProration(2026, 11, null, ctx({ companyBasisDays: 30 }))).toEqual({ basisDays: 30, nonProratedDates: [], mode: "COMPANY_DEFAULT" });
    expect(monthProration(2026, 2, null, ctx({ companyBasisDays: 28 }))).toMatchObject({ basisDays: 28, mode: "COMPANY_DEFAULT" });
  });

  it("calendar days: the days in the month (31 for January, 28 or 29 for February, 30 for April), whatever the company's rule", () => {
    for (const [y, m, n] of [[2026, 1, 31], [2026, 2, 28], [2028, 2, 29], [2026, 4, 30]] as const) {
      expect(monthProration(y, m, calendar, ctx({ companyBasisDays: 30 }))).toEqual({ basisDays: n, nonProratedDates: [], mode: "CALENDAR_DAYS" });
      expect(daysInMonth(y, m)).toBe(n);
    }
  });

  it("working days, Monday to Friday: 22 in January 2026, 20 in February 2026, 21 in November 2026; the weekend days are the days that add no basic pay", () => {
    expect(monthProration(2026, 1, working(), ctx()).basisDays).toBe(22);
    expect(monthProration(2026, 2, working(), ctx()).basisDays).toBe(20);
    const nov = monthProration(2026, 11, working(), ctx());
    expect(nov.basisDays).toBe(21);
    expect(nov.nonProratedDates).toEqual(["2026-11-01", "2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29"]);
    expect(nov.mode).toBe("WORKING_DAYS");
  });

  it("the working week comes from the contract when it sets one, else from the company's leave setting", () => {
    expect(monthProration(2026, 1, working({ workingDaysPerWeek: 6 }), ctx()).basisDays).toBe(27); // Monday to Saturday
    expect(monthProration(2026, 1, working(), ctx({ leaveWorkingDaysPerWeek: 6 })).basisDays).toBe(27);
    expect(monthProration(2026, 1, working({ workingDaysPerWeek: 5 }), ctx({ leaveWorkingDaysPerWeek: 6 })).basisDays).toBe(22); // the contract wins
  });

  it("excluding public holidays takes the confirmed holidays out of the working days, adds them to the days that add no basic pay, and does not count a weekend holiday twice", () => {
    const holidays = ["2026-01-01", "2026-01-03"]; // a Thursday and a Saturday
    const plain = monthProration(2026, 1, working(), ctx({ holidays }));
    expect(plain.basisDays).toBe(22); // holidays are ordinary working days unless the contract excludes them
    const ex = monthProration(2026, 1, working({ excludePublicHolidays: true }), ctx({ holidays }));
    expect(ex.basisDays).toBe(21);
    expect(ex.nonProratedDates).toContain("2026-01-01");
    expect(ex.nonProratedDates.filter((x) => x === "2026-01-03")).toHaveLength(1);
    expect(ex.nonProratedDates).toHaveLength(31 - 21);
  });

  it("ignores a holiday that is in another month", () => {
    expect(monthProration(2026, 2, working({ excludePublicHolidays: true }), ctx({ holidays: ["2026-01-01", "2026-03-20"] })).basisDays).toBe(20);
  });
});

describe("which setting applies to a contract on a date", () => {
  const rows: BasisRow[] = [
    { contractId: "k1", status: "APPROVED", setting: calendar, effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-06-30") },
    { contractId: "k1", status: "APPROVED", setting: working(), effectiveFrom: d("2026-07-01"), effectiveTo: null },
    { contractId: "k1", status: "PENDING", setting: working({ excludePublicHolidays: true }), effectiveFrom: d("2026-07-01"), effectiveTo: null },
    { contractId: "k2", status: "REJECTED", setting: working(), effectiveFrom: d("2026-01-01"), effectiveTo: null },
  ];
  it("takes the approved row in force on the date (effective-dated), never a pending or rejected one, and none for a contract with no row", () => {
    expect(resolveSetting(rows, "k1", d("2026-03-15"))?.basis).toBe("CALENDAR_DAYS");
    expect(resolveSetting(rows, "k1", d("2026-07-01"))).toEqual(working());
    expect(resolveSetting(rows, "k1", d("2025-12-31"))).toBeNull();
    expect(resolveSetting(rows, "k2", d("2026-03-01"))).toBeNull();
    expect(resolveSetting(rows, "nope", d("2026-03-01"))).toBeNull();
  });
  it("the newest start wins when two approved rows overlap", () => {
    const two: BasisRow[] = [
      { contractId: "k", status: "APPROVED", setting: calendar, effectiveFrom: d("2026-01-01"), effectiveTo: null },
      { contractId: "k", status: "APPROVED", setting: working(), effectiveFrom: d("2026-03-01"), effectiveTo: null },
    ];
    expect(resolveSetting(two, "k", d("2026-04-01"))?.basis).toBe("WORKING_DAYS");
  });
});

describe("one employee in a month", () => {
  const rows: BasisRow[] = [
    { contractId: "a", status: "APPROVED", setting: working(), effectiveFrom: d("2026-01-01"), effectiveTo: null },
    { contractId: "b", status: "APPROVED", setting: working(), effectiveFrom: d("2026-01-01"), effectiveTo: null },
    { contractId: "c", status: "APPROVED", setting: calendar, effectiveFrom: d("2026-01-01"), effectiveTo: null },
  ];
  const at = d("2026-03-01"); // the basis in force at the start of the pay month applies to the whole month
  it("uses the one setting when every contract the person worked on has it (or none has any)", () => {
    expect(employeeProration(rows, ["a"], at)).toEqual({ kind: "ok", setting: working() });
    expect(employeeProration(rows, ["a", "b"], at)).toEqual({ kind: "ok", setting: working() });
    expect(employeeProration(rows, [], at)).toEqual({ kind: "ok", setting: null }); // no contract: the company's rule
    expect(employeeProration(rows, ["zzz"], at)).toEqual({ kind: "ok", setting: null });
  });
  it("flags a person who worked on contracts with different bases in the month, rather than paying on a guess", () => {
    expect(employeeProration(rows, ["a", "c"], at).kind).toBe("mixed");
    expect(employeeProration(rows, ["a", "zzz"], at).kind).toBe("mixed"); // one with a setting, one on the company's rule
  });
  it("a date helper agrees with the calendar", () => {
    expect(iso(at)).toBe("2026-03-01");
  });
});
