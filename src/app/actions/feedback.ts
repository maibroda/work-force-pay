"use server";
import { actFor } from "./_run";
import * as fb from "@/server/services/feedback";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("feedback.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr", "/me"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

/** Feedback is written by employee number (a text box, not a list of every employee). Whether this person may give feedback about that employee is the service's decision: for anyone who may not, the answer is only "not found". */
export async function giveFeedbackAction(v: V) {
  return act("feedback.give", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await fb.giveFeedback(ctx, { employeeId: emp.id, kind: str(v.kind) as never, body: str(v.body) ?? "", relatesOn: str(v.relatesOn) || undefined });
    return { message: "Feedback recorded. The employee can see it." };
  }, PAGES);
}

// The employee's reply acts on feedback about themselves: a login is enough, and the service decides whether it is theirs.
export async function replyToFeedbackAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await fb.replyToFeedback(ctx, id, str(v.reply) ?? "");
    return { message: "Your reply has been added." };
  }, PAGES);
}

export async function voidFeedbackAction(id: string, reason?: string) {
  return act("feedback.manage", async (ctx) => {
    await fb.voidFeedback(ctx, id, reason ?? "");
    return { message: "Feedback voided. It is kept, marked, with your reason." };
  }, PAGES);
}
