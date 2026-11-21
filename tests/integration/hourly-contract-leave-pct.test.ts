import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { addContractRateRecord, contractRateSchema } from "@/server/services/clients";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, createSupplementaryRun, runPayroll } from "@/server/services/payroll";
import { loadRateBook } from "@/server/services/rates";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, H14, the contract's own leave percentage (the founder's message of 2026-11-21: "the leave percentage could be determined by the contract, but 2.5% could be used as default"; his answer: it lives ON THE CONTRACT'S RATE
 * for a job role, effective-dated, blank = the company's percentage). The company percentage (a payroll rule version) is 10 for 2049 in this file (a test figure, not a recommendation); the contract rate may set its own (5, or 0 for
 * none), or leave it blank. The percentage in force on the LAST day worked at the site in the month is used for that site's hours. Real payrolls in the demo company for March and April 2049 and March 2050 (no other test uses them);
 * in March 2050 the company's percentage is the demo company's own open-ended rule: 0.
 * Calendar: 2049-03-01, 2049-03-08, 2049-04-05 and 2050-03-07 are Mondays. Rates are INVENTED: role weekday 1,000 an hour.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06);

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
  /** A rule version for ONE year only, CLOSED, made directly: the demo company keeps exactly one open-ended rule. */
  const ruleFor = async (year: number, hourlyLeavePct: string) => {
    const current = await db.payrollRule.findFirstOrThrow({ where: { organizationId: org, effectiveTo: null } });
    const { id: _id, createdAt: _created, ...fields } = current;
    void _id;
    void _created;
    await db.payrollRule.create({ data: { ...fields, version: `cp-${year}-${tag}`, effectiveFrom: day(`${year}-01-01`), effectiveTo: day(`${year}-12-31`), hourlyLeavePct } });
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const allowances = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId } });
  /** Sets a new rate row through the same service the screen uses (closes the old one the day before). */
  const setRate = (input: Record<string, unknown>) =>
    db.$transaction((tx) => addContractRateRecord(payroll, tx, contractRateSchema.parse({ contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 200000, ...input })));
  return { payroll, org, cat, contract, rate, person, shift, site, ruleFor, record, allowances, setRate, beat, tag };
}

// the 2049 rule version (company percentage 10) is made once for the whole file
beforeAll(async () => {
  const w = await world();
  await w.ruleFor(2049, "10");
}, 120_000);

const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

