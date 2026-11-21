/**
 * Paid sick leave for a person paid by the hour, step 2a (the founder's H14, docs/plans/hourly-payroll-h14-build-plan.md): RECORDING a spell of sickness, its approval by HR, and the days of entitlement. The pay for the
 * days is the next step; nothing here changes any pay.
 *
 * His answers of 2026-11-20 and 2026-11-21: paid sick leave, a set number of days a year (the leave policy's `sickDaysPerYear`, 5), in the same leave year as annual leave and after the same service period; a medical
 * certificate is needed; HR approves, and never the person who recorded the spell. A spell holds ONLY the dates, the working days and the certificate's id: never a diagnosis or any health detail. The certificate is a
 * document in the employee's medical category (the document store already restricts those to people with sensitive access). The audit log holds ids and numbers only; the words of a rejection stay on the spell.
 *
 * Who sees what: HR (leave.manage) sees every spell; a person sees their own; nobody else (a supervisor does not see sickness). Every query is scoped to the caller's company.
 * Days beyond the entitlement are not refused: sickness is not optional; they are simply not paid (worked out where the pay is).
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, fmtDate, iso } from "@/lib/dates";
import { leaveEligibility, workingDatesBetween } from "@/lib/leave";
import { compensationTypeOn } from "@/lib/payroll/hourly-rates";
import { sickBalance, sickCycleFor } from "@/lib/sick-leave";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { getLeavePolicy } from "./leave";

const NOT_ON_LEAVE = ["TERMINATED", "RESIGNED", "EXITED", "INACTIVE", "SUSPENDED"];

export const sickSpellSchema = z.object({
  employeeId: z.string().min(1).optional(),
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  certificateDocumentId: z.string().min(1),
});

/** A closed pay period cannot take a sick spell (its pay could never be made). An approved, locked or paid one can: it is paid by a supplementary payroll, as late hours are. */
async function assertPeriodsOpenEnough(tx: Tx, orgId: string, start: Date, end: Date) {
  const closed = await tx.payrollPeriod.findFirst({ where: { organizationId: orgId, status: "CLOSED", startDate: { lte: end }, endDate: { gte: start } }, select: { name: true } });
  if (closed) throw new BusinessError(`Payroll for ${closed.name} is closed: a spell of sickness in those dates cannot be recorded or approved.`);
}

async function loadSpell(ctx: Ctx, id: string) {
  const s = await db.sickSpell.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!s) throw new BusinessError("Sick spell not found.");
  return s;
}

const facts = (s: { employeeId: string; startDate: Date; endDate: Date; workingDays: number; certificateDocumentId: string }) => ({ employeeId: s.employeeId, from: iso(s.startDate), to: iso(s.endDate), workingDays: s.workingDays, certificate: s.certificateDocumentId });

// ───────────────────────────── Record ─────────────────────────────

