import { describe, expect, it } from "vitest";
import { annualReturnDueDate, FOUNDER_FILING_DEFAULTS, filingDefaultsFor, latePenalty, monthEndDue, remittanceDueInfo, payeDueInfo, payeDueDate, rangesOverlap, validateTiming } from "@/lib/paye-dates";

/**
 * When PAYE is due, when the annual return is due and the penalty on PAYE paid late are RULE DATA (they come from the tax rule in force, as the
 * adviser verified them). These tests prove the arithmetic and the dates with invented values; they do not say what the law requires.
 */
describe("the PAYE due date", () => {
  it("is the chosen day of the month after the pay month", () => {
    expect(payeDueDate(2026, 3, 10)).toBe("2026-04-10");
    expect(payeDueDate(2026, 12, 10)).toBe("2027-01-10");
    expect(payeDueDate(2027, 1, 28)).toBe("2027-02-28");
  });
  it("is not set when the rule has no due day", () => {
    expect(payeDueDate(2026, 3, null)).toBeNull();
  });
});

describe("the annual return due date", () => {
  it("falls in the year after the tax year", () => {
    expect(annualReturnDueDate(2026, 1, 31)).toBe("2027-01-31");
    expect(annualReturnDueDate(2026, 3, 31)).toBe("2027-03-31");
  });
  it("is not set when the rule has no date", () => {
    expect(annualReturnDueDate(2026, null, null)).toBeNull();
    expect(annualReturnDueDate(2026, 1, null)).toBeNull();
  });
});

describe("the late penalty", () => {
  it("is the rate on the unremitted amount, rounded half up to the kobo", () => {
    expect(latePenalty(250000, 10)).toBe(25000);
    expect(latePenalty(0.05, 10)).toBe(0.01); // 0.005 rounds up
    expect(latePenalty(100.05, 7.5)).toBe(7.5); // 7.50375
    expect(latePenalty(1234567.89, 12.5)).toBe(154320.99); // 154320.98625
  });
  it("is nothing when there is no rate or no amount", () => {
    expect(latePenalty(250000, null)).toBe(0);
    expect(latePenalty(0, 10)).toBe(0);
  });
});

describe("a PAYE remittance's due information", () => {
  const timing = { dueDay: 10, annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: 10 };
  const line = (status: "PENDING" | "PAID", totalAmount = 250000) => ({ type: "PAYE", status, totalAmount, period: { year: 2026, month: 3 } });

  it("is on time up to and including the due date", () => {
    expect(payeDueInfo(line("PENDING"), timing, "2026-04-10")).toEqual({ dueDate: "2026-04-10", overdue: false, daysLate: 0, penalty: 0 });
    expect(payeDueInfo(line("PENDING"), timing, "2026-04-01").overdue).toBe(false);
  });
  it("is overdue from the day after, with the days late and the penalty on the unremitted amount", () => {
    expect(payeDueInfo(line("PENDING"), timing, "2026-04-11")).toEqual({ dueDate: "2026-04-10", overdue: true, daysLate: 1, penalty: 25000 });
    expect(payeDueInfo(line("PENDING"), timing, "2026-05-10").daysLate).toBe(30);
  });
  it("is never overdue once paid", () => {
    expect(payeDueInfo(line("PAID"), timing, "2027-01-01")).toEqual({ dueDate: "2026-04-10", overdue: false, daysLate: 0, penalty: 0 });
  });
  it("shows a due date but no penalty when the rule has no penalty rate", () => {
    const r = payeDueInfo(line("PENDING"), { ...timing, latePenaltyPct: null }, "2026-06-01");
    expect(r.overdue).toBe(true);
    expect(r.penalty).toBeNull();
  });
  it("says 'not set' (no date, never overdue) when the rule has no due day or there is no rule", () => {
    expect(payeDueInfo(line("PENDING"), { ...timing, dueDay: null }, "2030-01-01")).toEqual({ dueDate: null, overdue: false, daysLate: 0, penalty: null });
    expect(payeDueInfo(line("PENDING"), null, "2030-01-01")).toEqual({ dueDate: null, overdue: false, daysLate: 0, penalty: null });
  });
  it("applies only to PAYE", () => {
    expect(payeDueInfo({ ...line("PENDING"), type: "PENSION" }, timing, "2030-01-01").dueDate).toBeNull();
  });
});

describe("checking the timing fields of a rule", () => {
  const ok = { dueDay: 10, annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: 10 };
  it("accepts a complete set, and accepts all blank", () => {
    expect(validateTiming(ok)).toEqual([]);
    expect(validateTiming({ dueDay: null, annualReturnMonth: null, annualReturnDay: null, latePenaltyPct: null })).toEqual([]);
  });
  it("refuses a due day outside 1 to 28", () => {
    expect(validateTiming({ ...ok, dueDay: 0 })[0]).toMatch(/due day/i);
    expect(validateTiming({ ...ok, dueDay: 29 })[0]).toMatch(/due day/i);
  });
  it("refuses an annual return date that is not a real day, or only half given", () => {
    expect(validateTiming({ ...ok, annualReturnMonth: 13 })[0]).toMatch(/annual return/i);
    expect(validateTiming({ ...ok, annualReturnMonth: 4, annualReturnDay: 31 })[0]).toMatch(/annual return/i);
    expect(validateTiming({ ...ok, annualReturnMonth: 2, annualReturnDay: 30 })[0]).toMatch(/annual return/i);
    expect(validateTiming({ ...ok, annualReturnDay: null })[0]).toMatch(/annual return/i);
  });
  it("refuses a penalty below 0 or above 100", () => {
    expect(validateTiming({ ...ok, latePenaltyPct: -1 })[0]).toMatch(/penalty/i);
    expect(validateTiming({ ...ok, latePenaltyPct: 101 })[0]).toMatch(/penalty/i);
  });
});