describe("the contract rate's own leave percentage: saving and reading it", () => {
  it("is blank (null) unless set, kept to a percentage of at most two decimals, stored with the rate and shown by the rate book", async () => {
    const w = await world();
    const parse = (hourlyLeavePct: unknown) => contractRateSchema.safeParse({ contractId: "c", categoryId: "k", agreedRate: 1000, effectiveFrom: "2045-01-01", hourlyLeavePct });
    expect(parse(undefined).success).toBe(true);
    expect(parse("").success).toBe(true);
    expect(parse(0).success).toBe(true);
    expect(parse(100).success).toBe(true);
    expect(parse(-1).success).toBe(false);
    expect(parse(100.5).success).toBe(false);
    expect(parse(2.555).success).toBe(false);
    expect((parse("") as { data: { hourlyLeavePct?: number } }).data.hourlyLeavePct).toBeUndefined();
    // a new rate row starts blank, and the old row's value is NOT carried over
    const blank = await w.setRate({ effectiveFrom: "2046-01-01" });
    expect(blank.hourlyLeavePct).toBeNull();
    const five = await w.setRate({ effectiveFrom: "2047-01-01", hourlyLeavePct: 5 });
    expect(num(five.hourlyLeavePct)).toBe(5);
    const zero = await w.setRate({ effectiveFrom: "2048-01-01", hourlyLeavePct: "0" });
    expect(num(zero.hourlyLeavePct)).toBe(0);
    const book = await db.$transaction((tx) => loadRateBook(tx, w.org, day("2045-01-01"), day("2048-12-31"), 70));
    expect(book.leavePctFor(w.contract.id, w.cat.id, day("2045-06-01"))).toBeNull(); // the first row (blank)
    expect(book.leavePctFor(w.contract.id, w.cat.id, day("2046-06-01"))).toBeNull();
    expect(book.leavePctFor(w.contract.id, w.cat.id, day("2047-06-01"))).toBe(5);
    expect(book.leavePctFor(w.contract.id, w.cat.id, day("2048-06-01"))).toBe(0);
    expect(book.leavePctFor("no-such-contract", w.cat.id, day("2047-06-01"))).toBeNull();
    // it is audited with the rate (ids and numbers only)
    const audit = await db.auditLog.findFirst({ where: { organizationId: w.org, action: "CONTRACT_RATE_SET", entityId: w.contract.id }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(audit?.newValue)).toContain("hourlyLeavePct");
  });
});

describe("the pay run uses the contract's percentage, else the company's", () => {
  it("a contract rate of 5 beats the company's 10: 5% of the hours' pay is added, stored with the percentage used", async () => {
    const w = await world({ leavePct: "5" });
    const e = await w.person("Five");
    await w.shift(e.id, "2049-03-01T08:00", "2049-03-01T18:00"); // Monday 10 h = 10,000
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2049, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 10_500);
    expect((await w.allowances(rec.id)).map((l) => [l.kind, num(l.baseAmount), num(l.pct), num(l.amount)])).toEqual([["LEAVE_PERCENT", 10_000, 5, 500]]);
  });

  it("a blank contract rate uses the company's 10", async () => {
    const w = await world();
    const e = await w.person("Blank");
    await w.shift(e.id, "2049-03-01T08:00", "2049-03-01T18:00");
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2049, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 11_000);
    expect((await w.allowances(rec.id)).map((l) => [num(l.pct), num(l.amount)])).toEqual([[10, 1_000]]);
  });

  it("a contract rate of 0 means NO leave pay on that contract, even though the company's is 10", async () => {
    const w = await world({ leavePct: "0" });
    const e = await w.person("Zero");
    await w.shift(e.id, "2049-03-01T08:00", "2049-03-01T18:00");
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2049, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 10_000);
    expect(await w.allowances(rec.id)).toHaveLength(0);
  });

  it("two contracts in one month: each site's hours get their own contract's percentage", async () => {
    const w = await world({ leavePct: "5" });
    const second = await world({ leavePct: null }); // another contract, blank: the company's 10
    const e = await w.person("Two");
    await w.shift(e.id, "2049-03-01T08:00", "2049-03-01T18:00");
    await w.shift(e.id, "2049-03-08T08:00", "2049-03-08T18:00", second.site);
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2049, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 20_000 + 500 + 1_000);
    const lines = (await w.allowances(rec.id)).map((l) => [l.beatId, num(l.pct), num(l.amount)]);
    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual([w.beat.id, 5, 500]);
    expect(lines).toContainEqual([second.beat.id, 10, 1_000]);
  });

  it("is effective-dated: March uses the row in force then (5), April the new row (blank = the company's 10)", async () => {
    const w = await world({ leavePct: "5" });
    const e = await w.person("Dated");
    await w.shift(e.id, "2049-03-01T08:00", "2049-03-01T18:00");
    await w.shift(e.id, "2049-04-05T08:00", "2049-04-05T18:00");
    await w.setRate({ effectiveFrom: "2049-04-01" }); // blank from April: the company's 10
    const mar = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2049, 3)).id);
    near(num((await w.record(mar.id, e.id)).earnedGross), 10_500);
    const apr = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2049, 4)).id);
    near(num((await w.record(apr.id, e.id)).earnedGross), 11_000);
  });

  it("is added to late hours paid by a supplementary payroll with the contract's percentage too", async () => {
    const w = await world({ leavePct: "5" });
    const e = await w.person("Late");
    await w.shift(e.id, "2049-03-01T08:00", "2049-03-01T16:00"); // 8,000 + 5% in the regular payroll
    const period = await periodOf(w.org, w.payroll, 2049, 3);
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_400);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2049-03-08T08:00", "2049-03-08T18:00"); // approved after the lock: 10,000
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 10_500);
    expect((await w.allowances(rec.id)).map((l) => [num(l.baseAmount), num(l.pct), num(l.amount)])).toEqual([[10_000, 5, 500]]);
  });

  it("with the company's percentage at 0 (off), a contract that sets its own still pays it, and a contract with none pays none", async () => {
    const own = await world({ leavePct: "5" });
    const plain = await world({ leavePct: null });
    const a = await own.person("OwnPct");
    const b = await plain.person("NoPct");
    await own.shift(a.id, "2050-03-07T08:00", "2050-03-07T18:00");
    await plain.shift(b.id, "2050-03-07T08:00", "2050-03-07T18:00");
    const run = await runPayroll(own.payroll, (await periodOf(own.org, own.payroll, 2050, 3)).id);
    near(num((await own.record(run.id, a.id)).earnedGross), 10_500);
    near(num((await own.record(run.id, b.id)).earnedGross), 10_000);
    expect(await own.allowances((await own.record(run.id, b.id)).id)).toHaveLength(0);
  });
});
