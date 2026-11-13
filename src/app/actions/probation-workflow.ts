"use server";
import { actFor } from "./_run";
import * as pw from "@/server/services/probation-workflow";
const act = actFor("probation-workflow.ts");

type V = Record<string, unknown>;
const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const PAGES = ["/hr/contracts", "/me/probation", "/me/team-probation", "/settings/probation-deciders"];

/** The reporting manager recommends (or HR, where the employee has no reporting manager). The service checks who may. */
export async function recommendProbationAction(contractId: string, v: V) {
  return act("probation.recommend", async (ctx) => {
    await pw.recommendProbation(ctx, contractId, { recommendation: s(v.recommendation) as never, months: s(v.months) as never, note: s(v.note) });
    return { message: "Recommendation recorded. HR reviews it next." };
  }, PAGES);
}

export async function reviewRecommendationAction(reviewId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await pw.reviewRecommendation(ctx, reviewId, { outcome: s(v.outcome) as never, note: s(v.note) ?? "" });
    return { message: "HR review recorded." };
  }, PAGES);
}

/** Any signed-in user may reach this: the service allows only a designated decider, never someone in the chain above. */
export async function decideReviewAction(reviewId: string, v: V) {
  return act(undefined, async (ctx) => {
    await pw.decideReview(ctx, reviewId, {
      decision: s(v.decision) as never,
      note: s(v.note),
      extensionMonths: s(v.extensionMonths) as never,
      effectiveDate: s(v.effectiveDate),
      feedback: s(v.feedback),
    });
    return { message: "Decision recorded. HR will tell the employee." };
  }, PAGES);
}

/** The employee's own response: only about their own probation (the service checks). */
export async function respondToReviewAction(reviewId: string, v: V) {
  return act(undefined, async (ctx) => {
    await pw.respondToReview(ctx, reviewId, { agree: v.agree === "yes" || v.agree === true, comment: s(v.comment) });
    return { message: "Your response is recorded." };
  }, PAGES);
}

export async function markResponseReadAction(reviewId: string) {
  return act(undefined, async (ctx) => {
    await pw.markResponseRead(ctx, reviewId);
    return { message: "Marked as read." };
  }, PAGES);
}

/** Only the Company Administrator (and platform staff): `probation.designate` is withheld from the HR administrator. */
export async function designateDeciderAction(v: V) {
  return act("probation.designate", async (ctx) => {
    await pw.designateDecider(ctx, { userId: s(v.userId) ?? "", departmentId: s(v.departmentId), reason: s(v.reason) ?? "" });
    return { message: "Designated. They can decide probation reviews from the next request." };
  }, PAGES);
}

export async function revokeDeciderAction(id: string, reason?: string) {
  return act("probation.designate", async (ctx) => {
    await pw.revokeDecider(ctx, id, reason ?? "");
    return { message: "Revoked. It stops working on their next request." };
  }, PAGES);
}
