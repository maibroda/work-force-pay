import { describe, expect, it } from "vitest";
import { calculateEmployeePayroll, type EngineInput, type RateInfo, type WorkDay } from "@/lib/payroll/engine";
import type { TaxRuleDef } from "@/lib/payroll/paye";
import type { StructureDef } from "@/lib/payroll/structure";

/**
 * The take-home floor: a payroll-rule setting (a percentage of gross; 0 = off, which is how pay has always been worked). Loan and salary-advance recoveries
 * may not take net pay below that share of gross; what is not taken is reported as DEFERRED (so the loan book can carry it forward), never silently lost.
 * Penalties, recoveries and other deductions are never reduced. Everything here is invented.
 */
const base = { taxable: true, employerCost: false, active: true };
const STRUCT: StructureDef = {
  id: "g", code: "G", name: "Golden shares", isPartial: false,
  components: [
    { ...base, code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 50, pensionable: true, sortOrder: 0 },
    { ...base, code: "HOUSING", name: "Housing", calcType: "PERCENTAGE", percentage: 10, pensionable: true, sortOrder: 1 },
    { ...base, code: "TRANSPORT", name: "Transport", calcType: "PERCENTAGE", percentage: 10, pensionable: true, sortOrder: 2 },
    { ...base, code: "OTHER", name: "Other", calcType: "PERCENTAGE", percentage: 30, pensionable: false, sortOrder: 3 },
  ],
};
const TAX: TaxRuleDef = {
  code: "T", version: "t",
  bands: [{ lowerBound: 0, upperBound: 800_000, rate: 0 }, { lowerBound: 800_000, upperBound: null, rate: 15 }],
  reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true }, { code: "NHF", name: "NHF", type: "NHF", rate: 2.5, active: true }],
  exemptions: [],
};
const ded = (id: string, type: string, amount: number) => ({ id, type, amount, authorityReference: `REF-${id}`, reason: `test ${id}` });

function run(monthlyGross: number, extra: Partial<EngineInput> = {}) {
  const rate: RateInfo = { key: "r", source: "EMPLOYEE_PAY_RATE", agreedRate: null, operativeSharePct: null, monthlyGross, structure: STRUCT };
  const days: WorkDay[] = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)), clientId: null, clientName: "-", contractId: null, beatId: "b", beatName: "-", categoryId: "GUARD", status: "PRESENT", overtimeHours: 0 }));
  return calculateEmployeePayroll({ basisDays: 30, days, resolveRate: () => rate, pension: { employeeRate: 8, employerRate: 10, version: "g" }, taxRule: TAX, ...extra });
}
const line = (r: ReturnType<typeof run>, code: string) => r.lines.filter((l) => l.type === "DEDUCTION" && l.code === code);

