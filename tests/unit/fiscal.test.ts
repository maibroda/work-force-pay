import { describe, expect, it } from "vitest";
import { fiscalYearFor, monthlyPeriods, nextStatus, postingAllowed, whyNot, type PeriodAction, type PeriodStatus } from "@/lib/fiscal";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("fiscalYearFor", () => {
  it("is the calendar year when the year starts in January", () => {
    const y = fiscalYearFor(day("2026-08-15"), 1);
    expect([y.name, iso(y.startDate), iso(y.endDate)]).toEqual(["FY2026", "2026-01-01", "2026-12-31"]);
    expect(fiscalYearFor(day("2026-01-01"), 1).name).toBe("FY2026");
    expect(fiscalYearFor(day("2026-12-31"), 1).name).toBe("FY2026");
  });

  it("belongs to the year that started earlier when the year starts mid-calendar", () => {
    const early = fiscalYearFor(day("2026-02-15"), 4);
    expect([early.name, iso(early.startDate), iso(early.endDate)]).toEqual(["FY2025/26", "2025-04-01", "2026-03-31"]);
    const late = fiscalYearFor(day("2026-04-01"), 4);
    expect([late.name, iso(late.startDate), iso(late.endDate)]).toEqual(["FY2026/27", "2026-04-01", "2027-03-31"]);
    expect(fiscalYearFor(day("2026-03-31"), 4).name).toBe("FY2025/26");
  });

  it("names a year across the century boundary sensibly", () => {
    expect(fiscalYearFor(day("2099-10-01"), 7).name).toBe("FY2099/00");
  });

  it("refuses a start month that isn't a month", () => {
    expect(() => fiscalYearFor(day("2026-01-01"), 0)).toThrow(/1–12/);
    expect(() => fiscalYearFor(day("2026-01-01"), 13)).toThrow(/1–12/);
    expect(() => fiscalYearFor(day("2026-01-01"), 1.5)).toThrow(/1–12/);
  });
});

describe("monthlyPeriods", () => {
  it("gives twelve contiguous months that cover the year exactly", () => {
    const p = monthlyPeriods(day("2026-01-01"));
    expect(p).toHaveLength(12);
    expect(p.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(p[0].name).toBe("Jan 2026");
    expect(p[11].name).toBe("Dec 2026");
    expect(iso(p[11].endDate)).toBe("2026-12-31");
    for (let i = 1; i < 12; i++) expect(p[i].startDate.getTime() - p[i - 1].endDate.getTime()).toBe(86_400_000);
  });

  it("ends February on the 28th, or the 29th in a leap year", () => {
    expect(iso(monthlyPeriods(day("2026-01-01"))[1].endDate)).toBe("2026-02-28");
    expect(iso(monthlyPeriods(day("2028-01-01"))[1].endDate)).toBe("2028-02-29");
  });

  it("runs across two calendar years for a mid-year start, with the right month names", () => {
    const p = monthlyPeriods(day("2026-04-01"));
    expect(p[0].name).toBe("Apr 2026");
    expect(p[8].name).toBe("Dec 2026");
    expect(p[9].name).toBe("Jan 2027");
    expect(iso(p[11].endDate)).toBe("2027-03-31");
  });
});

describe("postingAllowed", () => {
  it("lets anyone post into an open period, and only the close permission into a soft-closed one", () => {
    expect(postingAllowed("OPEN", "Aug 2026", false).ok).toBe(true);
    expect(postingAllowed("SOFT_CLOSED", "Aug 2026", true).ok).toBe(true);
    const refused = postingAllowed("SOFT_CLOSED", "Aug 2026", false);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/Aug 2026 is soft closed/);
  });

  it("refuses a closed or locked period for everyone, with a reason that says what to do", () => {
    for (const can of [true, false]) {
      expect(postingAllowed("CLOSED", "Aug 2026", can).ok).toBe(false);
      expect(postingAllowed("LOCKED", "Aug 2026", can).ok).toBe(false);
    }
    expect(postingAllowed("CLOSED", "Aug 2026", true).reason).toMatch(/reopened, with a reason/);
    expect(postingAllowed("LOCKED", "Aug 2026", true).reason).toMatch(/cannot be posted to or reopened/);
  });
});

describe("nextStatus", () => {
  const table: Array<[PeriodAction, PeriodStatus, PeriodStatus | null]> = [
    ["SOFT_CLOSE", "OPEN", "SOFT_CLOSED"],
    ["SOFT_CLOSE", "SOFT_CLOSED", null],
    ["SOFT_CLOSE", "CLOSED", null],
    ["SOFT_CLOSE", "LOCKED", null],
    ["CLOSE", "OPEN", null],
    ["CLOSE", "SOFT_CLOSED", "CLOSED"],
    ["CLOSE", "CLOSED", null],
    ["LOCK", "CLOSED", "LOCKED"],
    ["LOCK", "OPEN", null],
    ["LOCK", "SOFT_CLOSED", null],
    ["REOPEN", "SOFT_CLOSED", "OPEN"],
    ["REOPEN", "CLOSED", "OPEN"],
    ["REOPEN", "OPEN", null],
    ["REOPEN", "LOCKED", null],
  ];
  it.each(table)("%s from %s leads to %s", (action, from, to) => {
    expect(nextStatus(action, from)).toBe(to);
  });

  it("explains a refusal", () => {
    expect(whyNot("REOPEN", "LOCKED")).toMatch(/final/);
    expect(whyNot("CLOSE", "OPEN")).toMatch(/soft closed/);
    expect(whyNot("LOCK", "SOFT_CLOSED")).toMatch(/closed/);
  });
});
