"use server";
import { actFor } from "./_run";
import * as te from "@/server/services/time-entries";
const act = actFor("time-entries.ts");

type V = Record<string, unknown>;
const PATHS = ["/operations/time-entries"];
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** "2026-11-20 19:00" (or already with a T) as the service reads it; empty stays empty. */
const when = (v: unknown) => text(v).replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/, "$1T$2");

/** Captures a shift (a draft). Supervisors only for their own sites; the service checks. */
export async function captureTimeEntryAction(v: V) {
  return act("attendance.record", async (ctx) => {
    const row = await te.captureTimeEntry(ctx, { employeeId: text(v.employeeId), beatId: text(v.beatId), clockIn: when(v.clockIn), clockOut: when(v.clockOut) || null });
    return { message: row.clockOut ? "Shift entered as a draft. Submit it for approval." : "Entered as a draft with no clock-out: it is never paid until the clock-out is entered." };
  }, PATHS);
}

export async function completeClockOutAction(v: V) {
  return act("attendance.record", async (ctx) => {
    await te.completeClockOut(ctx, text(v.id), when(v.clockOut));
    return { message: "Clock-out entered. Submit the entry for approval." };
  }, PATHS);
}

export async function submitTimeEntryAction(id: string) {
  return act("attendance.record", async (ctx) => {
    await te.submitTimeEntry(ctx, id);
    return { message: "Submitted for approval." };
  }, PATHS);
}

export async function withdrawTimeEntryAction(id: string) {
  return act("attendance.record", async (ctx) => {
    await te.withdrawTimeEntry(ctx, id);
    return { message: "Entry withdrawn." };
  }, PATHS);
}

/** Approval is for the site's supervisor or someone with the payroll approval right: the service decides, so any signed-in person may reach it and be told plainly if not. */
export async function approveTimeEntryAction(v: V) {
  return act(undefined, async (ctx) => {
    await te.approveTimeEntry(ctx, text(v.id), { breaks: text(v.breaks) });
    return { message: "Approved. Its paid hours are now on record." };
  }, PATHS);
}

export async function approveTimeEntryNoBreakAction(id: string) {
  return act(undefined, async (ctx) => {
    await te.approveTimeEntry(ctx, id, {});
    return { message: "Approved with no break. Its paid hours are now on record." };
  }, PATHS);
}

export async function rejectTimeEntryAction(id: string, reason?: string) {
  return act(undefined, async (ctx) => {
    await te.rejectTimeEntry(ctx, id, reason ?? "");
    return { message: "Entry rejected." };
  }, PATHS);
}

export async function correctTimeEntryAction(v: V) {
  return act("attendance.record", async (ctx) => {
    await te.correctTimeEntry(ctx, text(v.id), { clockIn: when(v.clockIn), clockOut: when(v.clockOut), beatId: text(v.beatId) || undefined, reason: text(v.reason) });
    return { message: "Correction entered as a draft. Submit it: it replaces the original only when someone else approves it." };
  }, PATHS);
}
