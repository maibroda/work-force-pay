/**
 * Quick payslip: from a monthly gross salary and how it splits into Basic, Housing, Transport and other allowances, produce a
 * payslip with the pension and PAYE the payroll engine would deduct, using the tax rule and pension rule in force on the pay
 * date. Nothing is saved: it is a calculator for offers, budgets and what-ifs, not a payroll record.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { distributeOthers, quickPayslip, quickProblems, type QuickComponent } from "@/lib/payroll/quick-payslip";
import { validateStructure, type ComponentDef } from "@/lib/payroll/structure";
import { assertCan, BusinessError, db } from "./_base";
import { pensionRuleFor, taxRuleFor } from "./statutory";

const number = (def?: number) => z.preprocess((v) => (v === "" || v === undefined || v === null ? def : v), z.coerce.number().optional());

export const quickSchema = z.object({
  gross: z.coerce.number({ message: "Enter the monthly gross salary" }),
  payDate: z.string().optional(),
  basicPct: z.coerce.number(),
  housingPct: z.coerce.number(),
  transportPct: z.coerce.number(),
  /** Splits the "other allowances" share the way a saved salary structure splits its other components. */
  structureId: z.string().optional(),
  annualRent: number(0),
  deductionName: z.string().trim().max(60).optional(),
  deductionAmount: number(0),
  employeeName: z.string().trim().max(120).optional(),
  position: z.string().trim().max(120).optional(),
});
export type QuickParams = z.input<typeof quickSchema>;

/** The share of the gross each of Basic, Housing and Transport takes in a salary structure, and what it keeps besides. */
export async function quickPayslipPresets(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  const rows = await db.salaryStructure.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, include: { components: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const structures = rows
    .map((s) => {
      const comps: ComponentDef[] = s.components.map((c) => ({
        code: c.code,
        name: c.name,
        calcType: c.calcType as ComponentDef["calcType"],
        percentage: c.percentage === null ? null : num(c.percentage),
        fixedAmount: c.fixedAmount === null ? null : num(c.fixedAmount),
        formula: c.formula,
        taxable: c.taxable,
        pensionable: c.pensionable,
        active: c.active,
        sortOrder: c.sortOrder,
      }));
      // only a structure that is a plain percentage split of the gross can be expressed as percentages
      if (s.isPartial || validateStructure({ isPartial: false, components: comps }).length || comps.some((c) => c.active && c.calcType !== "PERCENTAGE")) return null;
      const pct = (code: string) => comps.find((c) => c.active && c.code === code)?.percentage ?? 0;
      const others = comps.filter((c) => c.active && !["BASIC", "HOUSING", "TRANSPORT"].includes(c.code));
      return { id: s.id, name: s.name, isDefault: s.isDefault, basicPct: pct("BASIC"), housingPct: pct("HOUSING"), transportPct: pct("TRANSPORT"), othersPct: round2(others.reduce((a, c) => a + (c.percentage ?? 0), 0)), others: others.map((c) => ({ code: c.code, name: c.name, weight: c.percentage ?? 0, taxable: c.taxable, pensionable: c.pensionable })) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const fallback = structures.find((s) => s.isDefault) ?? structures[0];
  return { structures, defaults: fallback ? { basicPct: fallback.basicPct, housingPct: fallback.housingPct, transportPct: fallback.transportPct } : { basicPct: 50, housingPct: 25, transportPct: 15 } };
}

export async function buildQuickPayslip(ctx: Ctx, raw: QuickParams) {
  assertCan(ctx, "payroll.view");
  const v = quickSchema.parse(raw);
  const payDate = v.payDate ? d(v.payDate) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(payDate.getTime())) throw new BusinessError("The pay date isn't a valid date.");
  const otherPct = round2(100 - v.basicPct - v.housingPct - v.transportPct);
  if ([v.basicPct, v.housingPct, v.transportPct].some((p) => !Number.isFinite(p) || p < 0)) throw new BusinessError("A percentage can't be negative.");
  if (otherPct < -0.0001) throw new BusinessError(`Basic, Housing and Transport add up to ${round2(v.basicPct + v.housingPct + v.transportPct)}%, which is more than 100%.`);

  const [tax, pension, org, presets] = await Promise.all([
    taxRuleFor(db, ctx.orgId, payDate),
    pensionRuleFor(db, ctx.orgId, payDate),
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } }),
    v.structureId ? quickPayslipPresets(ctx) : Promise.resolve(null),
  ]);
  const pensionable = new Set((pension.codes?.length ? pension.codes : ["BASIC", "HOUSING", "TRANSPORT"]).map((c) => c.toUpperCase()));
  const chosen = presets?.structures.find((s) => s.id === v.structureId);
  if (v.structureId && !chosen) throw new BusinessError("That salary structure isn't available for a quick payslip (it must be active and a plain percentage split).");
  const others: QuickComponent[] = Math.max(0, otherPct) > 0 ? (chosen ? distributeOthers(Math.max(0, otherPct), chosen.others) : [{ code: "OTHER", name: "Other allowances", pct: Math.max(0, otherPct), taxable: true, pensionable: false }]) : [];
  const components: QuickComponent[] = [
    { code: "BASIC", name: "Basic", pct: v.basicPct, taxable: true, pensionable: true },
    { code: "HOUSING", name: "Housing", pct: v.housingPct, taxable: true, pensionable: true },
    { code: "TRANSPORT", name: "Transport", pct: v.transportPct, taxable: true, pensionable: true },
    ...others,
  ].map((c) => ({ ...c, pensionable: pensionable.has(c.code) })); // the pension rule says which allowances count
  const deductions = v.deductionAmount && v.deductionAmount > 0 ? [{ name: v.deductionName || "Other deduction", amount: v.deductionAmount }] : [];
  const problems = quickProblems({ monthlyGross: v.gross, components, otherDeductions: deductions });
  if (problems.length) throw new BusinessError(problems[0]);
  const slip = quickPayslip({ monthlyGross: v.gross, components, employeeRate: pension.employeeRate, employerRate: pension.employerRate, taxRule: tax.def, annualRent: v.annualRent ?? 0, otherDeductions: deductions });
  return {
    slip,
    organization: org.name,
    payDate,
    employeeName: v.employeeName || null,
    position: v.position || null,
    taxRule: `${tax.def.code}@${tax.def.version}`,
    pensionRule: pension.version,
    pensionRates: { employee: pension.employeeRate, employer: pension.employerRate },
    pensionableCodes: [...pensionable],
    otherPct: Math.max(0, otherPct),
    structure: chosen?.name ?? null,
  };
}
