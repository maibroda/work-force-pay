import { describe, expect, it } from "vitest";
import { d, iso } from "@/lib/dates";
import { addMonths, countWorkingDays, leaveEligibility, workingDatesBetween } from "@/lib/leave";

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(iso(addMonths(d("2025-03-15"), 12))).toBe("2026-03-15");
  });
  it("clamps to the end of a shorter month", () => {
    expect(iso(addMonths(d("2025-01-31"), 1))).toBe("2025-02-28");
    expect(iso(addMonths(d("2024-02-29"), 12))).toBe("2025-02-28");
  });
});

describe("leaveEligibility", () => {
  it("is not due before the eligibility period is complete", () => {
    const r = leaveEligibility(d("2026-01-10"), d("2026-09-21"), 12);
    expect(r.cycle).toBeNull();
    expect(iso(r.nextDueDate)).toBe("2027-01-10");
  });

  it("falls due on the anniversary itself", () => {
    const r = leaveEligibility(d("2025-09-21"), d("2026-09-21"), 12);
    expect(r.cycle?.number).toBe(1);
    expect(iso(r.cycle!.start)).toBe("2026-09-21");
    expect(iso(r.cycle!.end)).toBe("2027-09-20");
  });

  it("is not due the day before the anniversary", () => {
    expect(leaveEligibility(d("2025-09-22"), d("2026-09-21"), 12).cycle).toBeNull();
  });

  it("renews every 12 months", () => {
    const r = leaveEligibility(d("2022-05-16"), d("2026-09-21"), 12);
    expect(r.cycle?.number).toBe(4);
    expect(iso(r.cycle!.start)).toBe("2026-05-16");
    expect(iso(r.cycle!.end)).toBe("2027-05-15");
    expect(iso(r.nextDueDate)).toBe("2027-05-16");
  });

  it("honours a different eligibility period (0 = due immediately)", () => {
    const r = leaveEligibility(d("2026-09-01"), d("2026-09-21"), 0);
    expect(r.cycle?.number).toBe(1);
    expect(iso(r.cycle!.start)).toBe("2026-09-01");
  });
});

describe("working days", () => {
  // 2026-09-21 is a Monday
  it("counts Mon–Fri on a 5-day week", () => {
    expect(countWorkingDays(d("2026-09-21"), d("2026-09-25"), 5)).toBe(5);
    expect(countWorkingDays(d("2026-09-21"), d("2026-10-02"), 5)).toBe(10); // two full weeks
  });
  it("skips the weekend", () => {
    expect(countWorkingDays(d("2026-09-25"), d("2026-09-28"), 5)).toBe(2); // Fri + Mon
    expect(workingDatesBetween(d("2026-09-26"), d("2026-09-27"), 5)).toHaveLength(0);
  });
  it("counts Saturdays on a 6-day week and every day on a 7-day week", () => {
    expect(countWorkingDays(d("2026-09-21"), d("2026-09-27"), 6)).toBe(6);
    expect(countWorkingDays(d("2026-09-21"), d("2026-09-27"), 7)).toBe(7);
  });
  it("returns nothing for a reversed range", () => {
    expect(countWorkingDays(d("2026-09-25"), d("2026-09-21"), 5)).toBe(0);
  });
});
