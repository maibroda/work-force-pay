import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";
import type { TaxRuleDef } from "@/lib/payroll/paye";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

/** The tax rule version effective on a date. Stored on every payroll run and record. */
export async function taxRuleFor(tx: Tx, orgId: string, date: Date) {
  const rule = await tx.taxRule.findFirst({
    where: {
      organizationId: orgId,
      active: true,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    include: { bands: { orderBy: { sortOrder: "asc" } }, reliefs: true, exemptions: true },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!rule) throw new BusinessError("No active PAYE tax rule is configured for this payroll date.");
  const def: TaxRuleDef = {
    code: rule.code,
    version: rule.version,
    bands: rule.bands.map((b) => ({
      lowerBound: num(b.lowerBound),
      upperBound: b.upperBound === null ? null : num(b.upperBound),
      rate: num(b.rate),
    })),
    reliefs: rule.reliefs.map((r) => ({
      code: r.code,
      name: r.name,
      type: r.type,
      rate: r.rate === null ? null : num(r.rate),
      amount: r.amount === null ? null : num(r.amount),
      cap: r.cap === null ? null : num(r.cap),
      active: r.active,
    })),
    exemptions: rule.exemptions.map((x) => ({
      code: x.code,
      description: x.description,
      annualGrossCeiling: num(x.annualGrossCeiling),
      active: x.active,
    })),
  };
  return { rule, def };
}

export async function pensionRuleFor(tx: Tx, orgId: string, date: Date) {
  const r = await tx.pensionRule.findFirst({
    where: {
      organizationId: orgId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!r) throw new BusinessError("No pension rule is configured for this payroll date.");
  return {
    rule: r,
    employeeRate: num(r.employeeRate),
    employerRate: num(r.employerRate),
    codes: r.pensionableCodes,
    version: r.version,
  };
}

export async function payrollRuleFor(tx: Tx, orgId: string, date: Date) {
  const r = await tx.payrollRule.findFirst({
    where: {
      organizationId: orgId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!r) throw new BusinessError("No payroll rule is configured for this payroll date.");
  return {
    rule: r,
    prorationBasis: r.prorationBasis,
    defaultOperativeSharePct: num(r.defaultOperativeSharePct),
    standardHoursPerDay: num(r.standardHoursPerDay),
    overtimeMultiplier: num(r.overtimeMultiplier),
    maxOvertimeHoursPerMonth: num(r.maxOvertimeHoursPerMonth),
    maxDeductionPctOfGross: num(r.maxDeductionPctOfGross),
    backOfficeChargePct: num(r.backOfficeChargePct),
  };
}

export async function employerCostRuleFor(tx: Tx, orgId: string, date: Date) {
  const r = await tx.employerCostRule.findFirst({
    where: {
      organizationId: orgId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!r)
    throw new BusinessError(
      "No employer cost rule (ITF / NSITF / insurance / …) is configured for this payroll date.",
    );
  return {
    rule: r,
    itfPct: num(r.itfPct),
    nsitfPct: num(r.nsitfPct),
    nhfMedicalPct: num(r.nhfMedicalPct),
    insurancePct: num(r.insurancePct),
    uniformKitsPct: num(r.uniformKitsPct),
    recruitmentTrainingPct: num(r.recruitmentTrainingPct),
    leaveRelieverPct: num(r.leaveRelieverPct),
    outsourcingLeaveAllowancePct: num(r.outsourcingLeaveAllowancePct),
    version: r.version,
  };
}

export async function listTaxRules(ctx: Ctx) {
  return db.taxRule.findMany({
    where: { organizationId: ctx.orgId },
    include: { bands: { orderBy: { sortOrder: "asc" } }, reliefs: true, exemptions: true },
    orderBy: { effectiveFrom: "desc" },
  });
}

export const taxRuleSchema = z.object({
  code: z.string().trim().min(2),
  name: z.string().trim().min(3),
  version: z.string().trim().min(1),
  legalBasis: z.string().optional(),
  effectiveFrom: z.string().min(10),
  bands: z
    .array(
      z.object({
        lowerBound: z.coerce.number().min(0),
        upperBound: z.coerce.number().positive().nullable(),
        rate: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1),
  reliefs: z.array(
    z.object({
      code: z.string().min(2),
      name: z.string().min(2),
      type: z.enum([
        "PERCENT_OF_GROSS",
        "FIXED_ANNUAL",
        "PERCENT_OF_RENT_CAPPED",
        "EMPLOYEE_PENSION",
        "NHF",
        "NHIS",
      ]),
      rate: z.coerce.number().nullable().optional(),
      amount: z.coerce.number().nullable().optional(),
      cap: z.coerce.number().nullable().optional(),
    }),
  ),
  exemptions: z.array(
    z.object({
      code: z.string().min(2),
      description: z.string().min(3),
      annualGrossCeiling: z.coerce.number().min(0),
    }),
  ),
});

/** Adds a NEW tax rule version; the previous version is end-dated, never edited. */
export async function createTaxRuleVersion(ctx: Ctx, raw: z.input<typeof taxRuleSchema>) {
  assertCan(ctx, "settings.manage");
  const v = taxRuleSchema.parse(raw);
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const open = await tx.taxRule.findMany({
      where: { organizationId: ctx.orgId, effectiveTo: null, active: true },
    });
    for (const r of open) {
      if (r.effectiveFrom >= from)
        throw new BusinessError("An open tax rule already starts on or after this date.");
      await tx.taxRule.update({
        where: { id: r.id },
        data: { effectiveTo: new Date(from.getTime() - 86400000) },
      });
    }
    const rule = await tx.taxRule.create({
      data: {
        organizationId: ctx.orgId,
        code: v.code,
        name: v.name,
        version: v.version,
        legalBasis: v.legalBasis,
        effectiveFrom: from,
        bands: {
          create: v.bands.map((b, i) => ({
            sortOrder: i + 1,
            lowerBound: b.lowerBound,
            upperBound: b.upperBound,
            rate: b.rate,
          })),
        },
        reliefs: {
          create: v.reliefs.map((r) => ({
            code: r.code,
            name: r.name,
            type: r.type,
            rate: r.rate ?? null,
            amount: r.amount ?? null,
            cap: r.cap ?? null,
          })),
        },
        exemptions: { create: v.exemptions },
      },
    });
    await logAudit(
      ctx,
      {
        action: "TAX_CONFIGURATION_CHANGE",
        entity: "TaxRule",
        entityId: rule.id,
        oldValue: open.map((o) => ({ id: o.id, version: o.version })),
        newValue: v,
      },
      tx,
    );
    return rule;
  });
}

export async function listPensionRules(ctx: Ctx) {
  return db.pensionRule.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { effectiveFrom: "desc" },
  });
}

export const pensionRuleSchema = z.object({
  version: z.string().min(1),
  employeeRate: z.coerce.number().min(0).max(100),
  employerRate: z.coerce.number().min(0).max(100),
  pensionableCodes: z.array(z.string().min(2)).min(1),
  effectiveFrom: z.string().min(10),
});

export async function createPensionRule(ctx: Ctx, raw: z.input<typeof pensionRuleSchema>) {
  assertCan(ctx, "settings.manage");
  const v = pensionRuleSchema.parse(raw);
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const open = await tx.pensionRule.findMany({ where: { organizationId: ctx.orgId, effectiveTo: null } });
    for (const r of open) {
      if (r.effectiveFrom >= from)
        throw new BusinessError("An open pension rule already starts on or after this date.");
      await tx.pensionRule.update({
        where: { id: r.id },
        data: { effectiveTo: new Date(from.getTime() - 86400000) },
      });
    }
    const rule = await tx.pensionRule.create({
      data: {
        organizationId: ctx.orgId,
        version: v.version,
        employeeRate: v.employeeRate,
        employerRate: v.employerRate,
        pensionableCodes: v.pensionableCodes.map((c) => c.toUpperCase()),
        effectiveFrom: from,
      },
    });
    await logAudit(
      ctx,
      {
        action: "PENSION_CONFIGURATION_CHANGE",
        entity: "PensionRule",
        entityId: rule.id,
        oldValue: open,
        newValue: rule,
      },
      tx,
    );
    return rule;
  });
}

export async function listPayrollRules(ctx: Ctx) {
  return db.payrollRule.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { effectiveFrom: "desc" },
  });
}

export const payrollRuleSchema = z.object({
  version: z.string().min(1),
  prorationBasis: z.enum(["CALENDAR_DAYS", "FIXED_30"]),
  defaultOperativeSharePct: z.coerce.number().min(1).max(100),
  standardHoursPerDay: z.coerce.number().min(1).max(24),
  overtimeMultiplier: z.coerce.number().min(1).max(5),
  maxOvertimeHoursPerMonth: z.coerce.number().min(0),
  maxDeductionPctOfGross: z.coerce.number().min(0).max(100),
  backOfficeChargePct: z.coerce.number().min(0).max(100).default(15),
  effectiveFrom: z.string().min(10),
});

export async function createPayrollRule(ctx: Ctx, raw: z.input<typeof payrollRuleSchema>) {
  assertCan(ctx, "settings.manage");
  const v = payrollRuleSchema.parse(raw);
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const open = await tx.payrollRule.findMany({ where: { organizationId: ctx.orgId, effectiveTo: null } });
    for (const r of open) {
      if (r.effectiveFrom >= from)
        throw new BusinessError("An open payroll rule already starts on or after this date.");
      await tx.payrollRule.update({
        where: { id: r.id },
        data: { effectiveTo: new Date(from.getTime() - 86400000) },
      });
    }
    const rule = await tx.payrollRule.create({
      data: { organizationId: ctx.orgId, ...v, effectiveFrom: from },
    });
    await logAudit(
      ctx,
      {
        action: "PAYROLL_RULE_CHANGE",
        entity: "PayrollRule",
        entityId: rule.id,
        oldValue: open,
        newValue: rule,
      },
      tx,
    );
    return rule;
  });
}

