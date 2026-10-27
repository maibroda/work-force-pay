import { describe, expect, it } from "vitest";
import { MoneyError } from "@/lib/money-exact";
import { NTA_2025_BANDS, type TaxRuleDef } from "@/lib/payroll/paye";
import { distributeOthers, quickPayslip, type QuickComponent } from "@/lib/payroll/quick-payslip";

/** The quick payslip in exact arithmetic. Expected figures are worked by hand; each tie ends in exactly half a kobo and goes UP. */
const rule: TaxRuleDef = {
  code: "TEST",
  version: "1",
  bands: NTA_2025_BANDS,
  reliefs: [{ code: "PENSION", name: "Employee pension", type: "EMPLOYEE_PENSION", active: true }],
  exemptions: [{ code: "MIN", description: "Minimum wage earners", annualGrossCeiling: 800_000, active: true }],
};
const comp = (code: string, pct: number, pensionable = true): QuickComponent => ({ code, name: code, pct, taxable: true, pensionable });
const slip = (monthlyGross: number, components: QuickComponent[], over: Partial<Parameters<typeof quickPayslip>[0]> = {}) =>
  quickPayslip({ monthlyGross, components, employeeRate: 8, employerRate: 10, taxRule: rule, ...over });

describe("quick payslip ties round half up", () => {
  it("₦50,002.45 split 70/30: Basic is 35,001.715 → ₦35,001.72 (was .71) and the last line takes the rest, ₦15,000.73", () => {
    const s = slip(50_002.45, [comp("BASIC", 70), comp("OTHER", 30, false)]);
    expect(s.earnings.map((e) => e.amount)).toEqual([35_001.72, 15_000.73]);
    expect(s.gross).toBe(50_002.45);
  });
  it("employer pension 10% of a pensionable base ending in 5 kobo: base ₦81,920.05 → 8,192.005 → ₦8,192.01", () => {
    const s = slip(81_920.05, [comp("BASIC", 100)]);
    expect(s.pensionBase).toBe(81_920.05);
    expect(s.employerPension).toBe(8_192.01);
    expect(s.employerCost).toBe(90_112.06);
  });
  it("the lines always add back to the gross, to the kobo, whatever the split", () => {
    let seed = 99;
    for (let i = 0; i < 400; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const gross = (5_000_000 + (seed % 40_000_000)) / 100;
      const s = slip(gross, [comp("BASIC", 33.33), comp("HOUSING", 33.33), comp("TRANSPORT", 16.67), comp("OTHER", 16.67, false)]);
      expect(Math.round(s.earnings.reduce((a, e) => a + e.amount, 0) * 100)).toBe(Math.round(gross * 100));
    }
  });
});

describe("splitting the 'other allowances' share by the structure's weights is exact", () => {
  const w = (code: string, weight: number) => ({ code, name: code, weight, taxable: true, pensionable: false });
  it("each share is taken to four decimals, half up, and the last takes the rest: 10.0001 over two equal weights is 5.0001 and 5.0000", () => {
    const parts = distributeOthers(10.0001, [w("A", 1), w("B", 1)]);
    expect(parts.map((p) => p.pct)).toEqual([5.0001, 5]);
    expect(Math.round(parts.reduce((a, p) => a + p.pct, 0) * 10000)).toBe(100001);
  });
  it("the shares always add up to exactly the share given, whatever the weights", () => {
    let seed = 5;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const other = (1 + (seed % 90_000)) / 1000;
      const parts = distributeOthers(other, [w("A", 20), w("B", 13.5), w("C", 2.5), w("D", 5), w("E", 15)]);
      expect(Math.round(parts.reduce((a, p) => a + p.pct, 0) * 10000), `${other}`).toBe(Math.round(other * 10000));
    }
  });
  it("with no weights, or weights that add to nothing, the whole share goes to one 'Other allowances' line", () => {
    expect(distributeOthers(40, [])).toEqual([{ code: "OTHER", name: "Other allowances", pct: 40, taxable: true, pensionable: false }]);
    expect(distributeOthers(40, [w("A", 0)])).toHaveLength(1);
  });
  it("keeps the usual split: 40% over weights 20, 15 and 5 is 20, 15 and 5", () => {
    expect(distributeOthers(40, [w("A", 20), w("B", 15), w("C", 5)]).map((p) => p.pct)).toEqual([20, 15, 5]);
  });
});

describe("quick payslip: behaviour that must not change", () => {
  it("works a 500,000 salary through by hand (as the existing test does)", () => {
    const s = slip(500_000, [comp("BASIC", 50), comp("HOUSING", 25), comp("TRANSPORT", 15), comp("OTHER", 10, false)]);
    expect(s).toMatchObject({ gross: 500_000, pensionBase: 450_000, employeePension: 36_000, employerPension: 45_000, netPay: 397_980, employerCost: 545_000, netPct: 79.6 });
    expect(s.paye).toMatchObject({ annualChargeable: 5_568_000, annualTax: 792_240, paye: 66_020 });
  });
  it("a typed gross or deduction with more than two decimals is taken to the kobo, half up: 500,000.555 → 500,000.56", () => {
    expect(slip(500_000.555, [comp("BASIC", 100)]).gross).toBe(500_000.56);
    const s = slip(500_000, [comp("BASIC", 100)], { otherDeductions: [{ name: "Loan", amount: 1000.005 }, { name: "Zero", amount: 0 }] });
    expect(s.otherDeductions).toEqual([{ name: "Loan", amount: 1000.01 }]);
  });
  it("percentages typed with more than four decimals still work: 33.33333 + 33.33333 + 33.33334", () => {
    const s = slip(100_000, [comp("A", 33.33333), comp("B", 33.33333), comp("C", 33.33334)]);
    expect(s.earnings.map((e) => e.amount)).toEqual([33_333.33, 33_333.33, 33_333.34]);
  });
  it("net pay as a share of gross is shown to two decimals, half up: 39,798/50,000 → 79.60; nothing when there is no gross", () => {
    expect(slip(500_000, [comp("BASIC", 50), comp("HOUSING", 25), comp("TRANSPORT", 15), comp("OTHER", 10, false)]).netPct).toBe(79.6);
    expect(slip(0, [comp("BASIC", 100)]).netPct).toBe(0);
  });
  it("refuses a pension rate with more than four decimals, rather than rounding it", () => {
    expect(() => slip(100_000, [comp("BASIC", 100)], { employeeRate: 8.12345 })).toThrow(MoneyError);
  });
});
