"use server";
import { actFor } from "./_run";
import * as pip from "@/server/services/pip";
import { db } from "@/server/services/_base";
import { BusinessError } from "@/server/services/_base";
const act = actFor("pip.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr", "/me", "/employees"];

const str = (x: unknown) => (typeof x === "string" ? x : undefined);
/** A blank form field means "leave it as it is". */
const filled = (x: unknown) => str(x)?.trim() || undefined;
const days = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));

/** A plan is drafted by employee number (a text box, not a list of every employee: light on a slow connection). */
export async function createPlanAction(v: V) {
  return act("pip.manage", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    const p = await pip.createPlan(ctx, { employeeId: emp.id, concerns: str(v.concerns) ?? "", startDate: str(v.startDate) ?? "", days: days(v.days), ownerUserId: str(v.ownerUserId) ?? "" });
    return { message: "Draft saved. Add the objectives, then submit it.", redirectTo: `/hr/improvement-plans/${p.id}` };
  }, PAGES);
}

export async function planFromAppraisalAction(appraisalId: string, v: V) {
  return act("pip.manage", async (ctx) => {
    const p = await pip.planFromAppraisal(ctx, appraisalId, { startDate: str(v.startDate) ?? "", days: days(v.days), ownerUserId: str(v.ownerUserId) ?? "" });
    return { message: "Draft saved from the appraisal. Add the objectives, then submit it.", redirectTo: `/hr/improvement-plans/${p.id}` };
  }, PAGES);
}

export async function updatePlanAction(id: string, v: V) {
  return act("pip.manage", async (ctx) => {
    await pip.updatePlan(ctx, id, { concerns: filled(v.concerns), startDate: filled(v.startDate), days: days(v.days), ownerUserId: filled(v.ownerUserId) });
    return { message: "Saved." };
  }, PAGES);
}

export async function addObjectiveAction(planId: string, v: V) {
  return act("pip.manage", async (ctx) => {
    await pip.addObjective(ctx, planId, { gap: str(v.gap) ?? "", target: str(v.target) ?? "", support: str(v.support), dueDate: str(v.dueDate) ?? "" });
    return { message: "Objective added." };
  }, PAGES);
}

export async function removeObjectiveAction(objectiveId: string) {
  return act("pip.manage", async (ctx) => {
    await pip.removeObjective(ctx, objectiveId);
    return { message: "Objective removed." };
  }, PAGES);
}

export async function submitPlanAction(id: string) {
  return act("pip.manage", async (ctx) => {
    await pip.submitPlan(ctx, id);
    return { message: "Submitted. Someone else has to approve it before it starts." };
  }, PAGES);
}

export async function approveStartAction(id: string) {
  return act("pip.approve", async (ctx) => {
    await pip.approveStart(ctx, id);
    return { message: "The plan has started. The employee can now see it." };
  }, PAGES);
}

export async function returnPlanAction(id: string, reason?: string) {
  return act("pip.approve", async (ctx) => {
    await pip.returnPlan(ctx, id, reason ?? "");
    return { message: "Returned to draft with your reason." };
  }, PAGES);
}

/** Pulls `result_<objectiveId>` / `note_<objectiveId>` form fields into the list the service expects. */
function assessments(v: V) {
  return Object.keys(v)
    .filter((k) => k.startsWith("result_") && str(v[k]))
    .map((k) => {
      const objectiveId = k.slice("result_".length);
      return { objectiveId, result: v[k] as "MET" | "PARTLY_MET" | "NOT_MET", note: str(v[`note_${objectiveId}`]) };
    });
}

export async function recordReviewAction(id: string, v: V) {
  return act("pip.manage", async (ctx) => {
    await pip.recordReview(ctx, id, { reviewedOn: str(v.reviewedOn) ?? "", summary: str(v.summary) ?? "", assessments: assessments(v) });
    return { message: "Review recorded." };
  }, PAGES);
}

export async function proposeOutcomeAction(id: string, v: V) {
  return act("pip.manage", async (ctx) => {
    await pip.proposeOutcome(ctx, id, { outcome: str(v.outcome) as never, note: str(v.note) ?? "", newEndDate: str(v.newEndDate) || undefined });
    return { message: "Outcome proposed. Someone else has to approve it." };
  }, PAGES);
}

export async function approveOutcomeAction(id: string) {
  return act("pip.approve", async (ctx) => {
    await pip.approveOutcome(ctx, id);
    return { message: "Outcome approved." };
  }, PAGES);
}

export async function returnOutcomeAction(id: string, reason?: string) {
  return act("pip.approve", async (ctx) => {
    await pip.returnOutcome(ctx, id, reason ?? "");
    return { message: "Outcome returned. The plan is active again." };
  }, PAGES);
}

/** The service decides who may withdraw what (a draft: whoever manages plans; a plan that has started: the approve right). */
export async function withdrawPlanAction(id: string, reason?: string) {
  return act("pip.view", async (ctx) => {
    await pip.withdrawPlan(ctx, id, reason ?? "");
    return { message: "Plan withdrawn." };
  }, PAGES);
}

// The employee's own answers act on their own plan: a login is enough, and the service decides whether the plan is theirs.
export async function acknowledgePlanAction(id: string, agree: boolean, comment?: string) {
  return act(undefined, async (ctx) => {
    await pip.acknowledgePlan(ctx, id, { agree, comment });
    return { message: agree ? "Thank you — recorded." : "Your response has been recorded." };
  }, PAGES);
}

export async function addEmployeeCommentAction(reviewId: string, v: V) {
  return act(undefined, async (ctx) => {
    await pip.addEmployeeComment(ctx, reviewId, str(v.comment) ?? "");
    return { message: "Your comment has been added to the review." };
  }, PAGES);
}
