import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DayClass } from "@/lib/payroll/hourly";
import type { HourlyRateRow } from "@/lib/payroll/hourly-rates";
import { groupLines, hoursOf, priceLines, rollup, type Piece } from "@/lib/payroll/hourly-report";

/**
 * Hourly pay, phase 5 (docs/plans/hourly-payroll-assessment.md): the arithmetic behind the hourly reports. The pieces are the paid pieces of APPROVED time entries (by day and class); the rates are the approved
 * hourly rates. The result is an INDICATIVE cost (approved hours x approved rates), not payroll: phase 4 has not built the pay run. Every figure is worked once, at one grain (person, contract, month, class and rate),
 * rounded half up to the kobo once at that line, and every report is a roll-up of those lines, so no report can add up to a different total than another. Rates are INVENTED for the tests.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
let n = 0;
const rate = (over: Partial<HourlyRateRow> & Pick<HourlyRateRow, "scope">, w = 1000): HourlyRateRow => ({
  id: `r${++n}`,
  employeeId: null,
  contractId: null,
  categoryId: null,
  weekdayRate: w,
  weekendRate: w + 500,
  holidayRate: w + 1000,
  effectiveFrom: day("2026-01-01"),
  effectiveTo: null,
  status: "APPROVED",
  ...over,
});
const piece = (date: string, dayClass: DayClass, minutes: number, over: Partial<Piece> = {}): Piece => ({ employeeId: "e1", contractId: "k1", clientId: "c1", date, dayClass, minutes, ...over });
const GUARD = () => "guard";
const ROLE = rate({ scope: "CATEGORY", categoryId: "guard" }); // weekday 1,000, weekend 1,500, holiday 2,000

describe("priceLines: each approved piece is priced with the rate in force on its day", () => {
  it("prices the three classes at their own rates: 5 h weekday + 6.5 h holiday = 5,000 + 13,000", () => {
    const lines = priceLines([piece("2026-11-20", "WEEKDAY", 300), piece("2026-11-21", "HOLIDAY", 120), piece("2026-11-21", "HOLIDAY", 270)], [ROLE], GUARD);
    expect(lines.map((l) => [l.dayClass, l.minutes, l.rate, l.amountKobo])).toEqual([
      ["WEEKDAY", 300, 1000, 500_000],
      ["HOLIDAY", 390, 2000, 1_300_000],
    ]);
  });

  it("uses the founder's order of rates: the employee's own, then the contract and role, then the role", () => {
    const own = rate({ scope: "EMPLOYEE", employeeId: "e1" }, 3000);
    const cc = rate({ scope: "CONTRACT_CATEGORY", contractId: "k1", categoryId: "guard" }, 2000);
    const l = (rows: HourlyRateRow[]) => priceLines([piece("2026-11-20", "WEEKDAY", 60)], rows, GUARD)[0];
    expect(l([ROLE, cc, own]).rate).toBe(3000);
    expect(l([ROLE, cc]).rate).toBe(2000);
    expect(l([ROLE]).rate).toBe(1000);
  });

  it("a rate change in the middle of a month: the old rate up to the day before, the new rate from the day it starts", () => {
    const old = rate({ scope: "CATEGORY", categoryId: "guard", effectiveTo: day("2026-11-15") }, 1000);
    const next = rate({ scope: "CATEGORY", categoryId: "guard", effectiveFrom: day("2026-11-16") }, 1200);
    const lines = priceLines([piece("2026-11-15", "WEEKDAY", 60), piece("2026-11-16", "WEEKDAY", 60)], [old, next], GUARD);
    expect(lines.map((l) => [l.rate, l.amountKobo])).toEqual([[1000, 100_000], [1200, 120_000]]);
  });

  it("rounds half up to the kobo ONCE per line, on the line's total minutes: two one-minute weekend pieces at 0.90 an hour are 3 kobo, not 2 + 2", () => {
    const r = rate({ scope: "CATEGORY", categoryId: "guard", weekendRate: 0.9 });
    const lines = priceLines([piece("2026-11-21", "WEEKEND", 1), piece("2026-11-22", "WEEKEND", 1)], [r], GUARD);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ minutes: 2, amountKobo: 3 });
  });

  it("a piece with no approved rate is not priced as zero: it is kept as hours with no rate, so a gap is never hidden", () => {
    const lines = priceLines([piece("2026-11-20", "WEEKDAY", 480)], [], GUARD);
    expect(lines).toEqual([{ employeeId: "e1", contractId: "k1", clientId: "c1", month: "2026-11", dayClass: "WEEKDAY", rateId: null, rate: null, minutes: 480, amountKobo: null }]);
  });

  it("a shift over a month end is two lines, one in each month", () => {
    const lines = priceLines([piece("2026-07-31", "WEEKDAY", 300), piece("2026-08-01", "WEEKEND", 420)], [ROLE], GUARD);
    expect(lines.map((l) => [l.month, l.dayClass, l.minutes])).toEqual([["2026-07", "WEEKDAY", 300], ["2026-08", "WEEKEND", 420]]);
  });

  it("different people, contracts or clients are different lines", () => {
    const lines = priceLines([piece("2026-11-20", "WEEKDAY", 60), piece("2026-11-20", "WEEKDAY", 60, { employeeId: "e2" }), piece("2026-11-20", "WEEKDAY", 60, { contractId: "k2", clientId: "c2" })], [ROLE], GUARD);
    expect(lines).toHaveLength(3);
  });
});

describe("rollup: the minutes and the indicative cost of a set of lines", () => {
  it("adds the minutes and kobo by class and keeps the minutes with no rate apart from the priced ones", () => {
    const lines = priceLines([piece("2026-11-20", "WEEKDAY", 300), piece("2026-11-21", "WEEKEND", 60), piece("2026-11-22", "WEEKEND", 30, { employeeId: "e9" })], [rate({ scope: "EMPLOYEE", employeeId: "e1" })], GUARD);
    const r = rollup(lines);
    expect(r.minutes).toEqual({ WEEKDAY: 300, WEEKEND: 90, HOLIDAY: 0 });
    expect(r.kobo).toEqual({ WEEKDAY: 500_000, WEEKEND: 150_000, HOLIDAY: 0 });
    expect(r).toMatchObject({ totalMinutes: 390, totalKobo: 650_000, unpricedMinutes: 30 });
  });

  it("nothing is nothing", () => {
    expect(rollup([])).toEqual({ minutes: { WEEKDAY: 0, WEEKEND: 0, HOLIDAY: 0 }, kobo: { WEEKDAY: 0, WEEKEND: 0, HOLIDAY: 0 }, unpricedMinutes: 0, totalMinutes: 0, totalKobo: 0 });
  });
});

describe("the reports agree: every way of adding the same lines gives the same total (nothing counted twice)", () => {
  let seed = 20261119;
  const next = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };

  it("by person, by client and contract, and by month: 300 random pieces, three roll-ups, one total", () => {
    const classes: DayClass[] = ["WEEKDAY", "WEEKEND", "HOLIDAY"];
    const rates = [rate({ scope: "CATEGORY", categoryId: "guard" }, 333.33), rate({ scope: "EMPLOYEE", employeeId: "e2" }, 417.77)];
    const pieces: Piece[] = [];
    for (let i = 0; i < 300; i++) {
      const month = 1 + next(3);
      pieces.push({ employeeId: `e${1 + next(4)}`, contractId: `k${1 + next(3)}`, clientId: `c${1 + next(2)}`, date: `2026-0${month}-${String(1 + next(28)).padStart(2, "0")}`, dayClass: classes[next(3)], minutes: 1 + next(600) });
    }
    const lines = priceLines(pieces, rates, GUARD);
    const total = rollup(lines);
    const sumOf = (key: (l: (typeof lines)[number]) => string) => [...groupLines(lines, key).values()].map(rollup).reduce((a, r) => ({ m: a.m + r.totalMinutes, k: a.k + r.totalKobo }), { m: 0, k: 0 });
    for (const key of [(l: (typeof lines)[number]) => l.employeeId, (l: (typeof lines)[number]) => `${l.clientId}|${l.contractId}`, (l: (typeof lines)[number]) => l.month]) expect(sumOf(key)).toEqual({ m: total.totalMinutes, k: total.totalKobo });
    expect(total.totalMinutes).toBe(pieces.reduce((a, p) => a + p.minutes, 0));
  });
});

describe("hoursOf: minutes as hours to two decimals, for display, half up", () => {
  it("is exact for the usual figures and rounds half up", () => {
    expect([0, 30, 60, 90, 480, 690].map(hoursOf)).toEqual([0, 0.5, 1, 1.5, 8, 11.5]);
    expect([1, 3, 20, 59, 100].map(hoursOf)).toEqual([0.02, 0.05, 0.33, 0.98, 1.67]);
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-report.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
