import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, fmtDate, iso } from "@/lib/dates";
import { leaveEligibility, workingDatesBetween, type LeaveCycle } from "@/lib/leave";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { assertPeriodEditable, deploymentOn } from "./operations";

const todayUtc = () => d(iso(new Date()));
const NOT_ON_LEAVE = ["TERMINATED", "RESIGNED", "EXITED", "INACTIVE", "SUSPENDED"];

// ───────────────────────────── Policy ─────────────────────────────

export async function getLeavePolicy(orgId: string, tx: Tx = db) {
  return tx.leavePolicy.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId },
    update: {},
  });
}

export const policySchema = z.object({
  annualDays: z.coerce.number().int().min(1).max(60),
  eligibilityMonths: z.coerce.number().int().min(0).max(60),
  workingDaysPerWeek: z.coerce
    .number()
    .int()
    .refine((n) => [5, 6, 7].includes(n), "Must be 5, 6 or 7"),
});

export async function updateLeavePolicy(ctx: Ctx, raw: z.input<typeof policySchema>) {
  assertCan(ctx, "leave.manage");
  const v = policySchema.parse(raw);
  const old = await getLeavePolicy(ctx.orgId);
  const next = await db.leavePolicy.update({ where: { organizationId: ctx.orgId }, data: v });
  await logAudit(ctx, {
    action: "LEAVE_POLICY_UPDATE",
    entity: "LeavePolicy",
    entityId: next.id,
    oldValue: old,
    newValue: next,
  });
  return next;
}

// ───────────────────────────── Balances ─────────────────────────────

export interface LeaveBalance {
  /** False until the first entitlement falls due. */
  due: boolean;
  cycle: LeaveCycle | null;
  nextDueDate: Date;
  entitled: number;
  approved: number;
  pending: number;
  remaining: number;
}

function computeBalance(
  emp: { employmentDate: Date },
  policy: { annualDays: number; eligibilityMonths: number },
  requests: Array<{ cycleStart: Date; status: string; workingDays: number }>,
  today: Date,
): LeaveBalance {
  const { cycle, nextDueDate } = leaveEligibility(emp.employmentDate, today, policy.eligibilityMonths);
  if (!cycle)
    return { due: false, cycle: null, nextDueDate, entitled: 0, approved: 0, pending: 0, remaining: 0 };
  const inCycle = requests.filter((r) => r.cycleStart.getTime() === cycle.start.getTime());
  const sum = (status: string) =>
    inCycle.filter((r) => r.status === status).reduce((a, r) => a + r.workingDays, 0);
  const approved = sum("APPROVED");
  const pending = sum("PENDING");
  return {
    due: true,
    cycle,
    nextDueDate,
    entitled: policy.annualDays,
    approved,
    pending,
    remaining: Math.max(0, policy.annualDays - approved - pending),
  };
}

async function balanceFor(tx: Tx, orgId: string, emp: { id: string; employmentDate: Date }, today: Date) {
  const policy = await getLeavePolicy(orgId, tx);
  const requests = await tx.leaveRequest.findMany({
    where: { organizationId: orgId, employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] } },
    select: { cycleStart: true, status: true, workingDays: true },
  });
  return { policy, balance: computeBalance(emp, policy, requests, today) };
}

/** Everything the employee-facing "My leave" page needs. */
export async function myLeave(ctx: Ctx) {
  if (!ctx.employeeId) return null;
  const emp = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId } });
  if (!emp) return null;
  const { policy, balance } = await balanceFor(db, ctx.orgId, emp, todayUtc());
  const requests = await db.leaveRequest.findMany({
    where: { organizationId: ctx.orgId, employeeId: emp.id },
    orderBy: { createdAt: "desc" },
  });
  return { employee: emp, policy, balance, requests };
}

// ───────────────────────────── Visibility ─────────────────────────────

/** Employees see their own leave; supervisors see the guards on their beats (and their own). */
function scope(ctx: Ctx): Prisma.LeaveRequestWhereInput {
  const base = { organizationId: ctx.orgId };
  if (ctx.role === "EMPLOYEE") return { ...base, employeeId: ctx.employeeId ?? "__none__" };
  if (ctx.role === "SUPERVISOR")
    return {
      ...base,
      OR: [
        { employee: { currentBeat: { supervisorId: ctx.userId } } },
        ...(ctx.employeeId ? [{ employeeId: ctx.employeeId }] : []),
      ],
    };
  return base;
}

export async function listLeave(ctx: Ctx, filter: { status?: string; employeeId?: string } = {}) {
  assertCan(ctx, "leave.view");
  return db.leaveRequest.findMany({
    where: {
      ...scope(ctx),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
    },
    include: { employee: { include: { currentBeat: { include: { client: true } } } } },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 500,
  });
}

