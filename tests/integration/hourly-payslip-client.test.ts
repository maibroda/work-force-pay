import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { payslipModel } from "@/lib/payslip-pdf";
import { addContractRateRecord, contractRateSchema } from "@/server/services/clients";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, getPayslip, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Payslip, the client's name (the founder's confirmed decision of 2026-11-21): the payslip of a person paid by the hour names the client of each place they worked (the Site column reads 'Client - Site' and a Client / Clients detail lists them),
 * as it was WHEN THE PAYROLL WAS CALCULATED: each stored hours line and extra pay line keeps the client's and the site's name, so renaming a client later never changes a payslip already made; a line from an older payroll with no stored
 * name shows the current names. Only the NAME is shown, never what the client is charged. Real payrolls in the demo company for March 2061 (no other test uses 2061). Calendar: 2061-03-07, 2061-03-08 and 2061-03-14 are Monday, Tuesday and Monday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);

async function world(opts: { leavePct?: string | null; tag?: string } = {}) {
  const tag = opts.tag ?? uid();
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `CP-${tag}`, name: `Contract pct ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `CQ${tag}`, name: `Contract pct Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `CQK${tag}`, name: `Contract pct guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `CQB${tag}`, name: `Contract pct site ${tag}`, state: "Lagos" } });
  const rate = await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01"), ...(opts.leavePct === undefined ? {} : { hourlyLeavePct: opts.leavePct }) } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2", decidedAt: new Date() } });
  let n = 0;
  const person = async (label: string, employmentDate = "2040-01-01") => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Cp", lastName: `${label}${tag}`, employmentDate, categoryId: cat.id, bankName: "GTBank", accountNumber: `74${String(Date.now()).slice(-7)}${n}`, accountName: `CP ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2", decidedAt: new Date() } });
    return e;
  };
  /** An approved shift at this world's site, or at another world's site (`at`). */
  const shift = async (employeeId: string, from: string, to: string, at: { clientId: string; contractId: string; beatId: string } = { clientId: client.id, contractId: contract.id, beatId: beat.id }) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, ...at, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  const site = { clientId: client.id, contractId: contract.id, beatId: beat.id };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const allowances = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId } });
  /** Sets a new rate row through the same service the screen uses (closes the old one the day before). */
  const setRate = (input: Record<string, unknown>) =>
    db.$transaction((tx) => addContractRateRecord(payroll, tx, contractRateSchema.parse({ contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 200000, ...input })));
  return { payroll, org, cat, contract, rate, person, shift, site, record, allowances, setRate, beat, tag };
}


const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

describe("the payslip names the client, as it was when the payroll was calculated", () => {
  it("each hours line and each extra pay line stores the client's name and the site's name; the payslip shows both clients of the month", async () => {
    const a = await world({ leavePct: "5" }); // leave pay of 5% on this contract
    const b = await world({ leavePct: null });
    const clientA = await db.client.findUniqueOrThrow({ where: { id: a.site.clientId } });
    const clientB = await db.client.findUniqueOrThrow({ where: { id: b.site.clientId } });
    const e = await a.person("Two");
    await a.shift(e.id, "2061-03-07T08:00", "2061-03-07T18:00"); // Monday at the first client's site
    await a.shift(e.id, "2061-03-14T08:00", "2061-03-14T18:00", b.site); // Monday at the second client's site
    const run = await runPayroll(a.payroll, (await periodOf(a.org, a.payroll, 2061, 3)).id);
    const rec = await a.record(run.id, e.id);
    const lines = await db.hourlyPayLine.findMany({ where: { recordId: rec.id } });
    expect(lines.map((l) => [l.clientName, l.siteName].join(" / ")).sort()).toEqual([[clientA.name, a.beat.name].join(" / "), [clientB.name, b.beat.name].join(" / ")].sort());
    const allowanceLines = await a.allowances(rec.id);
    expect(allowanceLines).toHaveLength(1); // the first contract's 5% leave pay
    expect([allowanceLines[0].clientName, allowanceLines[0].siteName]).toEqual([clientA.name, a.beat.name]);
    const slip = (await getPayslip(a.payroll, rec.id))!;
    expect(slip.hourly.map((l) => l.clientName).sort()).toEqual([clientA.name, clientB.name].sort());
    expect(slip.hourlyAllowances[0].clientName).toBe(clientA.name);
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, allowances: slip.hourlyAllowances, periodName: "March 2061", periodStart: "2061-03-01", periodEnd: "2061-03-31", runType: "REGULAR", runNumber: 1, generatedOn: "2061-03-31",
    });
    expect((m.details.find(([k]) => k === "Clients")?.[1] ?? "").split("; ").sort()).toEqual([clientA.name, clientB.name].sort()); // each once
    expect(JSON.stringify(m)).not.toMatch(/200000|agreedRate/); // the contract's agreed rate is not on the payslip
  });

  it("renaming the client or the site afterwards does not change a payslip already calculated; a line with no stored name (an older payroll) shows the current names", async () => {
    const a = await world();
    const e = await a.person("Renamed");
    await a.shift(e.id, "2061-03-08T08:00", "2061-03-08T18:00");
    const run = await runPayroll(a.payroll, (await periodOf(a.org, a.payroll, 2061, 3)).id);
    const rec = await a.record(run.id, e.id);
    const before = await db.client.findUniqueOrThrow({ where: { id: a.site.clientId } });
    const beatBefore = a.beat.name;
    await db.client.update({ where: { id: a.site.clientId }, data: { name: `Renamed ${before.name}` } });
    await db.beat.update({ where: { id: a.beat.id }, data: { name: `Renamed ${beatBefore}` } });
    const slip = (await getPayslip(a.payroll, rec.id))!;
    expect([slip.hourly[0].clientName, slip.hourly[0].siteName]).toEqual([before.name, beatBefore]); // the names of the day it was calculated
    // an older line, made before the names were kept, falls back to the current names
    await db.hourlyPayLine.updateMany({ where: { recordId: rec.id }, data: { clientName: null, siteName: null } });
    const older = (await getPayslip(a.payroll, rec.id))!;
    expect([older.hourly[0].clientName, older.hourly[0].siteName]).toEqual([`Renamed ${before.name}`, `Renamed ${beatBefore}`]);
  });
});
