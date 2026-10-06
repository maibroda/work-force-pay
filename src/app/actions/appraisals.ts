"use server";
import { act } from "./_run";
import * as ap from "@/server/services/appraisals";

type V = Record<string, unknown>;

// Reviewing and self-service act on the caller's own appraisals, so those only need a login — the service
// decides whether this person may touch this appraisal. Cycle and criteria management need appraisal.manage.
const PAGES = ["/hr", "/me", "/employees", "/settings"];

/** Pulls `rating_<id>` / `comment_<id>` form fields into the list the service expects. */
function entries(v: V, prefix: string) {
  return Object.keys(v)
    .filter((k) => k.startsWith(`${prefix}rating_`))
    .map((k) => {
      const criterionId = k.slice(`${prefix}rating_`.length);
      return { criterionId, rating: v[k] === undefined ? undefined : Number(v[k]), comment: v[`${prefix}comment_${criterionId}`] as string | undefined };
    });
}

export async function launchCycleAction(v: V) {
  return act("appraisal.manage", async (ctx) => {
    const r = await ap.launchCycle(ctx, {
      ...v,
      categoryIds: v.categoryId ? [String(v.categoryId)] : undefined,
      employeeIds: v.employeeId ? [String(v.employeeId)] : undefined,
    } as never);
    const notes = [r.unassigned ? `${r.unassigned} have no reviewer yet — assign one` : "", r.skipped.length ? `${r.skipped.length} skipped for short service` : ""].filter(Boolean);
    return { message: `Cycle launched — ${r.created} appraisal(s) created${notes.length ? `; ${notes.join("; ")}` : ""}.`, redirectTo: `/hr/appraisals/cycle/${r.cycle.id}` };
  }, PAGES);
}
export async function startProbationAppraisalAction(contractId: string) {
  return act("appraisal.manage", async (ctx) => {
    const r = await ap.startProbationAppraisal(ctx, contractId);
    return {
      message: r.unassigned ? "Probation appraisal started — assign a reviewer on the appraisal." : "Probation appraisal started.",
      redirectTo: `/hr/appraisals/${r.appraisal.id}`,
    };
  }, [...PAGES, "/hr/contracts"]);
}
export async function closeCycleAction(id: string) {
  return act("appraisal.manage", async (ctx) => {
    const r = await ap.closeCycle(ctx, id);
    return { message: r.stillOpen ? `Cycle closed — ${r.stillOpen} appraisal(s) were not finished.` : "Cycle closed." };
  }, PAGES);
}
export async function assignReviewerAction(id: string, v: V) {
  return act("appraisal.manage", async (ctx) => {
    await ap.assignReviewer(ctx, id, String(v.userId ?? ""));
    return { message: "Reviewer assigned." };
  }, PAGES);
}

export async function saveReviewAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await ap.saveReview(ctx, id, {
      ratings: entries(v, "") as never,
      strengths: v.strengths as string | undefined,
      improvements: v.improvements as string | undefined,
      goals: v.goals as string | undefined,
      reviewerComment: v.reviewerComment as string | undefined,
      recommendation: (v.recommendation as never) ?? "NONE",
    });
    return { message: "Draft saved." };
  }, PAGES);
}
export async function submitReviewAction(id: string) {
  return act(undefined, async (ctx) => {
    await ap.submitReview(ctx, id);
    return { message: "Submitted for sign-off." };
  }, PAGES);
}
export async function returnReviewAction(id: string, note?: string) {
  return act("appraisal.approve", async (ctx) => {
    await ap.returnReview(ctx, id, note ?? "");
    return { message: "Returned to the reviewer." };
  }, PAGES);
}
export async function approveAppraisalAction(id: string, note?: string) {
  return act("appraisal.approve", async (ctx) => {
    await ap.approveAppraisal(ctx, id, note);
    return { message: "Appraisal signed off — the employee can now see it." };
  }, PAGES);
}

export async function saveSelfAssessmentAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await ap.saveSelfAssessment(ctx, id, { ratings: entries(v, "self_") as never, comment: v.comment as string | undefined });
    return { message: "Your self-assessment is saved." };
  }, PAGES);
}
export async function acknowledgeAppraisalAction(id: string, agree: boolean, comment?: string) {
  return act(undefined, async (ctx) => {
    await ap.acknowledgeAppraisal(ctx, id, { agree, comment });
    return { message: agree ? "Thank you — recorded." : "Your response has been recorded." };
  }, PAGES);
}

export async function addCriterionAction(v: V) {
  return act("appraisal.manage", async (ctx) => {
    await ap.addCriterion(ctx, v as never);
    return { message: "Criterion added." };
  }, PAGES);
}
export async function updateCriterionAction(id: string, v: V) {
  return act("appraisal.manage", async (ctx) => {
    await ap.updateCriterion(ctx, id, v as never);
    return { message: "Criterion updated.", redirectTo: "/settings/appraisal-criteria" };
  }, PAGES);
}
export async function toggleCriterionAction(id: string, active: boolean) {
  return act("appraisal.manage", async (ctx) => {
    await ap.updateCriterion(ctx, id, { active });
    return { message: active ? "Criterion switched on." : "Criterion switched off — new cycles won't use it." };
  }, PAGES);
}
