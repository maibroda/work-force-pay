"use server";
import { actFor } from "./_run";
import * as enq from "@/server/services/hr-enquiries";
const act = actFor("hr-enquiries.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/enquiries", "/me/enquiries"];

/** An employee asks HR a question. */
export async function raiseEnquiryAction(v: V) {
  return act("enquiry.raise", async (ctx) => {
    const e = await enq.raiseEnquiry(ctx, v as never);
    return { message: `Sent to HR as ${e.number}. You will see the reply here.`, redirectTo: `/me/enquiries/${e.id}` };
  }, PAGES);
}

// Reply and close are for the employee who asked and for HR; the service decides which of them this is and refuses anyone else, so they only need a login here.
export async function replyEnquiryAction(id: string, v: V) {
  return act(undefined, async (ctx) => {
    await enq.replyToEnquiry(ctx, id, String(v.body ?? ""));
    return { message: "Message sent." };
  }, PAGES);
}

export async function closeEnquiryAction(id: string) {
  return act(undefined, async (ctx) => {
    await enq.closeEnquiry(ctx, id);
    return { message: "Closed." };
  }, PAGES);
}

/** HR moves an enquiry that is really a grievance, harassment, whistleblowing or welfare concern into an Employee relations case. */
export async function moveEnquiryToCaseAction(id: string, v: V) {
  return act("enquiry.respond", async (ctx) => {
    const c = await enq.moveEnquiryToCase(ctx, id, { ...v, welfareKind: v.welfareKind || undefined } as never);
    return { message: `Moved into case ${c.caseNumber}. The employee has been told, without the case number.`, redirectTo: c.type === "WELFARE" ? `/hr/welfare-cases/${c.id}` : `/hr/relations/${c.id}` };
  }, [...PAGES, "/hr/relations", "/hr/welfare-cases"]);
}
