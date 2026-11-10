"use server";
import { actFor } from "./_run";
import * as rec from "@/server/services/recognition";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("recognition.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/recognition", "/me/recognition", "/me/team-recognition", "/me/recognition-board"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

/** HR sets up the awards the company gives. */
export async function addAwardTypeAction(v: V) {
  return act("hr.configure", async (ctx) => {
    await rec.addAwardType(ctx, {
      name: str(v.name) ?? "",
      description: str(v.description),
      longServiceYears: str(v.longServiceYears) ? Number(v.longServiceYears) : undefined,
      mayAnnounce: v.mayAnnounce === true || v.mayAnnounce === "true" || v.mayAnnounce === "on",
    });
    return { message: "Award added." };
  }, PAGES);
}

export async function setAwardTypeActiveAction(id: string, active: boolean) {
  return act("hr.configure", async (ctx) => {
    await rec.setAwardTypeActive(ctx, id, active);
    return { message: active ? "Award switched on." : "Award switched off. Nominations already made are kept." };
  }, PAGES);
}

/** A nomination is made by employee number. Whether this person may nominate that employee is the service's decision: for anyone who may not, the answer is only "not found". */
export async function nominateAction(v: V) {
  return act("recognition.nominate", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await rec.nominate(ctx, { employeeId: emp.id, typeId: str(v.typeId) ?? "", citation: str(v.citation) ?? "" });
    return { message: "Nomination sent to HR for a decision." };
  }, PAGES);
}

export async function approveAwardAction(id: string) {
  return act("hr.approve", async (ctx) => {
    await rec.approveAward(ctx, id);
    return { message: "Award approved. The employee can now see it." };
  }, PAGES);
}

export async function rejectAwardAction(id: string, reason?: string) {
  return act("hr.approve", async (ctx) => {
    await rec.rejectAward(ctx, id, reason ?? "");
    return { message: "Nomination declined. The employee is not told." };
  }, PAGES);
}

// A nominator may withdraw their own nomination while it is undecided; HR may withdraw an award. The service decides which.
export async function withdrawAwardAction(id: string, reason?: string) {
  return act(undefined, async (ctx) => {
    await rec.withdrawAward(ctx, id, reason ?? "");
    return { message: "Withdrawn. It is kept, marked, with the reason." };
  }, PAGES);
}

// The recipient answers about their own award: a login is enough, and the service decides whether it is theirs.
export async function announceAgreementAction(id: string, agree: boolean) {
  return act(undefined, async (ctx) => {
    await rec.setAnnounceAgreement(ctx, id, agree);
    return { message: agree ? "Thank you. Your award may be shown on the recognition board." : "Understood. Your award will not be shown on the recognition board." };
  }, PAGES);
}
