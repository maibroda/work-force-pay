import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { d, eachDay, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { addContractRate, createBeat, createClient, createContract } from "@/server/services/clients";
import { createEmployee } from "@/server/services/employees";
import { addHoliday, confirmHolidayYear, listHolidays, removeHoliday } from "@/server/services/holidays";
import { applyForLeave, decideLeave, updateLeavePolicy } from "@/server/services/leave";
import { deployEmployee, recordAttendance } from "@/server/services/operations";
import { approveBasis, cancelBasis, listBases, proposeBasis, rejectBasis } from "@/server/services/pay-basis";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * The paid-days basis agreed with each client, set on the contract (the founder, 2026-11-05; docs/plans/paid-days-basis.md and founder-decisions-2026-11-05.md), and UNPAID leave. A contract
 * is paid on the days in the month (calendar) or on the working days in it (Monday to Friday by default), optionally without the confirmed public holidays; a contract with no setting keeps the
 * company's rule exactly. A change is PROPOSED and approved by a second person (the payroll manager), takes effect from the first day of a pay month, and never changes pay while pending.
 * Unpaid leave is a leave request that is not paid: its working days are not paid days, and it does not use up the annual-leave entitlement. Everything here is invented.
 */
const person = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });
const isWeekend = (x: Date) => x.getUTCDay() === 0 || x.getUTCDay() === 6;
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06); // each earnings line is rounded to the kobo (nine lines)
const ask = (contractId: string, over: Record<string, unknown> = {}) => ({ contractId, basis: "WORKING_DAYS" as const, effectiveFrom: "2029-03-01", reason: "Agreed with the client", ...over });

async function contractIn(orgId: string, role: Role = "COMPANY_ADMIN") {
  const admin = person(orgId, role);
  const client = await createClient(admin, { name: `Client ${uid()}` });
  return createContract(admin, { clientId: client.id, name: "Guarding", startDate: "2026-01-01" });
}

