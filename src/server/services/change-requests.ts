/**
 * Change control for an employee's bank, tax and pension details.
 *
 * Quietly changing someone's bank account is the classic payroll fraud, so by default (HR policy) these
 * details can't be edited directly: a change is *requested* — by HR, or by the employee for themselves —
 * and takes effect only when someone other than the requester approves it. The approver is shown what is
 * on file beside what is asked for, and whether the account name looks like the employee's. Approval is
 * refused if the new account number, tax ID or pension PIN already belongs to someone else, or if the
 * employee's details have changed since the request was made.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import {
  FIELD_LABELS,
  KIND_AUDIT,
  KIND_FIELDS,
  KIND_LABELS,
  nameLooksLike,
  normalizeValue,
  sameValues,
  type ChangeKindName,
} from "@/lib/change-control";
import { addDays } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const SCHEMAS: Record<ChangeKindName, z.ZodTypeAny> = {
  BANK: z.object({
    bankName: z.string().trim().min(2, "Bank name is required"),
    accountNumber: z.string().trim().regex(/^\d{10}$/, "Account number must be 10 digits (NUBAN)"),
    accountName: z.string().trim().min(3, "Account name is required"),
  }),
  // a blank rent clears it — it must not be read as 0
  TAX: z.object({ taxId: opt, annualRent: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().min(0, "Rent can't be negative").optional()) }),
  PENSION: z.object({ pensionPin: opt, pfa: opt }),
};

const isSelf = (ctx: Ctx, employeeId: string) => !!ctx.employeeId && ctx.employeeId === employeeId && can(ctx.role, "self.view");

async function loadEmployee(ctx: Ctx, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!e) throw new BusinessError("Employee not found.");
  return e;
}

/** What the employee holds now for one kind of change, as plain values. */
function snapshot(e: Record<string, unknown>, kind: ChangeKindName) {
  return Object.fromEntries(KIND_FIELDS[kind].map((f) => [f, f === "annualRent" ? (e[f] == null ? null : Number(e[f])) : normalizeValue(e[f])]));
}

// ───────────────────────────── Requesting ─────────────────────────────

export async function requestChange(ctx: Ctx, employeeId: string, kind: ChangeKindName, raw: Record<string, unknown>, reason: string) {
  if (!isSelf(ctx, employeeId)) assertCan(ctx, "employee.manage");
  const emp = await loadEmployee(ctx, employeeId);
  if (GONE.includes(emp.status)) throw new BusinessError("This employee has left — their details can no longer be changed.");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why the details are changing (at least a few words).");
  const fields = KIND_FIELDS[kind];
  const parsed = SCHEMAS[kind].parse(Object.fromEntries(fields.map((f) => [f, raw[f]]))) as Record<string, unknown>;
  const proposed = Object.fromEntries(fields.map((f) => [f, normalizeValue(parsed[f])]));
  const previous = snapshot(emp as never, kind);
  if (sameValues(proposed, previous, fields)) throw new BusinessError("That's what is already on file — nothing to change.");
  if (await db.employeeChangeRequest.findFirst({ where: { organizationId: ctx.orgId, employeeId, kind, status: "PENDING" } }))
    throw new BusinessError(`There is already a pending request to change this employee's ${KIND_LABELS[kind].toLowerCase()} — approve, reject or cancel it first.`);
  const r = await db.employeeChangeRequest.create({
    data: { organizationId: ctx.orgId, employeeId, kind, proposed, previous, reason: reason.trim(), requestedBy: ctx.name, requestedByUserId: ctx.userId },
  });
  await logAudit(ctx, { action: "CHANGE_REQUEST", entity: "Employee", entityId: employeeId, oldValue: previous, newValue: proposed, reason });
  return r;
}

export async function cancelChange(ctx: Ctx, id: string) {
  const r = await db.employeeChangeRequest.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Change request not found.");
  if (r.requestedByUserId !== ctx.userId) throw new BusinessError("Only the person who made the request can cancel it.");
  if (r.status !== "PENDING") throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  const u = await db.employeeChangeRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date(), decidedBy: ctx.name, decidedByUserId: ctx.userId } });
  await logAudit(ctx, { action: "CHANGE_REQUEST_CANCEL", entity: "Employee", entityId: r.employeeId });
  return u;
}

// ───────────────────────────── Deciding ─────────────────────────────

/** Another current employee already holds this account number / tax ID / pension PIN. */
async function conflictFor(orgId: string, employeeId: string, kind: ChangeKindName, proposed: Record<string, unknown>) {
  const field = kind === "BANK" ? "accountNumber" : kind === "TAX" ? "taxId" : "pensionPin";
  const value = proposed[field];
  if (!value) return null;
  return db.employee.findFirst({
    where: { organizationId: orgId, id: { not: employeeId }, status: { notIn: GONE as never }, [field]: String(value) },
    select: { employeeNumber: true, firstName: true, lastName: true },
  });
}

async function loadPending(ctx: Ctx, id: string) {
  assertCan(ctx, "employee.approve");
  const r = await db.employeeChangeRequest.findFirst({ where: { id, organizationId: ctx.orgId }, include: { employee: true } });
  if (!r) throw new BusinessError("Change request not found.");
  if (r.status !== "PENDING") throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  if (r.requestedByUserId === ctx.userId) throw new BusinessError("You made this request — someone else has to decide it.");
  if (ctx.employeeId && ctx.employeeId === r.employeeId) throw new BusinessError("These are your own details — someone else has to decide this.");
  return r;
}

