/**
 * Skills, skill gaps and learning paths.
 *
 * The company's own skill library (none provided), the level of each skill a role needs, and a manager's assessment of a person. An assessment is a record of a
 * judgement and is APPEND-ONLY: the current level is the latest, a correction is a new assessment, the history stays, and the employee reads all of it. "Not assessed" is
 * never a gap. Nothing here changes pay, status, a certificate, an appraisal or a career proposal; a training need is added from a gap only by HR, never automatically.
 * Who may assess whom is the same rule as feedback, recognition, promotions and evaluation (`mayGiveFeedback`), reused. The audit log carries ids, the skill and the level,
 * never a comment. Every query selects only the fields it returns.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { mayGiveFeedback } from "@/lib/feedback";
import { checkLevel, COMMENT_MAX, currentLevel, gapOf, isStale, pathSkills, summariseGaps, type AssessmentLike } from "@/lib/skills";
import { sameCourse } from "@/lib/training-plan";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { addNeed } from "./training-plan";

const todayIso = () => iso(todayUtc());
const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;

// ───────────────────────────── The library and what a role needs ─────────────────────────────

export const skillSchema = z.object({
  name: z.string().trim().min(3, "Name the skill").max(80),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
  courses: z.array(z.string().trim().min(3).max(120)).max(10).default([]),
});

export async function addSkill(ctx: Ctx, raw: z.input<typeof skillSchema>) {
  assertCan(ctx, "hr.configure");
  const v = skillSchema.parse(raw);
  const all = await db.skill.findMany({ where: { organizationId: ctx.orgId }, select: { name: true } });
  if (all.some((s) => sameCourse(s.name, v.name))) throw new BusinessError("A skill with that name already exists.");
  const s = await db.skill.create({ data: { organizationId: ctx.orgId, name: v.name, description: v.description ?? null, courses: v.courses, createdBy: ctx.name } });
  await logAudit(ctx, { action: "SKILL_ADD", entity: "Skill", entityId: s.id, newValue: { courseCount: v.courses.length } });
  return s;
}

export async function setSkillActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "hr.configure");
  const s = await db.skill.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true } });
  if (!s) throw new BusinessError("Skill not found.");
  const u = await db.skill.update({ where: { id }, data: { active } });
  await logAudit(ctx, { action: "SKILL_UPDATE", entity: "Skill", entityId: id, newValue: { active } });
  return u;
}

/** HR (and the auditor) and managers who assess read the library; the employee reads their own skills instead. */
export async function listSkills(ctx: Ctx) {
  if (!can(ctx.role, "hr.view")) assertCan(ctx, "skills.assess");
  return db.skill.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, description: true, courses: true, active: true }, orderBy: { name: "asc" } });
}

export async function setRoleSkill(ctx: Ctx, raw: { categoryId: string; skillId: string; requiredLevel: number }) {
  assertCan(ctx, "hr.configure");
  const bad = checkLevel(Number(raw.requiredLevel));
  if (bad) throw new BusinessError(bad);
  const [cat, skill] = await Promise.all([
    db.employeeCategory.findFirst({ where: { id: raw.categoryId, organizationId: ctx.orgId }, select: { id: true } }),
    db.skill.findFirst({ where: { id: raw.skillId, organizationId: ctx.orgId }, select: { id: true } }),
  ]);
  if (!cat) throw new BusinessError("Role not found.");
  if (!skill) throw new BusinessError("Skill not found.");
  const row = await db.roleSkill.upsert({
    where: { categoryId_skillId: { categoryId: cat.id, skillId: skill.id } },
    create: { organizationId: ctx.orgId, categoryId: cat.id, skillId: skill.id, requiredLevel: raw.requiredLevel, createdBy: ctx.name },
    update: { requiredLevel: raw.requiredLevel },
  });
  await logAudit(ctx, { action: "ROLE_SKILL_SET", entity: "RoleSkill", entityId: row.id, newValue: { categoryId: cat.id, skillId: skill.id, requiredLevel: raw.requiredLevel } });
  return row;
}