describe("proposing and approving a contract's paid-days basis", () => {
  it("is proposed by those who manage clients and approved by the payroll manager (a second person); nobody else may do either", async () => {
    const t = await isolatedOrg();
    const k = await contractIn(t.org.id);
    for (const r of ["AUDITOR", "SUPERVISOR", "EMPLOYEE"] as Role[]) await expect(proposeBasis(person(t.org.id, r), ask(k.id)), r).rejects.toThrow(/permission/);
    const p = await proposeBasis(person(t.org.id, "COMPANY_ADMIN", 1), ask(k.id));
    expect(p).toMatchObject({ status: "PENDING", basis: "WORKING_DAYS", excludePublicHolidays: false });
    await expect(approveBasis(person(t.org.id, "HR_ADMIN"), p.id)).rejects.toThrow(/permission/); // HR does not hold the approval permission
    await expect(approveBasis(person(t.org.id, "COMPANY_ADMIN", 1), p.id)).rejects.toThrow(/someone else/i); // not the person who proposed it
    await expect(approveBasis(person(t.org.id, "PAYROLL_ADMIN"), p.id)).resolves.toMatchObject({ status: "APPROVED" });
    await expect(approveBasis(person(t.org.id, "PAYROLL_ADMIN"), p.id)).rejects.toThrow(/already approved/i);
  });

  it("takes effect only from the first day of a pay month, and holds to the rules on what may be set", async () => {
    const t = await isolatedOrg();
    const k = await contractIn(t.org.id);
    const who = person(t.org.id, "COMPANY_ADMIN");
    await expect(proposeBasis(who, ask(k.id, { effectiveFrom: "2029-03-15" }))).rejects.toThrow(/first day of a month/i);
    await expect(proposeBasis(who, ask(k.id, { effectiveFrom: "soon" }))).rejects.toThrow(/date/i);
    await expect(proposeBasis(who, ask(k.id, { reason: "x" }))).rejects.toThrow(/reason/i);
    await expect(proposeBasis(who, ask(k.id, { basis: "FORTNIGHTLY" as never }))).rejects.toThrow(/basis/i);
    await expect(proposeBasis(who, ask(k.id, { workingDaysPerWeek: 4 }))).rejects.toThrow(/working week/i);
    await expect(proposeBasis(who, ask(k.id, { basis: "CALENDAR_DAYS", workingDaysPerWeek: 6 }))).rejects.toThrow(/working-days basis/i);
    await expect(proposeBasis(who, ask(k.id, { basis: "CALENDAR_DAYS", excludePublicHolidays: true }))).rejects.toThrow(/working-days basis/i);
    await expect(proposeBasis(who, ask("nope"))).rejects.toThrow(/contract.*not found/i);
    const ok = await proposeBasis(who, ask(k.id, { workingDaysPerWeek: 6, excludePublicHolidays: true }));
    expect(ok).toMatchObject({ workingDaysPerWeek: 6, excludePublicHolidays: true });
    await expect(proposeBasis(who, ask(k.id, { effectiveFrom: "2029-04-01" }))).rejects.toThrow(/already a pending/i);
  });

  it("closes the previous setting the day before when approved, keeps the history, and refuses one that would start on or before an existing one; reject needs a reason; the proposer may withdraw", async () => {
    const t = await isolatedOrg();
    const k = await contractIn(t.org.id);
    const who = person(t.org.id, "COMPANY_ADMIN");
    const mgr = person(t.org.id, "PAYROLL_ADMIN");
    const first = await proposeBasis(who, ask(k.id, { basis: "CALENDAR_DAYS", effectiveFrom: "2029-01-01" }));
    await approveBasis(mgr, first.id);
    const second = await proposeBasis(who, ask(k.id, { effectiveFrom: "2029-03-01" }));
    await approveBasis(mgr, second.id);
    const rows = await listBases(who, k.id);
    expect(rows.filter((r) => r.status === "APPROVED").map((r) => [r.basis, iso(r.effectiveFrom), r.effectiveTo ? iso(r.effectiveTo) : null]).sort()).toEqual([["CALENDAR_DAYS", "2029-01-01", "2029-02-28"], ["WORKING_DAYS", "2029-03-01", null]]);
    const early = await proposeBasis(who, ask(k.id, { effectiveFrom: "2029-02-01" }));
    await expect(approveBasis(mgr, early.id)).rejects.toThrow(/already starts/i);
    expect((await db.contractPayBasis.findUniqueOrThrow({ where: { id: early.id } })).status).toBe("PENDING");
    await expect(rejectBasis(mgr, early.id, " ")).rejects.toThrow(/reason/i);
    await rejectBasis(mgr, early.id, "Not what the client agreed");
    const w = await proposeBasis(who, ask(k.id, { effectiveFrom: "2029-06-01" }));
    await expect(cancelBasis(person(t.org.id, "COMPANY_ADMIN", 2), w.id)).rejects.toThrow(/your own/i);
    await expect(cancelBasis(who, w.id)).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("is audited by ids and field names, and another company cannot see or change it (not found)", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const k = await contractIn(a.org.id);
    const p = await proposeBasis(person(a.org.id, "COMPANY_ADMIN"), ask(k.id));
    await approveBasis(person(a.org.id, "PAYROLL_ADMIN"), p.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: a.org.id, entityId: p.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["PAY_BASIS_PROPOSED", "PAY_BASIS_APPROVED"]);
    expect(rows[0].newValue).toMatchObject({ contractId: k.id, fields: expect.arrayContaining(["basis", "effectiveFrom"]) });
    await expect(approveBasis(person(b.org.id, "PAYROLL_ADMIN"), p.id)).rejects.toThrow(/not found/i);
    await expect(listBases(person(b.org.id, "COMPANY_ADMIN"), k.id)).resolves.toEqual([]);
    await expect(proposeBasis(person(b.org.id, "COMPANY_ADMIN"), ask(k.id))).rejects.toThrow(/contract.*not found/i);
  });
});

describe("the company's public holidays", () => {
  it("are entered by date and name (one per date), listed by year, removed, and each year is confirmed by the payroll manager; editing a confirmed year un-confirms it", async () => {
    const t = await isolatedOrg();
    const ops = person(t.org.id, "PAYROLL_ADMIN", 1);
    await expect(addHoliday(person(t.org.id, "AUDITOR"), { date: "2029-01-01", name: "New Year" })).rejects.toThrow(/permission/);
    const h = await addHoliday(ops, { date: "2029-01-01", name: "New Year's Day" });
    await addHoliday(ops, { date: "2029-12-25", name: "Christmas Day" });
    await expect(addHoliday(ops, { date: "2029-01-01", name: "Again" })).rejects.toThrow(/already on the list/i);
    await expect(addHoliday(ops, { date: "soon", name: "x" })).rejects.toThrow(/date/i);
    await expect(addHoliday(ops, { date: "2029-02-02", name: " " })).rejects.toThrow(/name/i);
    expect((await listHolidays(ops, 2029)).holidays.map((x) => iso(x.date))).toEqual(["2029-01-01", "2029-12-25"]);
    expect((await listHolidays(ops, 2029)).confirmed).toBeNull();
    await expect(confirmHolidayYear(person(t.org.id, "HR_ADMIN"), 2029)).rejects.toThrow(/permission/);
    await confirmHolidayYear(person(t.org.id, "COMPANY_ADMIN"), 2029);
    expect((await listHolidays(ops, 2029)).confirmed).toMatchObject({ year: 2029, confirmedBy: "COMPANY_ADMIN 1" });
    await removeHoliday(ops, h.id);
    expect((await listHolidays(ops, 2029)).confirmed).toBeNull(); // an edited year must be confirmed again
    const other = await isolatedOrg();
    await expect(removeHoliday(person(other.org.id, "PAYROLL_ADMIN"), h.id)).rejects.toThrow(/not found/i);
    expect((await listHolidays(person(other.org.id, "PAYROLL_ADMIN"), 2029)).holidays).toEqual([]);
  });
});

/** A guard company on the seeded demo organization (future months, uniquely named), as the other payroll tests do. */
async function world(tag: string, year: number, month: number) {
  const admin = await ctxFor("COMPANY_ADMIN");
  const hr = await ctxFor("HR_ADMIN");
  const ops = await ctxFor("OPERATIONS");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: admin.orgId, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `PD-${tag}`, name: `Paid days ${tag}`, effectiveFrom: "2029-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const makeContract = async (label: string) => {
    const client = await createClient(admin, { name: `PD ${label} ${tag}` });
    const contract = await createContract(admin, { clientId: client.id, name: `PD ${label} 2029`, startDate: "2029-01-01", defaultStructureId: structure.id, operativeSharePct: 70 });
    await addContractRate(admin, { contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 300000, effectiveFrom: "2029-01-01" }); // operative gross 210,000
    const beat = await createBeat(admin, { contractId: contract.id, name: `PD Site ${label} ${tag}`, approvedStrength: 5 });
    return { contract, beat };
  };
  const guard = async (label: string, k: { beat: { id: string } }, dates: Date[], from = `${year}-${String(month).padStart(2, "0")}-01`) => {
    const e = await createEmployee(hr, { firstName: "Pd", lastName: `${label}${tag}`, employmentDate: "2029-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `75${String(Date.now()).slice(-8)}`, accountName: `PD ${label} ${tag}`, taxId: `TIN${label}${tag}`, stateOfResidence: "Lagos" });
    await deployEmployee(ops, { employeeId: e.id, beatId: k.beat.id, startDate: from });
    await recordAttendance(ops, dates.map((dt) => ({ employeeId: e.id, beatId: k.beat.id, date: iso(dt), status: "PRESENT" as const })));
    return e;
  };
  const days = eachDay(d(`${year}-${String(month).padStart(2, "0")}-01`), d(iso(new Date(Date.UTC(year, month, 0)))));
  return { admin, hr, ops, payroll, cat, makeContract, guard, days, weekdays: days.filter((x) => !isWeekend(x)), weekends: days.filter(isWeekend), period: () => createPeriod(payroll, year, month) };
}
const grossOf = async (runId: string, employeeId: string) => num((await db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } })).earnedGross);

