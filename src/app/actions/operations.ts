"use server";
import { act } from "./_run";
import * as svc from "@/server/services/operations";

type V = Record<string, unknown>;

export async function deployAction(v: V) {
  return act(
    "operations.manage",
    async (ctx) => {
      const r = await svc.deployEmployee(ctx, v as never);
      return { message: r.warning ?? `Deployed ${r.employee.employeeNumber} to ${r.beat.name}.` };
    },
    ["/operations", "/beats", "/employees"],
  );
}
export async function createMovementAction(v: V) {
  return act(
    "operations.manage",
    async (ctx) => {
      await svc.createMovement(ctx, {
        ...(v as Record<string, unknown>),
        approve: v.approve === true || v.approve === "true",
      } as never);
      return {
        message: v.approve ? "Movement approved — deployments updated." : "Movement submitted for approval.",
      };
    },
    ["/operations", "/employees", "/beats"],
  );
}
export async function approveMovementAction(id: string) {
  return act(
    "movement.approve",
    async (ctx) => {
      await svc.approveMovement(ctx, id);
      return { message: "Movement approved." };
    },
    ["/operations"],
  );
}
export async function rejectMovementAction(id: string, reason?: string) {
  return act(
    "movement.approve",
    async (ctx) => {
      await svc.rejectMovement(ctx, id, reason ?? "Rejected");
      return { message: "Movement rejected." };
    },
    ["/operations"],
  );
}
export async function recordAttendanceAction(v: V) {
  return act(
    "attendance.record",
    async (ctx) => {
      const r = await svc.recordAttendance(
        ctx,
        [v as never],
        ctx.role === "SUPERVISOR" ? "SUPERVISOR" : "MANUAL",
      );
      return {
        message: r.mismatches.length
          ? `Saved with exception: ${r.mismatches[0].message}`
          : "Attendance recorded.",
      };
    },
    ["/operations", "/supervisor"],
  );
}
export async function bulkAttendanceAction(entries: Array<Record<string, unknown>>) {
  return act(
    "attendance.record",
    async (ctx) => {
      const r = await svc.recordAttendance(
        ctx,
        entries as never,
        ctx.role === "SUPERVISOR" ? "SUPERVISOR" : "MANUAL",
      );
      return {
        message: `${r.saved} attendance record(s) saved${r.mismatches.length ? ` — ${r.mismatches.length} location exception(s) flagged` : ""}.`,
      };
    },
    ["/operations", "/supervisor"],
  );
}
export async function recordMonthlyAttendanceAction(
  beatId: string,
  year: number,
  month: number,
  rows: Array<{ employeeId: string; daysWorked: number }>,
) {
  return act(
    "attendance.record",
    async (ctx) => {
      const r = await svc.recordMonthlyAttendance(ctx, { beatId, year, month, rows });
      return {
        message: `${r.summary.length} employee(s) updated for the month${r.mismatches.length ? ` — ${r.mismatches.length} location exception(s) flagged` : ""}.`,
      };
    },
    ["/operations", "/supervisor"],
  );
}
export async function importWorkRegisterAction(v: V) {
  return act(
    "attendance.record",
    async (ctx) => {
      const r = await svc.importWorkRegisterCsv(ctx, String(v.csv ?? ""));
      if (r.errors.length && !r.saved) throw new Error(r.errors.slice(0, 5).join(" | "));
      return {
        message: `Imported ${r.saved} row(s); ${r.mismatches.length} exception(s); ${r.errors.length} error(s)${r.errors.length ? `: ${r.errors.slice(0, 3).join(" | ")}` : ""}.`,
      };
    },
    ["/operations"],
  );
}
export async function resolveMismatchAction(id: string, action: string, note?: string) {
  return act(
    "operations.manage",
    async (ctx) => {
      await svc.resolveMismatch(ctx, { workRegisterId: id, action: action as never, note: note ?? "" });
      return { message: "Location exception resolved. Recalculate payroll to clear the validation error." };
    },
    ["/operations", "/payroll"],
  );
}