export async function removeRoleSkill(ctx: Ctx, categoryId: string, skillId: string) {
  assertCan(ctx, "hr.configure");
  const row = await db.roleSkill.findFirst({ where: { organizationId: ctx.orgId, categoryId, skillId }, select: { id: true } });
  if (!row) throw new BusinessError("That requirement does not exist.");
  await db.roleSkill.delete({ where: { id: row.id } });
  await logAudit(ctx, { action: "ROLE_SKILL_REMOVE", entity: "RoleSkill", entityId: row.id, newValue: { categoryId, skillId } });
  return { id: row.id };
}

export async function listRoleSkills(ctx: Ctx) {
  if (!can(ctx.role, "hr.view")) assertCan(ctx, "skills.assess");
  const rows = await db.roleSkill.findMany({
    where: { organizationId: ctx.orgId },
    select: { categoryId: true, skillId: true, requiredLevel: true, category: { select: { name: true } }, skill: { select: { name: true, active: true } } },
    orderBy: [{ category: { name: "asc" } }, { skill: { name: "asc" } }],
  });
  return rows.map((r) => ({ categoryId: r.categoryId, role: r.category.name, skillId: r.skillId, skillName: r.skill.name, skillActive: r.skill.active, requiredLevel: r.requiredLevel }));
}

// ───────────────────────────── Assessing ─────────────────────────────

const assessmentSchema = z.object({
  employeeId: z.string().min(1),
  skillId: z.string().min(1),
  level: z.coerce.number(),
  comment: z
    .string()
    .trim()
    .max(COMMENT_MAX, `Keep the comment to at most ${COMMENT_MAX} characters`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** A manager assesses a direct report, HR anyone, nobody themselves. Append-only: this becomes the current level and the earlier ones stay as history. */
export async function assessSkill(ctx: Ctx, raw: z.input<typeof assessmentSchema>) {
  assertCan(ctx, "skills.assess");
  const v = assessmentSchema.parse(raw);
  const bad = checkLevel(v.level);
  if (bad) throw new BusinessError(bad);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true, reportingManagerId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't assess yourself.");
  if (verdict === "NOT_FOUND") throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so they can't be assessed.");
  const skill = await db.skill.findFirst({ where: { id: v.skillId, organizationId: ctx.orgId }, select: { id: true, active: true } });
  if (!skill) throw new BusinessError("Skill not found.");
  if (!skill.active) throw new BusinessError("This skill is switched off.");
  const a = await db.skillAssessment.create({
    data: { organizationId: ctx.orgId, employeeId: emp.id, skillId: skill.id, level: v.level, comment: v.comment ?? null, assessedOn: d(todayIso()), assessedByUserId: ctx.userId, assessedBy: ctx.name },
  });
  await logAudit(ctx, { action: "SKILL_ASSESS", entity: "SkillAssessment", entityId: a.id, newValue: { employeeId: emp.id, skillId: skill.id, level: v.level } });
  return a;
}

// ───────────────────────────── The gap view ─────────────────────────────

type Hist = { level: number; assessedOn: string; assessedBy: string; comment: string | null; recordedAt: number };

/** The person's requirements against their current level, with the whole history of each skill (newest first). Selects only what it returns. */
async function skillRows(orgId: string, employeeId: string, categoryId: string) {
  const [needs, assessments] = await Promise.all([
    db.roleSkill.findMany({ where: { organizationId: orgId, categoryId, skill: { active: true } }, select: { skillId: true, requiredLevel: true, skill: { select: { name: true } } }, orderBy: { skill: { name: "asc" } } }),
    db.skillAssessment.findMany({ where: { organizationId: orgId, employeeId }, select: { skillId: true, level: true, assessedOn: true, assessedBy: true, comment: true, createdAt: true }, orderBy: [{ assessedOn: "desc" }, { createdAt: "desc" }] }),
  ]);
  const bySkill = new Map<string, Hist[]>();
  for (const a of assessments) bySkill.set(a.skillId, [...(bySkill.get(a.skillId) ?? []), { level: a.level, assessedOn: iso(a.assessedOn), assessedBy: a.assessedBy, comment: a.comment, recordedAt: a.createdAt.getTime() }]);
  return needs.map((n) => {
    const history = bySkill.get(n.skillId) ?? [];
    const asLike: AssessmentLike[] = history.map((h) => ({ level: h.level, assessedOn: h.assessedOn, recordedAt: h.recordedAt }));
    const current = currentLevel(asLike);
    return {
      skillId: n.skillId,
      name: n.skill.name,
      requiredLevel: n.requiredLevel,
      current,
      ...gapOf(n.requiredLevel, current),
      history: history.map((h) => ({ level: h.level, assessedOn: h.assessedOn, assessedBy: h.assessedBy, comment: h.comment })),
    };
  });
}

/** One person's skills for HR (and the auditor) or for their own manager. Anyone else: "Employee not found". */
export async function employeeSkills(ctx: Ctx, employeeId: string) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "skills.assess");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { ...EMPLOYEE_SELECT, categoryId: true, reportingManagerId: true, category: { select: { name: true } } } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (!all && mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: false }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId }) !== null) throw new BusinessError("Employee not found.");
  return { employee: { id: emp.id, employeeNumber: emp.employeeNumber, firstName: emp.firstName, lastName: emp.lastName }, role: emp.category.name, rows: await skillRows(ctx.orgId, emp.id, emp.categoryId) };
}

