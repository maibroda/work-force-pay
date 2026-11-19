import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MoneyError } from "@/lib/money-exact";
import { priceHours, type ShiftSegment } from "@/lib/payroll/hourly";
import { entriesOverlap, parseBreakTimes, parseWatLocal, payableSegments, workingIntervals } from "@/lib/payroll/time-entry";

/**
 * Hourly pay, phase 3 (docs/plans/hourly-payroll-assessment.md): the pure rules under a time entry (a clock-in and a clock-out). The founder's answers of 2026-11-19: H5, approved unpaid breaks are
 * deducted from the payable hours; H10, a missing clock-out is not payable (an entry with no clock-out is "open" and is never priced); H2, hours fall on the day they were worked.
 * Breaks are recorded as the TIMES they were taken, so that a break across midnight comes off the right day and no allocation rule has to be invented (a reading flagged to the founder as H18).
 * Rates are INVENTED for the tests. Calendar: 2026-11-20 is a Friday, 21 a Saturday, 22 a Sunday.
 */
const wat = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`);
const NONE: ReadonlySet<string> = new Set();
const shape = (segs: ShiftSegment[]) => segs.map((s) => [s.date, s.dayClass, s.minutes]);
const mins = (segs: ShiftSegment[]) => segs.reduce((a, s) => a + s.minutes, 0);
const brk = (a: Date, b: Date) => ({ start: a, end: b });

describe("parseWatLocal: a clock time typed as Nigerian wall-clock time", () => {
  it("reads YYYY-MM-DDTHH:mm as West Africa Time (UTC plus one hour)", () => {
    expect(parseWatLocal("2026-11-20T19:00").toISOString()).toBe("2026-11-20T18:00:00.000Z");
    expect(parseWatLocal("2026-11-21T00:00").toISOString()).toBe("2026-11-20T23:00:00.000Z");
  });

  it("refuses anything that is not exactly that form, including seconds, a space, a time zone, hour 24 and an impossible date", () => {
    for (const bad of ["2026-11-20 19:00", "2026-11-20T19:00:30", "2026-11-20T19:00Z", "2026-11-20T24:00", "2026-02-30T10:00", "2026-11-20T10:60", "20/11/2026 19:00", ""]) expect(() => parseWatLocal(bad), bad).toThrow(MoneyError);
  });
});

describe("workingIntervals: the shift without its breaks (H5)", () => {
  const start = wat("2026-11-20", "08:00");
  const end = wat("2026-11-20", "16:00");

  it("no breaks is the whole shift", () => {
    expect(workingIntervals(start, end, []).map((i) => [i.from.getTime(), i.to.getTime()])).toEqual([[start.getTime(), end.getTime()]]);
  });

  it("a break in the middle makes two working intervals", () => {
    const w = workingIntervals(start, end, [brk(wat("2026-11-20", "12:00"), wat("2026-11-20", "12:30"))]);
    expect(w.map((i) => (i.to.getTime() - i.from.getTime()) / 60000)).toEqual([240, 210]);
  });

  it("a break at the very start or the very end shortens the shift without leaving an empty piece", () => {
    expect(workingIntervals(start, end, [brk(start, wat("2026-11-20", "08:15"))])).toHaveLength(1);
    expect(workingIntervals(start, end, [brk(wat("2026-11-20", "15:45"), end)])).toHaveLength(1);
  });

  it("breaks are put in order, and two breaks leave three intervals", () => {
    const w = workingIntervals(start, end, [brk(wat("2026-11-20", "14:00"), wat("2026-11-20", "14:15")), brk(wat("2026-11-20", "11:00"), wat("2026-11-20", "11:30"))]);
    expect(w).toHaveLength(3);
  });

  it("refuses a break outside the shift, a break that overlaps another, an empty break, a break on part of a minute, and breaks that leave nothing to pay", () => {
    expect(() => workingIntervals(start, end, [brk(wat("2026-11-20", "07:30"), wat("2026-11-20", "08:30"))])).toThrow(MoneyError);
    expect(() => workingIntervals(start, end, [brk(wat("2026-11-20", "15:30"), wat("2026-11-20", "16:30"))])).toThrow(MoneyError);
    expect(() => workingIntervals(start, end, [brk(wat("2026-11-20", "12:00"), wat("2026-11-20", "12:30")), brk(wat("2026-11-20", "12:20"), wat("2026-11-20", "12:40"))])).toThrow(MoneyError);
    expect(() => workingIntervals(start, end, [brk(wat("2026-11-20", "12:00"), wat("2026-11-20", "12:00"))])).toThrow(MoneyError);
    expect(() => workingIntervals(start, end, [brk(new Date(start.getTime() + 30_000), wat("2026-11-20", "12:00"))])).toThrow(MoneyError);
    expect(() => workingIntervals(start, end, [brk(start, end)])).toThrow(MoneyError);
  });
});

describe("payableSegments: the paid pieces of a shift, by day and class", () => {
  it("a Friday 19:00 to Saturday 07:00 shift with no break is 5 hours of Friday and 7 of Saturday", () => {
    expect(shape(payableSegments(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), [], NONE))).toEqual([
      ["2026-11-20", "WEEKDAY", 300],
      ["2026-11-21", "WEEKEND", 420],
    ]);
  });

  it("a half-hour break across midnight (23:45 to 00:15) comes 15 minutes off Friday and 15 off Saturday", () => {
    const segs = payableSegments(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), [brk(wat("2026-11-20", "23:45"), wat("2026-11-21", "00:15"))], NONE);
    expect(shape(segs)).toEqual([
      ["2026-11-20", "WEEKDAY", 285],
      ["2026-11-21", "WEEKEND", 405],
    ]);
    expect(mins(segs)).toBe(720 - 30);
  });

  it("a break after midnight comes off Saturday only, and the pieces either side are both Saturday weekend time", () => {
    const segs = payableSegments(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), [brk(wat("2026-11-21", "02:00"), wat("2026-11-21", "02:30"))], NONE);
    expect(shape(segs)).toEqual([
      ["2026-11-20", "WEEKDAY", 300],
      ["2026-11-21", "WEEKEND", 120],
      ["2026-11-21", "WEEKEND", 270],
    ]);
  });

  it("a break on a public holiday comes off holiday time, not weekday time", () => {
    const segs = payableSegments(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), [brk(wat("2026-11-21", "02:00"), wat("2026-11-21", "03:00"))], new Set(["2026-11-21"]));
    expect(segs.filter((s) => s.dayClass === "HOLIDAY").reduce((a, s) => a + s.minutes, 0)).toBe(360);
    expect(segs.filter((s) => s.dayClass === "WEEKDAY").reduce((a, s) => a + s.minutes, 0)).toBe(300);
  });

  it("priced with invented rates (weekday 1,000, weekend 1,500), the break is not paid: 5 x 1,000 + 6.5 x 1,500 = 14,750", () => {
    const segs = payableSegments(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), [brk(wat("2026-11-21", "02:00"), wat("2026-11-21", "02:30"))], NONE);
    expect(priceHours(segs, { weekday: 1000, weekend: 1500, holiday: 2000 }).totalAmount).toBe(14750);
  });
});

describe("entriesOverlap: one person cannot be at work twice at the same time", () => {
  const a = { clockIn: wat("2026-11-20", "08:00"), clockOut: wat("2026-11-20", "16:00") as Date | null };
  const e = (from: string, to: string | null, day = "2026-11-20") => ({ clockIn: wat(day, from), clockOut: to ? wat(day, to) : null });

  it("shifts that touch end to end do not overlap; shifts that share any minute do", () => {
    expect(entriesOverlap(a, e("16:00", "20:00"))).toBe(false);
    expect(entriesOverlap(a, e("04:00", "08:00"))).toBe(false);
    expect(entriesOverlap(a, e("15:59", "20:00"))).toBe(true);
    expect(entriesOverlap(a, e("09:00", "10:00"))).toBe(true); // inside
    expect(entriesOverlap(a, e("06:00", "20:00"))).toBe(true); // around
    expect(entriesOverlap(a, a)).toBe(true); // the same shift entered twice
  });

  it("an entry with no clock-out (open) conflicts when its clock-in falls inside another shift, and does not otherwise", () => {
    expect(entriesOverlap(a, e("10:00", null))).toBe(true);
    expect(entriesOverlap(e("10:00", null), a)).toBe(true);
    expect(entriesOverlap(a, e("08:00", null))).toBe(true);
    expect(entriesOverlap(a, e("16:00", null))).toBe(false);
    expect(entriesOverlap(a, e("07:00", null))).toBe(false);
    expect(entriesOverlap(e("10:00", null), e("10:00", null))).toBe(true);
  });
});

describe("parseBreakTimes: breaks typed as clock times (HH:MM-HH:MM) are placed inside the shift", () => {
  it("a day shift: the first time the clock reads each time within the shift", () => {
    const b = parseBreakTimes("13:00-13:30", wat("2026-11-20", "08:00"), wat("2026-11-20", "20:00"));
    expect(b).toEqual([{ start: wat("2026-11-20", "13:00"), end: wat("2026-11-20", "13:30") }]);
  });

  it("several breaks, separated by commas, semicolons or new lines", () => {
    const b = parseBreakTimes("12:00-12:30, 16:00-16:15;18:00-18:10\n19:00-19:05", wat("2026-11-20", "08:00"), wat("2026-11-20", "20:00"));
    expect(b).toHaveLength(4);
  });

  it("a night shift: 23:45-00:15 is Friday 23:45 to Saturday 00:15, and 02:00-02:30 is Saturday", () => {
    const b = parseBreakTimes("23:45-00:15, 02:00-02:30", wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"));
    expect(b).toEqual([
      { start: wat("2026-11-20", "23:45"), end: wat("2026-11-21", "00:15") },
      { start: wat("2026-11-21", "02:00"), end: wat("2026-11-21", "02:30") },
    ]);
  });

  it("nothing typed is no breaks", () => {
    expect(parseBreakTimes("  ", wat("2026-11-20", "08:00"), wat("2026-11-20", "16:00"))).toEqual([]);
  });

  it("refuses a bad format, a break that starts and ends at the same time, and a break that does not fall inside the shift", () => {
    const s = wat("2026-11-20", "08:00");
    const e = wat("2026-11-20", "16:00");
    for (const bad of ["1pm-1:30pm", "13:00", "13:00-13:00", "25:00-25:30", "13:00 to 13:30"]) expect(() => parseBreakTimes(bad, s, e), bad).toThrow(MoneyError);
    expect(() => parseBreakTimes("17:00-17:30", s, e)).toThrow(MoneyError); // the clock never reads 17:00 during the shift
    expect(() => parseBreakTimes("15:45-16:30", s, e)).toThrow(MoneyError); // runs past the end
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/time-entry.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
