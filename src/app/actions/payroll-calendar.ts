"use server";
import { act } from "./_run";
import * as cal from "@/server/services/payroll-calendar";

type V = Record<string, unknown>;
const PATHS = ["/payroll/calendar", "/bureau/deadlines"];

export async function saveCalendarSettingAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      const expected = Object.keys(v).filter((k) => k.startsWith("input_") && v[k] === true).map((k) => k.slice(6));
      await cal.saveCalendarSetting(ctx, { ...v, expectedInputs: expected } as never);
      return { message: "Calendar rhythm saved. It applies to months whose dates are generated from now on." };
    },
    PATHS,
  );
}

export async function generateCalendarAction(periodId: string) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      const r = await cal.generateCalendar(ctx, periodId);
      return { message: r.problems.length ? `Dates generated. Note: ${r.problems.join(" ")}` : "Dates generated.", redirectTo: `/payroll/calendar/${periodId}` };
    },
    PATHS,
  );
}

export async function generateMissingCalendarsAction() {
  return act(
    "payroll.inputs",
    async (ctx) => {
      const n = await cal.generateMissingCalendars(ctx);
      return { message: n ? `Dates generated for ${n} month(s).` : "Every month already has its dates." };
    },
    PATHS,
  );
}

export async function adjustCalendarAction(periodId: string, v: V) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      await cal.adjustCalendar(ctx, periodId, v as never);
      return { message: "Dates adjusted." };
    },
    PATHS,
  );
}

export async function markInputAction(periodId: string, kind: string, status: "RECEIVED" | "NOT_APPLICABLE" | "EXPECTED", note?: string) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      await cal.markInput(ctx, periodId, kind, status, note);
      return { message: status === "RECEIVED" ? "Marked received." : status === "NOT_APPLICABLE" ? "Marked not applicable." : "Back to expected." };
    },
    PATHS,
  );
}

export async function raiseInputIssueAction(periodId: string, v: V) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      await cal.raiseInputIssue(ctx, periodId, v.kind ? String(v.kind) : undefined, String(v.description ?? ""));
      return { message: "Issue logged." };
    },
    PATHS,
  );
}

export async function resolveInputIssueAction(issueId: string, resolution?: string) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      await cal.resolveInputIssue(ctx, issueId, resolution ?? "");
      return { message: "Issue resolved." };
    },
    PATHS,
  );
}
