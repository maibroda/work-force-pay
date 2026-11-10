"use server";
import { actFor } from "./_run";
import * as sk from "@/server/services/skills";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("skills.ts");

type V = Record<string, unknown>;
const PAGES = ["/settings/skills", "/hr/skills", "/me/skills", "/me/team-skills", "/me/career"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

// ── the library and what a role needs (HR who configures) ──
export async function addSkillAction(v: V) {
  return act("hr.configure", async (ctx) => {
    // the courses that build the skill: one per line or separated by commas
    const courses = (str(v.courses) ?? "")
      .split(/[\n,]/)
      .map((c) => c.trim())
      .filter(Boolean);
    await sk.addSkill(ctx, { name: str(v.name) ?? "", description: str(v.description), courses });
    return { message: "Skill added." };
  }, PAGES);
}

export async function setSkillActiveAction(id: string, active: boolean) {
  return act("hr.configure", async (ctx) => {
    await sk.setSkillActive(ctx, id, active);
    return { message: active ? "Skill switched on." : "Skill switched off. Assessments already made are kept." };
  }, PAGES);
}

export async function setRoleSkillAction(v: V) {
  return act("hr.configure", async (ctx) => {
    await sk.setRoleSkill(ctx, { categoryId: str(v.categoryId) ?? "", skillId: str(v.skillId) ?? "", requiredLevel: Number(v.requiredLevel) });
    return { message: "Requirement saved." };
  }, PAGES);
}

export async function removeRoleSkillAction(categoryId: string, skillId: string) {
  return act("hr.configure", async (ctx) => {
    await sk.removeRoleSkill(ctx, categoryId, skillId);
    return { message: "Requirement removed." };
  }, PAGES);
}

// ── assessing a person ──
/** An assessment is made by employee number. Whether this person may assess that employee is the service's decision: for anyone who may not, the answer is only "not found". */
export async function assessSkillAction(v: V) {
  return act("skills.assess", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    await sk.assessSkill(ctx, { employeeId: emp.id, skillId: str(v.skillId) ?? "", level: Number(v.level), comment: str(v.comment) });
    return { message: "Assessment recorded. The employee can read it." };
  }, PAGES);
}

// ── from a gap to a need (HR, never automatic) ──
export async function addNeedFromGapAction(employeeId: string, skillId: string, courseName: string) {
  return act("hr.manage", async (ctx) => {
    await sk.addNeedFromGap(ctx, employeeId, skillId, courseName);
    return { message: "Added to the training needs list. Nothing else has changed." };
  }, ["/hr/skills", "/hr/training-needs"]);
}
