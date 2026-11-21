import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sickBalance, sickCycleFor } from "@/lib/sick-leave";

/**
 * Hourly pay, H14 piece 2 (docs/plans/hourly-payroll-h14-build-plan.md): paid sick leave for a person paid by the hour. The founder's answers of 2026-11-20 and 2026-11-21: 5 days a year (the leave policy's figure), in the
 * SAME leave year as annual leave, only after the same service period (12 months by the leave policy, as for monthly staff). This is the pure part: which leave year a spell of sickness is charged to, and the balance of days.
 * A spell is charged to the leave year that contains its FIRST day, whenever it is recorded (a person is often ill before anyone records it). Days beyond the entitlement are not refused: sickness is not optional;
 * they are simply not paid (the pay is a later step). Dates are invented.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const joined = day("2040-03-15"); // completes 12 months on 2041-03-15: the first leave year runs 2041-03-15 to 2042-03-14

describe("sickCycleFor: the leave year a spell is charged to", () => {
  it("is the leave year containing the first day of the spell, counted from the service period as for annual leave", () => {
    const c = sickCycleFor(joined, day("2041-06-02"), 12)!;
    expect([c.number, c.start.toISOString().slice(0, 10), c.end.toISOString().slice(0, 10)]).toEqual([1, "2041-03-15", "2042-03-14"]);
    const next = sickCycleFor(joined, day("2042-03-15"), 12)!;
    expect([next.number, next.start.toISOString().slice(0, 10)]).toEqual([2, "2042-03-15"]);
  });

  it("is nothing before the service period is complete (paid sick leave is not due yet)", () => {
    expect(sickCycleFor(joined, day("2041-03-14"), 12)).toBeNull();
    expect(sickCycleFor(joined, day("2040-06-01"), 12)).toBeNull();
  });

  it("follows the leave policy's service period, whatever it is", () => {
    expect(sickCycleFor(joined, day("2040-10-01"), 6)).not.toBeNull(); // 6 months' service complete on 2040-09-15
    expect(sickCycleFor(joined, day("2040-10-01"), 12)).toBeNull();
  });
});

describe("sickBalance: the days in a leave year", () => {
  const cycleStart = day("2041-03-15");
  const spells = [
    { cycleStart, status: "APPROVED", workingDays: 2 },
    { cycleStart, status: "PENDING", workingDays: 1 },
    { cycleStart, status: "REJECTED", workingDays: 4 },
    { cycleStart, status: "CANCELLED", workingDays: 3 },
    { cycleStart: day("2042-03-15"), status: "APPROVED", workingDays: 5 }, // another leave year
  ];

  it("counts approved and pending days of the leave year, and ignores rejected, cancelled and other years", () => {
    expect(sickBalance(5, spells, cycleStart)).toEqual({ entitled: 5, approved: 2, pending: 1, remaining: 2 });
  });

  it("never goes below zero: days beyond the entitlement are not refused, just not paid", () => {
    expect(sickBalance(5, [{ cycleStart, status: "APPROVED", workingDays: 7 }], cycleStart)).toEqual({ entitled: 5, approved: 7, pending: 0, remaining: 0 });
  });

  it("is all of the entitlement when nothing has been taken", () => {
    expect(sickBalance(5, [], cycleStart)).toEqual({ entitled: 5, approved: 0, pending: 0, remaining: 5 });
  });
});

describe("the file keeps to plain whole numbers", () => {
  it("uses no money and no floating-point parsing", () => {
    expect(readFileSync("src/lib/sick-leave.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
