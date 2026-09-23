import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d, daysInMonth, eachDay, iso, monthEnd, monthStart } from "@/lib/dates";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { buildLocationRanges, type AttendanceStatus } from "@/lib/payroll/engine";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { recomputeBeatStatus } from "./clients";

export const LOCATION_MISMATCH =
  "Location mismatch — employee was not assigned to this location on this date.";
export const CLIENT_MISMATCH = "Client mismatch detected.";

// ─────────────────────────── Locked-period guard ───────────────────────────

const FROZEN: Prisma.PayrollPeriodWhereInput["status"] = { in: ["APPROVED", "LOCKED", "PAID", "CLOSED"] };

/** Once Finance approves & locks payroll, normal operational modifications stop. */
export async function assertPeriodEditable(tx: Tx, orgId: string, date: Date) {
  const p = await tx.payrollPeriod.findFirst({
    where: { organizationId: orgId, startDate: { lte: date }, endDate: { gte: date }, status: FROZEN },
  });
  if (p)
    throw new BusinessError(
      `Payroll for ${p.name} is ${p.status.toLowerCase()} — operational records for this date cannot be changed. Use a supplementary payroll for corrections.`,
    );
}

// ───────────────────────────── Deployment ─────────────────────────────

export const deploySchema = z.object({
  employeeId: z.string().min(1),
  beatId: z.string().min(1),
  categoryId: z.string().optional(),
  startDate: z.string().min(10),
  shift: z.enum(["DAY", "NIGHT", "FULL"]).default("FULL"),
});

async function deployInTx(
  tx: Tx,
  ctx: Ctx,
  v: {
    employeeId: string;
    beatId: string;
    categoryId?: string;
    startDate: Date;
    endDate?: Date | null;
    shift?: "DAY" | "NIGHT" | "FULL";
    movementId?: string;
  },
) {
  const emp = await tx.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (["TERMINATED", "RESIGNED", "EXITED"].includes(emp.status))
    throw new BusinessError(`Employee ${emp.employeeNumber} has exited and cannot be deployed.`);
  const beat = await tx.beat.findFirst({ where: { id: v.beatId, organizationId: ctx.orgId } });
  if (!beat) throw new BusinessError("Beat not found.");
  if (beat.status === "INACTIVE") throw new BusinessError("Beat is inactive.");

  // Close deployments that overlap the new start date.
  const overlapping = await tx.deployment.findMany({
    where: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      startDate: { lte: v.startDate },
      OR: [{ endDate: null }, { endDate: { gte: v.startDate } }],
    },
  });
  const touchedBeats = new Set<string>([beat.id]);
  for (const o of overlapping) {
    touchedBeats.add(o.beatId);
    if (o.startDate.getTime() === v.startDate.getTime()) {
      // Same-day replacement of an assignment: the earlier record never took effect.
      await tx.deployment.delete({ where: { id: o.id } });
    } else {
      await tx.deployment.update({
        where: { id: o.id },
        data: { endDate: addDays(v.startDate, -1), status: "ENDED" },
      });
    }
  }
  const today = d(iso(new Date()));
  const dep = await tx.deployment.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      clientId: beat.clientId,
      contractId: beat.contractId,
      beatId: beat.id,
      categoryId: v.categoryId || emp.categoryId,
      shift: v.shift ?? "FULL",
      startDate: v.startDate,
      endDate: v.endDate ?? null,
      status: v.endDate && v.endDate < today ? "ENDED" : "ACTIVE",
      movementId: v.movementId,
    },
  });
  await syncCurrentLocation(tx, ctx.orgId, emp.id);
  for (const b of touchedBeats) await recomputeBeatStatus(tx, ctx.orgId, b);
  const actual = await tx.deployment.count({
    where: { organizationId: ctx.orgId, beatId: beat.id, status: "ACTIVE" },
  });
  const warning =
    actual > beat.approvedStrength
      ? `Overdeployment: ${beat.name} now has ${actual} against approved strength ${beat.approvedStrength}.`
      : null;
  return { deployment: dep, warning, employee: emp, beat };
}

/**
 * "Current Location" is only an operational status (the deployment covering today, or the
 * next future one). Payroll NEVER uses it — payroll reads the work register for the period.
 */