describe("a payroll run on the working-days basis (March 2029)", () => {
  it("pays the full gross to someone who works every working day, nothing extra for weekends, and a proportion for working days missed; changes nothing until approved", async () => {
    const tag = uid();
    const w = await world(tag, 2029, 3);
    const k = await w.makeContract("A");
    const everyDay = await w.guard("Every", k, w.days); // works all 31 days
    const weekdaysOnly = await w.guard("Weekdays", k, w.weekdays);
    const missed = await w.guard("Missed", k, [...w.weekdays.slice(0, w.weekdays.length - 2), ...w.weekends.slice(0, 4)]); // two working days missed, four weekend days worked
    const period = await w.period();
    const rule = await db.payrollRule.findFirstOrThrow({ where: { organizationId: w.payroll.orgId, effectiveTo: null } });
    const companyDays = rule.prorationBasis === "FIXED_30" ? 30 : 31;
    const WD = w.weekdays.length;

    // before any setting: the company's rule, exactly as before
    const before = await runPayroll(w.payroll, period.id);
    near(await grossOf(before.id, weekdaysOnly.id), (210000 * WD) / companyDays);
    near(await grossOf(before.id, everyDay.id), 210000);

    // a proposal changes nothing while pending
    const p = await proposeBasis(w.admin, { contractId: k.contract.id, basis: "WORKING_DAYS", effectiveFrom: "2029-03-01", reason: "Agreed with the client" });
    const pending = await runPayroll(w.payroll, period.id);
    near(await grossOf(pending.id, weekdaysOnly.id), (210000 * WD) / companyDays);

    // approved: working days
    await approveBasis(w.payroll, p.id);
    const after = await runPayroll(w.payroll, period.id);
    near(await grossOf(after.id, weekdaysOnly.id), 210000); // every working day: a full gross
    near(await grossOf(after.id, everyDay.id), 210000); // weekends add nothing: never more than one gross
    near(await grossOf(after.id, missed.id), (210000 * (WD - 2)) / WD); // weekend days do not make up for the missed working days
    expect((await db.payrollRecord.findFirstOrThrow({ where: { runId: after.id, employeeId: missed.id } })).basisDays).toBe(WD);
  });

  it("uses the contract's own working week when it sets one: Monday to Saturday", async () => {
    const tag = uid();
    const w = await world(tag, 2029, 4);
    const k = await w.makeContract("B");
    const sixDays = [...w.weekdays, ...w.days.filter((x) => x.getUTCDay() === 6)];
    const e = await w.guard("Six", k, sixDays.slice(0, sixDays.length - 3));
    const p = await proposeBasis(w.admin, { contractId: k.contract.id, basis: "WORKING_DAYS", workingDaysPerWeek: 6, effectiveFrom: "2029-04-01", reason: "Monday to Saturday client" });
    await approveBasis(w.payroll, p.id);
    const period = await w.period();
    const run = await runPayroll(w.payroll, period.id);
    near(await grossOf(run.id, e.id), (210000 * (sixDays.length - 3)) / sixDays.length);
    expect((await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: e.id } })).basisDays).toBe(sixDays.length);
  });
});

