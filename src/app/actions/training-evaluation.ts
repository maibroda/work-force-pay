"use server";
import { actFor } from "./_run";
import * as ev from "@/server/services/training-evaluation";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("training-evaluation.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/training-requests", "/hr/training-evaluations", "/hr/training", "/hr/training-needs", "/me/training", "/me/team-training"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

/** A request is made by employee number. Whether this person may request for that employee is the service's decision: for anyone who may not, the answer is only "not found". */
export async function requestTrainingAction(v: V) {
  return act("training.request", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await ev.requestTraining(ctx, { employeeId: emp.id, courseName: str(v.courseName) ?? "", reason: str(v.reason) ?? "" });
    return { message: "Request sent. HR will decide it." };
  }, PAGES);
}

export async function acceptRequestAction(id: string) {
  return act("hr.manage", async (ctx) => {
    await ev.acceptRequest(ctx, id);
    return { message: "Accepted. It is now on the training needs list; nothing else has changed." };
  }, PAGES);
}

export async function declineRequestAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await ev.declineRequest(ctx, id, reason ?? "");
    return { message: "Request declined. The employee is not told." };
  }, PAGES);
}

// Whoever made the request withdraws it while undecided; HR may withdraw any. The service decides which.
export async function withdrawRequestAction(id: string, reason?: string) {
  return act(undefined, async (ctx) => {
    await ev.withdrawRequest(ctx, id, reason ?? "");
    return { message: "Withdrawn. It is kept, marked, with the reason." };
  }, PAGES);
}

// The participant answers about their own attended course: a login is enough, and the service decides whether it is theirs.
export async function evaluateParticipantAction(enrolmentId: string, v: V) {
  return act(undefined, async (ctx) => {
    await ev.evaluateAsParticipant(ctx, enrolmentId, { rating: Number(v.rating), comment: str(v.comment) });
    return { message: "Thank you. Your answer is confidential: HR sees only results from five answers or more, without names." };
  }, PAGES);
}

export async function evaluateManagerAction(enrolmentId: string, v: V) {
  return act("training.request", async (ctx) => {
    await ev.evaluateAsManager(ctx, enrolmentId, { rating: Number(v.rating), comment: str(v.comment) });
    return { message: "Evaluation recorded. The employee can read it." };
  }, PAGES);
}
