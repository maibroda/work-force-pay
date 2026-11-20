import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { copyStatutoryRules } from "@/server/services/statutory";
import { createStructure } from "@/server/services/structures";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 4c (performance, the project's rule 12): payroll for 3,000 workers must complete in 10 minutes or less. This is the plan's test, run in CI and not only on a laptop: 3,000 people paid by the
 * hour, each with 30 approved shifts in one month (90,000 shifts, 90,000 paid pieces), across 20 sites of two clients, in a company of their own, through the real pay run. It checks that the pay run finishes
 * inside the limit, then that a recalculation (which replaces everything the first one stored) does too, and that the pay is right for every one of the 3,000: nothing lost, nothing paid twice, nothing blocking.
 * Every person works the same 30 days of April 2041 (8 hours a day), so the expected pay is one figure worked out here, independently of the pay run. Rates are INVENTED: weekday 1,000, weekend 1,500 an hour.
 * The measured times are printed in the test log (on the error stream, which the test runner always shows) so a slowdown can be seen in CI long before it nears the limit.
 */
const PEOPLE = 3_000;
const SHIFTS_EACH = 30;
const LIMIT_MS = 10 * 60 * 1000;
const YEAR = 2041;
const MONTH = 4; // April: 30 days, so 30 shifts of 8 hours, one a day
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const chunks = <T>(rows: T[], size: number) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const dateOf = (d: number) => `${YEAR}-${String(MONTH).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const isWeekend = (d: number) => [0, 6].includes(new Date(`${dateOf(d)}T00:00:00Z`).getUTCDay());

let orgId: string;
let ctx: Parameters<typeof runPayroll>[0];
let expectedGross = 0;
let weekdayDays = 0;
let weekendDays = 0;

beforeAll(async () => {
  const t = await isolatedOrg();
  orgId = t.org.id;
  const user = await db.user.create({ data: { organizationId: orgId, email: `perf.${uid()}@perf.test`.toLowerCase(), name: "Payroll Officer", role: "PAYROLL_ADMIN", passwordHash: "x" } });
  ctx = { userId: user.id, orgId, role: "PAYROLL_ADMIN", name: user.name, email: user.email, employeeId: null };
  const dss = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
  await db.$transaction((tx) => copyStatutoryRules(tx, dss.id, orgId));
  const structure = await createStructure(ctx, {
    code: `PERF-${uid()}`, name: "Hourly performance structure", effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  await db.hourlyRate.create({ data: { organizationId: orgId, scope: "CATEGORY", categoryId: t.guardId, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2040-01-01"), reason: "perf", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });

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

  // 3,000 people paid by the hour, 150 at each site
  const people = Array.from({ length: PEOPLE }, (_, i) => ({ id: randomUUID(), n: i + 1, site: sites[i % sites.length] }));
  for (const part of chunks(people, 1000))
    await db.employee.createMany({ data: part.map((p) => ({ id: p.id, organizationId: orgId, employeeNumber: `PF-${String(p.n).padStart(5, "0")}`, firstName: "Perf", lastName: `Guard${p.n}`, employmentDate: day("2040-01-01"), categoryId: t.guardId, departmentId: t.deptId, status: "ACTIVE" as const, bankName: "GTBank", accountNumber: `9${String(p.n).padStart(9, "0")}`, accountName: `Perf Guard ${p.n}`, stateOfResidence: "Lagos" })) });
  for (const part of chunks(people, 1000))
    await db.employeeCompensationType.createMany({ data: part.map((p) => ({ organizationId: orgId, employeeId: p.id, type: "HOURLY" as const, effectiveFrom: day("2040-01-01"), reason: "perf", status: "APPROVED" as const, proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" })) });

  // 30 approved shifts each: 08:00 to 16:00 on each of the 30 days of April
  const entries: Array<{ id: string; employeeId: string; site: (typeof sites)[number]; d: number }> = [];
  for (const p of people) for (let d = 1; d <= SHIFTS_EACH; d++) entries.push({ id: randomUUID(), employeeId: p.id, site: p.site, d });
  for (const part of chunks(entries, 5000)) {
    await db.timeEntry.createMany({ data: part.map((e) => ({ id: e.id, organizationId: orgId, employeeId: e.employeeId, clientId: e.site.clientId, contractId: e.site.contractId, beatId: e.site.beatId, clockIn: wat(`${dateOf(e.d)}T08:00`), clockOut: wat(`${dateOf(e.d)}T16:00`), status: "APPROVED" as const, capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: 480 })) });
    await db.timeEntrySegment.createMany({ data: part.map((e) => ({ organizationId: orgId, entryId: e.id, date: day(dateOf(e.d)), dayClass: isWeekend(e.d) ? ("WEEKEND" as const) : ("WEEKDAY" as const), minutes: 480 })) });
  }
  for (let d = 1; d <= SHIFTS_EACH; d++) {
    if (isWeekend(d)) weekendDays += 1;
    else weekdayDays += 1;
  }
  expectedGross = weekdayDays * 8 * 1000 + weekendDays * 8 * 1500; // worked out here, whole naira, independently of the pay run
}, 900_000);

describe(`payroll for ${PEOPLE.toLocaleString("en")} people paid by the hour, ${SHIFTS_EACH} approved shifts each, finishes inside 10 minutes (rule 12)`, () => {
  it("has the data the test says it has", async () => {
    expect(await db.employee.count({ where: { organizationId: orgId } })).toBe(PEOPLE);
    expect(await db.timeEntry.count({ where: { organizationId: orgId, status: "APPROVED" } })).toBe(PEOPLE * SHIFTS_EACH);
    expect(weekdayDays + weekendDays).toBe(SHIFTS_EACH);
    expect(weekdayDays).toBeGreaterThan(0);
    expect(weekendDays).toBeGreaterThan(0);
  });

  let periodId = "";
  let runId = "";

  it("the first calculation pays all of them inside the limit", async () => {
    periodId = (await createPeriod(ctx, YEAR, MONTH)).id;
    const started = performance.now();
    const run = await runPayroll(ctx, periodId);
    const ms = performance.now() - started;
    runId = run.id;
    console.error(`PERFORMANCE hourly payroll: ${PEOPLE} people, ${PEOPLE * SHIFTS_EACH} shifts, first calculation ${(ms / 1000).toFixed(1)} s (limit ${LIMIT_MS / 1000} s)`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(run.employeeCount).toBe(PEOPLE);
  }, LIMIT_MS + 120_000);

  it("every one of them is paid exactly what their hours earned: nothing lost, nothing twice, nothing blocking", async () => {
    expect(await db.payrollRecord.count({ where: { runId } })).toBe(PEOPLE);
    // every record's gross is the one figure worked out independently (each earnings line is rounded to the kobo, so allow for that)
    const off = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "PayrollRecord" WHERE "runId" = ${runId} AND abs("earnedGross" - ${expectedGross}::numeric) > 0.06`;
    expect(Number(off[0].n)).toBe(0);
    const hourlyLines = await db.hourlyPayLine.findMany({ where: { runId }, select: { dayClass: true, minutes: true } });
    expect(hourlyLines).toHaveLength(PEOPLE * 2); // a weekday line and a weekend line each
    expect(hourlyLines.reduce((a, l) => a + l.minutes, 0)).toBe(PEOPLE * SHIFTS_EACH * 480); // every minute of every shift
    expect(await db.hourlyPayPiece.count({ where: { runId, kind: "PAID" } })).toBe(PEOPLE * SHIFTS_EACH); // every piece marked as paid, once
    expect(await db.payrollValidationIssue.count({ where: { runId, severity: "CRITICAL" } })).toBe(0);
  }, 300_000);

  it("a recalculation (which replaces everything the first one stored) also finishes inside the limit, and changes nothing", async () => {
    const started = performance.now();
    const again = await runPayroll(ctx, periodId);
    const ms = performance.now() - started;
    console.error(`PERFORMANCE hourly payroll: recalculation ${(ms / 1000).toFixed(1)} s (limit ${LIMIT_MS / 1000} s)`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(again.id).toBe(runId);
    expect(await db.payrollRecord.count({ where: { runId } })).toBe(PEOPLE);
    expect(await db.hourlyPayLine.count({ where: { runId } })).toBe(PEOPLE * 2);
    expect(await db.hourlyPayPiece.count({ where: { runId, kind: "PAID" } })).toBe(PEOPLE * SHIFTS_EACH);
    const off = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "PayrollRecord" WHERE "runId" = ${runId} AND abs("earnedGross" - ${expectedGross}::numeric) > 0.06`;
    expect(Number(off[0].n)).toBe(0);
  }, LIMIT_MS + 120_000);
});
