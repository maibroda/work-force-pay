"use server";
import { actFor } from "./_run";
import * as car from "@/server/services/career";
import * as suc from "@/server/services/succession";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("career.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/promotions", "/hr/succession", "/settings/career-paths", "/me/career", "/me/team-promotions"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

// ── career paths (guidance) ──
export async function addCareerPathAction(v: V) {
  return act("hr.configure", async (ctx) => {
    await car.addCareerPath(ctx, { fromCategoryId: str(v.fromCategoryId) ?? "", toCategoryId: str(v.toCategoryId) ?? "", minMonths: str(v.minMonths) ? Number(v.minMonths) : undefined, requiredCourse: str(v.requiredCourse) });
    return { message: "Career path added." };
  }, PAGES);
}

export async function setCareerPathActiveAction(id: string, active: boolean) {
  return act("hr.configure", async (ctx) => {
    await car.setCareerPathActive(ctx, id, active);
    return { message: active ? "Career path switched on." : "Career path switched off." };
  }, PAGES);
}

// ── promotion proposals ──
/** A proposal is made by employee number. Whether this person may propose that employee is the service's decision: for anyone who may not, the answer is only "not found". */
export async function proposePromotionAction(v: V) {
  return act("career.propose", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await car.proposePromotion(ctx, { employeeId: emp.id, toCategoryId: str(v.toCategoryId) ?? "", reason: str(v.reason) ?? "", intendedOn: str(v.intendedOn) ?? "" });
    return { message: "Proposal recorded. Someone else will decide it." };
  }, PAGES);
}

export async function approvePromotionAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await car.approvePromotion(ctx, id, note);
    return { message: "Approved. Nothing about the employee has changed: HR now applies it on the employee and pay screens." };
  }, PAGES);
}

export async function declinePromotionAction(id: string, reason?: string) {
  return act("hr.approve", async (ctx) => {
    await car.declinePromotion(ctx, id, reason ?? "");
    return { message: "Proposal declined. The employee is not told." };
  }, PAGES);
}

// A proposer may withdraw their own proposal while it is undecided; the approve right may withdraw an approved one. The service decides which.
export async function withdrawPromotionAction(id: string, reason?: string) {
  return act(undefined, async (ctx) => {
    await car.withdrawPromotion(ctx, id, reason ?? "");
    return { message: "Withdrawn. It is kept, marked, with the reason." };
  }, PAGES);
}

export async function applyPromotionAction(id: string) {
  return act("hr.manage", async (ctx) => {
    await car.applyPromotion(ctx, id);
    return { message: "Marked applied." };
  }, PAGES);
}

// ── succession (HR administrator only) ──
export async function addSuccessionRoleAction(v: V) {
  return act("succession.manage", async (ctx) => {
    await suc.addSuccessionRole(ctx, str(v.categoryId) ?? "");
    return { message: "Critical role added." };
  }, PAGES);
}

export async function setSuccessionRoleActiveAction(id: string, active: boolean) {
  return act("succession.manage", async (ctx) => {
    await suc.setSuccessionRoleActive(ctx, id, active);
    return { message: active ? "Critical role switched on." : "Critical role switched off." };
  }, PAGES);
}

export async function setSuccessorAction(roleId: string, v: V) {
  return act("succession.manage", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await suc.setSuccessor(ctx, { roleId, employeeId: emp.id, readiness: (str(v.readiness) ?? "") as never, reason: str(v.reason), singleHolderReason: str(v.singleHolderReason) });
    return { message: "Recorded. A new nomination counts once a different holder of this function approves it." };
  }, PAGES);
}

/** A different holder of the succession function approves a proposed nomination; the proposer only with a reason, and only if they are the only holder. */
export async function approveSuccessorAction(id: string, reason?: string) {
  return act("succession.manage", async (ctx) => {
    await suc.approveSuccessor(ctx, id, { reason });
    return { message: "Nomination approved: it now counts." };
  }, PAGES);
}

export async function rejectSuccessorAction(id: string) {
  return act("succession.manage", async (ctx) => {
    await suc.rejectSuccessor(ctx, id);
    return { message: "Nomination rejected." };
  }, PAGES);
}

export async function removeSuccessorAction(id: string) {
  return act("succession.manage", async (ctx) => {
    await suc.removeSuccessor(ctx, id);
    return { message: "Successor removed." };
  }, PAGES);
}