export async function leaveBalances(ctx: Ctx) {
  assertCan(ctx, "leave.view");
  const today = todayUtc();
  const [policy, employees, requests] = await Promise.all([
    getLeavePolicy(ctx.orgId),
    db.employee.findMany({
      where: {
        organizationId: ctx.orgId,
        status: { in: ["ACTIVE", "ON_LEAVE"] },
        ...(ctx.role === "SUPERVISOR" ? { currentBeat: { supervisorId: ctx.userId } } : {}),
      },
      include: { category: true, currentBeat: true },
      orderBy: { employeeNumber: "asc" },
    }),
    db.leaveRequest.findMany({
      where: { organizationId: ctx.orgId, status: { in: ["PENDING", "APPROVED"] } },
      select: { employeeId: true, cycleStart: true, status: true, workingDays: true },
    }),
  ]);
  return {
    policy,
    rows: employees.map((e) => ({
      employee: e,
      balance: computeBalance(
        e,
        policy,
        requests.filter((r) => r.employeeId === e.id),
        today,
      ),
    })),
  };
}

export async function pendingLeaveCount(ctx: Ctx) {
  if (!can(ctx.role, "leave.approve")) return 0;
  return db.leaveRequest.count({
    where: { ...scope(ctx), status: "PENDING", NOT: { employeeId: ctx.employeeId ?? "__none__" } },
  });
}

// ───────────────────────────── Apply ─────────────────────────────

export const applySchema = z.object({
  employeeId: z.string().optional(),
  startDate: z.string().min(10, "Start date is required"),
  endDate: z.string().min(10, "End date is required"),
  reason: z.string().max(500).optional(),
});

/**
 * Employees apply for their own leave as soon as an entitlement is due. HR may apply on an
 * employee's behalf. The request waits for supervisor approval; its days are reserved meanwhile.
 */
export async function applyForLeave(ctx: Ctx, raw: z.input<typeof applySchema>) {
  const v = applySchema.parse(raw);
  const employeeId = v.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new BusinessError("Your user account is not linked to an employee record.");
  if (employeeId === ctx.employeeId) assertCan(ctx, "leave.apply");
  else assertCan(ctx, "leave.manage");

  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (NOT_ON_LEAVE.includes(emp.status))
    throw new BusinessError(`${emp.employeeNumber} is ${emp.status.toLowerCase()} and cannot take leave.`);

  const start = d(v.startDate);
  const end = d(v.endDate);
  const today = todayUtc();
  if (end < start) throw new BusinessError("The end date cannot be before the start date.");
  if (start < today) throw new BusinessError("Leave cannot start in the past.");

  return db.$transaction(async (tx) => {
    const { policy, balance } = await balanceFor(tx, ctx.orgId, emp, today);
    if (!balance.cycle)
      throw new BusinessError(
        `Annual leave is not yet due — it falls due on ${fmtDate(balance.nextDueDate)} (after ${policy.eligibilityMonths} months' service).`,
      );
    if (start > balance.cycle.end)
      throw new BusinessError(
        `Leave must start within the current leave year, which ends on ${fmtDate(balance.cycle.end)}.`,
      );
    const days = workingDatesBetween(start, end, policy.workingDaysPerWeek).length;
    if (!days) throw new BusinessError("The selected dates contain no working days.");
    if (days > balance.remaining)
      throw new BusinessError(
        `This request needs ${days} working day(s) but only ${balance.remaining} of ${balance.entitled} remain for this leave year.`,
      );
    const clash = await tx.leaveRequest.findFirst({
      where: {
        organizationId: ctx.orgId,
        employeeId: emp.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (clash)
      throw new BusinessError(
        `These dates overlap an existing ${clash.status.toLowerCase()} leave request (${fmtDate(clash.startDate)} – ${fmtDate(clash.endDate)}).`,
      );
    const req = await tx.leaveRequest.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: emp.id,
        cycleStart: balance.cycle.start,
        cycleEnd: balance.cycle.end,
        startDate: start,
        endDate: end,
        workingDays: days,
        reason: v.reason?.trim() || null,
        requestedBy: ctx.name,
      },
    });
    await logAudit(
      ctx,
      {
        action: "LEAVE_REQUEST",
        entity: "LeaveRequest",
        entityId: req.id,
        newValue: { employee: emp.employeeNumber, from: iso(start), to: iso(end), workingDays: days },
      },
      tx,
    );
    return req;
  });
}

// ───────────────────────────── Decide ─────────────────────────────

async function loadRequest(ctx: Ctx, id: string) {
  const req = await db.leaveRequest.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { employee: { include: { currentBeat: true } } },
  });
  if (!req) throw new BusinessError("Leave request not found.");
  return req;
}

/** A supervisor may only decide leave for guards on beats they supervise — never their own. */
function assertCanDecide(ctx: Ctx, req: Awaited<ReturnType<typeof loadRequest>>) {
  assertCan(ctx, "leave.approve");
  if (req.employeeId === ctx.employeeId)
    throw new BusinessError("You cannot approve or reject your own leave.");
  if (ctx.role === "SUPERVISOR" && req.employee.currentBeat?.supervisorId !== ctx.userId)
    throw new BusinessError(`${req.employee.employeeNumber} is not on a beat you supervise.`);
}

