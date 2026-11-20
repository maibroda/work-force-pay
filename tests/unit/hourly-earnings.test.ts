import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DayClass } from "@/lib/payroll/hourly";
import { buildHourlyEarnings, type ApprovedPiece } from "@/lib/payroll/hourly-earnings";
import type { HourlyRateRow } from "@/lib/payroll/hourly-rates";
import { DEFAULT_EARNINGS, type StructureDef } from "@/lib/payroll/structure";

/**
 * Hourly pay, phase 4 (docs/plans/hourly-payroll-phase4-plan.md): the pure step that turns a person's APPROVED pieces of shifts into pay lines per site, for the pay engine to take. Pure: no database.
 * The founder's answers of 2026-11-19 and 2026-11-20: H1 the rate is the employee's own, then the contract and job role, then the job role; H8 each site's hours follow the established salary structure
 * for that site (here supplied by the caller); H9/H21 only approved hours reach this step; no rate or no structure means the hours are NOT paid and are reported, never priced as zero.
 * Rates and structures are INVENTED for the tests.
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
const STRUCT = (id: string): StructureDef => ({
  id,
  code: id.toUpperCase(),
  name: id,
  isPartial: false,
  components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })),
});
const STD = STRUCT("std");
const OTHER = STRUCT("other");
const ROLE = rate({ scope: "CATEGORY", categoryId: "guard" }); // weekday 1,000, weekend 1,500, holiday 2,000
const piece = (date: string, dayClass: DayClass, minutes: number, over: Partial<ApprovedPiece> = {}): ApprovedPiece => ({ employeeId: "e1", beatId: "b1", contractId: "k1", clientId: "c1", date, dayClass, minutes, ...over });
const opts = (structureFor: (q: { contractId: string; categoryId: string; date: string }) => StructureDef | null = () => STD) => ({
  categoryOf: () => "guard",
  structureFor,
  namesOf: (beatId: string) => ({ clientName: `Client of ${beatId}`, beatName: `Site ${beatId}` }),
});

describe("buildHourlyEarnings: approved pieces become pay lines per site", () => {
  it("prices the three classes at their own rates, in whole kobo, once per line: 5 h weekday + 6.5 h holiday = 5,000 + 13,000", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 300), piece("2026-11-21", "HOLIDAY", 120), piece("2026-11-21", "HOLIDAY", 270)], [ROLE], opts());
    expect(r.unresolved).toEqual([]);
    expect(r.sites).toHaveLength(1);
    expect(r.sites[0].lines.map((l) => [l.dayClass, l.minutes, l.rate, l.amountKobo])).toEqual([
      ["WEEKDAY", 300, 1000, 500_000],
      ["HOLIDAY", 390, 2000, 1_300_000],
    ]);
    expect(r.sites[0]).toMatchObject({ beatId: "b1", contractId: "k1", clientId: "c1", clientName: "Client of b1", beatName: "Site b1", from: "2026-11-20", to: "2026-11-21", dates: ["2026-11-20", "2026-11-21"] });
    expect(r.pricedMinutes).toBe(690);
  });

  it("each site (a beat) is its own piece of pay, and each carries the structure of that site", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 60), piece("2026-11-21", "WEEKDAY", 60, { beatId: "b2", contractId: "k2", clientId: "c2" })], [ROLE], opts((q) => (q.contractId === "k1" ? STD : OTHER)));
    expect(r.sites.map((s) => [s.beatId, s.structure.id])).toEqual([["b1", "std"], ["b2", "other"]]);
  });

  it("a structure that changes in the middle of the month makes two pieces of pay at the same site, split at the day it changes", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-12", "WEEKDAY", 60), piece("2026-11-18", "WEEKDAY", 60)], [ROLE], opts((q) => (q.date < "2026-11-16" ? STD : OTHER)));
    expect(r.sites.map((s) => [s.structure.id, s.dates])).toEqual([["std", ["2026-11-12"]], ["other", ["2026-11-18"]]]);
  });

  it("a rate change in the middle of the month gives two lines of the same class, each at the rate in force that day", () => {
    const old = rate({ scope: "CATEGORY", categoryId: "guard", effectiveTo: day("2026-11-15") }, 1000);
    const next = rate({ scope: "CATEGORY", categoryId: "guard", effectiveFrom: day("2026-11-16") }, 1200);
    const r = buildHourlyEarnings("e1", [piece("2026-11-15", "WEEKDAY", 60), piece("2026-11-16", "WEEKDAY", 60)], [old, next], opts());
    expect(r.sites[0].lines.map((l) => [l.rate, l.amountKobo])).toEqual([[1000, 100_000], [1200, 120_000]]);
  });

  it("uses the founder's order of rates: the employee's own, then the contract and job role, then the job role", () => {
    const own = rate({ scope: "EMPLOYEE", employeeId: "e1" }, 3000);
    const cc = rate({ scope: "CONTRACT_CATEGORY", contractId: "k1", categoryId: "guard" }, 2000);
    const rateOf = (rows: HourlyRateRow[]) => buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 60)], rows, opts()).sites[0].lines[0].rate;
    expect([rateOf([ROLE, cc, own]), rateOf([ROLE, cc]), rateOf([ROLE])]).toEqual([3000, 2000, 1000]);
  });

  it("rounds half up to the kobo once per line, on the line's total minutes: two one-minute weekend pieces at 0.90 an hour are 3 kobo, not 2 + 2", () => {
    const r = rate({ scope: "CATEGORY", categoryId: "guard", weekendRate: 0.9 });
    const out = buildHourlyEarnings("e1", [piece("2026-11-21", "WEEKEND", 1), piece("2026-11-22", "WEEKEND", 1)], [r], opts());
    expect(out.sites[0].lines).toEqual([{ dayClass: "WEEKEND", minutes: 2, rateId: r.id, rate: 0.9, amountKobo: 3 }]);
  });

  it("hours with no approved rate are NOT paid and are reported, never priced as zero", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 480)], [], opts());
    expect(r.sites).toEqual([]);
    expect(r.unresolved).toEqual([{ reason: "NO_RATE", beatId: "b1", contractId: "k1", date: "2026-11-20", dayClass: "WEEKDAY", minutes: 480 }]);
    expect(r.pricedMinutes).toBe(0);
    expect(r.totalMinutes).toBe(480);
  });

  it("hours at a site with no salary structure are NOT paid and are reported, so the pay run can stop and say so", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 480), piece("2026-11-21", "WEEKDAY", 60, { beatId: "b2", contractId: "k2" })], [ROLE], opts((q) => (q.contractId === "k1" ? STD : null)));
    expect(r.sites.map((s) => s.beatId)).toEqual(["b1"]);
    expect(r.unresolved).toEqual([{ reason: "NO_STRUCTURE", beatId: "b2", contractId: "k2", date: "2026-11-21", dayClass: "WEEKDAY", minutes: 60 }]);
  });

  it("another person's pieces are never taken, and no pieces is no pay", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 60, { employeeId: "e2" })], [ROLE], opts());
    expect(r).toEqual({ sites: [], unresolved: [], totalMinutes: 0, pricedMinutes: 0 });
  });

  it("the paid minutes plus the unresolved minutes are always every minute that was asked for (nothing lost, nothing twice)", () => {
    const r = buildHourlyEarnings("e1", [piece("2026-11-20", "WEEKDAY", 100), piece("2026-11-21", "WEEKEND", 50, { beatId: "b2", contractId: "k2" }), piece("2026-11-22", "HOLIDAY", 30)], [ROLE], opts((q) => (q.contractId === "k2" ? null : STD)));
    const priced = r.sites.flatMap((s) => s.lines).reduce((a, l) => a + l.minutes, 0);
    expect(priced).toBe(r.pricedMinutes);
    expect(priced + r.unresolved.reduce((a, u) => a + u.minutes, 0)).toBe(r.totalMinutes);
    expect(r.totalMinutes).toBe(180);
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-earnings.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
