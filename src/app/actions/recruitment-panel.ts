"use server";
import { actFor } from "./_run";
import * as rp from "@/server/services/recruitment-panel";
const act = actFor("recruitment-panel.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/requisitions", "/hr/candidates", "/me/interviews"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const pick = (v: V, keys: string[]) => keys.map((k) => str(v[k])?.trim()).filter((x): x is string => !!x);

// ── HR sets up the scoring ──
export async function setCriteriaAction(requisitionId: string, v: V) {
  return act("recruitment.assess", async (ctx) => {
    await rp.setCriteria(ctx, requisitionId, pick(v, ["c1", "c2", "c3", "c4", "c5", "c6"]));
    return { message: "Scoring criteria saved." };
  }, PAGES);
}

export async function setPanelAction(interviewId: string, v: V) {
  return act("recruitment.assess", async (ctx) => {
    await rp.setPanel(ctx, interviewId, { chairEmployeeId: str(v.chair) ?? "", memberEmployeeIds: pick(v, ["m1", "m2", "m3", "m4"]) });
    return { message: "Panel saved." };
  }, PAGES);
}

// ── A panel member (a seat, not a permission) ──
/** The scorecard form: a score and an optional comment per criterion (score_<id>, comment_<id>), a recommendation and an optional overall comment. */
export async function submitScorecardAction(interviewId: string, v: V) {
  return act(undefined, async (ctx) => {
    const scores = Object.entries(v)
      .filter(([k]) => k.startsWith("score_"))
      .map(([k, val]) => ({ criterionId: k.slice(6), score: Number(val), comment: str(v[`comment_${k.slice(6)}`])?.trim() || undefined }));
    await rp.submitScorecard(ctx, interviewId, { scores, recommendation: str(v.recommendation) as never, comment: str(v.comment)?.trim() || undefined });
    return { message: "Scorecard saved. You can correct it until the panel closes." };
  }, PAGES);
}

/** Closes the scoring early: the chair, or HR (the service decides). */
export async function closePanelAction(interviewId: string) {
  return act(undefined, async (ctx) => {
    await rp.closePanel(ctx, interviewId);
    return { message: "Scoring closed. The scorecards can now be read." };
  }, PAGES);
}

export async function recommendSelectionAction(candidateId: string, v: V) {
  return act(undefined, async (ctx) => {
    await rp.recommendSelection(ctx, candidateId, str(v.note) ?? "");
    return { message: "Recommendation sent for approval." };
  }, PAGES);
}

export async function approveSelectionAction(candidateId: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await rp.decideSelection(ctx, candidateId, "APPROVED", note);
    return { message: "Selection approved. An offer can now be raised." };
  }, PAGES);
}

export async function declineSelectionAction(candidateId: string, reason?: string) {
  return act("hr.approve", async (ctx) => {
    await rp.decideSelection(ctx, candidateId, "REJECTED", reason ?? "");
    return { message: "Selection declined." };
  }, PAGES);
}