export async function listEmployerCostRules(ctx: Ctx) {
  return db.employerCostRule.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { effectiveFrom: "desc" },
  });
}

export const employerCostRuleSchema = z.object({
  version: z.string().min(1),
  itfPct: z.coerce.number().min(0).max(100),
  nsitfPct: z.coerce.number().min(0).max(100),
  nhfMedicalPct: z.coerce.number().min(0).max(100).default(0),
  insurancePct: z.coerce.number().min(0).max(100),
  uniformKitsPct: z.coerce.number().min(0).max(100),
  recruitmentTrainingPct: z.coerce.number().min(0).max(100),
  leaveRelieverPct: z.coerce.number().min(0).max(100),
  outsourcingLeaveAllowancePct: z.coerce.number().min(0).max(100),
  effectiveFrom: z.string().min(10),
});

/** Adds a NEW employer-cost rule version; the previous open version is end-dated, never edited. */
export async function createEmployerCostRule(ctx: Ctx, raw: z.input<typeof employerCostRuleSchema>) {
  assertCan(ctx, "settings.manage");
  const v = employerCostRuleSchema.parse(raw);
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const open = await tx.employerCostRule.findMany({
      where: { organizationId: ctx.orgId, effectiveTo: null },
    });
    for (const r of open) {
      if (r.effectiveFrom >= from)
        throw new BusinessError("An open employer cost rule already starts on or after this date.");
      await tx.employerCostRule.update({
        where: { id: r.id },
        data: { effectiveTo: new Date(from.getTime() - 86400000) },
      });
    }
    const rule = await tx.employerCostRule.create({
      data: { organizationId: ctx.orgId, ...v, effectiveFrom: from },
    });
    await logAudit(
      ctx,
      {
        action: "EMPLOYER_COST_RULE_CHANGE",
        entity: "EmployerCostRule",
        entityId: rule.id,
        oldValue: open,
        newValue: rule,
      },
      tx,
    );
    return rule;
  });
}
