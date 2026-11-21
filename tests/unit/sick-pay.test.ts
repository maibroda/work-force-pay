import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HourlySiteInput } from "@/lib/payroll/engine";
import { mergeAllowanceSites, paidSickDates, sickBasis, sickPay, sickWindow, type WorkedSegment } from "@/lib/payroll/sick-pay";
import { DEFAULT_EARNINGS, type StructureDef } from "@/lib/payroll/structure";

/**
 * Hourly pay, H14 piece 2, step 2b (docs/plans/hourly-payroll-h14-build-plan.md): the PAY for a paid sick day of a person paid by the hour. The founder's answers of 2026-11-20 and 2026-11-21 (my recommendations for
 * the build plan's questions, which he accepted): a paid sick day is paid at the person's AVERAGE DAILY HOURS times their WEEKDAY RATE; the average is the approved hours of the 3 months before the spell (a company
 * setting) divided by the days they worked; a day counts only when it is one of their USUAL days (a day of the week they worked at least once in that period); only the first days of the year, up to the entitlement
 * (5), are paid, in date order; no hours in the period means nothing to average and nothing is paid. Pure: no database. Every amount is whole kobo, rounded half up once. The rates and hours are INVENTED.
 */
const seg = (date: string, minutes: number, over: Partial<WorkedSegment> = {}): WorkedSegment => ({ date, minutes, beatId: "b1", contractId: "k1", clientId: "c1", ...over });

describe("sickWindow: the period the average is taken over", () => {
  it("is the months before the first day of the spell, up to the day before it", () => {
    expect(sickWindow("2043-06-15", 3)).toEqual({ from: "2043-03-15", to: "2043-06-15" });
    expect(sickWindow("2043-03-31", 1)).toEqual({ from: "2043-02-28", to: "2043-03-31" }); // clamped to the end of a shorter month
  });
});

describe("sickBasis: the hours behind the average", () => {
  const history = [seg("2043-03-16", 480), seg("2043-03-17", 480), seg("2043-03-18", 360), seg("2043-03-18", 120), seg("2043-04-04", 600, { beatId: "b2", contractId: "k2" })];

  it("is the hours in the window, the distinct days worked (two shifts on one day are one day), the days of the week worked and the site last worked", () => {
    const b = sickBasis(history, "2043-03-15", "2043-06-15")!;
    expect(b.totalMinutes).toBe(480 + 480 + 360 + 120 + 600);
    expect(b.daysWorked).toBe(4);
    expect([...b.weekdays].sort()).toEqual([1, 2, 3, 6]); // Monday 16, Tuesday 17 and Wednesday 18 March, and Saturday 4 April 2043
    expect(b.last).toEqual({ beatId: "b2", contractId: "k2", clientId: "c1" });
  });

  it("counts only hours inside the window: the first day is in, the day of the spell is not", () => {
    const b = sickBasis([seg("2043-03-14", 480), seg("2043-03-15", 480), seg("2043-06-15", 480)], "2043-03-15", "2043-06-15")!;
    expect([b.totalMinutes, b.daysWorked]).toEqual([480, 1]);
  });

  it("is nothing (null, never an average of zero) when there are no hours in the window", () => {
    expect(sickBasis([], "2043-03-15", "2043-06-15")).toBeNull();
    expect(sickBasis([seg("2043-02-01", 480)], "2043-03-15", "2043-06-15")).toBeNull();
  });
});