export async function approveChange(ctx: Ctx, id: string, note?: string) {
  const r = await loadPending(ctx, id);
  const kind = r.kind as ChangeKindName;
  const fields = KIND_FIELDS[kind];
  const proposed = r.proposed as Record<string, unknown>;
  if (GONE.includes(r.employee.status)) throw new BusinessError("This employee has left — reject this request.");
  if (!sameValues(snapshot(r.employee as never, kind), r.previous as Record<string, unknown>, fields))
    throw new BusinessError("The employee's details have changed since this was requested — reject it and ask for a fresh request.");
  const clash = await conflictFor(ctx.orgId, r.employeeId, kind, proposed);
  if (clash) throw new BusinessError(`That ${FIELD_LABELS[kind === "BANK" ? "accountNumber" : kind === "TAX" ? "taxId" : "pensionPin"].toLowerCase()} is already on ${clash.employeeNumber} ${clash.firstName} ${clash.lastName} — it can't be on two people.`);
  const data = Object.fromEntries(fields.map((f) => [f, proposed[f] ?? null]));
  return db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: r.employeeId }, data });
    const u = await tx.employeeChangeRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null, appliedAt: new Date() },
    });
    await logAudit(ctx, { action: KIND_AUDIT[kind], entity: "Employee", entityId: r.employeeId, oldValue: r.previous, newValue: proposed, reason: r.reason }, tx);
    await logAudit(ctx, { action: "CHANGE_REQUEST_APPROVE", entity: "Employee", entityId: r.employeeId, newValue: { kind, requestedBy: r.requestedBy }, reason: note }, tx);
    return u;
  });
}

export async function rejectChange(ctx: Ctx, id: string, note: string) {
  const r = await loadPending(ctx, id);
  if (!note || note.trim().length < 3) throw new BusinessError("Give a reason.");
  const u = await db.employeeChangeRequest.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
  await logAudit(ctx, { action: "CHANGE_REQUEST_REJECT", entity: "Employee", entityId: r.employeeId, reason: note });
  return u;
}

// ───────────────────────────── Reading ─────────────────────────────

const employeeSelect = { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, status: true } as const;

/** Adds what an approver needs to judge a request: whether the account name fits, and who else holds the number. */
async function decorate<T extends { kind: string; proposed: unknown; employeeId: string; employee: { firstName: string; lastName: string } }>(orgId: string, rows: T[]) {
  return Promise.all(
    rows.map(async (r) => {
      const proposed = r.proposed as Record<string, unknown>;
      const clash = await conflictFor(orgId, r.employeeId, r.kind as ChangeKindName, proposed);
      return { ...r, nameMatches: r.kind === "BANK" ? nameLooksLike(proposed.accountName as string, r.employee) : null, clash: clash ? `${clash.employeeNumber} ${clash.firstName} ${clash.lastName}` : null };
    }),
  );
}

export async function listChanges(ctx: Ctx, f: { status?: string; employeeId?: string } = {}) {
  assertCan(ctx, "employee.sensitive");
  const rows = await db.employeeChangeRequest.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status as never } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}) },
    include: { employee: { select: employeeSelect } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return decorate(ctx.orgId, rows);
}

/** The employee's own requests (self-service). */
export async function myChanges(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  return db.employeeChangeRequest.findMany({ where: { organizationId: ctx.orgId, employeeId: ctx.employeeId }, orderBy: { createdAt: "desc" }, take: 50 });
}

/** For the employee page: HR sees every request on the employee; the employee sees their own. */
export async function employeeChanges(ctx: Ctx, employeeId: string) {
  if (isSelf(ctx, employeeId)) return db.employeeChangeRequest.findMany({ where: { organizationId: ctx.orgId, employeeId }, include: { employee: { select: employeeSelect } }, orderBy: { createdAt: "desc" }, take: 50 }).then((r) => decorate(ctx.orgId, r));
  return listChanges(ctx, { employeeId });
}

/** What an employee has on file for each kind of detail — for the request forms. Employees may read their own. */
export async function currentDetails(ctx: Ctx, employeeId: string) {
  if (!isSelf(ctx, employeeId)) assertCan(ctx, "employee.sensitive");
  const e = await loadEmployee(ctx, employeeId);
  return {
    employee: { id: e.id, employeeNumber: e.employeeNumber, firstName: e.firstName, lastName: e.lastName, status: e.status },
    BANK: snapshot(e as never, "BANK"),
    TAX: snapshot(e as never, "TAX"),
    PENSION: snapshot(e as never, "PENSION"),
  };
}

// ───────────────────────────── For payroll and the digest (no permission check — they run as the system) ─────────────────────────────

/** Employees whose bank details were changed within the policy's watch window, with when and by whom. */
export async function recentBankChanges(orgId: string, employeeIds: string[]) {
  const policy = await db.hrPolicy.findUnique({ where: { organizationId: orgId }, select: { bankChangeWatchDays: true } });
  const days = policy?.bankChangeWatchDays ?? 30;
  if (days <= 0 || !employeeIds.length) return [];
  return db.employeeChangeRequest.findMany({
    where: { organizationId: orgId, kind: "BANK", status: "APPROVED", employeeId: { in: employeeIds }, appliedAt: { gte: addDays(todayUtc(), -days) } },
    orderBy: { appliedAt: "desc" },
  });
}

export async function pendingChanges(orgId: string) {
  return db.employeeChangeRequest.findMany({ where: { organizationId: orgId, status: "PENDING" }, include: { employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" } });
}
