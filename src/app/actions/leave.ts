"use server";
import { actFor } from "./_run";
import * as lv from "@/server/services/leave";
const act = actFor("leave.ts");

type V = Record<string, unknown>;

const PATHS = ["/leave", "/me", "/supervisor", "/operations"];

/** An employee (or supervisor) applying for their own leave. */
export async function applyLeaveAction(v: V) {
  return act(
    "leave.apply",
    async (ctx) => {
      const r = await lv.applyForLeave(ctx, v as never);
      const note = r.unpaid ? null : await lv.leaveNotPaidNotice(ctx, r.employeeId, r.startDate, r.endDate); // a person paid by the hour is not paid for annual leave (H14 piece 0)
      return {
        message: `Leave request submitted — ${r.workingDays} working day(s), awaiting supervisor approval.${note ? ` ${note}` : ""}`,
      };
    },
    PATHS,
  );
}

/** HR applying on an employee's behalf. */
export async function applyLeaveForAction(v: V) {
  return act(
    "leave.manage",
    async (ctx) => {
      const r = await lv.applyForLeave(ctx, v as never);
      const note = r.unpaid ? null : await lv.leaveNotPaidNotice(ctx, r.employeeId, r.startDate, r.endDate); // a person paid by the hour is not paid for annual leave (H14 piece 0)
      return {
        message: `Leave request submitted — ${r.workingDays} working day(s), awaiting supervisor approval.${note ? ` ${note}` : ""}`,
      };
    },
    PATHS,
  );
}

export async function approveLeaveAction(id: string) {
  return act(
    "leave.approve",
    async (ctx) => {
      const r = await lv.decideLeave(ctx, id, "APPROVED");
      const note = r.request.unpaid ? null : await lv.leaveNotPaidNotice(ctx, r.request.employeeId, r.request.startDate, r.request.endDate); // a person paid by the hour is not paid for annual leave (H14 piece 0)
      return {
        message: `Leave approved. ${r.marked} day(s) marked as leave in the work register${r.skipped.length ? ` — skipped: ${r.skipped.join(", ")}` : ""}.${note ? ` ${note}` : ""}`,
      };
    },
    PATHS,
  );
}

export async function rejectLeaveAction(id: string, reason?: string) {
  return act(
    "leave.approve",
    async (ctx) => {
      await lv.decideLeave(ctx, id, "REJECTED", reason);
      return { message: "Leave rejected." };
    },
    PATHS,
  );
}

/** Employee cancelling their own request. */
export async function cancelLeaveAction(id: string) {
  return act(
    "leave.apply",
    async (ctx) => {
      await lv.cancelLeave(ctx, id);
      return { message: "Leave request cancelled." };
    },
    PATHS,
  );
}

/** Supervisor / HR cancelling leave for someone else. */
export async function cancelLeaveForAction(id: string) {
  return act(
    "leave.approve",
    async (ctx) => {
      await lv.cancelLeave(ctx, id);
      return { message: "Leave request cancelled." };
    },
    PATHS,
  );
}

export async function updateLeavePolicyAction(v: V) {
  return act(
    "leave.manage",
    async (ctx) => {
      await lv.updateLeavePolicy(ctx, v as never);
      return { message: "Leave policy updated." };
    },
    ["/leave", "/me", "/settings"],
  );
}