export async function syncCurrentLocation(tx: Tx, orgId: string, employeeId: string) {
  const today = d(iso(new Date()));
  const deps = await tx.deployment.findMany({
    where: { organizationId: orgId, employeeId },
    orderBy: { startDate: "asc" },
  });
  for (const dep of deps) {
    const status = dep.endDate && dep.endDate < today ? "ENDED" : "ACTIVE";
    if (status !== dep.status) await tx.deployment.update({ where: { id: dep.id }, data: { status } });
  }
  const current =
    deps.find((x) => x.startDate <= today && (!x.endDate || x.endDate >= today)) ??
    deps.find((x) => x.startDate > today) ??
    null;
  await tx.employee.update({
    where: { id: employeeId },
    data: { currentBeatId: current?.beatId ?? null, currentClientId: current?.clientId ?? null },
  });
}

export async function deployEmployee(ctx: Ctx, raw: z.input<typeof deploySchema>) {
  assertCan(ctx, "operations.manage");
  const v = deploySchema.parse(raw);
  return db.$transaction(async (tx) => {
    const res = await deployInTx(tx, ctx, { ...v, startDate: d(v.startDate) });
    await logAudit(
      ctx,
      {
        action: "EMPLOYEE_DEPLOYMENT",
        entity: "Deployment",
        entityId: res.deployment.id,
        newValue: { employee: res.employee.employeeNumber, beat: res.beat.name, startDate: v.startDate },
      },
      tx,
    );
    await recheckMismatches(tx, ctx.orgId, v.employeeId, d(v.startDate));
    return res;
  });
}

export async function listDeployments(
  ctx: Ctx,
  f: { beatId?: string; clientId?: string; activeOnly?: boolean; q?: string } = {},
) {
  return db.deployment.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.beatId ? { beatId: f.beatId } : {}),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.activeOnly ? { status: "ACTIVE" } : {}),
      ...(f.q
        ? {
            employee: {
              OR: [
                { employeeNumber: { contains: f.q, mode: "insensitive" } },
                { lastName: { contains: f.q, mode: "insensitive" } },
                { firstName: { contains: f.q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: { employee: true, beat: true, client: true, contract: true, category: true },
    orderBy: [{ startDate: "desc" }],
    take: 300,
  });
}

// ───────────────────────────── Staff movement ─────────────────────────────

export const movementSchema = z.object({
  employeeId: z.string().min(1),
  toBeatId: z.string().min(1),
  movementType: z.enum([
    "PERMANENT_TRANSFER",
    "TEMPORARY_TRANSFER",
    "RELIEF",
    "REPLACEMENT",
    "CLIENT_TRANSFER",
    "LOCATION_TRANSFER",
    "SHIFT_CHANGE",
  ]),
  movementDate: z.string().min(10),
  effectiveDate: z.string().min(10),
  endDate: z.string().optional(),
  reason: z.string().trim().min(3, "Reason is required"),
  remarks: z.string().optional(),
  approve: z.coerce.boolean().default(false),
});

export async function createMovement(ctx: Ctx, raw: z.input<typeof movementSchema>) {
  assertCan(ctx, "operations.manage");
  const v = movementSchema.parse(raw);
  const effective = d(v.effectiveDate);
  const endDate = v.endDate ? d(v.endDate) : null;
  if (endDate && endDate < effective)
    throw new BusinessError("End date cannot be before the effective date.");
  if (["TEMPORARY_TRANSFER", "RELIEF"].includes(v.movementType) && !endDate)
    throw new BusinessError("Temporary transfers and reliefs need an end date.");
  const toBeat = await db.beat.findFirst({ where: { id: v.toBeatId, organizationId: ctx.orgId } });
  if (!toBeat) throw new BusinessError("Destination beat not found.");
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  const from = await deploymentOn(db, ctx.orgId, v.employeeId, effective);
  const mv = await db.$transaction(async (tx) => {
    await assertPeriodEditable(tx, ctx.orgId, effective);
    const m = await tx.staffMovement.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: v.employeeId,
        movementType: v.movementType,
        fromClientId: from?.clientId ?? null,
        fromContractId: from?.contractId ?? null,
        fromBeatId: from?.beatId ?? null,
        toClientId: toBeat.clientId,
        toContractId: toBeat.contractId,
        toBeatId: toBeat.id,
        movementDate: d(v.movementDate),
        effectiveDate: effective,
        endDate,
        reason: v.reason,
        remarks: v.remarks,
        requestedBy: ctx.name,
        status: "PENDING",
      },
    });
    await logAudit(
      ctx,
      {
        action: "STAFF_MOVEMENT_REQUEST",
        entity: "StaffMovement",
        entityId: m.id,
        newValue: m,
        reason: v.reason,
      },
      tx,
    );
    return m;
  });
  if (v.approve) return approveMovement(ctx, mv.id);
  return mv;
}