export async function recordSickSpell(ctx: Ctx, raw: z.input<typeof sickSpellSchema>) {
  const v = sickSpellSchema.parse(raw);
  const employeeId = v.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new BusinessError("Your user account is not linked to an employee record.");
  // HR may record for anyone; a person only for themselves
  if (!can(ctx.role, "leave.manage")) {
    assertCan(ctx, "leave.apply");
    if (employeeId !== ctx.employeeId) assertCan(ctx, "leave.manage");
  }
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (NOT_ON_LEAVE.includes(emp.status)) throw new BusinessError(`${emp.employeeNumber} is ${emp.status.toLowerCase()}: a spell of sickness cannot be recorded.`);
  const start = d(v.startDate);
  const end = d(v.endDate);
  if (end < start) throw new BusinessError("The end date cannot be before the start date.");

  return db.$transaction(async (tx) => {
    const policy = await getLeavePolicy(ctx.orgId, tx);
    if (policy.sickDaysPerYear <= 0) throw new BusinessError("Paid sick leave is not set up for this company: HR sets the paid sick days a year in the leave policy.");
    const comp = await tx.employeeCompensationType.findMany({ where: { organizationId: ctx.orgId, employeeId, status: "APPROVED", effectiveFrom: { lte: end } }, select: { type: true, effectiveFrom: true, status: true } });
    if (compensationTypeOn(comp, start) !== "HOURLY") throw new BusinessError("Paid sick leave is for staff paid by the hour: this person is paid monthly on those dates.");
    const cycle = sickCycleFor(emp.employmentDate, start, policy.eligibilityMonths);
    if (!cycle) {
      const due = leaveEligibility(emp.employmentDate, start, policy.eligibilityMonths).nextDueDate;
      throw new BusinessError(`Paid sick leave falls due after ${policy.eligibilityMonths} months' service, on ${fmtDate(due)}: it is not yet due for those dates.`);
    }
    const days = workingDatesBetween(start, end, policy.workingDaysPerWeek).length;
    if (!days) throw new BusinessError("The selected dates contain no working days.");
    const doc = await tx.employeeDocument.findFirst({ where: { id: v.certificateDocumentId, organizationId: ctx.orgId, employeeId, archivedAt: null }, include: { type: { select: { category: true } } } });
    if (!doc) throw new BusinessError("The medical certificate was not found for this employee: add it to their documents first.");
    if (doc.type?.category !== "MEDICAL") throw new BusinessError("The certificate must be a document in the medical category.");
    const clash = await tx.sickSpell.findFirst({ where: { organizationId: ctx.orgId, employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } } });
    if (clash) throw new BusinessError(`These dates overlap an existing ${clash.status.toLowerCase()} spell (${fmtDate(clash.startDate)} – ${fmtDate(clash.endDate)}).`);
    await assertPeriodsOpenEnough(tx, ctx.orgId, start, end);
    const spell = await tx.sickSpell.create({
      data: { organizationId: ctx.orgId, employeeId, cycleStart: cycle.start, cycleEnd: cycle.end, startDate: start, endDate: end, workingDays: days, certificateDocumentId: doc.id, recordedBy: ctx.name, recordedByUserId: ctx.userId },
    });
    await logAudit(ctx, { action: "SICK_SPELL_RECORD", entity: "SickSpell", entityId: spell.id, newValue: facts(spell) }, tx);
    return spell;
  });
}

// ───────────────────────────── Decide ─────────────────────────────

/** HR approves or rejects, and never the person who recorded the spell or the person it is about. */
export async function decideSickSpell(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  assertCan(ctx, "leave.manage");
  const spell = await loadSpell(ctx, id);
  if (spell.status !== "PENDING") throw new BusinessError(`This spell is already ${spell.status.toLowerCase()}.`);
  if (spell.recordedByUserId === ctx.userId) throw new BusinessError("You recorded this spell, so someone else must approve or reject it.");
  if (spell.employeeId === ctx.employeeId) throw new BusinessError("You cannot approve or reject your own sickness.");
  if (decision === "REJECTED" && (!note || note.trim().length < 3)) throw new BusinessError("Give a reason when rejecting a spell of sickness.");
  return db.$transaction(async (tx) => {
    if (decision === "APPROVED") await assertPeriodsOpenEnough(tx, ctx.orgId, spell.startDate, spell.endDate);
    const updated = await tx.sickSpell.update({ where: { id }, data: { status: decision, decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    // the audit log keeps ids and numbers only: the words of a rejection stay on the spell
    await logAudit(ctx, { action: decision === "APPROVED" ? "SICK_SPELL_APPROVED" : "SICK_SPELL_REJECTED", entity: "SickSpell", entityId: id, newValue: facts(spell) }, tx);
    return updated;
  });
}

/** A spell can be cancelled while it waits, by whoever recorded it or by HR. Once approved it can no longer be cancelled here. */
export async function cancelSickSpell(ctx: Ctx, id: string) {
  const spell = await loadSpell(ctx, id);
  if (spell.recordedByUserId !== ctx.userId && !can(ctx.role, "leave.manage")) throw new BusinessError("Only the person who recorded this spell, or HR, may cancel it.");
  if (spell.status !== "PENDING") throw new BusinessError(`This spell is already ${spell.status.toLowerCase()} and cannot be cancelled.`);
  return db.$transaction(async (tx) => {
    const updated = await tx.sickSpell.update({ where: { id }, data: { status: "CANCELLED" } });
    await logAudit(ctx, { action: "SICK_SPELL_CANCELLED", entity: "SickSpell", entityId: id, newValue: facts(spell) }, tx);
    return updated;
  });
}

// ───────────────────────────── Read ─────────────────────────────

/** HR sees every spell of the company; a person sees their own; nobody else sees any. */
export async function listSickSpells(ctx: Ctx, filter: { employeeId?: string; status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } = {}) {
  const base: Prisma.SickSpellWhereInput = { organizationId: ctx.orgId, ...(filter.status ? { status: filter.status } : {}) };
  const include = { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } } as const;
  if (can(ctx.role, "leave.manage")) return db.sickSpell.findMany({ where: { ...base, ...(filter.employeeId ? { employeeId: filter.employeeId } : {}) }, include, orderBy: [{ startDate: "desc" }, { id: "asc" }] });
  if (!ctx.employeeId) return [];
  return db.sickSpell.findMany({ where: { ...base, employeeId: ctx.employeeId }, include, orderBy: [{ startDate: "desc" }, { id: "asc" }] });
}

/** The days of paid sick leave in the leave year that contains `onDate` (today when left out): entitled, approved, waiting and left. */
export async function sickLeaveBalance(ctx: Ctx, employeeId: string, onDate?: string) {
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true, employmentDate: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (!can(ctx.role, "leave.manage") && employeeId !== ctx.employeeId) throw new BusinessError("Employee not found.");
  const policy = await getLeavePolicy(ctx.orgId);
  const date = onDate ? d(onDate) : d(iso(new Date()));
  const { cycle, nextDueDate } = leaveEligibility(emp.employmentDate, date, policy.eligibilityMonths);
  if (!cycle) return { due: false, cycle: null, nextDueDate, entitled: 0, approved: 0, pending: 0, remaining: 0 };
  const spells = await db.sickSpell.findMany({ where: { organizationId: ctx.orgId, employeeId }, select: { cycleStart: true, status: true, workingDays: true } });
  return { due: true, cycle, nextDueDate, ...sickBalance(policy.sickDaysPerYear, spells, cycle.start) };
}

// ───────────────────────────── For the screens (step 2c) ─────────────────────────────

/**
 * The medical documents that can be attached to a spell as its certificate: HR sees the company's (newest first, at most 300) with whose they are; a person sees their own; nobody else sees any. Archived documents and
 * documents that are not in the medical category are left out. Only the document's kind and date are shown, never its contents.
 */
export async function listMedicalCertificates(ctx: Ctx) {
  const hr = can(ctx.role, "leave.manage");
  if (!hr && !ctx.employeeId) return [];
  const rows = await db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId, archivedAt: null, type: { category: "MEDICAL" }, ...(hr ? {} : { employeeId: ctx.employeeId! }) },
    select: { id: true, employeeId: true, createdAt: true, type: { select: { name: true } }, employee: { select: { employeeNumber: true, firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 300,
  });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeNumber: r.employee.employeeNumber, employeeName: `${r.employee.firstName} ${r.employee.lastName}`, typeName: r.type?.name ?? "Medical document", createdAt: r.createdAt }));
}

