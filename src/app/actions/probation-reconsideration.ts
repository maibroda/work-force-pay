"use server";
import { actFor } from "./_run";
import * as pr from "@/server/services/probation-reconsideration";
const act = actFor("probation-reconsideration.ts");

type V = Record<string, unknown>;
const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const PAGES = ["/hr/contracts", "/me/probation", "/me/team-probation"];

/** The conditions come from up to three rows of the form (what is measured, the target, the review day); a row left completely blank is skipped, a half-filled one is checked by the service. */
function expectationsFrom(v: V) {
  const out: Array<{ measure: string; target: string; reviewOn: string }> = [];
  for (const i of [1, 2, 3]) {
    const measure = s(v[`measure${i}`]);
    const target = s(v[`target${i}`]);
    const reviewOn = s(v[`reviewOn${i}`]);
    if (measure || target || reviewOn) out.push({ measure: measure ?? "", target: target ?? "", reviewOn: reviewOn ?? "" });
  }
  return out;
}

/** The reporting manager asks (or HR, only where the employee has no reporting manager). The service checks who may. */
export async function requestReconsiderationAction(contractId: string, v: V) {
  return act(undefined, async (ctx) => {
    await pr.requestReconsideration(ctx, contractId, { justification: s(v.justification) ?? "", months: s(v.months) as never, expectations: expectationsFrom(v) });
    return { message: "Reconsideration requested. HR reviews it next; nothing changes for the employee until it is approved and they are told." };
  }, PAGES);
}

export async function reviewReconsiderationAction(id: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await pr.reviewReconsideration(ctx, id, { outcome: s(v.outcome) as never, note: s(v.note) ?? "" });
    return { message: "HR review recorded." };
  }, PAGES);
}

/** Any signed-in user may reach this: the service allows only a designated decider, never the person who asked or the HR reviewer. */
export async function decideReconsiderationAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await pr.decideReconsideration(ctx, id, { decision: s(v.decision) as never, months: s(v.months) as never, note: s(v.note) });
    return { message: "Decision recorded." };
  }, PAGES);
}

export async function communicateReconsiderationAction(id: string) {
  return act("hr.manage", async (ctx) => {
    await pr.communicateReconsideration(ctx, id);
    return { message: "Recorded as told to the employee: the probation is extended from today." };
  }, PAGES);
}

/** The employee's one response; the service checks it is theirs, in effect and inside the window. */
export async function respondToReconsiderationAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await pr.respondToReconsideration(ctx, id, { agree: v.agree === "yes", comment: s(v.comment) });
    return { message: "Your response was recorded." };
  }, PAGES);
}

export async function withdrawReconsiderationAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await pr.withdrawReconsideration(ctx, id, s(v.reason) ?? "");
    return { message: "Withdrawn." };
  }, PAGES);
}
