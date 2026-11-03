import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { d, eachDay, iso } from "@/lib/dates";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { FOUNDER_FILING_DEFAULTS } from "@/lib/paye-dates";
import { addContractRate, createBeat, createClient, createContract } from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee } from "@/server/services/employees";
import { deployEmployee, recordAttendance } from "@/server/services/operations";
import { approveRun, createPeriod, runPayroll, submitForApproval } from "@/server/services/payroll";
import { copyStatutoryRules, createPayrollRule, payrollRuleFor } from "@/server/services/statutory";
import { ctxFor, explainVariances, isolatedOrg, uid } from "../helpers";

/**
 * The open decisions were given DEFAULTS that can be edited, not hard-coded. Everything here is invented.
 * (1) A missing state of residence warns by default; a payroll rule can make it block approval. (2) The PAYE filing dates start from the founder's own
 * values, flagged as not verified by the tax adviser. (Who is told about the audit log is in audit-alert-recipients.test.ts.)
 */
const rule = (over: Record<string, unknown> = {}) => ({
  version: `v${uid()}`, prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5,
  maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15, effectiveFrom: "2027-01-01", ...over,
});
async function person(orgId: string, role: Ctx["role"]): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `p.${uid()}${uid()}@defaults.test`.toLowerCase(), name: `Person ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

describe("'a state of residence is required' on the payroll rule", () => {
  it("is off unless switched on, is stored with the rule version, is read back by the payroll, and is copied to a new organization", async () => {
    const t = await isolatedOrg();
    const admin = await person(t.org.id, "COMPANY_ADMIN");
    const plain = await createPayrollRule(admin, rule() as never);
    expect(plain.requirePayeState).toBe(false);
    const strict = await createPayrollRule(admin, rule({ effectiveFrom: "2028-01-01", requirePayeState: true }) as never);
    expect(strict.requirePayeState).toBe(true);
    expect((await payrollRuleFor(db, t.org.id, d("2027-06-01"))).requirePayeState).toBe(false);
    expect((await payrollRuleFor(db, t.org.id, d("2028-06-01"))).requirePayeState).toBe(true);
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => r.requirePayeState)).toEqual([false, true]);
  });

  it("makes a worker with PAYE and no state a CRITICAL finding that blocks approval until fixed or overridden, instead of a warning", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const hr = await ctxFor("HR_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: admin.orgId, code: "GUARD" } });
    const client = await createClient(admin, { name: `Strict Client ${tag}` });
    const structure = await createStructure(payroll, {
      code: `SR-${tag}`, name: `Strict Structure ${tag}`, effectiveFrom: "2027-01-01", activate: true,
      components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
    });
    const contract = await createContract(admin, { clientId: client.id, name: "Strict Staff 2027", startDate: "2027-01-01", defaultStructureId: structure.id, operativeSharePct: 70 });
    await addContractRate(admin, { contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 300000, effectiveFrom: "2027-01-01" });
    const beat = await createBeat(admin, { contractId: contract.id, name: `Strict Site ${tag}`, approvedStrength: 2 });
    const mk = async (label: string, state?: string) => {
      const e = await createEmployee(hr, { firstName: "Strict", lastName: `${label}${tag}`, employmentDate: "2027-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `73${String(Date.now()).slice(-8)}`, accountName: `STRICT ${label} ${tag}`, taxId: `TIN${label}${tag}`, ...(state ? { stateOfResidence: state } : {}) });
      await deployEmployee(ops, { employeeId: e.id, beatId: beat.id, startDate: "2027-10-01" });
      await recordAttendance(ops, eachDay(d("2027-10-01"), d("2027-10-31")).map((dt) => ({ employeeId: e.id, beatId: beat.id, date: iso(dt), status: "PRESENT" as const })));
      return e;
    };
    const withState = await mk("Has", "Lagos");
    const without = await mk("None");
    const period = await createPeriod(payroll, 2027, 10);
    const issueFor = (runId: string, empId: string) => db.payrollValidationIssue.findFirst({ where: { runId, employeeId: empId, code: "STATE_MISSING" } });

    // as shipped: a warning, and the payroll can be approved
    const warn = await runPayroll(payroll, period.id);
    expect((await issueFor(warn.id, without.id))?.severity).toBe("WARNING");
    expect(await issueFor(warn.id, withState.id)).toBeNull();

    // switched on in the payroll rule (a setting, not code): the same finding is critical
    const open = await db.payrollRule.findFirstOrThrow({ where: { organizationId: payroll.orgId, effectiveTo: null } });
    await db.payrollRule.update({ where: { id: open.id }, data: { requirePayeState: true } });
    try {
      const strict = await runPayroll(payroll, period.id);
      const issue = await issueFor(strict.id, without.id);
      expect(issue?.severity).toBe("CRITICAL");
      expect(issue?.message).toMatch(/state of residence/i);
      expect(await issueFor(strict.id, withState.id)).toBeNull();
      await explainVariances(payroll, strict.id);
      await submitForApproval(payroll, strict.id);
      await expect(approveRun(fin, strict.id)).rejects.toThrow(/critical validation error/);

      // fixing the worker's state and recalculating clears it; the rule is read at calculation, so nothing else changed
      await db.employee.update({ where: { id: without.id }, data: { stateOfResidence: "Ogun" } });
      expect(await db.payrollRun.findUniqueOrThrow({ where: { id: strict.id } })).toMatchObject({ status: "PENDING_APPROVAL" });
    } finally {
      await db.payrollRule.update({ where: { id: open.id }, data: { requirePayeState: false } });
    }
  });
});

describe("the PAYE filing dates start from the founder's own values", () => {
  it("are on the seeded tax rule, as tax rule data that can be edited by creating a new version, and are the values in the founder's PAYE seed file", async () => {
    const ctx = await ctxFor("COMPANY_ADMIN");
    const seeded = await db.taxRule.findFirstOrThrow({ where: { organizationId: ctx.orgId, active: true }, orderBy: { effectiveFrom: "desc" } });
    expect(seeded).toMatchObject({ payeDueDay: FOUNDER_FILING_DEFAULTS.dueDay, annualReturnMonth: FOUNDER_FILING_DEFAULTS.annualReturnMonth, annualReturnDay: FOUNDER_FILING_DEFAULTS.annualReturnDay });
    expect(Number(seeded.latePenaltyPct)).toBe(FOUNDER_FILING_DEFAULTS.latePenaltyPct);
  });
});
