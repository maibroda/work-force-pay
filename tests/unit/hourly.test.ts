import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MoneyError } from "@/lib/money-exact";
import { classifyDay, priceHours, segmentsInPeriod, splitShift, watDate, type DayClass, type ShiftSegment } from "@/lib/payroll/hourly";

/**
 * Hourly pay, phase 1 (docs/plans/hourly-payroll-assessment.md): cutting a shift at midnight into calendar days, giving each day a class, and pricing the hours.
 * Pure functions: no database, no framework. The rules tested are the founder's of 2026-11-19: H2 the actual hours fall on the day they fell on (a shift is cut at
 * midnight, West Africa Time), H3 a public holiday's rate wins over the weekend's. The rates below are INVENTED for the tests (weekday 1,000, weekend 1,500,
 * holiday 2,000 an hour); the system holds whatever rates are agreed.
 *
 * Calendar used: 2026-07-31 is a Friday, so 2026-08-01 is a Saturday and 2026-08-02 a Sunday; 2026-11-20 is a Friday, 21 a Saturday, 22 a Sunday, 23 a Monday.
 */
const NONE: ReadonlySet<string> = new Set();
/** A West Africa Time wall clock (UTC+1, no daylight saving) as the instant it is. "24:00" is not used: give the next day's "00:00". */
const wat = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`);
const RATES = { weekday: 1000, weekend: 1500, holiday: 2000 };
const shape = (segs: ShiftSegment[]) => segs.map((s) => [s.date, s.dayClass, s.minutes]);

describe("watDate: the West Africa Time calendar day of an instant", () => {
  it("is UTC plus one hour: 23:00 UTC is already the next day in Nigeria", () => {
    expect(watDate(new Date("2026-11-20T22:59:00Z"))).toBe("2026-11-20");
    expect(watDate(new Date("2026-11-20T23:00:00Z"))).toBe("2026-11-21");
    expect(watDate(new Date("2026-11-21T00:00:00Z"))).toBe("2026-11-21");
  });
});

describe("classifyDay: weekday, weekend or public holiday", () => {
  it("Monday to Friday are weekdays and Saturday and Sunday are weekends", () => {
    const days: Array<[string, DayClass]> = [
      ["2026-11-23", "WEEKDAY"],
      ["2026-11-24", "WEEKDAY"],
      ["2026-11-25", "WEEKDAY"],
      ["2026-11-26", "WEEKDAY"],
      ["2026-11-20", "WEEKDAY"],
      ["2026-11-21", "WEEKEND"],
      ["2026-11-22", "WEEKEND"],
    ];
    for (const [day, expected] of days) expect(classifyDay(day, NONE)).toBe(expected);
  });

  it("a public holiday on a weekday is a holiday", () => {
    expect(classifyDay("2026-11-24", new Set(["2026-11-24"]))).toBe("HOLIDAY");
  });

  it("a public holiday on a Saturday or a Sunday is a holiday, not a weekend (the founder's rule H3: the holiday rate wins)", () => {
    expect(classifyDay("2026-11-21", new Set(["2026-11-21"]))).toBe("HOLIDAY");
    expect(classifyDay("2026-11-22", new Set(["2026-11-22"]))).toBe("HOLIDAY");
  });

  it("a day that is not on the holiday list is not a holiday", () => {
    expect(classifyDay("2026-11-24", new Set(["2026-11-25"]))).toBe("WEEKDAY");
  });

  it("refuses a date that is not a real calendar date", () => {
    expect(() => classifyDay("2026-02-30", NONE)).toThrow(MoneyError);
    expect(() => classifyDay("20/11/2026", NONE)).toThrow(MoneyError);
  });
});

describe("splitShift: a shift is cut at midnight and each part goes to the day it fell on (the founder's rule H2)", () => {
  it("a shift inside one day is one piece", () => {
    expect(shape(splitShift(wat("2026-11-23", "08:00"), wat("2026-11-23", "16:00"), NONE))).toEqual([["2026-11-23", "WEEKDAY", 480]]);
  });

  it("Friday 19:00 to Saturday 07:00 is 5 hours of Friday and 7 hours of Saturday", () => {
    expect(shape(splitShift(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), NONE))).toEqual([
      ["2026-11-20", "WEEKDAY", 300],
      ["2026-11-21", "WEEKEND", 420],
    ]);
  });

  it("Saturday night into Sunday is weekend on both sides", () => {
    expect(shape(splitShift(wat("2026-11-21", "19:00"), wat("2026-11-22", "07:00"), NONE))).toEqual([
      ["2026-11-21", "WEEKEND", 300],
      ["2026-11-22", "WEEKEND", 420],
    ]);
  });

  it("Sunday night into Monday: weekend, then weekday", () => {
    expect(shape(splitShift(wat("2026-11-22", "19:00"), wat("2026-11-23", "07:00"), NONE))).toEqual([
      ["2026-11-22", "WEEKEND", 300],
      ["2026-11-23", "WEEKDAY", 420],
    ]);
  });

  it("a shift into a public holiday: the hours after midnight are holiday hours (the holiday is a Saturday, so the holiday wins over the weekend)", () => {
    expect(shape(splitShift(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), new Set(["2026-11-21"])))).toEqual([
      ["2026-11-20", "WEEKDAY", 300],
      ["2026-11-21", "HOLIDAY", 420],
    ]);
  });

  it("a shift out of a public holiday: the hours before midnight are holiday hours and the rest follow the next day", () => {
    expect(shape(splitShift(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), new Set(["2026-11-20"])))).toEqual([
      ["2026-11-20", "HOLIDAY", 300],
      ["2026-11-21", "WEEKEND", 420],
    ]);
  });

  it("is cut at West Africa Time midnight, not at UTC midnight", () => {
    // 22:00 UTC on Friday is 23:00 in Nigeria; 02:00 UTC on Saturday is 03:00 in Nigeria: one hour of Friday, three of Saturday
    const segs = splitShift(new Date("2026-11-20T22:00:00Z"), new Date("2026-11-21T02:00:00Z"), NONE);
    expect(shape(segs)).toEqual([
      ["2026-11-20", "WEEKDAY", 60],
      ["2026-11-21", "WEEKEND", 180],
    ]);
    expect(segs[0].to.toISOString()).toBe("2026-11-20T23:00:00.000Z");
    expect(segs[1].from.toISOString()).toBe("2026-11-20T23:00:00.000Z");
  });

  it("a shift that ends exactly at midnight does not make an empty piece for the next day", () => {
    expect(shape(splitShift(wat("2026-11-20", "16:00"), wat("2026-11-21", "00:00"), NONE))).toEqual([["2026-11-20", "WEEKDAY", 480]]);
  });

  it("a shift that starts exactly at midnight is all of the new day", () => {
    expect(shape(splitShift(wat("2026-11-21", "00:00"), wat("2026-11-21", "08:00"), NONE))).toEqual([["2026-11-21", "WEEKEND", 480]]);
  });

  it("counts partial hours in whole minutes", () => {
    expect(shape(splitShift(wat("2026-11-23", "08:15"), wat("2026-11-23", "12:50"), NONE))).toEqual([["2026-11-23", "WEEKDAY", 275]]);
  });

  it("a shift over more than two days gives every whole day its full 24 hours", () => {
    expect(shape(splitShift(wat("2026-11-20", "12:00"), wat("2026-11-22", "06:00"), NONE))).toEqual([
      ["2026-11-20", "WEEKDAY", 720],
      ["2026-11-21", "WEEKEND", 1440],
      ["2026-11-22", "WEEKEND", 360],
    ]);
  });

  it("the pieces join end to end and add up to the whole shift", () => {
    const start = wat("2026-11-20", "19:00");
    const end = wat("2026-11-22", "07:00");
    const segs = splitShift(start, end, NONE);
    expect(segs[0].from.getTime()).toBe(start.getTime());
    expect(segs[segs.length - 1].to.getTime()).toBe(end.getTime());
    for (let i = 1; i < segs.length; i++) expect(segs[i].from.getTime()).toBe(segs[i - 1].to.getTime());
    expect(segs.reduce((a, s) => a + s.minutes, 0)).toBe((end.getTime() - start.getTime()) / 60000);
  });

  it("refuses a shift that ends when it starts or before it starts", () => {
    expect(() => splitShift(wat("2026-11-23", "08:00"), wat("2026-11-23", "08:00"), NONE)).toThrow(MoneyError);
    expect(() => splitShift(wat("2026-11-23", "16:00"), wat("2026-11-23", "08:00"), NONE)).toThrow(MoneyError);
  });

  it("refuses a time that is not on a whole minute (hours are counted in whole minutes, never guessed)", () => {
    expect(() => splitShift(new Date("2026-11-23T07:00:30Z"), wat("2026-11-23", "16:00"), NONE)).toThrow(MoneyError);
    expect(() => splitShift(wat("2026-11-23", "08:00"), new Date("2026-11-23T15:00:00.500Z"), NONE)).toThrow(MoneyError);
  });

  it("refuses a date that is not a date", () => {
    expect(() => splitShift(new Date("nope"), wat("2026-11-23", "16:00"), NONE)).toThrow(MoneyError);
  });
});

describe("segmentsInPeriod: the pieces that fall in a pay period (a shift over a month end belongs half to each month)", () => {
  const friday = splitShift(wat("2026-07-31", "19:00"), wat("2026-08-01", "07:00"), NONE);

  it("the last night of July gives 5 hours to July and 7 hours to August", () => {
    expect(shape(segmentsInPeriod(friday, "2026-07-01", "2026-07-31"))).toEqual([["2026-07-31", "WEEKDAY", 300]]);
    expect(shape(segmentsInPeriod(friday, "2026-08-01", "2026-08-31"))).toEqual([["2026-08-01", "WEEKEND", 420]]);
  });

  it("the two months together hold every minute of the shift once", () => {
    const july = segmentsInPeriod(friday, "2026-07-01", "2026-07-31");
    const august = segmentsInPeriod(friday, "2026-08-01", "2026-08-31");
    expect([...july, ...august].reduce((a, s) => a + s.minutes, 0)).toBe(720);
  });

  it("the first and last day of the period are both inside it", () => {
    expect(segmentsInPeriod(friday, "2026-07-31", "2026-08-01")).toHaveLength(2);
  });
});

describe("priceHours: the pay for the hours, in exact kobo, rounded half up once per class", () => {
  it("an ordinary Friday night into Saturday: 5 x 1,000 + 7 x 1,500 = 15,500", () => {
    const priced = priceHours(splitShift(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), NONE), RATES);
    expect(priced.lines).toEqual([
      { dayClass: "WEEKDAY", minutes: 300, rate: 1000, amount: 5000 },
      { dayClass: "WEEKEND", minutes: 420, rate: 1500, amount: 10500 },
    ]);
    expect(priced.totalMinutes).toBe(720);
    expect(priced.totalAmount).toBe(15500);
  });

  it("the same night with Saturday a public holiday: 5 x 1,000 + 7 x 2,000 = 19,000", () => {
    const priced = priceHours(splitShift(wat("2026-11-20", "19:00"), wat("2026-11-21", "07:00"), new Set(["2026-11-21"])), RATES);
    expect(priced.lines.map((l) => [l.dayClass, l.minutes, l.amount])).toEqual([
      ["WEEKDAY", 300, 5000],
      ["HOLIDAY", 420, 14000],
    ]);
    expect(priced.totalAmount).toBe(19000);
  });

  it("lines come in a fixed order (weekday, weekend, holiday) and a class with no hours has no line", () => {
    const priced = priceHours(splitShift(wat("2026-11-22", "19:00"), wat("2026-11-23", "07:00"), new Set(["2026-11-23"])), RATES);
    expect(priced.lines.map((l) => l.dayClass)).toEqual(["WEEKEND", "HOLIDAY"]);
  });

  it("a partial hour is paid by the minute: 8 hours 15 minutes at 1,000 = 8,250", () => {
    const priced = priceHours(splitShift(wat("2026-11-23", "08:00"), wat("2026-11-23", "16:15"), NONE), RATES);
    expect(priced.totalAmount).toBe(8250);
  });

  it("rounds half up to the kobo: one minute at 1,000 an hour is 16.666... naira, so 16.67", () => {
    const seg: ShiftSegment = { date: "2026-11-23", dayClass: "WEEKDAY", minutes: 1, from: wat("2026-11-23", "08:00"), to: wat("2026-11-23", "08:01") };
    expect(priceHours([seg], RATES).totalAmount).toBe(16.67);
  });

  it("a tie goes up: one minute at 0.90 an hour is exactly 1.5 kobo, so 2 kobo; at 0.30 an hour half a kobo rounds up to 1", () => {
    const seg: ShiftSegment = { date: "2026-11-23", dayClass: "WEEKDAY", minutes: 1, from: wat("2026-11-23", "08:00"), to: wat("2026-11-23", "08:01") };
    expect(priceHours([seg], { ...RATES, weekday: 0.9 }).totalAmount).toBe(0.02);
    expect(priceHours([seg], { ...RATES, weekday: 0.3 }).totalAmount).toBe(0.01);
  });

  it("rounds ONCE per class, on the class's total minutes, not once per day: two one-minute weekend pieces at 0.90 are 3 kobo, not 2 + 2", () => {
    const sat: ShiftSegment = { date: "2026-11-21", dayClass: "WEEKEND", minutes: 1, from: wat("2026-11-21", "08:00"), to: wat("2026-11-21", "08:01") };
    const sun: ShiftSegment = { date: "2026-11-22", dayClass: "WEEKEND", minutes: 1, from: wat("2026-11-22", "08:00"), to: wat("2026-11-22", "08:01") };
    const priced = priceHours([sat, sun], { ...RATES, weekend: 0.9 });
    expect(priced.lines).toEqual([{ dayClass: "WEEKEND", minutes: 2, rate: 0.9, amount: 0.03 }]);
  });

  it("the total is exactly the sum of the lines", () => {
    const priced = priceHours(splitShift(wat("2026-11-20", "19:07"), wat("2026-11-22", "06:41"), new Set(["2026-11-21"])), { weekday: 333.33, weekend: 444.44, holiday: 555.55 });
    const kobo = priced.lines.reduce((a, l) => a + Math.round(l.amount * 100), 0);
    expect(Math.round(priced.totalAmount * 100)).toBe(kobo);
  });

  it("no hours is no pay", () => {
    expect(priceHours([], RATES)).toEqual({ lines: [], totalMinutes: 0, totalAmount: 0 });
  });

  it("refuses a negative rate and a rate with a part of a kobo", () => {
    const segs = splitShift(wat("2026-11-23", "08:00"), wat("2026-11-23", "16:00"), NONE);
    expect(() => priceHours(segs, { ...RATES, weekday: -1 })).toThrow(MoneyError);
    expect(() => priceHours(segs, { ...RATES, weekday: 1000.005 })).toThrow(MoneyError);
  });

  it("a rate that is not needed is still checked (a bad rate is refused, not left to be found later)", () => {
    const segs = splitShift(wat("2026-11-23", "08:00"), wat("2026-11-23", "16:00"), NONE);
    expect(() => priceHours(segs, { ...RATES, holiday: Number.NaN })).toThrow(MoneyError);
  });
});

describe("whatever the shift, the hours are never lost or counted twice", () => {
  // a small fixed pseudo-random sequence, so the test is the same every run
  let seed = 20261119;
  const next = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };

  it("500 shifts of up to three days: pieces join end to end, never cross midnight, add up, and the day classes agree with classifyDay", () => {
    const holidays = new Set(["2026-11-21", "2026-11-24", "2026-11-27"]);
    const base = wat("2026-11-18", "00:00").getTime();
    for (let i = 0; i < 500; i++) {
      const startMin = next(14 * 1440);
      const length = 1 + next(72 * 60);
      const start = new Date(base + startMin * 60000);
      const end = new Date(start.getTime() + length * 60000);
      const segs = splitShift(start, end, holidays);
      expect(segs.reduce((a, s) => a + s.minutes, 0)).toBe(length);
      expect(segs[0].from.getTime()).toBe(start.getTime());
      expect(segs[segs.length - 1].to.getTime()).toBe(end.getTime());
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k];
        expect(s.minutes).toBeGreaterThan(0);
        expect(s.minutes).toBeLessThanOrEqual(1440);
        expect(watDate(s.from)).toBe(s.date);
        expect(watDate(new Date(s.to.getTime() - 60000))).toBe(s.date); // its last minute is still on its own day
        expect(s.dayClass).toBe(classifyDay(s.date, holidays));
        if (k > 0) expect(s.from.getTime()).toBe(segs[k - 1].to.getTime());
      }
    }
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing for money", () => {
    const source = readFileSync("src/lib/payroll/hourly.ts", "utf8");
    expect(source).not.toMatch(/toFixed|parseFloat|Math\.round|Math\.floor\(.*\* 100/);
  });
});