const marker = (id: string) => `Annual leave (request ${id})`;

export async function decideLeave(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const req = await loadRequest(ctx, id);
  assertCanDecide(ctx, req);
  if (req.status !== "PENDING")
    throw new BusinessError(`This request is already ${req.status.toLowerCase()}.`);
  if (decision === "REJECTED" && (!note || note.trim().length < 3))
    throw new BusinessError("Give a reason when rejecting leave.");

  return db.$transaction(async (tx) => {
    let marked = 0;
    const skipped: string[] = [];
    if (decision === "APPROVED") {
      const policy = await getLeavePolicy(ctx.orgId, tx);
      const beats = new Map<string, { id: string; clientId: string; contractId: string } | null>();
      for (const date of workingDatesBetween(req.startDate, req.endDate, policy.workingDaysPerWeek)) {
        await assertPeriodEditable(tx, ctx.orgId, date);
        const dep = await deploymentOn(tx, ctx.orgId, req.employeeId, date);
        const beatId = dep?.beatId ?? req.employee.currentBeatId;
        if (!beatId) {
          skipped.push(`${iso(date)} (no assignment)`);
          continue;
        }
        if (!beats.has(beatId))
          beats.set(beatId, await tx.beat.findFirst({ where: { id: beatId, organizationId: ctx.orgId } }));
        const beat = beats.get(beatId);
        if (!beat) continue;
        const existing = await tx.workRegister.findUnique({
          where: {
            organizationId_employeeId_date: { organizationId: ctx.orgId, employeeId: req.employeeId, date },
          },
        });
        if (existing && ["PRESENT", "LATE"].includes(existing.attendanceStatus)) {
          skipped.push(`${iso(date)} (already recorded as worked)`);
          continue;
        }
        const data = {
          clientId: beat.clientId,
          contractId: beat.contractId,
          beatId: beat.id,
          categoryId: dep?.categoryId ?? req.employee.categoryId,
          shift: "FULL" as const,
          attendanceStatus: "LEAVE" as const,
          hoursWorked: 0,
          overtimeHours: 0,
          supervisor: ctx.name,
          remarks: marker(req.id),
          source: "SYSTEM" as const,
          locationMismatch: false,
          mismatchResolved: false,
          recordedBy: ctx.name,
        };
        if (existing) await tx.workRegister.update({ where: { id: existing.id }, data });
        else
          await tx.workRegister.create({
            data: { organizationId: ctx.orgId, employeeId: req.employeeId, date, ...data },
          });
        marked++;
      }
    }
    const updated = await tx.leaveRequest.update({
      where: { id },
      data: {
        status: decision,
        decidedBy: ctx.name,
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    await logAudit(
      ctx,
      {
        action: decision === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
        entity: "LeaveRequest",
        entityId: id,
        newValue: {
          employee: req.employee.employeeNumber,
          from: iso(req.startDate),
          to: iso(req.endDate),
          workingDays: req.workingDays,
          workRegisterDaysMarked: marked,
        },
        reason: note ?? null,
      },
      tx,
    );
    return { request: updated, marked, skipped };
  });
}

// ───────────────────────────── Cancel ─────────────────────────────

export async function cancelLeave(ctx: Ctx, id: string) {
  const req = await loadRequest(ctx, id);
  const own = req.employeeId === ctx.employeeId;
  if (!own && !can(ctx.role, "leave.manage")) {
    // A supervisor may cancel leave for their own guards.
    assertCanDecide(ctx, req);
  }
  if (!["PENDING", "APPROVED"].includes(req.status))
    throw new BusinessError(`A ${req.status.toLowerCase()} request cannot be cancelled.`);
  if (req.status === "APPROVED" && req.startDate <= todayUtc())
    throw new BusinessError("Leave that has already started cannot be cancelled — ask HR to adjust it.");

  return db.$transaction(async (tx) => {
    if (req.status === "APPROVED") {
      const rows = await tx.workRegister.findMany({
        where: {
          organizationId: ctx.orgId,
          employeeId: req.employeeId,
          date: { gte: req.startDate, lte: req.endDate },
          attendanceStatus: "LEAVE",
          source: "SYSTEM",
          remarks: marker(req.id),
        },
      });
      for (const r of rows) await assertPeriodEditable(tx, ctx.orgId, r.date);
      if (rows.length) await tx.workRegister.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
    const updated = await tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    await logAudit(
      ctx,
      {
        action: "LEAVE_CANCELLED",
        entity: "LeaveRequest",
        entityId: id,
        oldValue: { status: req.status },
        newValue: { employee: req.employee.employeeNumber, from: iso(req.startDate), to: iso(req.endDate) },
      },
      tx,
    );
    return updated;
  });
}
