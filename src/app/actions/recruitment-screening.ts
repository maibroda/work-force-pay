"use server";
import { actFor } from "./_run";
import * as rs from "@/server/services/recruitment-screening";
const act = actFor("recruitment-screening.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/requisitions", "/hr/candidates"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

/** The criteria form: a name and a kind per row (n1..n8, k1..k8). Empty rows are ignored; the service checks the rest. */
export async function setScreeningCriteriaAction(requisitionId: string, v: V) {
  return act("recruitment.assess", async (ctx) => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((i) => ({ name: str(v[`n${i}`])?.trim() ?? "", kind: (str(v[`k${i}`]) || "PREFERRED") as "MUST_HAVE" | "PREFERRED" }))
      .filter((x) => x.name);
    await rs.setScreeningCriteria(ctx, requisitionId, items);
    return { message: "Screening criteria saved." };
  }, PAGES);
}

/** One candidate's answers: outcome_<criterionId> and evidence_<criterionId> for every criterion. */
export async function recordScreeningAction(candidateId: string, v: V) {
  return act("recruitment.assess", async (ctx) => {
    const answers = Object.entries(v)
      .filter(([k]) => k.startsWith("outcome_"))
      .map(([k, val]) => ({ criterionId: k.slice(8), outcome: str(val) as never, evidence: str(v[`evidence_${k.slice(8)}`])?.trim() || undefined }));
    await rs.recordScreening(ctx, candidateId, answers);
    return { message: "Screening answers saved." };
  }, PAGES);
}

export async function decideShortlistAction(candidateId: string, v: V) {
  return act("recruitment.assess", async (ctx) => {
    await rs.decideShortlist(ctx, candidateId, str(v.decision) as never, str(v.reason) ?? "");
    return { message: "Shortlist decision recorded." };
  }, PAGES);
}