/** Approving a movement creates the deployment(s). Temporary moves/reliefs return to the original beat after endDate. */
export async function approveMovement(ctx: Ctx, id: string) {
  assertCan(ctx, "movement.approve");
  return db.$transaction(async (tx) => {
    const m = await tx.staffMovement.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!m) throw new BusinessError("Movement not found.");
    if (m.status !== "PENDING") throw new BusinessError(`Movement is already ${m.status.toLowerCase()}.`);
    await assertPeriodEditable(tx, ctx.orgId, m.effectiveDate);
    const original = await deploymentOn(tx, ctx.orgId, m.employeeId, m.effectiveDate);
    const originalEnd = original?.endDate ?? null;
    await deployInTx(tx, ctx, {
      employeeId: m.employeeId,
      beatId: m.toBeatId,
      startDate: m.effectiveDate,
      endDate: m.endDate,
      movementId: m.id,
    });
    if (m.endDate && original) {
      const resume = addDays(m.endDate, 1);
      if (!originalEnd || originalEnd >= resume)
        await deployInTx(tx, ctx, {
          employeeId: m.employeeId,
          beatId: original.beatId,
          startDate: resume,
          endDate: originalEnd,
          movementId: m.id,
        });
    }
    const updated = await tx.staffMovement.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: ctx.name },
    });
    await logAudit(
      ctx,
      {
        action: "STAFF_MOVEMENT_APPROVE",
        entity: "StaffMovement",
        entityId: id,
        oldValue: { status: "PENDING" },
        newValue: { status: "APPROVED" },
      },
      tx,
    );
    await recheckMismatches(tx, ctx.orgId, m.employeeId, m.effectiveDate);
    return updated;
  });
}

export async function rejectMovement(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "movement.approve");
  const m = await db.staffMovement.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!m || m.status !== "PENDING") throw new BusinessError("Only pending movements can be rejected.");
  const updated = await db.staffMovement.update({
    where: { id },
    data: { status: "REJECTED", approvedBy: ctx.name, remarks: reason },
  });
  await logAudit(ctx, { action: "STAFF_MOVEMENT_REJECT", entity: "StaffMovement", entityId: id, reason });
  return updated;
}

export async function listMovements(
  ctx: Ctx,
  f: { status?: string; type?: string; employeeId?: string } = {},
) {
  return db.staffMovement.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.status ? { status: f.status as "PENDING" } : {}),
      ...(f.type ? { movementType: f.type as "RELIEF" } : {}),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    },
    include: { employee: true, fromBeat: true, toBeat: true, fromClient: true, toClient: true },
    orderBy: { effectiveDate: "desc" },
    take: 300,
  });
}

export async function deploymentOn(tx: Tx, orgId: string, employeeId: string, date: Date) {
  return tx.deployment.findFirst({
    where: {
      organizationId: orgId,
      employeeId,
      startDate: { lte: date },
      OR: [{ endDate: null }, { endDate: { gte: date } }],
    },
    orderBy: { startDate: "desc" },
  });
}

/** Re-evaluates location-mismatch flags on work records after assignments change. */
export async function recheckMismatches(tx: Tx, orgId: string, employeeId: string, from: Date) {
  const rows = await tx.workRegister.findMany({
    where: { organizationId: orgId, employeeId, date: { gte: from } },
  });
  if (!rows.length) return;
  const deps = await tx.deployment.findMany({ where: { organizationId: orgId, employeeId } });
  for (const r of rows) {
    const dep = deps
      .filter((x) => x.startDate <= r.date && (!x.endDate || x.endDate >= r.date))
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
    const mismatch = !dep || dep.beatId !== r.beatId;
    if (mismatch !== r.locationMismatch)
      await tx.workRegister.update({
        where: { id: r.id },
        data: { locationMismatch: mismatch, mismatchResolved: mismatch ? r.mismatchResolved : false },
      });
  }
}

