import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { koboToNumber, koboToString, toKobo } from "@/lib/money-exact";
import { normaliseState } from "@/lib/nigeria-states";
import { isIsoDate } from "@/lib/pay-rate";
import { compensationTypeOn, holidaysApplying, type CompensationKind, type HourlyRateRow, type HourlyRateScope } from "@/lib/payroll/hourly-rates";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { unconfirm } from "./holidays";
import { assertPeriodEditable } from "./operations";

/**
 * Hourly pay, phase 2 (docs/plans/hourly-payroll-assessment.md; the founder's answers of 2026-11-19): the company switch, effective-dated hourly rates, how a person is paid from a date, and public holidays
 * limited to states. NOTHING here is read by the pay run yet (phase 4): these are the agreed facts, kept with their history, ready for it.
 *
 * Who may do what (no new permission was made; the same people as for a personal monthly gross): the payroll people PROPOSE (`payroll.run`), the payroll manager APPROVES (`payrate.approve`), never the
 * person who proposed it and never for their own pay; a company administrator switches the module on (`settings.manage`). With the switch OFF (the default) every action here refuses with a plain message.
 * Everything is for the caller's company only; another company's person, contract, job role, holiday or proposal is "not found". Audit entries carry ids, enums and rates, never the typed reasons.
 */

// ─────────────────────────────── the company switch ───────────────────────────────

export async function hourlyPayEnabled(orgId: string, client: Tx | typeof db = db): Promise<boolean> {
  const row = await client.hourlyPaySetting.findUnique({ where: { organizationId: orgId }, select: { enabled: true } });
  return row?.enabled ?? false;
}

async function assertOn(ctx: Ctx, client: Tx | typeof db = db) {
  if (!(await hourlyPayEnabled(ctx.orgId, client))) throw new BusinessError("Hourly pay is not switched on for this company. A company administrator can switch it on.");
}

/** Switches hourly pay on or off for the company. Off hides and refuses everything hourly; nothing already agreed is deleted. */
export async function setHourlyPayEnabled(ctx: Ctx, enabled: boolean) {
  assertCan(ctx, "settings.manage");
  return db.$transaction(async (tx) => {
    const row = await tx.hourlyPaySetting.upsert({
      where: { organizationId: ctx.orgId },
      create: { organizationId: ctx.orgId, enabled, changedBy: ctx.name, changedByUserId: ctx.userId },
      update: { enabled, changedBy: ctx.name, changedByUserId: ctx.userId, changedAt: new Date() },
    });
    await logAudit(ctx, { action: "HOURLY_PAY_SWITCH", entity: "HourlyPaySetting", entityId: row.id, newValue: { enabled } }, tx);
    return row;
  });
}

const assertPending = (status: string) => {
  if (status !== "PENDING") throw new BusinessError(`This proposal is already ${status.toLowerCase()}.`);
};

// ─────────────────────────────── hourly rates ───────────────────────────────

const SCOPES: readonly HourlyRateScope[] = ["EMPLOYEE", "CONTRACT_CATEGORY", "CATEGORY"];

export interface HourlyRateInput {
  scope: string;
  employeeId?: string | null;
  contractId?: string | null;
  categoryId?: string | null;
  weekdayRate: unknown;
  weekendRate: unknown;
  holidayRate: unknown;
  effectiveFrom: string;
  reason: string;
}

/** A typed rate as whole kobo: at most two decimals and above zero. A missing rate is refused, never read as zero (a class of day that is deliberately unpaid is a decision the founder has not made). */
function rateKobo(value: unknown, what: string) {
  let kobo;
  try {
    kobo = toKobo(String(value ?? "").trim());
  } catch {
    throw new BusinessError(`The ${what} hourly rate must be an amount in naira, with at most two decimal places.`);
  }
  if (kobo <= 0) throw new BusinessError(`The ${what} hourly rate must be above zero.`);
  return kobo;
}

