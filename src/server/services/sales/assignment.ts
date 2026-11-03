/**
 * Who a new lead goes to when nobody was named. It applies only to a lead created by a manager with no owner given, and to imports; a sales person always owns
 * what they add themselves. A manager is either someone who sees all sales records (the administrator), whose leads are shared out among all the active sales
 * people, or a sales manager, whose leads are shared out among the members of the teams they manage and nobody else (each team keeps its own place in the
 * rotation, so one team's leads never throw another's off). Methods: round robin, by the lead's state, or by the service wanted; a state or service rule may
 * name only someone within a sales manager's reach. When no rule fits, or a sales manager has no team members, the creator keeps it. Every assignment is
 * audited (ids and the rule, never the lead).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { assertCan, BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";

export const METHODS = ["NONE", "ROUND_ROBIN", "BY_STATE", "BY_SERVICE"] as const;
export type AssignmentMethod = (typeof METHODS)[number];

/** Roles of people who work leads themselves: they can manage sales records but do not see everyone's. */
const SALES_PERSON_ROLES = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.manage") && !can(r, "sales.view.all"));

export async function getAssignment(ctx: Ctx) {
  assertCan(ctx, "sales.view");
  const [setting, rules] = await Promise.all([
    db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { assignmentMethod: true } }),
    db.crmAssignmentRule.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ kind: "asc" }, { keyNorm: "asc" }] }),
  ]);
  return { method: (setting?.assignmentMethod ?? "NONE") as AssignmentMethod, rules };
}

export async function setAssignmentMethod(ctx: Ctx, method: AssignmentMethod) {
  assertCan(ctx, "sales.configure");
  if (!METHODS.includes(method)) throw new BusinessError("Choose none, round robin, by state or by service.");
  const before = await getAssignment(ctx);
  await db.crmSetting.upsert({
    where: { organizationId: ctx.orgId },
    create: { organizationId: ctx.orgId, assignmentMethod: method, updatedBy: ctx.name },
    update: { assignmentMethod: method, updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "SALES_ASSIGNMENT_METHOD", entity: "CrmSetting", entityId: ctx.orgId, oldValue: { method: before.method }, newValue: { method } });
}

export const ruleSchema = z.object({ kind: z.enum(["STATE", "SERVICE"]), key: z.string().trim().min(1, "Say which state or service"), userId: z.string().min(1) });

export async function setAssignmentRule(ctx: Ctx, raw: z.input<typeof ruleSchema>) {
  assertCan(ctx, "sales.configure");
  const v = ruleSchema.parse(raw);
  const user = await db.user.findFirst({ where: { id: v.userId, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!user) throw new BusinessError("That person is not an active user of this organization.");
  if (!can(user.role as Role, "sales.manage")) throw new BusinessError(`${user.name} does not work in sales, so leads cannot be assigned to them.`);
  const keyNorm = v.key.toLowerCase().replace(/\s+/g, " ");
  const rule = await db.crmAssignmentRule.upsert({
    where: { organizationId_kind_keyNorm: { organizationId: ctx.orgId, kind: v.kind, keyNorm } },
    create: { organizationId: ctx.orgId, kind: v.kind, key: v.key, keyNorm, userId: user.id, userName: user.name, createdBy: ctx.name },
    update: { key: v.key, userId: user.id, userName: user.name },
  });
  await logAudit(ctx, { action: "SALES_ASSIGNMENT_RULE", entity: "CrmAssignmentRule", entityId: rule.id, newValue: { kind: v.kind, userId: user.id } });
  return rule;
}

export async function removeAssignmentRule(ctx: Ctx, id: string) {
  assertCan(ctx, "sales.configure");
  const rule = await db.crmAssignmentRule.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rule) throw new BusinessError("Rule not found.");
  await db.crmAssignmentRule.delete({ where: { id } });
  await logAudit(ctx, { action: "SALES_ASSIGNMENT_RULE_REMOVE", entity: "CrmAssignmentRule", entityId: id, oldValue: { kind: rule.kind } });
}

/** Does a new lead this person adds, with no owner named, go through the assignment method? The administrator and a sales manager only. */
export const autoAssigns = (ctx: Ctx) => can(ctx.role, "sales.view.all") || ctx.role === "SALES_MANAGER";

/** The open teams a sales manager manages, with their members who are still active users, in a fixed order. The first team (by id) keeps the rotation. */
async function teamsOf(ctx: Ctx, tx: Tx) {
  const teams = await tx.crmTeam.findMany({ where: { organizationId: ctx.orgId, managerUserId: ctx.userId, active: true }, orderBy: { id: "asc" }, select: { id: true, members: { select: { userId: true } } } });
  const ids = [...new Set(teams.flatMap((t) => t.members.map((m) => m.userId)))];
  const users = ids.length ? await tx.user.findMany({ where: { organizationId: ctx.orgId, id: { in: ids }, active: true }, orderBy: { id: "asc" }, select: { id: true, name: true } }) : [];
  return { cursorTeamId: teams[0]?.id, members: users };
}

/** The owner for a new lead by the organization's method, or null when there is no method or no rule fits (the creator keeps it). Call inside the lead's transaction. */
export async function pickOwner(ctx: Ctx, tx: Tx, lead: { state?: string | null; serviceInterest: string }): Promise<{ ownerUserId: string; ownerName: string; via: string } | null> {
  const setting = await tx.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { assignmentMethod: true } });
  const method = setting?.assignmentMethod ?? "NONE";
  if (method === "NONE") return null;
  // a sales manager hands leads only to the people on their teams
  const team = ctx.role === "SALES_MANAGER" && !can(ctx.role, "sales.view.all") ? await teamsOf(ctx, tx) : null;
  if (method === "BY_STATE" || method === "BY_SERVICE") {
    const kind = method === "BY_STATE" ? "STATE" : "SERVICE";
    const keyNorm = (kind === "STATE" ? lead.state ?? "" : lead.serviceInterest).toLowerCase().replace(/\s+/g, " ");
    if (!keyNorm) return null;
    const rule = await tx.crmAssignmentRule.findUnique({ where: { organizationId_kind_keyNorm: { organizationId: ctx.orgId, kind, keyNorm } } });
    if (!rule) return null;
    if (team && !team.members.some((m) => m.id === rule.userId)) return null; // outside a sales manager's reach: the manager keeps it
    const user = await tx.user.findFirst({ where: { id: rule.userId, organizationId: ctx.orgId, active: true }, select: { id: true, name: true } });
    return user ? { ownerUserId: user.id, ownerName: user.name, via: method } : null;
  }
  if (team) {
    if (!team.cursorTeamId || !team.members.length) return null; // no team, or nobody in it: the manager keeps it
    const t = await tx.crmTeam.update({ where: { id: team.cursorTeamId }, data: { assignmentCursor: { increment: 1 } }, select: { assignmentCursor: true } });
    const member = team.members[(t.assignmentCursor - 1) % team.members.length];
    return { ownerUserId: member.id, ownerName: member.name, via: `${method} (team)` };
  }
  const pool = await tx.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: SALES_PERSON_ROLES as never } }, orderBy: { id: "asc" }, select: { id: true, name: true } });
  if (!pool.length) return null;
  const s = await tx.crmSetting.update({ where: { organizationId: ctx.orgId }, data: { assignmentCursor: { increment: 1 } }, select: { assignmentCursor: true } });
  const person = pool[(s.assignmentCursor - 1) % pool.length];
  return { ownerUserId: person.id, ownerName: person.name, via: method };
}
