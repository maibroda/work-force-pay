import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { applyPayRate } from "@/server/services/pay-rates";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * A pay rate that starts in the MIDDLE of a pay month (the founder chose, 2026-11-19, for a promotion that takes effect mid-month: "old rate to the day before, new rate from the change date").
 * The test is written to find out whether payroll already does this for a person on a personal pay rate. Nothing in pay code is changed by it. Everything here is invented.
 *
 * Worked example: someone on ₦300,000 a month is promoted to ₦360,000 from the 16th of a 30-day month. 15 days at ₦300,000 / 30 = ₦10,000 a day is ₦150,000; 15 days at ₦360,000 / 30 = ₦12,000 a day
 * is ₦180,000. Earned gross ₦330,000.
 */
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06); // each earnings line is rounded to the kobo (nine lines)
const grossOf = async (runId: string, employeeId: string) => num((await db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } })).earnedGross);

async function world(tag: string) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: hr.orgId, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `MM-${tag}`, name: `Mid month ${tag}`, effectiveFrom: "2035-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  let n = 0;
  /** An office employee (no work register) on a personal pay rate, with the rate from 1 Jan 2036 and, if given, a new rate from `promotedOn`. */
  const person = async (label: string, from: number, to?: { gross: number; on: string }) => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Mm", lastName: `${label}${tag}`, employmentDate: "2035-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `78${String(Date.now()).slice(-7)}${n}`, accountName: `MM ${label} ${tag}`, taxId: `TINM${n}${tag}`, stateOfResidence: "Lagos" });
    await db.$transaction(async (tx) => {
      await applyPayRate(payroll, tx, { employeeId: e.id, monthlyGross: from, structureCode: structure.code, reason: "Office", approvedBy: "Someone", effectiveFrom: "2036-01-01" });
      if (to) await applyPayRate(payroll, tx, { employeeId: e.id, monthlyGross: to.gross, structureCode: structure.code, reason: "Promotion", approvedBy: "Someone", effectiveFrom: to.on });
    });
    return e;
  };
  return { hr, payroll, person };
}

describe("a pay rate that starts in the middle of a pay month (April 2036, 30 days)", () => {
  it("pays the old rate up to the day before the change and the new rate from the change date", async () => {
    const tag = uid();
    const w = await world(tag);
    const mid = await w.person("Mid", 300000, { gross: 360000, on: "2036-04-16" }); // 15 days old, 15 days new
    const last = await w.person("Last", 300000, { gross: 360000, on: "2036-04-30" }); // 29 days old, 1 day new
    const first = await w.person("First", 300000, { gross: 360000, on: "2036-04-01" }); // new rate the whole month
    const none = await w.person("None", 300000); // no change: the old rate the whole month
    const period = await createPeriod(w.payroll, 2036, 4);
    const run = await runPayroll(w.payroll, period.id);
    near(await grossOf(run.id, mid.id), 330000); // 15 x 10,000 + 15 x 12,000
    near(await grossOf(run.id, last.id), 302000); // 29 x 10,000 + 1 x 12,000
    near(await grossOf(run.id, first.id), 360000);
    near(await grossOf(run.id, none.id), 300000);
  });
});

describe("a pay rate that starts in the middle of a 31-day pay month (May 2036)", () => {
  it("splits the month by days at the change date, on the company's paid-days rule", async () => {
    const tag = uid();
    const w = await world(tag);
    const mid = await w.person("Mid31", 300000, { gross: 360000, on: "2036-05-16" }); // 15 days old, 16 days new
    const period = await createPeriod(w.payroll, 2036, 5);
    const run = await runPayroll(w.payroll, period.id);
    const rule = await db.payrollRule.findFirstOrThrow({ where: { organizationId: w.payroll.orgId, effectiveTo: null } });
    // the demo company is on calendar days (the seeded rule); the 30-day fixed basis is NOT covered here
    expect(rule.prorationBasis).toBe("CALENDAR_DAYS");
    // each day is paid at that day's rate over the 31 days in the month: (15 x 300,000 + 16 x 360,000) / 31 = 330,967.74
    near(await grossOf(run.id, mid.id), (15 * 300000 + 16 * 360000) / 31);
  });
});