/** The signed-in employee's own skills: what their role needs, where they stand, and the whole history, with who assessed and when. Nothing about anyone else. */
export async function mySkills(ctx: Ctx) {
  if (!ctx.employeeId) return { role: null as string | null, rows: [] as Awaited<ReturnType<typeof skillRows>> };
  const emp = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId }, select: { categoryId: true, category: { select: { name: true } } } });
  if (!emp) return { role: null, rows: [] };
  return { role: emp.category.name, rows: await skillRows(ctx.orgId, ctx.employeeId, emp.categoryId) };
}

/** Per role and skill: how many people are at or above the level, below it and not assessed, with the named list below it. For HR (and the auditor). */
export async function roleGaps(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const [needs, people, assessments] = await Promise.all([
    db.roleSkill.findMany({ where: { organizationId: ctx.orgId, skill: { active: true } }, select: { categoryId: true, skillId: true, requiredLevel: true, category: { select: { name: true } }, skill: { select: { name: true } } }, orderBy: [{ category: { name: "asc" } }, { skill: { name: "asc" } }] }),
    db.employee.findMany({ where: { organizationId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { ...EMPLOYEE_SELECT, categoryId: true } }),
    db.skillAssessment.findMany({ where: { organizationId: ctx.orgId }, select: { employeeId: true, skillId: true, level: true, assessedOn: true, createdAt: true } }),
  ]);
  const hist = new Map<string, AssessmentLike[]>();
  for (const a of assessments) {
    const k = `${a.employeeId}:${a.skillId}`;
    hist.set(k, [...(hist.get(k) ?? []), { level: a.level, assessedOn: iso(a.assessedOn), recordedAt: a.createdAt.getTime() }]);
  }
  const byCategory = new Map<string, { categoryId: string; role: string; skills: Array<{ skillId: string; name: string; requiredLevel: number; met: number; below: number; notAssessed: number; total: number; belowPeople: Array<{ employeeNumber: string; firstName: string; lastName: string; current: number }> }> }>();
  for (const n of needs) {
    const members = people.filter((p) => p.categoryId === n.categoryId);
    const currents = members.map((m) => currentLevel(hist.get(`${m.id}:${n.skillId}`) ?? []));
    const entry = byCategory.get(n.categoryId) ?? { categoryId: n.categoryId, role: n.category.name, skills: [] };
    entry.skills.push({
      skillId: n.skillId,
      name: n.skill.name,
      requiredLevel: n.requiredLevel,
      ...summariseGaps(currents, n.requiredLevel),
      belowPeople: members.flatMap((m, i) => (currents[i] !== null && currents[i]! < n.requiredLevel ? [{ employeeNumber: m.employeeNumber, firstName: m.firstName, lastName: m.lastName, current: currents[i]! }] : [])),
    });
    byCategory.set(n.categoryId, entry);
  }
  return [...byCategory.values()];
}

/** The current assessments older than the company's number of days (0 = none), so a level does not go stale unnoticed. Never a score, never a block. */
export async function staleAssessments(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const days = (await getHrPolicy(ctx.orgId)).skillReassessDays;
  if (days === 0) return [];
  const rows = await db.skillAssessment.findMany({
    where: { organizationId: ctx.orgId, employee: { status: { in: ["ACTIVE", "ON_LEAVE"] } } },
    select: { employeeId: true, skillId: true, level: true, assessedOn: true, createdAt: true, employee: { select: EMPLOYEE_SELECT }, skill: { select: { name: true } } },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.employeeId}:${r.skillId}`;
    const cur = latest.get(k);
    if (!cur || r.assessedOn > cur.assessedOn || (+r.assessedOn === +cur.assessedOn && r.createdAt > cur.createdAt)) latest.set(k, r);
  }
  return [...latest.values()]
    .filter((r) => isStale(iso(r.assessedOn), todayIso(), days))
    .map((r) => ({ employee: r.employee, skillName: r.skill.name, level: r.level, assessedOn: r.assessedOn }))
    .sort((a, b) => +a.assessedOn - +b.assessedOn);
}

// ───────────────────────────── Learning paths (derived) ─────────────────────────────

/** For each career path set from the person's role: the skills of the target role they are below or not yet assessed on, with the courses that build them. A guide, not a promise. */
async function pathsFor(orgId: string, employeeId: string, categoryId: string) {
  const paths = await db.careerPath.findMany({ where: { organizationId: orgId, fromCategoryId: categoryId, active: true }, select: { toCategoryId: true, minMonths: true, requiredCourse: true, toCategory: { select: { name: true } } }, orderBy: { toCategory: { name: "asc" } } });
  const levels = new Map<string, number>();
  const all = await db.skillAssessment.findMany({ where: { organizationId: orgId, employeeId }, select: { skillId: true, level: true, assessedOn: true, createdAt: true } });
  const hist = new Map<string, AssessmentLike[]>();
  for (const a of all) hist.set(a.skillId, [...(hist.get(a.skillId) ?? []), { level: a.level, assessedOn: iso(a.assessedOn), recordedAt: a.createdAt.getTime() }]);
  for (const [skillId, h] of hist) {
    const c = currentLevel(h);
    if (c !== null) levels.set(skillId, c);
  }
  const out = [];
  for (const p of paths) {
    const target = await db.roleSkill.findMany({ where: { organizationId: orgId, categoryId: p.toCategoryId, skill: { active: true } }, select: { skillId: true, requiredLevel: true, skill: { select: { name: true, courses: true } } }, orderBy: { skill: { name: "asc" } } });
    out.push({
      toRole: p.toCategory.name,
      minMonths: p.minMonths,
      requiredCourse: p.requiredCourse,
      skills: pathSkills(target.map((t) => ({ skillId: t.skillId, name: t.skill.name, requiredLevel: t.requiredLevel, courses: t.skill.courses })), levels),
    });
  }
  return out;
}

export async function myLearningPaths(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const emp = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId }, select: { categoryId: true } });
  if (!emp) return [];
  return pathsFor(ctx.orgId, ctx.employeeId, emp.categoryId);
}

/** The same for a person HR or their manager looks at. */
export async function learningPathFor(ctx: Ctx, employeeId: string) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "skills.assess");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true, categoryId: true, reportingManagerId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (!all && mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: false }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId }) !== null) throw new BusinessError("Employee not found.");
  return pathsFor(ctx.orgId, emp.id, emp.categoryId);
}

// ───────────────────────────── From a gap to a need ─────────────────────────────

/** HR adds a training need for a real gap (a level below what the role needs: never for a skill not yet assessed), for a course linked to the skill. Never automatic. */
export async function addNeedFromGap(ctx: Ctx, employeeId: string, skillId: string, courseName: string) {
  assertCan(ctx, "hr.manage");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true, categoryId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const skill = await db.skill.findFirst({ where: { id: skillId, organizationId: ctx.orgId }, select: { id: true, name: true, courses: true } });
  if (!skill) throw new BusinessError("Skill not found.");
  const link = skill.courses.find((c) => sameCourse(c, courseName));
  if (!link) throw new BusinessError("Choose a course linked to this skill.");
  const row = (await skillRows(ctx.orgId, emp.id, emp.categoryId)).find((r) => r.skillId === skill.id);
  if (!row || row.status !== "BELOW") throw new BusinessError("There is no gap for this person on that skill.");
  return addNeed(ctx, { employeeId: emp.id, courseName: link, source: "OTHER", note: `Skill gap: ${skill.name}` });
}