// ───────────────────────────── Work register ─────────────────────────────

export const attendanceSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(10),
  beatId: z.string().min(1),
  status: z.enum(["PRESENT", "LATE", "ABSENT", "LEAVE", "OFF", "SUSPENDED"]),
  shift: z.enum(["DAY", "NIGHT", "FULL"]).default("FULL"),
  hoursWorked: z.coerce.number().min(0).max(24).optional(),
  overtimeHours: z.coerce.number().min(0).max(24).default(0),
  supervisor: z.string().optional(),
  remarks: z.string().optional(),
});
export type AttendanceInput = z.input<typeof attendanceSchema>;

export interface RecordResult {
  saved: number;
  mismatches: Array<{ employeeNumber: string; date: string; beat: string; message: string }>;
  errors: string[];
}

export async function recordAttendance(
  ctx: Ctx,
  entries: AttendanceInput[],
  source: "MANUAL" | "IMPORT" | "SUPERVISOR" = "MANUAL",
): Promise<RecordResult> {
  assertCan(ctx, "attendance.record");
  const parsed = entries.map((e) => attendanceSchema.parse(e));
  const result: RecordResult = { saved: 0, mismatches: [], errors: [] };
  const beatIds = [...new Set(parsed.map((p) => p.beatId))];
  const beats = await db.beat.findMany({
    where: { id: { in: beatIds }, organizationId: ctx.orgId },
    include: { client: true },
  });
  const beatMap = new Map(beats.map((b) => [b.id, b]));
  if (ctx.role === "SUPERVISOR") {
    for (const b of beats)
      if (b.supervisorId !== ctx.userId) throw new BusinessError(`You are not the supervisor for ${b.name}.`);
  }
  await db.$transaction(
    async (tx) => {
      for (const e of parsed) {
        const beat = beatMap.get(e.beatId);
        if (!beat) {
          result.errors.push(`Beat not found for ${e.date}`);
          continue;
        }
        const emp = await tx.employee.findFirst({ where: { id: e.employeeId, organizationId: ctx.orgId } });
        if (!emp) {
          result.errors.push(`Employee not found (${e.employeeId})`);
          continue;
        }
        const date = d(e.date);
        await assertPeriodEditable(tx, ctx.orgId, date);
        const dep = await deploymentOn(tx, ctx.orgId, emp.id, date);
        const mismatch = !dep || dep.beatId !== beat.id;
        const existing = await tx.workRegister.findUnique({
          where: { organizationId_employeeId_date: { organizationId: ctx.orgId, employeeId: emp.id, date } },
        });
        const data = {
          clientId: beat.clientId,
          contractId: beat.contractId,
          beatId: beat.id,
          categoryId: dep?.categoryId ?? emp.categoryId,
          shift: e.shift,
          attendanceStatus: e.status,
          hoursWorked: e.hoursWorked ?? (["PRESENT", "LATE"].includes(e.status) ? 12 : 0),
          overtimeHours: e.overtimeHours,
          supervisor: e.supervisor ?? (source === "SUPERVISOR" ? ctx.name : undefined),
          remarks: e.remarks,
          source,
          locationMismatch: mismatch,
          mismatchResolved: false,
          recordedBy: ctx.name,
        };
        if (existing) {
          await tx.workRegister.update({ where: { id: existing.id }, data });
          await logAudit(
            ctx,
            {
              action: "ATTENDANCE_CHANGE",
              entity: "WorkRegister",
              entityId: existing.id,
              oldValue: { beatId: existing.beatId, status: existing.attendanceStatus },
              newValue: { beatId: beat.id, status: e.status },
            },
            tx,
          );
        } else {
          await tx.workRegister.create({
            data: { organizationId: ctx.orgId, employeeId: emp.id, date, ...data },
          });
        }
        result.saved++;
        if (mismatch) {
          const clientDiffers = dep && dep.clientId !== beat.clientId;
          result.mismatches.push({
            employeeNumber: emp.employeeNumber,
            date: e.date,
            beat: beat.name,
            message: clientDiffers ? CLIENT_MISMATCH : LOCATION_MISMATCH,
          });
        }
      }
      if (result.saved)
        await logAudit(
          ctx,
          {
            action: "ATTENDANCE_RECORD",
            entity: "WorkRegister",
            newValue: { entries: result.saved, source, mismatches: result.mismatches.length },
          },
          tx,
        );
    },
    { timeout: 60_000 },
  );
  return result;
}