/** HR records a spell by choosing the certificate, which says whose it is (the employee is taken from it). Everything else is as in `recordSickSpell`. */
export async function recordSickSpellFromCertificate(ctx: Ctx, raw: { certificateDocumentId: string; startDate: string; endDate: string }) {
  assertCan(ctx, "leave.manage");
  const doc = await db.employeeDocument.findFirst({ where: { id: raw.certificateDocumentId, organizationId: ctx.orgId, archivedAt: null }, select: { employeeId: true } });
  if (!doc) throw new BusinessError("The medical certificate was not found.");
  return recordSickSpell(ctx, { employeeId: doc.employeeId, startDate: raw.startDate, endDate: raw.endDate, certificateDocumentId: raw.certificateDocumentId });
}

/**
 * What My leave shows a person about sickness: nothing (`show` false) while paid sick leave is not set up or when the person is paid monthly; for a person paid by the hour, the days of the leave year, their own spells and
 * their own medical certificates. Null for an account with no employee record. Their own data only.
 */
export async function mySickLeave(ctx: Ctx) {
  if (!ctx.employeeId) return null;
  const emp = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId }, select: { id: true } });
  if (!emp) return null;
  const policy = await getLeavePolicy(ctx.orgId);
  const today = d(iso(new Date()));
  const comp = await db.employeeCompensationType.findMany({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: "APPROVED", effectiveFrom: { lte: today } }, select: { type: true, effectiveFrom: true, status: true } });
  const none = { show: false, entitled: policy.sickDaysPerYear, balance: null, spells: [] as Awaited<ReturnType<typeof listSickSpells>>, certificates: [] as Awaited<ReturnType<typeof listMedicalCertificates>> };
  if (policy.sickDaysPerYear <= 0 || compensationTypeOn(comp, today) !== "HOURLY") return none;
  const [balance, spells, certificates] = await Promise.all([sickLeaveBalance(ctx, emp.id), listSickSpells(ctx, {}), listMedicalCertificates(ctx)]);
  return { show: true, entitled: policy.sickDaysPerYear, balance, spells, certificates };
}