describe("effective dates that overlap", () => {
  const r = (from: string, to: string | null) => ({ from, to });
  it("overlap when both are in force on at least one day", () => {
    expect(rangesOverlap(r("2026-01-01", null), r("2026-06-01", null))).toBe(true);
    expect(rangesOverlap(r("2026-01-01", "2026-12-31"), r("2026-12-31", null))).toBe(true);
    expect(rangesOverlap(r("2026-01-01", "2026-12-31"), r("2026-03-01", "2026-04-30"))).toBe(true);
  });
  it("do not overlap when one ends the day before the other starts", () => {
    expect(rangesOverlap(r("2026-01-01", "2026-12-31"), r("2027-01-01", null))).toBe(false);
    expect(rangesOverlap(r("2027-01-01", null), r("2025-01-01", "2026-12-31"))).toBe(false);
  });
});

describe("the default filing dates and penalty (supplied by the founder, NOT verified by the tax adviser)", () => {
  it("are the values in the founder's own PAYE seed file: the 10th of the next month, 31 January, 10%", () => {
    expect(FOUNDER_FILING_DEFAULTS).toEqual({ dueDay: 10, annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: 10 });
    expect(validateTiming(FOUNDER_FILING_DEFAULTS)).toEqual([]);
  });
  it("are proposed only when the rule has none of its own: any value already set is kept as it is", () => {
    const none = { dueDay: null, annualReturnMonth: null, annualReturnDay: null, latePenaltyPct: null };
    expect(filingDefaultsFor(none)).toEqual({ ...FOUNDER_FILING_DEFAULTS, proposed: true });
    const mine = { dueDay: 15, annualReturnMonth: null, annualReturnDay: null, latePenaltyPct: null };
    expect(filingDefaultsFor(mine)).toEqual({ ...mine, proposed: false });
  });
});

describe("the employee NHF is remitted by the end of the pay month", () => {
  it("has the last day of the month as its due date (28, 29, 30 and 31 day months)", () => {
    expect(monthEndDue(2027, 11)).toBe("2027-11-30");
    expect(monthEndDue(2027, 12)).toBe("2027-12-31");
    expect(monthEndDue(2027, 2)).toBe("2027-02-28");
    expect(monthEndDue(2028, 2)).toBe("2028-02-29");
  });
  it("is on time up to and including that day, late from the next, never late once paid, and carries no penalty", () => {
    const line = (status: string) => ({ type: "NHF", status, totalAmount: 1375, period: { year: 2027, month: 11 } });
    expect(remittanceDueInfo(line("PENDING"), null, "2027-11-30")).toEqual({ dueDate: "2027-11-30", overdue: false, daysLate: 0, penalty: null });
    expect(remittanceDueInfo(line("PENDING"), null, "2027-12-01")).toEqual({ dueDate: "2027-11-30", overdue: true, daysLate: 1, penalty: null });
    expect(remittanceDueInfo(line("PAID"), null, "2028-03-01").overdue).toBe(false);
  });
});

describe("the pension remittance is due at the end of the pay month too (founder, 2026-10-29)", () => {
  const line = (status: string, type = "PENSION") => ({ type, status, totalAmount: 250000, period: { year: 2027, month: 11 } });
  it("has the last day of the pay month as its due date, is late from the next day, and carries no penalty", () => {
    expect(remittanceDueInfo(line("PENDING"), null, "2027-11-30")).toEqual({ dueDate: "2027-11-30", overdue: false, daysLate: 0, penalty: null });
    expect(remittanceDueInfo(line("PENDING"), null, "2027-12-03")).toEqual({ dueDate: "2027-11-30", overdue: true, daysLate: 3, penalty: null });
    expect(remittanceDueInfo(line("PAID"), null, "2028-03-01").overdue).toBe(false);
  });
  it("does not depend on the PAYE tax rule's dates, and leaves the other kinds of remittance without a date", () => {
    const paye = { dueDay: 10, annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: 10 };
    expect(remittanceDueInfo(line("PENDING"), paye, "2027-12-03").penalty).toBeNull();
    expect(remittanceDueInfo(line("PENDING", "ITF"), null, "2028-03-01")).toEqual({ dueDate: null, overdue: false, daysLate: 0, penalty: null });
    expect(remittanceDueInfo(line("PENDING", "PAYE"), paye, "2027-12-05").dueDate).toBe("2027-12-10"); // PAYE still follows its rule
  });
});
