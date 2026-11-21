import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { copyStatutoryRules } from "@/server/services/statutory";
import { createStructure } from "@/server/services/structures";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 4c (performance, the project's rule 12): payroll for 3,000 workers must complete in 10 minutes or less. This is the plan's test, run in CI and not only on a laptop: 3,000 people paid by the
 * hour, about 30 approved shifts each in one month (89,100 shifts, as many paid pieces), across 20 sites of two clients, in a company of their own, through the real pay run. It checks that the pay run finishes
 * inside the limit, then that a recalculation (which replaces everything the first one stored) does too, and that the pay is right for every one of the 3,000: nothing lost, nothing paid twice, nothing blocking.
 *
 * H14 piece 4: it now runs with ALL the extra pay on, so the history reads of the sick pay and the holiday pay are measured inside the same limit. Every person has been in service since 2040 (past the 12 months), the
 * payroll rule's leave percentage is 10 (a test figure) and the company has 5 paid sick days. March 2041 has 31 days. 2,700 people work the first 30 days (8 hours a day); 300 people (every tenth) work the first 27, and
 * have an approved spell of sickness on Thursday 28 and Friday 29 March. Sunday 31 March is a national public holiday that nobody works. So every person gets: the pay for their hours, the 10% leave pay on it, and
 * the holiday pay (8 hours at 1,000 for the day not worked); the 300 also get 2 paid sick days (8 hours at 1,000 each). The expected pay of each group is worked out here, independently of the pay run.
 * Rates are INVENTED: weekday 1,000, weekend 1,500 an hour.
 * The measured times are printed in the test log (on the error stream) and, when the environment variable WFP_PERF_REPORT names a file, appended to it, so a slowdown can be seen long before it nears the limit.
 */
const PEOPLE = 3_000;
const SICK_EVERY = 10; // every tenth person has the spell: 300 people
const LIMIT_MS = 10 * 60 * 1000;
const YEAR = 2041;
const MONTH = 3; // March: 31 days
const FULL_DAYS = 30; // the first 30 days worked by most
const SICK_PERSON_DAYS = 27; // the first 27 days worked by the 300 who are then ill on the 28th and 29th
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const chunks = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const dateOf = (d: number) => `${YEAR}-${String(MONTH).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const isWeekend = (d: number) => [0, 6].includes(new Date(`${dateOf(d)}T00:00:00Z`).getUTCDay());
/** The pay for 8-hour shifts on days 1 to `last` of the month, in whole naira: weekdays at 1,000 an hour, weekends at 1,500. */
const hoursPay = (last: number) => Array.from({ length: last }, (_, i) => i + 1).reduce((a, d) => a + (isWeekend(d) ? 12_000 : 8_000), 0);
const report = (line: string) => {
  console.error(line);
  if (process.env.WFP_PERF_REPORT) appendFileSync(process.env.WFP_PERF_REPORT, `${line}\n`);
};

let orgId: string;
let ctx: Parameters<typeof runPayroll>[0];
let idsFull: string[] = [];
let idsSick: string[] = [];
let totalShifts = 0;
// what each group is paid, in whole naira: its hours, 10% leave pay on them, the holiday not worked (8,000), and for the 300 two sick days (2 x 8,000)
const expectedFull = hoursPay(FULL_DAYS) * 1.1 + 8_000;
const expectedSick = hoursPay(SICK_PERSON_DAYS) * 1.1 + 8_000 + 2 * 8_000;

beforeAll(async () => {
  const t = await isolatedOrg();
  orgId = t.org.id;
  const user = await db.user.create({ data: { organizationId: orgId, email: `perf.${uid()}@perf.test`.toLowerCase(), name: "Payroll Officer", role: "PAYROLL_ADMIN", passwordHash: "x" } });
  ctx = { userId: user.id, orgId, role: "PAYROLL_ADMIN", name: user.name, email: user.email, employeeId: null };
  const dss = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
  await db.$transaction((tx) => copyStatutoryRules(tx, dss.id, orgId));
  await db.payrollRule.updateMany({ where: { organizationId: orgId }, data: { hourlyLeavePct: "10" } }); // the leave pay: 10% of every hour worked (a test figure)
  await db.leavePolicy.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, sickDaysPerYear: 5 }, update: { sickDaysPerYear: 5 } });
  await db.publicHoliday.create({ data: { organizationId: orgId, date: day(dateOf(31)), name: "Perf national holiday (Sunday)", createdBy: "perf" } });
  await db.holidayCalendarYear.create({ data: { organizationId: orgId, year: YEAR, confirmedBy: "perf", confirmedByUserId: "perf" } });
  const structure = await createStructure(ctx, {
    code: `PERF-${uid()}`, name: "Hourly performance structure", effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  await db.hourlyRate.create({ data: { organizationId: orgId, scope: "CATEGORY", categoryId: t.guardId, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "perf", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });

  // 20 sites: 2 clients, a contract each, 10 sites on each
  const sites: Array<{ clientId: string; contractId: string; beatId: string }> = [];
  for (const n of [1, 2]) {
    const client = await db.client.create({ data: { organizationId: orgId, code: `PC${n}${uid()}`, name: `Perf Client ${n}` } });
    const contract = await db.contract.create({ data: { organizationId: orgId, clientId: client.id, contractNumber: `PK${n}${uid()}`, name: `Perf guarding ${n}`, startDate: day("2040-01-01") } });
    await db.contractRate.create({ data: { organizationId: orgId, contractId: contract.id, categoryId: t.guardId, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
    for (let b = 1; b <= 10; b++) {
      const beat = await db.beat.create({ data: { organizationId: orgId, clientId: client.id, contractId: contract.id, code: `PB${n}-${b}`, name: `Perf site ${n}-${b}`, state: "Lagos" } });
      sites.push({ clientId: client.id, contractId: contract.id, beatId: beat.id });
    }
  }

  // 3,000 people paid by the hour, 150 at each site; every tenth is ill at the end of the month
  const people = Array.from({ length: PEOPLE }, (_, i) => ({ id: randomUUID(), n: i + 1, site: sites[i % sites.length], sick: i % SICK_EVERY === 0 }));
  idsFull = people.filter((p) => !p.sick).map((p) => p.id);
  idsSick = people.filter((p) => p.sick).map((p) => p.id);
  for (const part of chunks(people, 1000))
    await db.employee.createMany({ data: part.map((p) => ({ id: p.id, organizationId: orgId, employeeNumber: `PF-${String(p.n).padStart(5, "0")}`, firstName: "Perf", lastName: `Guard${p.n}`, employmentDate: day("2040-01-01"), categoryId: t.guardId, departmentId: t.deptId, status: "ACTIVE" as const, bankName: "GTBank", accountNumber: `9${String(p.n).padStart(9, "0")}`, accountName: `Perf Guard ${p.n}`, stateOfResidence: "Lagos" })) });
  for (const part of chunks(people, 1000))
    await db.employeeCompensationType.createMany({ data: part.map((p) => ({ organizationId: orgId, employeeId: p.id, type: "HOURLY" as const, effectiveFrom: day("2040-01-01"), reason: "perf", status: "APPROVED" as const, proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" })) });

  // the 300 ill people: a medical certificate each, and an approved spell on Thursday 28 and Friday 29 March (2 working days, in the leave year that began on 1 January 2041)
  const certs = idsSick.map((employeeId) => ({ id: randomUUID(), employeeId }));
  await db.employeeDocument.createMany({ data: certs.map((c) => ({ id: c.id, organizationId: orgId, employeeId: c.employeeId, documentType: "MEDICAL_CERTIFICATE" as const, fileReference: `perf-cert-${c.id}`, uploadedBy: "perf" })) });
  await db.sickSpell.createMany({ data: certs.map((c) => ({ organizationId: orgId, employeeId: c.employeeId, cycleStart: day(`${YEAR}-01-01`), cycleEnd: day(`${YEAR}-12-31`), startDate: day(dateOf(28)), endDate: day(dateOf(29)), workingDays: 2, certificateDocumentId: c.id, status: "APPROVED" as const, recordedBy: "perf", recordedByUserId: "perf", decidedBy: "perf2", decidedByUserId: "perf2", decidedAt: new Date() })) });

  // the approved shifts: 08:00 to 16:00 on each day worked
  const entries: Array<{ id: string; employeeId: string; site: (typeof sites)[number]; d: number }> = [];
  for (const p of people) for (let d = 1; d <= (p.sick ? SICK_PERSON_DAYS : FULL_DAYS); d++) entries.push({ id: randomUUID(), employeeId: p.id, site: p.site, d });
  totalShifts = entries.length;
  for (const part of chunks(entries, 5000)) {
    await db.timeEntry.createMany({ data: part.map((e) => ({ id: e.id, organizationId: orgId, employeeId: e.employeeId, clientId: e.site.clientId, contractId: e.site.contractId, beatId: e.site.beatId, clockIn: wat(`${dateOf(e.d)}T08:00`), clockOut: wat(`${dateOf(e.d)}T16:00`), status: "APPROVED" as const, capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: 480 })) });
    await db.timeEntrySegment.createMany({ data: part.map((e) => ({ organizationId: orgId, entryId: e.id, date: day(dateOf(e.d)), dayClass: isWeekend(e.d) ? ("WEEKEND" as const) : ("WEEKDAY" as const), minutes: 480 })) });
  }
}, 900_000);

/** The number of records in the run whose gross is not the expected figure (each earnings line is rounded to the kobo, so allow for that). */
const wrongGross = async (runId: string, ids: string[], expected: number) => {
  const off = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "PayrollRecord" WHERE "runId" = ${runId} AND "employeeId" = ANY(${ids}::text[]) AND abs("earnedGross" - ${expected}::numeric) > 0.06`;
  return Number(off[0].n);
};

