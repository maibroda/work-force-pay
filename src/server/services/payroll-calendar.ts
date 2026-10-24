/**
 * A client's payroll calendar and input tracker. The rhythm is agreed once (cut-off, draft, approval, pay day, remittance day); each pay
 * month gets concrete dates from it, which can be adjusted with a reason. The tracker lists the inputs the client owes for the month, whether each
 * has arrived, and a log of missing or inconsistent items. Where the work has really got to (draft calculated, approved, paid, remitted) is read
 * from the payroll itself, so a deadline is never ticked off by hand.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import {
  buildCalendar,
  DEFAULT_CALENDAR_RULE,
  datesProblems,
  daysUntil,
  INPUT_KINDS,
  MILESTONES,
  milestoneState,
  ruleProblems,
  type CalendarDates,
  type CalendarRule,
  type MilestoneState,
} from "@/lib/payroll-calendar";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { listClients } from "./bureau";

const KIND_SET = new Set<string>(INPUT_KINDS);

// ─────────────────────────────── The agreed rhythm ───────────────────────────────

export async function getCalendarSetting(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  const s = await db.payrollCalendarSetting.findUnique({ where: { organizationId: ctx.orgId } });
  const rule: CalendarRule = s
    ? { inputCutoffDay: s.inputCutoffDay, draftWorkingDays: s.draftWorkingDays, approvalWorkingDays: s.approvalWorkingDays, payDayOfMonth: s.payDayOfMonth, remittanceDueDay: s.remittanceDueDay }
    : DEFAULT_CALENDAR_RULE;
  return { rule, expectedInputs: s?.expectedInputs ?? [...INPUT_KINDS], saved: !!s };
}

export const calendarSettingSchema = z.object({
  inputCutoffDay: z.coerce.number().int(),
  draftWorkingDays: z.coerce.number().int(),
  approvalWorkingDays: z.coerce.number().int(),
  payDayOfMonth: z.coerce.number().int(),
  remittanceDueDay: z.coerce.number().int(),
  expectedInputs: z.array(z.enum(INPUT_KINDS)).default([...INPUT_KINDS]),
});

export async function saveCalendarSetting(ctx: Ctx, raw: z.input<typeof calendarSettingSchema>) {
  assertCan(ctx, "settings.manage");
  const v = calendarSettingSchema.parse(raw);
  const problems = ruleProblems(v);
  if (problems.length) throw new BusinessError(problems.join(" "));
  const before = await getCalendarSetting(ctx);
  await db.payrollCalendarSetting.upsert({
    where: { organizationId: ctx.orgId },
    create: { organizationId: ctx.orgId, ...v, updatedBy: ctx.name },
    update: { ...v, updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "PAYROLL_CALENDAR_SETTING_SAVE", entity: "PayrollCalendarSetting", entityId: ctx.orgId, oldValue: before, newValue: v });
}

// ─────────────────────────────── Each month ───────────────────────────────

const toDates = (e: { inputCutoff: Date; draftDue: Date; approvalDue: Date; payDate: Date; remittanceDue: Date }): CalendarDates => ({
  inputCutoff: iso(e.inputCutoff), draftDue: iso(e.draftDue), approvalDue: iso(e.approvalDue), payDate: iso(e.payDate), remittanceDue: iso(e.remittanceDue),
});

async function loadPeriod(ctx: Ctx, periodId: string) {
  const p = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Payroll period not found.");
  return p;
}

/** Works out a month's dates from the agreed rhythm and lists the inputs expected for it. */
export async function generateCalendar(ctx: Ctx, periodId: string) {
  assertCan(ctx, "payroll.inputs");
  const period = await loadPeriod(ctx, periodId);
  if (await db.payrollCalendarEntry.findUnique({ where: { periodId } })) throw new BusinessError(`${period.name} already has its dates. Adjust them instead.`);
  const { rule, expectedInputs } = await getCalendarSetting(ctx);
  const dates = buildCalendar(rule, period.year, period.month);
  return db.$transaction(async (tx) => {
    const entry = await tx.payrollCalendarEntry.create({
      data: { organizationId: ctx.orgId, periodId, inputCutoff: d(dates.inputCutoff), draftDue: d(dates.draftDue), approvalDue: d(dates.approvalDue), payDate: d(dates.payDate), remittanceDue: d(dates.remittanceDue), createdBy: ctx.name },
    });
    await tx.payrollInputItem.createMany({ data: expectedInputs.map((kind) => ({ organizationId: ctx.orgId, periodId, kind })), skipDuplicates: true });
    await logAudit(ctx, { action: "PAYROLL_CALENDAR_GENERATE", entity: "PayrollCalendarEntry", entityId: entry.id, newValue: { period: period.name, ...dates } }, tx);
    return { entry, problems: datesProblems(dates) };
  });
}