describe("the take-home floor on loan and salary-advance recoveries", () => {
  it("reproduces the golden dataset's case 10: loan and cooperative 40,000 asked, 28,047.50 allowed, net pay 32,500", () => {
    // gross 65,000; pension 3,640; NHF 812.50; PAYE 0 (annual taxable 726,570); floor 50% = 32,500; room = 65,000 - 3,640 - 812.50 - 32,500 = 28,047.50
    const r = run(65_000, { nhfEmployeeRatePct: 2.5, minTakeHomePct: 50, deductions: [ded("loan", "LOAN", 25_000), ded("coop", "LOAN", 15_000)] });
    expect(r.otherDeductions).toBe(28_047.5);
    expect(r.netPay).toBe(32_500);
    // taken in the order given: the loan in full, the second recovery only up to what is left
    expect(r.deferredDeductions).toEqual([{ id: "coop", type: "LOAN", requested: 15_000, taken: 3_047.5 }]);
  });

  it("is off at 0 or when not given: nothing is reduced, nothing is reported, the same totals as before", () => {
    const off = run(65_000, { deductions: [ded("loan", "LOAN", 25_000), ded("coop", "LOAN", 15_000)] });
    for (const r of [run(65_000, { minTakeHomePct: 0, deductions: [ded("loan", "LOAN", 25_000), ded("coop", "LOAN", 15_000)] }), off]) {
      expect(r.otherDeductions).toBe(40_000);
      expect(r.deferredDeductions).toEqual([]);
      expect(r.netPay).toBe(off.netPay);
    }
  });

  it("takes in the order given, a first recovery in full before a later one is cut, and reports exactly what was cut", () => {
    const r = run(65_000, { minTakeHomePct: 50, deductions: [ded("a", "LOAN", 20_000), ded("b", "SALARY_ADVANCE", 20_000)] });
    // room = 65,000 - 3,640 pension - 32,500 floor = 28,860: the first takes 20,000, the second only the 8,860 left
    expect(line(r, "LOAN")[0].amount).toBe(20_000);
    expect(line(r, "SALARY_ADVANCE")[0].amount).toBe(8_860);
    expect(r.deferredDeductions).toEqual([{ id: "b", type: "SALARY_ADVANCE", requested: 20_000, taken: 8_860 }]);
    expect(r.netPay).toBe(32_500);
  });

  it("never reduces a penalty, a recovery or an other deduction, and counts them when working out the room", () => {
    // 5,000 penalty is not reducible and uses up room: 65,000 - 3,640 - 5,000 - 32,500 = 23,860 left for the loan
    const r = run(65_000, { minTakeHomePct: 50, deductions: [ded("pen", "PENALTY", 5_000), ded("loan", "LOAN", 30_000)] });
    expect(line(r, "PENALTY")[0].amount).toBe(5_000);
    expect(line(r, "LOAN")[0].amount).toBe(23_860);
    expect(r.deferredDeductions).toEqual([{ id: "loan", type: "LOAN", requested: 30_000, taken: 23_860 }]);
    expect(r.netPay).toBe(32_500);
  });

  it("takes nothing of a recovery when the unavoidable deductions already leave less than the floor, but still never touches the penalty", () => {
    // floor 70% = 45,500; pension 3,640 and a 20,000 penalty already leave only 41,360, below the floor: no room at all
    const r = run(65_000, { minTakeHomePct: 70, deductions: [ded("pen", "PENALTY", 20_000), ded("loan", "LOAN", 4_000)] });
    expect(line(r, "LOAN")[0].amount).toBe(0);
    expect(line(r, "PENALTY")[0].amount).toBe(20_000);
    expect(r.deferredDeductions).toEqual([{ id: "loan", type: "LOAN", requested: 4_000, taken: 0 }]);
  });

  it("does not reduce a recovery that already fits, and the floor is exact to the kobo (half up)", () => {
    expect(run(65_000, { minTakeHomePct: 50, deductions: [ded("loan", "LOAN", 1_000)] }).deferredDeductions).toEqual([]);
    // gross 65,000.33; pension 3,640.02 (8% of the 45,500.23 pensionable); no PAYE; floor 33.333% of 65,000.33 = 21,666.55999 -> 21,666.56 (half up, once, to the kobo)
    // room = 65,000.33 - 3,640.02 - 21,666.56 = 39,693.75, so net pay lands exactly on the floor
    const r = run(65_000.33, { minTakeHomePct: 33.333, deductions: [ded("loan", "LOAN", 60_000)] });
    expect(r.otherDeductions).toBe(39_693.75);
    expect(r.netPay).toBe(21_666.56);
  });

  it("marks the payslip line with what was cut, and carries the deduction's id so the loan book can adjust", () => {
    const r = run(65_000, { minTakeHomePct: 50, deductions: [ded("loan", "LOAN", 40_000)] });
    const l = line(r, "LOAN")[0] as { amount: number; deductionId?: string; deferred?: number; name: string };
    expect(l.deductionId).toBe("loan");
    expect(l.deferred).toBeGreaterThan(0);
    expect(l.name).toMatch(/deferred/i);
  });

  it("refuses a floor outside 0 to 100", () => {
    expect(() => run(65_000, { minTakeHomePct: -1 })).toThrow();
    expect(() => run(65_000, { minTakeHomePct: 101 })).toThrow();
  });
});