describe("public holidays on the working-days basis (May 2029)", () => {
  it("takes the confirmed holidays out of the working days, and BLOCKS the run (a critical finding) until the year is confirmed", async () => {
    const tag = uid();
    const w = await world(tag, 2029, 5);
    const k = await w.makeContract("C");
    const holiday = w.weekdays[8]; // a weekday in the middle of the month
    const e = await w.guard("Hol", k, w.weekdays.filter((x) => iso(x) !== iso(holiday))); // takes the holiday off, works every other working day
    const p = await proposeBasis(w.admin, { contractId: k.contract.id, basis: "WORKING_DAYS", excludePublicHolidays: true, effectiveFrom: "2029-05-01", reason: "Holidays are overtime" });
    await approveBasis(w.payroll, p.id);
    await addHoliday(w.payroll, { date: iso(holiday), name: `Test holiday ${tag}` });
    const period = await w.period();

    const unconfirmed = await runPayroll(w.payroll, period.id);
    const issues = await db.payrollValidationIssue.findMany({ where: { runId: unconfirmed.id, code: "HOLIDAYS_UNCONFIRMED" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "CRITICAL", employeeId: null });

    await confirmHolidayYear(w.admin, 2029);
    const confirmed = await runPayroll(w.payroll, period.id);
    expect(await db.payrollValidationIssue.count({ where: { runId: confirmed.id, code: "HOLIDAYS_UNCONFIRMED" } })).toBe(0);
    expect((await db.payrollRecord.findFirstOrThrow({ where: { runId: confirmed.id, employeeId: e.id } })).basisDays).toBe(w.weekdays.length - 1);
    near(await grossOf(confirmed.id, e.id), 210000); // works every working day that month, the holiday excluded: a full gross
    await db.publicHoliday.deleteMany({ where: { organizationId: w.payroll.orgId, name: `Test holiday ${tag}` } });
    await db.holidayCalendarYear.deleteMany({ where: { organizationId: w.payroll.orgId, year: 2029 } });
  });
});

describe("a person who worked on contracts with different bases in a month (June 2029)", () => {
  it("is flagged for review (a finding that needs an explanation) and paid on the company's rule, not on a guess", async () => {
    const tag = uid();
    const w = await world(tag, 2029, 6);
    const a = await w.makeContract("D1");
    const b = await w.makeContract("D2");
    const pa = await proposeBasis(w.admin, { contractId: a.contract.id, basis: "WORKING_DAYS", effectiveFrom: "2029-06-01", reason: "x agreed" });
    await approveBasis(w.payroll, pa.id);
    const half = Math.floor(w.weekdays.length / 2);
    const e = await w.guard("Mover", a, w.weekdays.slice(0, half));
    await deployEmployee(w.ops, { employeeId: e.id, beatId: b.beat.id, startDate: iso(w.weekdays[half]) });
    await recordAttendance(w.ops, w.weekdays.slice(half).map((dt) => ({ employeeId: e.id, beatId: b.beat.id, date: iso(dt), status: "PRESENT" as const })));
    const period = await w.period();
    const run = await runPayroll(w.payroll, period.id);
    const flagged = await db.payrollValidationIssue.findMany({ where: { runId: run.id, code: "BASIS_MIXED", employeeId: e.id } });
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ severity: "WARNING", requiresExplanation: true });
    // June has 30 days, so the company's rule (calendar or fixed 30) divides by 30 either way
    expect((await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: e.id } })).basisDays).toBe(30);
  });
});

