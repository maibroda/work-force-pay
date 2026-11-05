import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { isIsoDate } from "@/lib/pay-rate";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

/**
 * The company's public holidays (the founder, 2026-11-05): the company ENTERS the dates each year and CONFIRMS the year, because some holidays are announced each year and no date is put in the
 * code. A contract on the working-days basis that excludes public holidays uses these dates, and cannot be paid cleanly for a month in an unconfirmed year (the pay run raises a critical
 * finding). Editing a confirmed year un-confirms it, so a change is always re-confirmed. Everything is for the caller's company only; audit entries carry ids.
 */
const yearOf = (date: Date) => date.getUTCFullYear();

async function unconfirm(ctx: Ctx, tx: Tx, year: number) {
  const row = await tx.holidayCalendarYear.findUnique({ where: { organizationId_year: { organizationId: ctx.orgId, year } } });
  if (!row) return;
  await tx.holidayCalendarYear.delete({ where: { id: row.id } });
  await logAudit(ctx, { action: "HOLIDAY_YEAR_UNCONFIRMED", entity: "HolidayCalendarYear", entityId: row.id, newValue: { year } }, tx);
}

export async function addHoliday(ctx: Ctx, raw: { date: string; name: string }) {
  assertCan(ctx, "payroll.run");
  if (!isIsoDate(raw.date)) throw new BusinessError("The date must be a valid date (YYYY-MM-DD).");
  const name = (raw.name ?? "").trim();
  if (name.length < 2) throw new BusinessError("Give the holiday a name.");
  return db.$transaction(async (tx) => {
    const date = d(raw.date);
    if (await tx.publicHoliday.findUnique({ where: { organizationId_date: { organizationId: ctx.orgId, date } } })) throw new BusinessError(`${raw.date} is already on the list.`);
    const row = await tx.publicHoliday.create({ data: { organizationId: ctx.orgId, date, name, createdBy: ctx.name } });
    await logAudit(ctx, { action: "HOLIDAY_ADDED", entity: "PublicHoliday", entityId: row.id, newValue: { date: raw.date } }, tx);
    await unconfirm(ctx, tx, yearOf(date));
    return row;
  });
}

export async function removeHoliday(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.run");
  await db.$transaction(async (tx) => {
    const row = await tx.publicHoliday.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!row) throw new BusinessError("Public holiday not found.");
    await tx.publicHoliday.delete({ where: { id } });
    await logAudit(ctx, { action: "HOLIDAY_REMOVED", entity: "PublicHoliday", entityId: id, newValue: { date: iso(row.date) } }, tx);
    await unconfirm(ctx, tx, yearOf(row.date));
  });
}

/** The holidays of a year, in date order, and whether the year has been confirmed (null if not). */
export async function listHolidays(ctx: Ctx, year: number) {
  assertCan(ctx, "payroll.view");
  const [holidays, confirmed] = await Promise.all([
    db.publicHoliday.findMany({ where: { organizationId: ctx.orgId, date: { gte: d(`${year}-01-01`), lte: d(`${year}-12-31`) } }, orderBy: { date: "asc" } }),
    db.holidayCalendarYear.findUnique({ where: { organizationId_year: { organizationId: ctx.orgId, year } } }),
  ]);
  return { holidays, confirmed };
}

/** Confirms the year's list is complete and right. By the payroll manager (the approval permission). */
export async function confirmHolidayYear(ctx: Ctx, year: number) {
  assertCan(ctx, "payrate.approve");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BusinessError("That is not a valid year.");
  return db.$transaction(async (tx) => {
    const row = await tx.holidayCalendarYear.upsert({
      where: { organizationId_year: { organizationId: ctx.orgId, year } },
      create: { organizationId: ctx.orgId, year, confirmedBy: ctx.name, confirmedByUserId: ctx.userId },
      update: { confirmedBy: ctx.name, confirmedByUserId: ctx.userId, confirmedAt: new Date() },
    });
    await logAudit(ctx, { action: "HOLIDAY_YEAR_CONFIRMED", entity: "HolidayCalendarYear", entityId: row.id, newValue: { year } }, tx);
    return row;
  });
}

/** What the pay run needs for a year: the holiday dates (ISO) and whether the year is confirmed. */
export async function holidayContext(tx: Tx, orgId: string, year: number) {
  const [rows, confirmed] = await Promise.all([
    tx.publicHoliday.findMany({ where: { organizationId: orgId, date: { gte: d(`${year}-01-01`), lte: d(`${year}-12-31`) } }, select: { date: true } }),
    tx.holidayCalendarYear.findUnique({ where: { organizationId_year: { organizationId: orgId, year } }, select: { id: true } }),
  ]);
  return { holidays: rows.map((r) => iso(r.date)), confirmed: Boolean(confirmed) };
}
