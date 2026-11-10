"use server";
import { actFor } from "./_run";
import * as tp from "@/server/services/training-plan";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("training-plan.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr", "/me", "/employees"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const filled = (x: unknown) => str(x)?.trim() || undefined;

async function employeeByNumber(orgId: string, number: unknown) {
  const n = str(number)?.trim();
  if (!n) throw new BusinessError("Enter the employee number.");
  const e = await db.employee.findFirst({ where: { organizationId: orgId, employeeNumber: { equals: n, mode: "insensitive" } }, select: { id: true } });
  if (!e) throw new BusinessError("Employee not found.");
  return e.id;
}

export async function addProgrammeAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await tp.addProgramme(ctx, { name: str(v.name) ?? "", provider: str(v.provider), validityMonths: filled(v.validityMonths) as never });
    return { message: "Programme added." };
  }, PAGES);
}

export async function setProgrammeActiveAction(id: string, active: boolean) {
  return act("hr.manage", async (ctx) => {
    await tp.updateProgramme(ctx, id, { active });
    return { message: active ? "Programme switched on." : "Programme switched off." };
  }, PAGES);
}

export async function scheduleSessionAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const s = await tp.scheduleSession(ctx, { programmeId: str(v.programmeId) ?? "", sessionDate: str(v.sessionDate) ?? "", startTime: str(v.startTime), venue: str(v.venue), trainer: str(v.trainer), seats: str(v.seats) as never });
    return { message: "Session scheduled.", redirectTo: `/hr/training-calendar/${s.id}` };
  }, PAGES);
}

export async function cancelSessionAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await tp.cancelSession(ctx, id, reason ?? "");
    return { message: "Session cancelled." };
  }, PAGES);
}

export async function completeSessionAction(id: string) {
  return act("hr.manage", async (ctx) => {
    await tp.completeSession(ctx, id);
    return { message: "Session completed." };
  }, PAGES);
}

export async function enrolByNumberAction(sessionId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await tp.enrol(ctx, sessionId, await employeeByNumber(ctx.orgId, v.employeeNumber));
    return { message: "Enrolled." };
  }, PAGES);
}

export async function enrolEmployeeAction(sessionId: string, employeeId: string) {
  return act("hr.manage", async (ctx) => {
    await tp.enrol(ctx, sessionId, employeeId);
    return { message: "Enrolled." };
  }, PAGES);
}

export async function unenrolAction(enrolmentId: string) {
  return act("hr.manage", async (ctx) => {
    await tp.unenrol(ctx, enrolmentId);
    return { message: "Taken off the session." };
  }, PAGES);
}

export async function attendedAction(enrolmentId: string) {
  return act("hr.manage", async (ctx) => {
    await tp.markAttendance(ctx, enrolmentId, { result: "ATTENDED" });
    return { message: "Marked as attended. Their certificate record has been created." };
  }, PAGES);
}

export async function notAttendedAction(enrolmentId: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await tp.markAttendance(ctx, enrolmentId, { result: "ABSENT", reason });
    return { message: "Marked as did not attend." };
  }, PAGES);
}

export async function addNeedAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await tp.addNeed(ctx, {
      employeeId: await employeeByNumber(ctx.orgId, v.employeeNumber),
      courseName: str(v.courseName) ?? "",
      source: (str(v.source) || "OTHER") as never,
      note: str(v.note),
      priority: (str(v.priority) || "NORMAL") as never,
      dueBy: filled(v.dueBy),
    });
    return { message: "Training need recorded." };
  }, PAGES);
}

export async function addNeedFromGapAction(employeeId: string, courseName: string) {
  return act("hr.manage", async (ctx) => {
    await tp.addNeed(ctx, { employeeId, courseName, source: "COMPLIANCE", note: "Required course missing or expired" });
    return { message: "Added to the training needs." };
  }, PAGES);
}

export async function needFromAppraisalAction(appraisalId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await tp.needsFromAppraisal(ctx, appraisalId, str(v.courseName) ?? "");
    return { message: "Added to the training needs." };
  }, PAGES);
}

export async function dropNeedAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await tp.dropNeed(ctx, id, reason ?? "");
    return { message: "Need dropped." };
  }, PAGES);
}