// ───────────────────────── Monthly attendance (quick entry) ─────────────────────────

export interface MonthlyAttendanceRow {
  employeeId: string;
  employeeNumber: string;
  daysInMonth: number;
  daysWorked: number;
  daysAbsent: number;
}

/**
 * Fast alternative to marking attendance day by day: for a beat and calendar month, "days in the
 * month" is fixed (e.g. August = 31); "days worked" defaults to that but is adjustable down to the
 * days the guard actually worked (e.g. 17). The first `daysWorked` working days of the employee's
 * time at the beat this month are marked PRESENT and the rest ABSENT — days already recorded as
 * approved leave are left untouched.
 */
export async function recordMonthlyAttendance(
  ctx: Ctx,
  raw: {
    beatId: string;
    year: number | string;
    month: number | string;
    rows: Array<{ employeeId: string; daysWorked: number | string }>;
  },
): Promise<RecordResult & { summary: MonthlyAttendanceRow[] }> {
  assertCan(ctx, "attendance.record");
  const beatId = String(raw.beatId);
  const year = Number(raw.year);
  const month = Number(raw.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
    throw new BusinessError("Invalid month.");
  const beat = await db.beat.findFirst({ where: { id: beatId, organizationId: ctx.orgId } });
  if (!beat) throw new BusinessError("Beat not found.");
  if (ctx.role === "SUPERVISOR" && beat.supervisorId !== ctx.userId)
    throw new BusinessError(`You are not the supervisor for ${beat.name}.`);
  const dim = daysInMonth(year, month);
  const mStart = monthStart(year, month);
  const mEnd = monthEnd(year, month);

  const empIds = raw.rows.map((r) => r.employeeId);
  const [employees, existing] = await Promise.all([
    db.employee.findMany({ where: { id: { in: empIds }, organizationId: ctx.orgId } }),
    db.workRegister.findMany({
      where: {
        organizationId: ctx.orgId,
        beatId,
        employeeId: { in: empIds },
        date: { gte: mStart, lte: mEnd },
      },
    }),
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const entries: AttendanceInput[] = [];
  const summary: MonthlyAttendanceRow[] = [];
  for (const row of raw.rows) {
    const emp = empMap.get(row.employeeId);
    if (!emp) continue;
    const from = emp.employmentDate > mStart ? emp.employmentDate : mStart;
    const to = emp.exitDate && emp.exitDate < mEnd ? emp.exitDate : mEnd;
    if (from > to) continue;
    // Approved leave (marked by the leave feature) is never overwritten by a bulk attendance entry.
    const protectedDates = new Set(
      existing
        .filter((w) => w.employeeId === emp.id && w.attendanceStatus === "LEAVE" && w.source === "SYSTEM")
        .map((w) => iso(w.date)),
    );
    const days = eachDay(from, to).filter((day) => !protectedDates.has(iso(day)));
    if (!days.length) continue;
    const requested = Math.max(0, Math.min(dim, Math.round(Number(row.daysWorked))));
    const worked = Math.min(requested, days.length);
    days.forEach((day, i) => {
      entries.push({ employeeId: emp.id, beatId, date: iso(day), status: i < worked ? "PRESENT" : "ABSENT" });
    });
    summary.push({
      employeeId: emp.id,
      employeeNumber: emp.employeeNumber,
      daysInMonth: dim,
      daysWorked: worked,
      daysAbsent: days.length - worked,
    });
  }
  if (!entries.length) throw new BusinessError("No employees to update for this month.");
  const result = await recordAttendance(ctx, entries, ctx.role === "SUPERVISOR" ? "SUPERVISOR" : "MANUAL");
  return { ...result, summary };
}

/** CSV columns: date,employee_number,beat_code,status[,hours,overtime_hours,shift,remarks] */
export async function importWorkRegisterCsv(ctx: Ctx, csv: string): Promise<RecordResult> {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new BusinessError("The file is empty.");
  const header = lines[0]
    .toLowerCase()
    .split(",")
    .map((h) => h.trim());
  const idx = (n: string) => header.indexOf(n);
  for (const col of ["date", "employee_number", "beat_code", "status"])
    if (idx(col) < 0)
      throw new BusinessError(
        `Missing column "${col}". Expected: date,employee_number,beat_code,status,hours,overtime_hours,shift,remarks`,
      );
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  const nums = [...new Set(rows.map((r) => r[idx("employee_number")]))];
  const codes = [...new Set(rows.map((r) => r[idx("beat_code")]?.toUpperCase()))];
  const [emps, beats] = await Promise.all([
    db.employee.findMany({ where: { organizationId: ctx.orgId, employeeNumber: { in: nums } } }),
    db.beat.findMany({ where: { organizationId: ctx.orgId, code: { in: codes } } }),
  ]);
  const empMap = new Map(emps.map((e) => [e.employeeNumber, e.id]));
  const beatMap = new Map(beats.map((b) => [b.code, b.id]));
  const entries: AttendanceInput[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const employeeId = empMap.get(r[idx("employee_number")]);
    const beatId = beatMap.get(r[idx("beat_code")]?.toUpperCase());
    const status = r[idx("status")]?.toUpperCase();
    if (!employeeId) return errors.push(`Line ${line}: unknown employee ${r[idx("employee_number")]}`);
    if (!beatId) return errors.push(`Line ${line}: unknown beat ${r[idx("beat_code")]}`);
    if (!["PRESENT", "LATE", "ABSENT", "LEAVE", "OFF", "SUSPENDED"].includes(status))
      return errors.push(`Line ${line}: invalid status ${status}`);
    entries.push({
      employeeId,
      beatId,
      date: r[idx("date")],
      status: status as AttendanceStatus,
      hoursWorked: idx("hours") >= 0 && r[idx("hours")] ? Number(r[idx("hours")]) : undefined,
      overtimeHours:
        idx("overtime_hours") >= 0 && r[idx("overtime_hours")] ? Number(r[idx("overtime_hours")]) : 0,
      shift: (idx("shift") >= 0 && r[idx("shift")] ? r[idx("shift")].toUpperCase() : "FULL") as "FULL",
      remarks: idx("remarks") >= 0 ? r[idx("remarks")] : undefined,
    });
  });
  const res = entries.length
    ? await recordAttendance(ctx, entries, "IMPORT")
    : { saved: 0, mismatches: [], errors: [] };
  return { ...res, errors: [...errors, ...res.errors] };
}

export const resolveSchema = z.object({
  workRegisterId: z.string().min(1),
  action: z.enum(["ACCEPT_AS_RELIEF", "CORRECT_TO_ASSIGNED_BEAT", "ACKNOWLEDGE"]),
  note: z.string().trim().min(3, "A resolution note is required"),
});

/**
 * Resolve a location exception:
 *  • ACCEPT_AS_RELIEF — creates & approves a one-day RELIEF movement to the recorded beat.
 *  • CORRECT_TO_ASSIGNED_BEAT — data-entry error: moves the record to the assigned beat.
 *  • ACKNOWLEDGE — keeps the record, marks the exception resolved with a documented note.
 */
export async function resolveMismatch(ctx: Ctx, raw: z.input<typeof resolveSchema>) {
  assertCan(ctx, "operations.manage");
  const v = resolveSchema.parse(raw);
  const row = await db.workRegister.findFirst({
    where: { id: v.workRegisterId, organizationId: ctx.orgId },
    include: { employee: true, beat: true },
  });
  if (!row) throw new BusinessError("Work register record not found.");
  if (!row.locationMismatch) throw new BusinessError("This record has no location exception.");
  if (v.action === "ACCEPT_AS_RELIEF") {
    await createMovement(ctx, {
      employeeId: row.employeeId,
      toBeatId: row.beatId,
      movementType: "RELIEF",
      movementDate: iso(row.date),
      effectiveDate: iso(row.date),
      endDate: iso(row.date),
      reason: `Location exception resolved: ${v.note}`,
      approve: true,
    });
  } else if (v.action === "CORRECT_TO_ASSIGNED_BEAT") {
    const dep = await deploymentOn(db, ctx.orgId, row.employeeId, row.date);
    if (!dep)
      throw new BusinessError(
        "Employee has no assignment on this date — accept as relief or deploy the employee first.",
      );
    await db.workRegister.update({
      where: { id: row.id },
      data: {
        beatId: dep.beatId,
        clientId: dep.clientId,
        contractId: dep.contractId,
        locationMismatch: false,
        resolutionNote: v.note,
      },
    });
  } else {
    await db.workRegister.update({
      where: { id: row.id },
      data: { mismatchResolved: true, resolutionNote: v.note },
    });
  }
  await logAudit(ctx, {
    action: "LOCATION_EXCEPTION_RESOLVED",
    entity: "WorkRegister",
    entityId: row.id,
    oldValue: { beat: row.beat.name },
    newValue: { action: v.action },
    reason: v.note,
  });
  return db.workRegister.findUnique({ where: { id: row.id } });
}

export async function listWorkRegister(
  ctx: Ctx,
  f: {
    from?: string;
    to?: string;
    beatId?: string;
    clientId?: string;
    employeeId?: string;
    mismatchOnly?: boolean;
    take?: number;
  } = {},
) {
  return db.workRegister.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.from || f.to
        ? { date: { ...(f.from ? { gte: d(f.from) } : {}), ...(f.to ? { lte: d(f.to) } : {}) } }
        : {}),
      ...(f.beatId ? { beatId: f.beatId } : {}),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(f.mismatchOnly ? { locationMismatch: true, mismatchResolved: false } : {}),
    },
    include: { employee: true, beat: true, client: true, contract: true, category: true },
    orderBy: [{ date: "desc" }, { employee: { employeeNumber: "asc" } }],
    take: f.take ?? 500,
  });
}

