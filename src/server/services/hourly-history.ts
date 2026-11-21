/**
 * Hourly pay, the three-month average on GROSS EARNINGS (the founder's confirmed decision of 2026-11-21): the approved hours of the months BEFORE a sick spell or a public holiday, valued at the approved hourly rate of their
 * own day and kind of day, for the pure step in `src/lib/payroll/hourly-average.ts`. Read for ONE company.
 *
 * The hours are read as totals by person, site, day and kind of day in the database (a day's shifts at one site are one row), not shift by shift, so a payroll for thousands of people reads a few rows each; they are
 * priced here once per person, contract and day (the approved rates in force that day, found as the pay run finds them). Only APPROVED shifts count; a day is never priced at today's rate. Hours with no approved rate, or
 * that meet two approved rates at one level, are kept with no rate (`rateKobo` null): they are not earnings, and the pay run says so.
 */
import { d, iso } from "@/lib/dates";
import { koboFromNaira } from "@/lib/money-exact";
import type { AverageDayClass, PricedDay } from "@/lib/payroll/hourly-average";
import { resolveHourlyRate } from "@/lib/payroll/hourly-rates";
import type { Tx } from "./_base";
import { loadApprovedHourlyRates } from "./hourly-pay";

export async function loadPricedHistory(tx: Tx, a: { orgId: string; employeeIds: readonly string[]; from: string; to: string; categoryOf: (employeeId: string) => string }): Promise<Map<string, PricedDay[]>> {
  const out = new Map<string, PricedDay[]>();
  if (a.employeeIds.length === 0 || a.from >= a.to) return out;
  const [rows, rates] = await Promise.all([
    tx.$queryRaw<Array<{ employeeId: string; beatId: string; contractId: string; clientId: string; date: Date; dayClass: AverageDayClass; minutes: number }>>`
      SELECT e."employeeId" AS "employeeId", e."beatId" AS "beatId", e."contractId" AS "contractId", e."clientId" AS "clientId", s."date" AS "date", s."dayClass"::text AS "dayClass", SUM(s."minutes")::int AS "minutes"
      FROM "TimeEntrySegment" s JOIN "TimeEntry" e ON e."id" = s."entryId"
      WHERE s."organizationId" = ${a.orgId} AND e."status" = 'APPROVED' AND s."date" >= ${a.from}::date AND s."date" < ${a.to}::date AND e."employeeId" = ANY(${[...a.employeeIds]}::text[])
      GROUP BY e."employeeId", e."beatId", e."contractId", e."clientId", s."date", s."dayClass"`,
    loadApprovedHourlyRates(tx, a.orgId, d(a.from), d(a.to)),
  ]);
  const rateAt = new Map<string, { weekday: number; weekend: number; holiday: number } | null>(); // by person, contract and day
  for (const r of rows) {
    const date = iso(r.date);
    const key = `${r.employeeId}|${r.contractId}|${date}`;
    if (!rateAt.has(key)) {
      let found: { weekday: number; weekend: number; holiday: number } | null = null;
      try {
        found = resolveHourlyRate(rates, { employeeId: r.employeeId, contractId: r.contractId, categoryId: a.categoryOf(r.employeeId), date: r.date })?.rates ?? null;
      } catch {
        found = null; // two approved rates at one level: not guessed
      }
      rateAt.set(key, found);
    }
    const found = rateAt.get(key)!;
    const naira = found ? (r.dayClass === "WEEKEND" ? found.weekend : r.dayClass === "HOLIDAY" ? found.holiday : found.weekday) : null;
    const list = out.get(r.employeeId) ?? [];
    list.push({ date, dayClass: r.dayClass, minutes: r.minutes, rateKobo: naira === null ? null : koboFromNaira(naira, "An hourly rate"), beatId: r.beatId, contractId: r.contractId, clientId: r.clientId });
    out.set(r.employeeId, list);
  }
  return out;
}
