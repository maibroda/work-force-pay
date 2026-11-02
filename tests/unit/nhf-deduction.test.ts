import { describe, expect, it } from "vitest";
import { calculateEmployeePayroll, type EngineInput, type RateInfo, type WorkDay } from "@/lib/payroll/engine";
import type { TaxRuleDef } from "@/lib/payroll/paye";
import type { StructureDef } from "@/lib/payroll/structure";

/**
 * The employee's NHF contribution: a rate on BASIC pay (a payroll-rule setting, effective-dated; 0 = none, which is how pay has always worked) taken
 * off net pay as its own payslip line, and counted as a PAYE relief at the amount actually taken. The rate used in these tests is 2.5%, the standard rate
 * in the founder's golden dataset. It is the tax adviser's to confirm. Everything is invented.
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
const taxRule = (nhfReliefRate = 2.5): TaxRuleDef => ({
  code: "T", version: "t",
  bands: [{ lowerBound: 0, upperBound: 800_000, rate: 0 }, { lowerBound: 800_000, upperBound: null, rate: 15 }],
  reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true }, { code: "NHF", name: "NHF", type: "NHF", rate: nhfReliefRate, active: true }],
  exemptions: [],
});

function run(monthlyGross: number, extra: Partial<EngineInput> = {}, rule = taxRule()) {
  const rate: RateInfo = { key: "r", source: "EMPLOYEE_PAY_RATE", agreedRate: null, operativeSharePct: null, monthlyGross, structure: STRUCT };
  const days: WorkDay[] = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)), clientId: null, clientName: "-", contractId: null, beatId: "b", beatName: "-", categoryId: "GUARD", status: "PRESENT", overtimeHours: 0 }));
  return calculateEmployeePayroll({ basisDays: 30, days, resolveRate: () => rate, pension: { employeeRate: 8, employerRate: 10, version: "g" }, taxRule: rule, ...extra });
}
const line = (r: ReturnType<typeof run>, code: string) => r.lines.find((l) => l.code === code);

describe("the employee NHF deduction", () => {
  it("is 2.5% of basic pay, as its own deduction line, and takes net pay down by exactly that amount (the golden dataset's case 1)", () => {
    const on = run(110_000, { nhfEmployeeRatePct: 2.5 });
    const off = run(110_000);
    expect(line(on, "NHF")).toEqual({ type: "DEDUCTION", code: "NHF", name: "NHF", amount: 1375 }); // 2.5% of basic 55,000
    expect(on.employeeNhf).toBe(1375);
    expect(on.totalDeductions).toBe(off.totalDeductions + 1375);
    expect(on.netPay).toBe(off.netPay - 1375);
    expect(on.netPay).toBe(97_095.25); // the golden key's net pay for case 1
  });

  it("changes nothing at all when the rate is 0 or not given: no line, the same totals, the same PAYE", () => {
    const off = run(110_000);
    for (const r of [run(110_000, { nhfEmployeeRatePct: 0 }), run(110_000, { nhfEmployeeRatePct: undefined })]) {
      expect(line(r, "NHF")).toBeUndefined();
      expect(r.employeeNhf).toBe(0);
      expect(r.netPay).toBe(off.netPay);
      expect(r.paye).toEqual(off.paye);
    }
  });

  it("is rounded half up to the kobo on the basic pay line", () => {
    // basic = 50% of 200,000.40 = 100,000.20; 2.5% of that is 2,500.005, which rounds up to 2,500.01
    expect(run(200_000.4, { nhfEmployeeRatePct: 2.5 }).employeeNhf).toBe(2500.01);
    // 2.5% of 4,000.20 = 100.005 -> 100.01 ; of 4,000.18 = 100.0045 -> 100.00
    expect(run(8_000.4, { nhfEmployeeRatePct: 2.5 }).employeeNhf).toBe(100.01);
    expect(run(8_000.36, { nhfEmployeeRatePct: 2.5 }).employeeNhf).toBe(100);
  });

  it("is the relief against PAYE at the amount ACTUALLY taken, not at the rule's own rate", () => {
    // the tax rule's NHF relief says 2.5%, but only 1% is being deducted: the relief must be 12 x the 1% deduction
    const r = run(110_000, { nhfEmployeeRatePct: 1 });
    expect(r.employeeNhf).toBe(550);
    expect(r.paye.reliefBreakdown.find((x) => x.code === "NHF")?.amount).toBe(550 * 12);
    // with nothing deducted the old behaviour stays: the relief is the rule's rate on a year of basic pay
    expect(run(110_000).paye.reliefBreakdown.find((x) => x.code === "NHF")?.amount).toBe(55_000 * 12 * 0.025);
  });

  it("reproduces the golden key's PAYE and net pay for case 11 (a high earner crossing bands)", () => {
    const on = run(700_000, { nhfEmployeeRatePct: 2.5 }, { ...taxRule(), bands: [{ lowerBound: 0, upperBound: 800_000, rate: 0 }, { lowerBound: 800_000, upperBound: 3_000_000, rate: 15 }, { lowerBound: 3_000_000, upperBound: 12_000_000, rate: 18 }, { lowerBound: 12_000_000, upperBound: null, rate: 21 }] });
    expect(on.employeeNhf).toBe(8750);
    expect(on.paye.paye).toBe(99_869);
    expect(on.netPay).toBe(552_181);
  });

  it("is not taken from a payroll that has no basic pay (an adjustments-only run)", () => {
    const r = run(110_000, { nhfEmployeeRatePct: 2.5, adjustmentsOnly: true, days: [], otherEarnings: [{ id: "o", name: "Bonus", amount: 5000, taxable: true }], payeBase: { regularTaxable: 110_000, employeePension: 6160, basic: 55_000 } });
    expect(line(r, "NHF")).toBeUndefined();
    expect(r.employeeNhf).toBe(0);
  });

  it("refuses a rate outside 0 to 100", () => {
    expect(() => run(110_000, { nhfEmployeeRatePct: -1 })).toThrow();
    expect(() => run(110_000, { nhfEmployeeRatePct: 101 })).toThrow();
  });
});