/** "My Work Locations" — consecutive-day location ranges for a month. */
export async function employeeLocationHistory(ctx: Ctx, employeeId: string, from: Date, to: Date) {
  const rows = await db.workRegister.findMany({
    where: { organizationId: ctx.orgId, employeeId, date: { gte: from, lte: to } },
    include: { beat: true, client: true },
    orderBy: { date: "asc" },
  });
  return buildLocationRanges(
    rows.map((r) => ({
      date: r.date,
      clientId: r.clientId,
      clientName: r.client.name,
      contractId: r.contractId,
      beatId: r.beatId,
      beatName: r.beat.name,
      categoryId: r.categoryId,
      status: r.attendanceStatus as AttendanceStatus,
      overtimeHours: num(r.overtimeHours),
    })),
  );
}

// ───────────────────────── Supervisor mobile view ─────────────────────────

export async function supervisorToday(ctx: Ctx, dateIso: string) {
  const date = d(dateIso);
  const beats = await db.beat.findMany({
    where: {
      organizationId: ctx.orgId,
      status: { not: "INACTIVE" },
      ...(ctx.role === "SUPERVISOR" ? { supervisorId: ctx.userId } : {}),
    },
    include: { client: true },
    orderBy: { name: "asc" },
  });
  const beatIds = beats.map((b) => b.id);
  const [deps, records] = await Promise.all([
    db.deployment.findMany({
      where: {
        organizationId: ctx.orgId,
        beatId: { in: beatIds },
        startDate: { lte: date },
        OR: [{ endDate: null }, { endDate: { gte: date } }],
      },
      include: { employee: true },
    }),
    db.workRegister.findMany({ where: { organizationId: ctx.orgId, date, beatId: { in: beatIds } } }),
  ]);
  const recMap = new Map(records.map((r) => [`${r.employeeId}|${r.beatId}`, r]));
  return beats.map((b) => {
    const staff = deps
      .filter((x) => x.beatId === b.id)
      .map((x) => ({
        employeeId: x.employeeId,
        employeeNumber: x.employee.employeeNumber,
        name: fullName(x.employee),
        status: recMap.get(`${x.employeeId}|${b.id}`)?.attendanceStatus ?? null,
      }))
      .sort((a, z2) => a.employeeNumber.localeCompare(z2.employeeNumber));
    const present = staff.filter((s) => s.status === "PRESENT").length;
    const late = staff.filter((s) => s.status === "LATE").length;
    const absent = staff.filter((s) => s.status === "ABSENT").length;
    return {
      beat: b,
      staff,
      present,
      late,
      absent,
      unrecorded: staff.filter((s) => !s.status).length,
      replacementRequired: absent + Math.max(0, b.approvedStrength - staff.length),
    };
  });
}