export async function proposeHourlyRate(ctx: Ctx, raw: HourlyRateInput) {
  assertCan(ctx, "payroll.run");
  await assertOn(ctx);
  if (!(SCOPES as readonly string[]).includes(raw.scope)) throw new BusinessError("Say whom the rate is for: an employee, a contract and job role together, or a job role.");
  const scope = raw.scope as HourlyRateScope;
  // only the keys that belong to the scope are used, so a stray value cannot make a rate for the wrong people
  const employeeId = scope === "EMPLOYEE" ? raw.employeeId || null : null;
  const contractId = scope === "CONTRACT_CATEGORY" ? raw.contractId || null : null;
  const categoryId = scope === "EMPLOYEE" ? null : raw.categoryId || null;
  if (scope === "EMPLOYEE" && !employeeId) throw new BusinessError("Choose the employee this rate is for.");
  if (scope === "CONTRACT_CATEGORY" && !contractId) throw new BusinessError("Choose the contract this rate is for.");
  if (scope !== "EMPLOYEE" && !categoryId) throw new BusinessError("Choose the job role this rate is for.");
  const weekday = rateKobo(raw.weekdayRate, "weekday");
  const weekend = rateKobo(raw.weekendRate, "weekend");
  const holiday = rateKobo(raw.holidayRate, "public holiday");
  const reason = (raw.reason ?? "").trim();
  if (reason.length < 3) throw new BusinessError("Give a reason (at least a few words), for example “Agreed with the client”.");
  if (!isIsoDate(raw.effectiveFrom)) throw new BusinessError("Effective from must be a valid date (YYYY-MM-DD).");
  return db.$transaction(async (tx) => {
    if (employeeId && !(await tx.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Employee not found.");
    if (contractId && !(await tx.contract.findFirst({ where: { id: contractId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Contract not found.");
    if (categoryId && !(await tx.employeeCategory.findFirst({ where: { id: categoryId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Job role not found.");
    if (await tx.hourlyRate.findFirst({ where: { organizationId: ctx.orgId, status: "PENDING", scope, employeeId, contractId, categoryId }, select: { id: true } }))
      throw new BusinessError("There is already a pending hourly rate proposal for this: decide it or withdraw it first.");
    const row = await tx.hourlyRate.create({
      data: {
        organizationId: ctx.orgId,
        scope,
        employeeId,
        contractId,
        categoryId,
        weekdayRate: koboToString(weekday),
        weekendRate: koboToString(weekend),
        holidayRate: koboToString(holiday),
        effectiveFrom: d(raw.effectiveFrom),
        reason,
        proposedBy: ctx.name,
        proposedByUserId: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "HOURLY_RATE_PROPOSED", entity: "HourlyRate", entityId: row.id, newValue: { scope, employeeId, contractId, categoryId, weekdayRate: koboToNumber(weekday), weekendRate: koboToNumber(weekend), holidayRate: koboToNumber(holiday), effectiveFrom: raw.effectiveFrom } }, tx);
    return row;
  });
}

async function loadRate(ctx: Ctx, id: string, tx: Tx) {
  const row = await tx.hourlyRate.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!row) throw new BusinessError("Hourly rate proposal not found.");
  return row;
}

/** Approval makes the rate count: it ends the previous open rate for the same people the day before, and changes nothing if a rate already starts on or after this date. */
export async function approveHourlyRate(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "payrate.approve");
  return db.$transaction(async (tx) => {
    await assertOn(ctx, tx);
    const p = await loadRate(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId === ctx.userId) throw new BusinessError("You made this proposal: someone else has to approve it.");
    if (ctx.employeeId && p.employeeId && ctx.employeeId === p.employeeId) throw new BusinessError("This is your own pay: someone else has to decide it.");
    const open = await tx.hourlyRate.findMany({ where: { organizationId: ctx.orgId, status: "APPROVED", scope: p.scope, employeeId: p.employeeId, contractId: p.contractId, categoryId: p.categoryId, effectiveTo: null } });
    for (const r of open) {
      if (r.effectiveFrom >= p.effectiveFrom) throw new BusinessError("An hourly rate already starts on or after this date.");
      await tx.hourlyRate.update({ where: { id: r.id }, data: { effectiveTo: new Date(p.effectiveFrom.getTime() - 86400000) } });
    }
    const done = await tx.hourlyRate.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "HOURLY_RATE_APPROVED", entity: "HourlyRate", entityId: id, newValue: { scope: p.scope, employeeId: p.employeeId, contractId: p.contractId, categoryId: p.categoryId, weekdayRate: num(p.weekdayRate), weekendRate: num(p.weekendRate), holidayRate: num(p.holidayRate), effectiveFrom: iso(p.effectiveFrom) } }, tx);
    return done;
  });
}

export async function rejectHourlyRate(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "payrate.approve");
  if ((note ?? "").trim().length < 3) throw new BusinessError("Give a reason for rejecting it.");
  return db.$transaction(async (tx) => {
    await assertOn(ctx, tx);
    const p = await loadRate(ctx, id, tx);
    assertPending(p.status);
    const done = await tx.hourlyRate.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
    await logAudit(ctx, { action: "HOURLY_RATE_REJECTED", entity: "HourlyRate", entityId: id, newValue: { scope: p.scope } }, tx);
    return done;
  });
}

/** The person who made a proposal may withdraw it while it is pending. */
export async function cancelHourlyRate(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.run");
  return db.$transaction(async (tx) => {
    await assertOn(ctx, tx);
    const p = await loadRate(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId !== ctx.userId) throw new BusinessError("You can withdraw only your own proposals.");
    const done = await tx.hourlyRate.update({ where: { id }, data: { status: "CANCELLED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date() } });
    await logAudit(ctx, { action: "HOURLY_RATE_WITHDRAWN", entity: "HourlyRate", entityId: id, newValue: { scope: p.scope } }, tx);
    return done;
  });
}

/** Every proposal and rate of the company, newest first, with the names of whom each is for. */
export async function listHourlyRates(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  await assertOn(ctx);
  const rates = await db.hourlyRate.findMany({
    where: { organizationId: ctx.orgId },
    include: {
      employee: { select: { employeeNumber: true, firstName: true, lastName: true } },
      contract: { select: { contractNumber: true, name: true, client: { select: { name: true } } } },
      category: { select: { code: true, name: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return { rates };
}

/** What the pay run needs (phase 4): the approved rates that overlap the period, as the pure rules read them. */
export async function loadApprovedHourlyRates(tx: Tx, orgId: string, from: Date, to: Date): Promise<HourlyRateRow[]> {
  const rows = await tx.hourlyRate.findMany({ where: { organizationId: orgId, status: "APPROVED", effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } });
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    employeeId: r.employeeId,
    contractId: r.contractId,
    categoryId: r.categoryId,
    weekdayRate: num(r.weekdayRate),
    weekendRate: num(r.weekendRate),
    holidayRate: num(r.holidayRate),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    status: r.status,
  }));
}

// ─────────────────────────────── how a person is paid ───────────────────────────────

const KINDS: readonly CompensationKind[] = ["MONTHLY", "HOURLY"];

export interface CompensationInput {
  employeeId: string;
  type: string;
  effectiveFrom: string;
  reason: string;
}

export async function proposeCompensationType(ctx: Ctx, raw: CompensationInput) {
  assertCan(ctx, "payroll.run");
  await assertOn(ctx);
  if (!(KINDS as readonly string[]).includes(raw.type)) throw new BusinessError("A person is paid monthly or by the hour.");
  const reason = (raw.reason ?? "").trim();
  if (reason.length < 3) throw new BusinessError("Give a reason (at least a few words), for example “Agreed in the offer letter”.");
  if (!isIsoDate(raw.effectiveFrom)) throw new BusinessError("Effective from must be a valid date (YYYY-MM-DD).");
  return db.$transaction(async (tx) => {
    const emp = await tx.employee.findFirst({ where: { id: raw.employeeId, organizationId: ctx.orgId }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await assertPeriodEditable(tx, ctx.orgId, d(raw.effectiveFrom)); // not inside a payroll period that is approved or locked
    if (await tx.employeeCompensationType.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: "PENDING" }, select: { id: true } }))
      throw new BusinessError("There is already a pending proposal for this person: decide it or withdraw it first.");
    const row = await tx.employeeCompensationType.create({
      data: { organizationId: ctx.orgId, employeeId: emp.id, type: raw.type as CompensationKind, effectiveFrom: d(raw.effectiveFrom), reason, proposedBy: ctx.name, proposedByUserId: ctx.userId },
    });
    await logAudit(ctx, { action: "COMPENSATION_TYPE_PROPOSED", entity: "EmployeeCompensationType", entityId: row.id, newValue: { employeeId: emp.id, type: raw.type, effectiveFrom: raw.effectiveFrom } }, tx);
    return row;
  });
}

async function loadCompensation(ctx: Ctx, id: string, tx: Tx) {
  const row = await tx.employeeCompensationType.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!row) throw new BusinessError("Proposal not found.");
  return row;
}

/** Approval makes the record count from its date. It is refused (and changes nothing) inside a payroll period that is approved or locked, or when a record already starts on or after the date. */
export async function approveCompensationType(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "payrate.approve");
  return db.$transaction(async (tx) => {
    await assertOn(ctx, tx);
    const p = await loadCompensation(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId === ctx.userId) throw new BusinessError("You made this proposal: someone else has to approve it.");
    if (ctx.employeeId && ctx.employeeId === p.employeeId) throw new BusinessError("This is your own pay: someone else has to decide it.");
    await assertPeriodEditable(tx, ctx.orgId, p.effectiveFrom);
    const later = await tx.employeeCompensationType.findFirst({ where: { organizationId: ctx.orgId, employeeId: p.employeeId, status: "APPROVED", effectiveFrom: { gte: p.effectiveFrom } }, select: { id: true } });
    if (later) throw new BusinessError("A record of how this person is paid already starts on or after this date.");
    const done = await tx.employeeCompensationType.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "COMPENSATION_TYPE_APPROVED", entity: "EmployeeCompensationType", entityId: id, newValue: { employeeId: p.employeeId, type: p.type, effectiveFrom: iso(p.effectiveFrom) } }, tx);
    return done;
  });
}

export async function rejectCompensationType(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "payrate.approve");
  if ((note ?? "").trim().length < 3) throw new BusinessError("Give a reason for rejecting it.");
  return db.$transaction(async (tx) => {
    await assertOn(ctx, tx);
    const p = await loadCompensation(ctx, id, tx);
    assertPending(p.status);
    const done = await tx.employeeCompensationType.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
    await logAudit(ctx, { action: "COMPENSATION_TYPE_REJECTED", entity: "EmployeeCompensationType", entityId: id, newValue: { employeeId: p.employeeId } }, tx);
    return done;
  });
}

export async function cancelCompensationType(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.run");
  return db.$transaction(async (tx) => {
    await assertOn(ctx, tx);
    const p = await loadCompensation(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId !== ctx.userId) throw new BusinessError("You can withdraw only your own proposals.");
    const done = await tx.employeeCompensationType.update({ where: { id }, data: { status: "CANCELLED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date() } });
    await logAudit(ctx, { action: "COMPENSATION_TYPE_WITHDRAWN", entity: "EmployeeCompensationType", entityId: id, newValue: { employeeId: p.employeeId } }, tx);
    return done;
  });
}

/** How a person is paid on a day: monthly unless an approved record says hourly. */
export async function compensationTypeFor(ctx: Ctx, employeeId: string, date: Date): Promise<CompensationKind> {
  assertCan(ctx, "payroll.view");
  await assertOn(ctx);
  const rows = await db.employeeCompensationType.findMany({ where: { organizationId: ctx.orgId, employeeId, status: "APPROVED" }, select: { type: true, effectiveFrom: true, status: true } });
  return compensationTypeOn(rows, date);
}

export async function listCompensationTypes(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  await assertOn(ctx);
  const records = await db.employeeCompensationType.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return { records };
}

// ─────────────────────────────── holidays limited to states ───────────────────────────────

/**
 * Limits a public holiday to the named states, replacing any earlier set; no states makes it a national holiday again. The state of the WORK LOCATION decides which holidays apply to an hour worked (the
 * founder's H11). Changing the states takes the year's confirmation away, as editing the holiday list does, so the year must be confirmed again.
 */
export async function setHolidayStates(ctx: Ctx, holidayId: string, states: readonly string[]) {
  assertCan(ctx, "payroll.run");
  await assertOn(ctx);
  const proper: string[] = [];
  for (const s of states) {
    const name = normaliseState(s);
    if (!name) throw new BusinessError(`“${s}” is not a state of Nigeria (use the state's name, or FCT).`);
    if (!proper.includes(name)) proper.push(name);
  }
  proper.sort();
  return db.$transaction(async (tx) => {
    const holiday = await tx.publicHoliday.findFirst({ where: { id: holidayId, organizationId: ctx.orgId } });
    if (!holiday) throw new BusinessError("Public holiday not found.");
    await tx.publicHolidayState.deleteMany({ where: { holidayId } });
    if (proper.length) await tx.publicHolidayState.createMany({ data: proper.map((state) => ({ organizationId: ctx.orgId, holidayId, state, createdBy: ctx.name })) });
    await logAudit(ctx, { action: "HOLIDAY_STATES_SET", entity: "PublicHoliday", entityId: holidayId, newValue: { holidayId, states: proper } }, tx);
    await unconfirm(ctx, tx, holiday.date.getUTCFullYear());
    return proper;
  });
}

/** The ISO dates of a year's public holidays that apply at a place of work in the given state (national holidays, and the ones limited to that state). A place with no recognised state gets the national ones only. */
export async function holidayDatesAt(ctx: Ctx, year: number, placeState: string | null): Promise<Set<string>> {
  assertCan(ctx, "payroll.view");
  await assertOn(ctx);
  const rows = await db.publicHoliday.findMany({
    where: { organizationId: ctx.orgId, date: { gte: d(`${year}-01-01`), lte: d(`${year}-12-31`) } },
    include: { states: { select: { state: true } } },
  });
  return holidaysApplying(rows.map((h) => ({ date: iso(h.date), states: h.states.map((s) => s.state) })), placeState);
}

/** The states each public holiday of a year is limited to, by holiday id (a holiday with no entry is national). For the holidays page. */
export async function holidayStatesOfYear(ctx: Ctx, year: number): Promise<Record<string, string[]>> {
  assertCan(ctx, "payroll.view");
  const rows = await db.publicHolidayState.findMany({
    where: { organizationId: ctx.orgId, holiday: { date: { gte: d(`${year}-01-01`), lte: d(`${year}-12-31`) } } },
    select: { holidayId: true, state: true },
    orderBy: { state: "asc" },
  });
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.holidayId] ??= []).push(r.state);
  return out;
}