/** Gives every period that has no dates yet its dates. */
export async function generateMissingCalendars(ctx: Ctx) {
  assertCan(ctx, "payroll.inputs");
  const periods = await db.payrollPeriod.findMany({ where: { organizationId: ctx.orgId, calendarEntry: null }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  for (const p of periods) await generateCalendar(ctx, p.id);
  return periods.length;
}

export const adjustSchema = z.object({
  inputCutoff: z.string().min(10),
  draftDue: z.string().min(10),
  approvalDue: z.string().min(10),
  payDate: z.string().min(10),
  remittanceDue: z.string().min(10),
  reason: z.string().trim().min(10, "Say why the dates are changing (at least 10 characters), for example a public holiday or an agreement with the client."),
});

export async function adjustCalendar(ctx: Ctx, periodId: string, raw: z.input<typeof adjustSchema>) {
  assertCan(ctx, "payroll.inputs");
  const v = adjustSchema.parse(raw);
  const entry = await db.payrollCalendarEntry.findFirst({ where: { periodId, organizationId: ctx.orgId } });
  if (!entry) throw new BusinessError("This month has no dates yet. Generate them first.");
  const next: CalendarDates = { inputCutoff: v.inputCutoff, draftDue: v.draftDue, approvalDue: v.approvalDue, payDate: v.payDate, remittanceDue: v.remittanceDue };
  if (!(next.inputCutoff <= next.draftDue && next.draftDue <= next.approvalDue)) throw new BusinessError("The dates must run in order: inputs, then the draft, then approval.");
  const updated = await db.payrollCalendarEntry.update({
    where: { id: entry.id },
    data: { inputCutoff: d(next.inputCutoff), draftDue: d(next.draftDue), approvalDue: d(next.approvalDue), payDate: d(next.payDate), remittanceDue: d(next.remittanceDue), adjusted: true, adjustReason: v.reason, adjustedBy: ctx.name },
  });
  await logAudit(ctx, { action: "PAYROLL_CALENDAR_ADJUST", entity: "PayrollCalendarEntry", entityId: entry.id, oldValue: toDates(entry), newValue: next, reason: v.reason });
  return updated;
}

// ─────────────────────────────── The tracker ───────────────────────────────

export async function markInput(ctx: Ctx, periodId: string, kind: string, status: "RECEIVED" | "NOT_APPLICABLE" | "EXPECTED", note?: string) {
  assertCan(ctx, "payroll.inputs");
  if (!KIND_SET.has(kind)) throw new BusinessError("Unknown input.");
  const item = await db.payrollInputItem.findFirst({ where: { periodId, kind, organizationId: ctx.orgId } });
  if (!item) throw new BusinessError("That input is not expected for this month.");
  const text = (note ?? "").trim();
  if (status === "NOT_APPLICABLE" && text.length < 5) throw new BusinessError("Say why this input does not apply this month.");
  if (status === "RECEIVED" && text.length < 3) throw new BusinessError("Say how it arrived and from whom, for example: email from HR, 3 Nov.");
  const period = await loadPeriod(ctx, periodId);
  if (["APPROVED", "LOCKED", "PAID", "CLOSED"].includes(period.status)) throw new BusinessError("This month's payroll is already approved, so its inputs are no longer tracked.");
  await db.payrollInputItem.update({
    where: { id: item.id },
    data: status === "EXPECTED" ? { status, receivedAt: null, markedBy: null, markedByUserId: null, note: null } : { status, receivedAt: status === "RECEIVED" ? new Date() : null, markedBy: ctx.name, markedByUserId: ctx.userId, note: text },
  });
  await logAudit(ctx, { action: "PAYROLL_INPUT_MARK", entity: "PayrollInputItem", entityId: item.id, oldValue: { status: item.status }, newValue: { kind, status, note: text }, });
}

export async function raiseInputIssue(ctx: Ctx, periodId: string, kind: string | undefined, description: string) {
  assertCan(ctx, "payroll.inputs");
  if (!description || description.trim().length < 10) throw new BusinessError("Describe what is missing or inconsistent (at least 10 characters).");
  if (kind && !KIND_SET.has(kind)) throw new BusinessError("Unknown input.");
  await loadPeriod(ctx, periodId);
  const issue = await db.payrollInputIssue.create({ data: { organizationId: ctx.orgId, periodId, kind: kind || null, description: description.trim(), raisedBy: ctx.name, raisedByUserId: ctx.userId } });
  await logAudit(ctx, { action: "PAYROLL_INPUT_ISSUE_RAISE", entity: "PayrollInputIssue", entityId: issue.id, newValue: { kind, description: description.trim() } });
  return issue;
}

export async function resolveInputIssue(ctx: Ctx, issueId: string, resolution: string) {
  assertCan(ctx, "payroll.inputs");
  if (!resolution || resolution.trim().length < 5) throw new BusinessError("Say how it was settled.");
  const issue = await db.payrollInputIssue.findFirst({ where: { id: issueId, organizationId: ctx.orgId } });
  if (!issue) throw new BusinessError("Issue not found.");
  if (issue.status === "RESOLVED") throw new BusinessError("This issue is already resolved.");
  await db.payrollInputIssue.update({ where: { id: issueId }, data: { status: "RESOLVED", resolvedBy: ctx.name, resolvedAt: new Date(), resolution: resolution.trim() } });
  await logAudit(ctx, { action: "PAYROLL_INPUT_ISSUE_RESOLVE", entity: "PayrollInputIssue", entityId: issueId, reason: resolution });
}

// ─────────────────────────────── Where each deadline stands ───────────────────────────────

export type MilestoneView = { key: string; label: string; due: string; done: boolean; state: MilestoneState; days: number };

/** The five deadlines for an entry, each with whether the payroll itself shows it done. */
async function milestonesFor(orgId: string, periodId: string, entry: CalendarDates, today: string): Promise<MilestoneView[]> {
  const [items, run] = await Promise.all([
    db.payrollInputItem.findMany({ where: { periodId }, select: { status: true } }),
    db.payrollRun.findFirst({ where: { periodId, organizationId: orgId, type: "REGULAR", status: { not: "SUPERSEDED" } }, orderBy: { runNumber: "desc" }, select: { id: true, status: true } }),
  ]);
  const remits = run ? await db.statutoryRemittance.findMany({ where: { runId: run.id }, select: { status: true } }) : [];
  const done: Record<string, boolean> = {
    inputCutoff: items.every((i) => i.status !== "EXPECTED"),
    draftDue: !!run && ["CALCULATED", "PENDING_APPROVAL", "APPROVED", "LOCKED", "PAID"].includes(run.status),
    approvalDue: !!run && ["APPROVED", "LOCKED", "PAID"].includes(run.status),
    payDate: !!run && run.status === "PAID",
    remittanceDue: remits.length > 0 && remits.every((r) => r.status === "PAID"),
  };
  return MILESTONES.map((m) => ({ key: m.key, label: m.label, due: entry[m.key], done: done[m.key], state: milestoneState(entry[m.key], done[m.key], today), days: daysUntil(entry[m.key], today) }));
}

const today = () => iso(new Date());

/** What exists in the system for each input this month, so a tracker line can be checked against reality. */
async function evidence(orgId: string, periodId: string, start: Date, end: Date): Promise<Record<string, number>> {
  const [attendance, overtime, allowances, deductions, joined, left] = await Promise.all([
    db.workRegister.count({ where: { organizationId: orgId, date: { gte: start, lte: end } } }),
    db.overtime.count({ where: { organizationId: orgId, periodId } }),
    db.otherEarning.count({ where: { organizationId: orgId, periodId } }),
    db.deduction.count({ where: { organizationId: orgId, periodId } }),
    db.employee.count({ where: { organizationId: orgId, employmentDate: { gte: start, lte: end } } }),
    db.employee.count({ where: { organizationId: orgId, exitDate: { gte: start, lte: end } } }),
  ]);
  return { ATTENDANCE: attendance, OVERTIME: overtime, ALLOWANCES: allowances, DEDUCTIONS: deductions, JOINERS_LEAVERS: joined + left };
}

export async function periodTracker(ctx: Ctx, periodId: string) {
  assertCan(ctx, "payroll.view");
  const period = await loadPeriod(ctx, periodId);
  const entry = await db.payrollCalendarEntry.findUnique({ where: { periodId } });
  const [items, issues, ev] = await Promise.all([
    db.payrollInputItem.findMany({ where: { periodId }, orderBy: { kind: "asc" } }),
    db.payrollInputIssue.findMany({ where: { periodId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    evidence(ctx.orgId, periodId, period.startDate, period.endDate),
  ]);
  const dates = entry ? toDates(entry) : null;
  const milestones = dates ? await milestonesFor(ctx.orgId, periodId, dates, today()) : [];
  const order = new Map(INPUT_KINDS.map((k, i) => [k as string, i]));
  return {
    period,
    entry,
    dates,
    problems: dates ? datesProblems(dates) : [],
    milestones,
    items: items.sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99)).map((i) => ({ ...i, evidence: ev[i.kind] ?? null })),
    issues,
  };
}

/** Every month with its dates and where it stands, newest first. */
export async function calendarOverview(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  const periods = await db.payrollPeriod.findMany({ where: { organizationId: ctx.orgId }, include: { calendarEntry: true }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 24 });
  const now = today();
  const rows = [];
  for (const p of periods) {
    const dates = p.calendarEntry ? toDates(p.calendarEntry) : null;
    const milestones = dates ? await milestonesFor(ctx.orgId, p.id, dates, now) : [];
    rows.push({ period: p, dates, adjusted: p.calendarEntry?.adjusted ?? false, milestones, next: milestones.find((m) => !m.done) ?? null });
  }
  return rows;
}

export type DeadlineRow = { clientId: string; clientName: string; periodId: string; period: string; label: string; due: string; state: MilestoneState; days: number };

/** What is overdue or due within `withinDays` across the clients this person may work in. */
export async function bureauDeadlines(ctx: Ctx, withinDays = 7): Promise<DeadlineRow[]> {
  assertCan(ctx, "bureau.view");
  const { clients } = await listClients(ctx);
  if (!clients.length) return [];
  const now = today();
  const horizon = iso(new Date(Date.now() + withinDays * 86400000));
  const entries = await db.payrollCalendarEntry.findMany({
    where: { organizationId: { in: clients.map((c) => c.org.id) }, remittanceDue: { gte: new Date(Date.now() - 60 * 86400000) } },
    include: { period: { select: { name: true } } },
  });
  const nameOf = new Map(clients.map((c) => [c.org.id, c.org.name]));
  const out: DeadlineRow[] = [];
  for (const e of entries) {
    for (const m of await milestonesFor(e.organizationId, e.periodId, toDates(e), now))
      if (!m.done && m.due <= horizon) out.push({ clientId: e.organizationId, clientName: nameOf.get(e.organizationId) ?? "", periodId: e.periodId, period: e.period.name, label: m.label, due: m.due, state: m.state, days: m.days });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.clientName.localeCompare(b.clientName));
}
