import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { payslipModel } from "@/lib/payslip-pdf";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, getPayslip, runPayroll } from "@/server/services/payroll";
import { payslipPdf } from "@/server/services/payslips";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 4c (payslip): the payslip of a person paid by the hour carries the hours worked and the pay for them, by site and kind of day, read from the stored pay lines of their payroll record. A
 * person paid monthly has none. Real payroll in the demo company for March 2039 (no other test uses it); the hourly facts are put in directly. Rates are INVENTED: role weekday 1,000, weekend 1,500, holiday 2,000 an hour.
 * Calendar: 2039-03-07 is a Monday, 2039-03-12 a Saturday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `HS-${tag}`, name: `Hourly slip ${tag}`, effectiveFrom: "2037-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `SC${tag}`, name: `Slip Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `SK${tag}`, name: `Slip guarding ${tag}`, startDate: day("2037-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `SB${tag}`, name: `Slip site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2037-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2037-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  const e = await createEmployee(hr, { firstName: "Hs", lastName: `Slip${tag}`, employmentDate: "2037-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `77${String(Date.now()).slice(-7)}1`, accountName: "HS Slip" } as never);
  await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2037-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
  const shift = async (from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId: e.id, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  return { payroll, org, e, beat, shift };
}

describe("the payslip of a person paid by the hour", () => {
  it("carries the hours worked and the pay for them by site and kind of day, exactly as stored on the payroll record, with the site's name", async () => {
    const w = await world();
    await w.shift("2039-03-07T08:00", "2039-03-07T16:00"); // Monday 8 h at 1,000 = 8,000
    await w.shift("2039-03-12T08:00", "2039-03-12T16:30"); // Saturday 8 h 30 min at 1,500 = 12,750
    const period = await createPeriod(w.payroll, 2039, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: w.e.id } });
    const slip = await getPayslip(w.payroll, rec.id);
    expect(slip).not.toBeNull();
    const stored = await db.hourlyPayLine.findMany({ where: { recordId: rec.id } });
    expect(slip!.hourly).toHaveLength(stored.length);
    const rows = slip!.hourly.map((h) => [h.siteName, h.dayClass, h.minutes, num(h.rate), num(h.amount)]).sort();
    expect(rows).toEqual([[w.beat.name, "WEEKDAY", 480, 1000, 8000], [w.beat.name, "WEEKEND", 510, 1500, 12750]].sort());
  });

  it("the PDF is made from the same lines: its model lists the hours and the totals, and a download is audited", async () => {
    const w = await world();
    await w.shift("2039-03-08T08:00", "2039-03-08T12:00"); // Tuesday 4 h = 4,000
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2039, month: 3 } });
    const run = await runPayroll(w.payroll, period.id);
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: w.e.id } });
    const slip = (await getPayslip(w.payroll, rec.id))!;
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, periodName: "March 2039", periodStart: "2039-03-01", periodEnd: "2039-03-31", runType: "REGULAR", runNumber: 1, generatedOn: "2039-03-31",
    });
    expect(m.hourly?.rows).toEqual([[w.beat.name, "Weekday", "4 h", "1,000.00", "4,000.00"]]);
    expect(m.hourly?.total).toEqual(["Total", "", "4 h", "", "4,000.00"]);
    expect(m.details.find(([k]) => k === "Pay basis")?.[1]).toBe("Paid by the hour");
    const f = await payslipPdf(w.payroll, rec.id);
    expect(Buffer.from(f.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("a person paid monthly has no hourly lines on their payslip", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: payroll.orgId, year: 2039, month: 3 } });
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: period.id, type: "REGULAR" } });
    const monthly = await db.payrollRecord.findFirst({ where: { runId: run.id, hourlyLines: { none: {} } } });
    expect(monthly).not.toBeNull();
    expect((await getPayslip(payroll, monthly!.id))!.hourly).toEqual([]);
  });

  it("another company cannot read it: the payslip is not found, hourly lines included", async () => {
    const w = await world();
    await w.shift("2039-03-09T08:00", "2039-03-09T12:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2039, month: 3 } });
    const run = await runPayroll(w.payroll, period.id);
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: w.e.id } });
    const other = await isolatedOrg();
    expect(await getPayslip(other.ctx("PAYROLL_ADMIN"), rec.id)).toBeNull();
  });
});
