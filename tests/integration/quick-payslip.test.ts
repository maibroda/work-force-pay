import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d } from "@/lib/dates";
import { computePaye } from "@/lib/payroll/paye";
import { pensionRuleFor, taxRuleFor } from "@/server/services/statutory";
import { buildQuickPayslip, quickPayslipPresets } from "@/server/services/quick-payslip";
import { ctxFor } from "../helpers";

// These tests only read, so they can share the seeded organization with the other files.
const base = { gross: 500_000, payDate: "2026-09-30", basicPct: 50, housingPct: 25, transportPct: 15 };

describe("quick payslip", () => {
  it("applies the tax rule and pension rule in force on the pay date, exactly as the payroll engine does", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const r = await buildQuickPayslip(ctx, base as never);
    const tax = await taxRuleFor(db, ctx.orgId, d("2026-09-30"));
    const pension = await pensionRuleFor(db, ctx.orgId, d("2026-09-30"));
    expect(r.taxRule).toBe(`${tax.def.code}@${tax.def.version}`);
    expect(r.pensionRates).toEqual({ employee: pension.employeeRate, employer: pension.employerRate });
    const s = r.slip;
    expect(s.earnings.map((e) => [e.code, e.amount])).toEqual([["BASIC", 250_000], ["HOUSING", 125_000], ["TRANSPORT", 75_000], ["OTHER", 50_000]]);
    expect(Math.round(s.earnings.reduce((a, e) => a + e.amount, 0) * 100)).toBe(50_000_000);
    expect(s.employeePension).toBe(Math.round(s.pensionBase * pension.employeeRate) / 100);
    // the same PAYE the engine's rule gives for those taxable earnings
    const direct = computePaye({ monthlyRegularTaxable: s.taxableEarnings, monthlyIrregularTaxable: 0, monthlyEmployeePension: s.employeePension, monthlyBasic: 250_000, annualRent: 0 }, tax.def);
    expect(s.paye.paye).toBe(direct.paye);
    expect(s.netPay).toBeCloseTo(500_000 - s.paye.paye - s.employeePension, 2);
    expect(r.otherPct).toBe(10);
    expect(r.organization).toBeTruthy();
  });

  it("makes the share of Basic, Housing and Transport matter: the pensionable base follows the pension rule's allowances", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const heavy = await buildQuickPayslip(ctx, { ...base, basicPct: 60, housingPct: 20, transportPct: 10 } as never);
    const light = await buildQuickPayslip(ctx, { ...base, basicPct: 30, housingPct: 10, transportPct: 10 } as never);
    expect(heavy.slip.pensionBase).toBe(450_000);
    expect(light.slip.pensionBase).toBe(250_000);
    expect(light.otherPct).toBe(50);
    expect(light.slip.employeePension).toBeLessThan(heavy.slip.employeePension);
  });

  it("takes a named deduction and the employee's name for the slip", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const r = await buildQuickPayslip(ctx, { ...base, deductionName: "Staff loan", deductionAmount: 20_000, employeeName: "Ada Obi", position: "Supervisor" } as never);
    expect(r.slip.otherDeductions).toEqual([{ name: "Staff loan", amount: 20_000 }]);
    expect(r.slip.totalDeductions).toBeCloseTo(r.slip.paye.paye + r.slip.employeePension + 20_000, 2);
    expect([r.employeeName, r.position]).toEqual(["Ada Obi", "Supervisor"]);
  });

  it("refuses what doesn't add up, in plain words", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    await expect(buildQuickPayslip(ctx, { ...base, basicPct: 70, housingPct: 25, transportPct: 15 } as never)).rejects.toThrow(/add up to 110%, which is more than 100%/);
    await expect(buildQuickPayslip(ctx, { ...base, gross: 0 } as never)).rejects.toThrow(/Enter the monthly gross salary/);
    await expect(buildQuickPayslip(ctx, { ...base, basicPct: -5, housingPct: 25, transportPct: 15 } as never)).rejects.toThrow(/can't be negative/);
    await expect(buildQuickPayslip(ctx, { ...base, payDate: "not a date" } as never)).rejects.toThrow();
    await expect(buildQuickPayslip(ctx, { ...base, structureId: "nope" } as never)).rejects.toThrow(/isn't available/);
    await expect(buildQuickPayslip(await ctxFor("EMPLOYEE"), base as never)).rejects.toThrow(/permission/i);
  });

  it("offers the active salary structures that are plain percentage splits, and splits the other allowances the way one does", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const presets = await quickPayslipPresets(ctx);
    expect(presets.structures.length).toBeGreaterThan(0);
    const std = presets.structures.find((s) => s.basicPct === 10 && s.housingPct === 14 && s.transportPct === 15);
    expect(std).toBeTruthy();
    expect(presets.defaults.basicPct).toBeGreaterThan(0);
    const r = await buildQuickPayslip(ctx, { gross: 100_000, payDate: "2026-09-30", basicPct: 10, housingPct: 14, transportPct: 15, structureId: std!.id } as never);
    const codes = r.slip.earnings.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["BASIC", "HOUSING", "TRANSPORT", "MEAL", "UTILITY"]));
    expect(r.slip.earnings.find((e) => e.code === "MEAL")!.amount).toBe(15_000);
    expect(r.slip.earnings.find((e) => e.code === "UTILITY")!.amount).toBe(20_000);
    expect(Math.round(r.slip.earnings.reduce((a, e) => a + e.amount, 0) * 100)).toBe(10_000_000);
    expect(r.structure).toBe(std!.name);
    // only Basic, Housing and Transport are pensionable, as the pension rule says
    expect(r.slip.pensionBase).toBe(39_000);
  });
});
