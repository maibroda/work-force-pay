import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupAllowances, rollupAllowances, type AllowanceRow } from "@/lib/payroll/hourly-allowance-report";

/**
 * Hourly pay, H14 follow-up (docs/plans/hourly-reports-allowances-plan.md, option A): the hourly cost reports show the leave pay, the sick pay and the holiday pay that payroll calculated, read from the stored payroll lines.
 * This is the pure step that totals those lines, in whole kobo, once. The figures here are INVENTED.
 */
const row = (kind: AllowanceRow["kind"], amountKobo: number, over: Partial<AllowanceRow> = {}): AllowanceRow => ({ employeeId: "e1", contractId: "k1", clientId: "c1", month: "2051-03", kind, amountKobo, ...over });

describe("rollupAllowances: the three extra pays of a set of stored lines", () => {
  it("totals each kind apart and all together, in whole kobo", () => {
    const r = rollupAllowances([row("LEAVE_PERCENT", 100_000), row("LEAVE_PERCENT", 50_001), row("SICK_DAY", 300_000), row("HOLIDAY_NOT_WORKED", 200_000)]);
    expect(r).toEqual({ leaveKobo: 150_001, sickKobo: 300_000, holidayKobo: 200_000, totalKobo: 650_001 });
  });

  it("is all zero for no lines", () => {
    expect(rollupAllowances([])).toEqual({ leaveKobo: 0, sickKobo: 0, holidayKobo: 0, totalKobo: 0 });
  });

  it("refuses an amount that is not a whole number of kobo, rather than rounding it", () => {
    expect(() => rollupAllowances([row("SICK_DAY", 10.5)])).toThrow();
  });
});

describe("groupAllowances: the same lines grouped for each report", () => {
  it("groups by the key given, and every line is in exactly one group", () => {
    const lines = [row("LEAVE_PERCENT", 100, { employeeId: "a" }), row("SICK_DAY", 200, { employeeId: "b" }), row("HOLIDAY_NOT_WORKED", 300, { employeeId: "a" })];
    const g = groupAllowances(lines, (l) => l.employeeId);
    expect([...g.keys()].sort()).toEqual(["a", "b"]);
    expect(rollupAllowances(g.get("a")!).totalKobo).toBe(400);
    expect(rollupAllowances(g.get("b")!).totalKobo).toBe(200);
    expect([...g.values()].reduce((n, x) => n + x.length, 0)).toBe(lines.length);
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-allowance-report.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