describe("paidSickDates: which days of a spell are paid", () => {
  // Monday 2043-06-01 to Friday 2043-06-05 are the five days; this person usually works Monday to Thursday (1 to 4)
  const week = ["2043-06-01", "2043-06-02", "2043-06-03", "2043-06-04", "2043-06-05"];
  const usual = new Set([1, 2, 3, 4]);

  it("pays the days that are within the entitlement and are one of the person's usual days", () => {
    const r = paidSickDates({ yearDates: week, entitled: 5, dates: week, weekdays: usual });
    expect(r.paid).toEqual(["2043-06-01", "2043-06-02", "2043-06-03", "2043-06-04"]);
    expect(r.notUsual).toEqual(["2043-06-05"]); // a Friday they do not work
    expect(r.beyondEntitlement).toEqual([]);
  });

  it("pays only the first days of the leave year, in date order, up to the entitlement (days beyond are not paid)", () => {
    // 3 days earlier in the leave year, then this spell: only 2 of its days are left within the 5
    const earlier = ["2043-02-02", "2043-02-03", "2043-02-04"];
    const r = paidSickDates({ yearDates: [...week, ...earlier], entitled: 5, dates: week, weekdays: usual });
    expect(r.paid).toEqual(["2043-06-01", "2043-06-02"]);
    expect(r.beyondEntitlement).toEqual(["2043-06-03", "2043-06-04", "2043-06-05"]);
  });

  it("counts a day that is not a usual day against the entitlement (it was a day of sickness)", () => {
    const r = paidSickDates({ yearDates: ["2043-05-30", "2043-05-31", ...week], entitled: 3, dates: week, weekdays: new Set([2, 3, 4]) }); // 30 May is a Sunday, 31 May a Monday
    expect(r.beyondEntitlement.length).toBeGreaterThan(0);
    expect([...r.paid, ...r.notUsual, ...r.beyondEntitlement].sort()).toEqual([...week].sort()); // every day is accounted for exactly once
  });

  it("pays nothing when nothing is entitled", () => {
    expect(paidSickDates({ yearDates: week, entitled: 0, dates: week, weekdays: usual }).paid).toEqual([]);
  });
});

describe("sickPay: the amount for some paid sick days", () => {
  it("is the average daily hours times the weekday rate, times the days", () => {
    // 12 days worked, 5,760 minutes (8 h a day): 2 sick days = 16 h at 1,000 = 16,000.00
    expect(sickPay(1000, { totalMinutes: 5_760, daysWorked: 12 }, 2)).toEqual({ minutes: 960, amountKobo: 1_600_000 });
  });

  it("rounds half up to the kobo ONCE, on the whole amount, not day by day", () => {
    // 5,000 minutes over 12 days: 2 days = 833.33 minutes (833); 100,000 kobo an hour x 5,000 x 2 / (12 x 60) = 1,388,888.89 kobo, which rounds to 1,388,889
    expect(sickPay(1000, { totalMinutes: 5_000, daysWorked: 12 }, 2)).toEqual({ minutes: 833, amountKobo: 1_388_889 });
    // 1 day of the same: 416.67 minutes (417), 694,444.44 kobo -> 694,444
    expect(sickPay(1000, { totalMinutes: 5_000, daysWorked: 12 }, 1)).toEqual({ minutes: 417, amountKobo: 694_444 });
  });

  it("refuses nonsense: no days worked, or no days to pay", () => {
    expect(() => sickPay(1000, { totalMinutes: 5_000, daysWorked: 0 }, 1)).toThrow();
    expect(() => sickPay(1000, { totalMinutes: 5_000, daysWorked: 12 }, 0)).toThrow();
  });
});

describe("mergeAllowanceSites: sick pay joins the hours of the same site", () => {
  const STRUCT: StructureDef = { id: "std", code: "STD", name: "std", isPartial: false, components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })) };
  const site = (key: string, over: Partial<HourlySiteInput> = {}): HourlySiteInput => ({ key, clientId: "c1", clientName: "C", contractId: "k1", beatId: key.split("|")[0], beatName: "S", structure: STRUCT, from: "2043-06-01", to: "2043-06-01", dates: [], lines: [], ...over });
  const sick = { kind: "SICK_DAY" as const, amountKobo: 1_600_000, minutes: 960, rate: 1000, dates: ["2043-06-01", "2043-06-02"] };
  it("adds the allowance to the site the person also worked at (one piece of pay for one site), and keeps the hours", () => {
    const worked = site("b1|k1|std", { dates: ["2043-06-03"], lines: [{ dayClass: "WEEKDAY", minutes: 480, rate: 1000, amountKobo: 800_000 }] });
    const merged = mergeAllowanceSites([worked], [site("b1|k1|std", { allowances: [sick] })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].lines).toEqual(worked.lines);
    expect(merged[0].allowances).toEqual([sick]);
  });
  it("adds a site the person did not work at as it is, and never changes the sites it was given", () => {
    const worked = site("b1|k1|std", { lines: [{ dayClass: "WEEKDAY", minutes: 60, rate: 1000, amountKobo: 100_000 }] });
    const copy = JSON.parse(JSON.stringify(worked));
    const merged = mergeAllowanceSites([worked], [site("b2|k1|std", { allowances: [sick] })]);
    expect(merged.map((s) => s.key)).toEqual(["b1|k1|std", "b2|k1|std"]);
    expect(JSON.parse(JSON.stringify(worked))).toEqual(copy);
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/sick-pay.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