describe(`payroll for ${PEOPLE.toLocaleString("en")} people paid by the hour, about 30 approved shifts each, with leave pay, sick pay and holiday pay on, finishes inside 10 minutes (rule 12)`, () => {
  it("has the data the test says it has", async () => {
    expect(await db.employee.count({ where: { organizationId: orgId } })).toBe(PEOPLE);
    expect(idsFull.length + idsSick.length).toBe(PEOPLE);
    expect(idsSick).toHaveLength(PEOPLE / SICK_EVERY);
    expect(await db.timeEntry.count({ where: { organizationId: orgId, status: "APPROVED" } })).toBe(totalShifts);
    expect(totalShifts).toBe(idsFull.length * FULL_DAYS + idsSick.length * SICK_PERSON_DAYS);
    expect(await db.sickSpell.count({ where: { organizationId: orgId, status: "APPROVED" } })).toBe(idsSick.length);
  });

  let periodId = "";
  let runId = "";

  it("the first calculation pays all of them inside the limit", async () => {
    periodId = (await createPeriod(ctx, YEAR, MONTH)).id;
    const started = performance.now();
    const run = await runPayroll(ctx, periodId);
    const ms = performance.now() - started;
    runId = run.id;
    report(`PERFORMANCE hourly payroll with leave, sick and holiday pay: ${PEOPLE} people, ${totalShifts} shifts, first calculation ${(ms / 1000).toFixed(1)} s (limit ${LIMIT_MS / 1000} s)`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(run.employeeCount).toBe(PEOPLE);
  }, LIMIT_MS + 120_000);

  it("every one of them is paid exactly what they earned: their hours, the leave pay, the holiday not worked and (the 300) two sick days; nothing lost, nothing twice, nothing blocking", async () => {
    expect(await db.payrollRecord.count({ where: { runId } })).toBe(PEOPLE);
    expect(await wrongGross(runId, idsFull, expectedFull)).toBe(0);
    expect(await wrongGross(runId, idsSick, expectedSick)).toBe(0);
    const hourlyLines = await db.hourlyPayLine.findMany({ where: { runId }, select: { dayClass: true, minutes: true } });
    expect(hourlyLines).toHaveLength(PEOPLE * 2); // a weekday line and a weekend line each
    expect(hourlyLines.reduce((a, l) => a + l.minutes, 0)).toBe(totalShifts * 480); // every minute of every shift
    expect(await db.hourlyPayPiece.count({ where: { runId, kind: "PAID" } })).toBe(totalShifts); // every piece marked as paid, once
    expect(await db.hourlyAllowanceLine.count({ where: { runId, kind: "LEAVE_PERCENT" } })).toBe(PEOPLE);
    expect(await db.hourlyAllowanceLine.count({ where: { runId, kind: "HOLIDAY_NOT_WORKED" } })).toBe(PEOPLE); // the one holiday nobody worked
    expect(await db.hourlyAllowanceLine.count({ where: { runId, kind: "SICK_DAY" } })).toBe(idsSick.length);
    expect(await db.payrollValidationIssue.count({ where: { runId, severity: "CRITICAL" } })).toBe(0);
  }, 300_000);

  it("a recalculation (which replaces everything the first one stored) also finishes inside the limit, and changes nothing", async () => {
    const started = performance.now();
    const again = await runPayroll(ctx, periodId);
    const ms = performance.now() - started;
    report(`PERFORMANCE hourly payroll with leave, sick and holiday pay: recalculation ${(ms / 1000).toFixed(1)} s (limit ${LIMIT_MS / 1000} s)`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(again.id).toBe(runId);
    expect(await db.payrollRecord.count({ where: { runId } })).toBe(PEOPLE);
    expect(await db.hourlyPayLine.count({ where: { runId } })).toBe(PEOPLE * 2);
    expect(await db.hourlyPayPiece.count({ where: { runId, kind: "PAID" } })).toBe(totalShifts);
    expect(await db.hourlyAllowanceLine.count({ where: { runId } })).toBe(PEOPLE * 2 + idsSick.length); // leave pay and holiday pay for everyone, sick pay for the 300: replaced, not added to
    expect(await wrongGross(runId, idsFull, expectedFull)).toBe(0);
    expect(await wrongGross(runId, idsSick, expectedSick)).toBe(0);
  }, LIMIT_MS + 120_000);

  it("on the GROSS EARNINGS basis (the founder's decision for sick and holiday days) the same payroll, calculated again, still finishes inside the limit, with the average of every person kept on their line", async () => {
    await db.payrollRule.updateMany({ where: { organizationId: orgId }, data: { hourlyAverageBasis: "GROSS_EARNINGS" } });
    const started = performance.now();
    const again = await runPayroll(ctx, periodId);
    const ms = performance.now() - started;
    report(`PERFORMANCE hourly payroll with leave, sick and holiday pay on the gross-earnings basis: recalculation ${(ms / 1000).toFixed(1)} s (limit ${LIMIT_MS / 1000} s)`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(again.id).toBe(runId);
    expect(await db.hourlyAllowanceLine.count({ where: { runId } })).toBe(PEOPLE * 2 + idsSick.length);
    // the average daily gross is never below the weekday rate for 8 hours (the weekend hours earn more), and every holiday and sick line says how it was worked out
    expect(await db.hourlyAllowanceLine.count({ where: { runId, kind: "HOLIDAY_NOT_WORKED", amount: { lt: "8000" } } })).toBe(0);
    expect(await db.hourlyAllowanceLine.count({ where: { runId, kind: "HOLIDAY_NOT_WORKED", NOT: { breakdown: { equals: Prisma.DbNull } } } })).toBe(PEOPLE);
    expect(await db.hourlyAllowanceLine.count({ where: { runId, kind: "SICK_DAY", NOT: { breakdown: { equals: Prisma.DbNull } } } })).toBe(idsSick.length);
    expect(await db.payrollValidationIssue.count({ where: { runId, severity: "CRITICAL" } })).toBe(0);
  }, LIMIT_MS + 120_000);
});