describe("unpaid leave", () => {
  it("is a leave request that is not paid: it needs the policy to allow it, needs no entitlement, does not use up annual leave, and its working days are not paid days (July 2029)", async () => {
    const tag = uid();
    const w = await world(tag, 2029, 7);
    const k = await w.makeContract("E");
    const e = await w.guard("Unpaid", k, w.days);
    const unpaidDays = w.weekdays.slice(2, 7); // five working days
    await updateLeavePolicy(w.hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5, unpaidLeaveEnabled: false } as never);
    await expect(applyForLeave(w.hr, { employeeId: e.id, startDate: iso(unpaidDays[0]), endDate: iso(unpaidDays[4]), unpaid: true })).rejects.toThrow(/unpaid leave is not switched on/i);
    await updateLeavePolicy(w.hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5, unpaidLeaveEnabled: true } as never);
    const req = await applyForLeave(w.hr, { employeeId: e.id, startDate: iso(unpaidDays[0]), endDate: iso(unpaidDays[4]), unpaid: true });
    expect(req).toMatchObject({ unpaid: true, workingDays: 5, status: "PENDING" });
    const period = await w.period();
    const rule = await db.payrollRule.findFirstOrThrow({ where: { organizationId: w.payroll.orgId, effectiveTo: null } });
    const companyDays = rule.prorationBasis === "FIXED_30" ? 30 : 31;
    // pending: still paid in full
    near(await grossOf((await runPayroll(w.payroll, period.id)).id, e.id), 210000);
    await decideLeave(w.hr, req.id, "APPROVED", "Agreed");
    expect(await db.workRegister.count({ where: { organizationId: w.hr.orgId, employeeId: e.id, remarks: `Annual leave (request ${req.id})` } })).toBe(0); // no leave days are written
    const run = await runPayroll(w.payroll, period.id);
    near(await grossOf(run.id, e.id), (210000 * (31 - 5)) / companyDays); // the five working days are not paid, exactly as for absence
    // the annual-leave entitlement is untouched: the balance counts only paid leave
    const balances = await db.leaveRequest.findMany({ where: { organizationId: w.hr.orgId, employeeId: e.id, unpaid: false } });
    expect(balances).toHaveLength(0);
  });

  it("reduces the pay of a person on a personal pay rate (no work register) in the same way, and leaves the others alone", async () => {
    const tag = uid();
    const w = await world(tag, 2029, 3 + 4 + 1); // a month no other test in this file uses
    const e = await createEmployee(w.hr, { firstName: "Pd", lastName: `Office${tag}`, employmentDate: "2029-01-01", categoryId: w.cat.id, bankName: "GTBank", accountNumber: `76${String(Date.now()).slice(-8)}`, accountName: `PD Office ${tag}`, taxId: `TINO${tag}`, stateOfResidence: "Lagos" });
    const structure = await db.salaryStructure.findFirstOrThrow({ where: { organizationId: w.hr.orgId, code: `PD-${tag}` } });
    await db.employeePayRate.create({ data: { organizationId: w.hr.orgId, employeeId: e.id, monthlyGross: "200000", structureCode: structure.code, reason: "Office", approvedBy: "Someone", effectiveFrom: d("2029-01-01") } });
    const other = await createEmployee(w.hr, { firstName: "Pd", lastName: `Other${tag}`, employmentDate: "2029-01-01", categoryId: w.cat.id, bankName: "GTBank", accountNumber: `77${String(Date.now()).slice(-8)}`, accountName: `PD Other ${tag}`, taxId: `TINP${tag}`, stateOfResidence: "Lagos" });
    await db.employeePayRate.create({ data: { organizationId: w.hr.orgId, employeeId: other.id, monthlyGross: "200000", structureCode: structure.code, reason: "Office", approvedBy: "Someone", effectiveFrom: d("2029-01-01") } });
    const unpaid = w.weekdays.slice(0, 4);
    await updateLeavePolicy(w.hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5, unpaidLeaveEnabled: true } as never);
    const req = await applyForLeave(w.hr, { employeeId: e.id, startDate: iso(unpaid[0]), endDate: iso(unpaid[3]), unpaid: true });
    await decideLeave(w.hr, req.id, "APPROVED", "Agreed");
    const period = await w.period();
    const run = await runPayroll(w.payroll, period.id);
    const rule = await db.payrollRule.findFirstOrThrow({ where: { organizationId: w.payroll.orgId, effectiveTo: null } });
    const companyDays = rule.prorationBasis === "FIXED_30" ? 30 : w.days.length;
    near(await grossOf(run.id, e.id), (200000 * (w.days.length - 4)) / companyDays);
    near(await grossOf(run.id, other.id), 200000);
  });
});
