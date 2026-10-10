import { describe, expect, it } from "vitest";
import { NTA_2025_BANDS, type TaxRuleDef } from "@/lib/payroll/paye";
import { distributeOthers, quickPayslip, quickProblems, type QuickComponent } from "@/lib/payroll/quick-payslip";

/** The 2025 bands, with pension as the only relief and an exemption up to 800,000 a year, so the figures can be worked by hand. */
const rule: TaxRuleDef = {
  code: "TEST",
  version: "1",
  bands: NTA_2025_BANDS,
  reliefs: [{ code: "PENSION", name: "Employee pension", type: "EMPLOYEE_PENSION", active: true }],
  exemptions: [{ code: "MIN", description: "Minimum wage earners", annualGrossCeiling: 800_000, active: true }],
};

const split = (basic: number, housing: number, transport: number, other: number): QuickComponent[] => [
  { code: "BASIC", name: "Basic", pct: basic, taxable: true, pensionable: true },
  { code: "HOUSING", name: "Housing", pct: housing, taxable: true, pensionable: true },
  { code: "TRANSPORT", name: "Transport", pct: transport, taxable: true, pensionable: true },
  { code: "OTHER", name: "Other allowances", pct: other, taxable: true, pensionable: false },
];

describe("quickPayslip", () => {
  it("works a 500,000 salary through by hand: 50/25/15 and 10% other, 8% pension, progressive PAYE", () => {
    const s = quickPayslip({ monthlyGross: 500_000, components: split(50, 25, 15, 10), employeeRate: 8, employerRate: 10, taxRule: rule });
    expect(s.earnings.map((e) => [e.code, e.amount])).toEqual([["BASIC", 250_000], ["HOUSING", 125_000], ["TRANSPORT", 75_000], ["OTHER", 50_000]]);
    expect(s.gross).toBe(500_000);
    expect(s.pensionBase).toBe(450_000); // basic + housing + transport
    expect(s.employeePension).toBe(36_000);
    expect(s.employerPension).toBe(45_000);
    // annual 6,000,000, less pension 432,000 = 5,568,000: 15% of 2,200,000 + 18% of 2,568,000 = 792,240 a year
    expect(s.paye.annualChargeable).toBe(5_568_000);
    expect(s.paye.annualTax).toBe(792_240);
    expect(s.paye.paye).toBe(66_020);
    expect(s.totalDeductions).toBe(102_020);
    expect(s.netPay).toBe(397_980);
    expect(s.employerCost).toBe(545_000);
    expect(s.netPct).toBe(79.6);
  });

  it("changes with the split: moving pay out of the pensionable allowances cuts the pension", () => {
    const heavyBasic = quickPayslip({ monthlyGross: 500_000, components: split(60, 20, 10, 10), employeeRate: 8, employerRate: 10, taxRule: rule });
    const lightBasic = quickPayslip({ monthlyGross: 500_000, components: split(30, 10, 10, 50), employeeRate: 8, employerRate: 10, taxRule: rule });
    expect(heavyBasic.pensionBase).toBe(450_000);
    expect(lightBasic.pensionBase).toBe(250_000);
    expect(lightBasic.employeePension).toBeLessThan(heavyBasic.employeePension);
    expect(lightBasic.paye.paye).toBeGreaterThan(heavyBasic.paye.paye); // less pension relief, so more tax
  });

  it("always adds the earnings back to the gross to the kobo, however the split rounds", () => {
    for (const gross of [123_456.78, 99_999.99, 1_000_000.01, 77_777.77]) {
      const s = quickPayslip({ monthlyGross: gross, components: split(33.33, 33.33, 16.67, 16.67), employeeRate: 8, employerRate: 10, taxRule: rule });
      expect(Math.round(s.earnings.reduce((a, e) => a + e.amount, 0) * 100)).toBe(Math.round(gross * 100));
      expect(s.netPay).toBeCloseTo(s.gross - s.totalDeductions, 2);
    }
  });

  it("takes other deductions off, and pays no tax under the exemption", () => {
    const s = quickPayslip({ monthlyGross: 60_000, components: split(50, 25, 15, 10), employeeRate: 8, employerRate: 10, taxRule: rule, otherDeductions: [{ name: "Staff loan", amount: 5_000 }, { name: "Ignored", amount: 0 }] });
    expect(s.paye.exempt).toBe(true);
    expect(s.paye.paye).toBe(0);
    expect(s.otherDeductions).toEqual([{ name: "Staff loan", amount: 5_000 }]);
    expect(s.totalDeductions).toBe(s.employeePension + 5_000);
    expect(s.netPay).toBe(60_000 - s.employeePension - 5_000);
  });

  it("gives the same answer however much of the pay is in the pensionable allowances, for a 100% basic salary", () => {
    const s = quickPayslip({ monthlyGross: 200_000, components: [{ code: "BASIC", name: "Basic", pct: 100, taxable: true, pensionable: true }], employeeRate: 8, employerRate: 10, taxRule: rule });
    expect(s.earnings).toHaveLength(1);
    expect(s.pensionBase).toBe(200_000);
    expect(s.employeePension).toBe(16_000);
  });
});

describe("quickProblems", () => {
  it("says what is wrong", () => {
    const ok = split(50, 25, 15, 10);
    expect(quickProblems({ monthlyGross: 500_000, components: ok })).toEqual([]);
    expect(quickProblems({ monthlyGross: 0, components: ok })).toContain("Enter the monthly gross salary.");
    expect(quickProblems({ monthlyGross: 100, components: split(50, 25, 15, 11) }).join(" ")).toMatch(/add up to 101%, which is more than 100%/);
    expect(quickProblems({ monthlyGross: 100, components: split(50, 25, 15, 9) }).join(" ")).toMatch(/add up to 99%, which is less than 100%/);
    expect(quickProblems({ monthlyGross: 100, components: split(-5, 55, 25, 25) })).toContain("A percentage can't be negative.");
    expect(quickProblems({ monthlyGross: 100, components: ok, otherDeductions: [{ name: "x", amount: -1 }] })).toContain("A deduction can't be negative.");
  });
});

describe("distributeOthers", () => {
  const weights = [
    { code: "ENT", name: "Entertainment", weight: 5, taxable: true, pensionable: false },
    { code: "MEAL", name: "Meal", weight: 15, taxable: true, pensionable: false },
    { code: "UTIL", name: "Utility", weight: 20, taxable: true, pensionable: false },
  ];
  it("shares the other allowances in the proportions the structure gives them, adding up exactly", () => {
    const out = distributeOthers(40, weights);
    expect(out.map((c) => [c.code, c.pct])).toEqual([["ENT", 5], ["MEAL", 15], ["UTIL", 20]]);
    const odd = distributeOthers(10, weights);
    expect(Math.round(odd.reduce((s, c) => s + c.pct, 0) * 10000)).toBe(100000);
  });
  it("is one line when the structure has no other allowances", () => {
    expect(distributeOthers(10, [])).toEqual([{ code: "OTHER", name: "Other allowances", pct: 10, taxable: true, pensionable: false }]);
  });
});
