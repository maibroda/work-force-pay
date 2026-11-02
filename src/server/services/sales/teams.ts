/**
 * Sales teams: a team has one manager (a sales manager) and members (salespeople); a person is in at most one team; a manager may manage several. Only the company administrator
 * (sales.configure) sets them up. A team is closed, not deleted, and closing it removes its members. What a team means for visibility is decided in access.ts: a sales manager sees
 * their own records and those of the members of the open teams they manage. Every change is audited by ids, never by name.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { requireSales } from "./access";

const teamSchema = z.object({
  name: z.string().trim().min(2, "Give the team a name of at least two letters.").max(80),
  managerUserId: z.string().min(1, "Choose the team's manager."),
});

async function activeUser(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const u = await tx.user.findFirst({ where: { id, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!u) throw new BusinessError("That person is not an active user of this organization.");
  return u;
}

/** A team's manager must be a sales manager (a role that manages teams). */
async function asManager(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const u = await activeUser(ctx, tx, id);
  if (u.role !== "SALES_MANAGER") throw new BusinessError(`${u.name} is not a sales manager. Give them the Sales Manager role first.`);
  return u;
}

export async function createTeam(ctx: Ctx, raw: z.input<typeof teamSchema>) {
  await requireSales(ctx, "sales.configure");
  const p = teamSchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  await asManager(ctx, db, v.managerUserId);
  if (await db.crmTeam.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" } }, select: { id: true } })) throw new BusinessError("A team with that name already exists.");
  const team = await db.crmTeam.create({ data: { organizationId: ctx.orgId, name: v.name, managerUserId: v.managerUserId, createdBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_TEAM_CREATE", entity: "CrmTeam", entityId: team.id, newValue: { managerUserId: v.managerUserId } });
  return team;
}

async function loadTeam(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const t = await tx.crmTeam.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!t) throw new BusinessError("Team not found.");
  return t;
}

export async function setTeamManager(ctx: Ctx, teamId: string, managerUserId: string) {
  await requireSales(ctx, "sales.configure");
  const t = await loadTeam(ctx, db, teamId);
  if (!t.active) throw new BusinessError("This team is closed.");
  await asManager(ctx, db, managerUserId);
  await db.crmTeam.update({ where: { id: teamId }, data: { managerUserId } });
  await logAudit(ctx, { action: "SALES_TEAM_MANAGER", entity: "CrmTeam", entityId: teamId, oldValue: { managerUserId: t.managerUserId }, newValue: { managerUserId } });
}

/** Adds a salesperson to a team. They must be able to work sales records, must not be someone who sees everything or manages teams, and must not already be in a team. */
export async function addTeamMember(ctx: Ctx, teamId: string, userId: string) {
  await requireSales(ctx, "sales.configure");
  const t = await loadTeam(ctx, db, teamId);
  if (!t.active) throw new BusinessError("This team is closed.");
  const u = await activeUser(ctx, db, userId);
  if (!can(u.role, "sales.manage") || can(u.role, "sales.view.all") || u.role === "SALES_MANAGER") throw new BusinessError(`${u.name} is not a salesperson (a sales rep, an account manager or a bureau sales person), so cannot be a team member.`);
  if (await db.crmTeamMember.findFirst({ where: { organizationId: ctx.orgId, userId }, select: { id: true } })) throw new BusinessError(`${u.name} is already in a team. Remove them from it first.`);
  const m = await db.crmTeamMember.create({ data: { organizationId: ctx.orgId, teamId, userId } });
  await logAudit(ctx, { action: "SALES_TEAM_ADD_MEMBER", entity: "CrmTeamMember", entityId: m.id, newValue: { teamId, userId } });
  return m;
}

export async function removeTeamMember(ctx: Ctx, teamId: string, userId: string) {
  await requireSales(ctx, "sales.configure");
  await loadTeam(ctx, db, teamId);
  const m = await db.crmTeamMember.findFirst({ where: { organizationId: ctx.orgId, teamId, userId } });
  if (!m) throw new BusinessError("That person is not in this team.");
  await db.crmTeamMember.delete({ where: { id: m.id } });
  await logAudit(ctx, { action: "SALES_TEAM_REMOVE_MEMBER", entity: "CrmTeamMember", entityId: m.id, newValue: { teamId, userId } });
}

/** Closes a team: its manager no longer sees its members' records, and the members are free to join another team. */
export async function deactivateTeam(ctx: Ctx, teamId: string) {
  await requireSales(ctx, "sales.configure");
  const t = await loadTeam(ctx, db, teamId);
  if (!t.active) throw new BusinessError("This team is already closed.");
  const n = await db.$transaction(async (tx: Tx) => {
    const removed = await tx.crmTeamMember.deleteMany({ where: { organizationId: ctx.orgId, teamId } });
    await tx.crmTeam.update({ where: { id: teamId }, data: { active: false } });
    await logAudit(ctx, { action: "SALES_TEAM_CLOSE", entity: "CrmTeam", entityId: teamId, newValue: { membersRemoved: removed.count } }, tx);
    return removed.count;
  });
  return n;
}

/** The open teams with their manager and members, for the administrator's page. */
export async function listTeams(ctx: Ctx) {
  await requireSales(ctx, "sales.configure");
  const teams = await db.crmTeam.findMany({ where: { organizationId: ctx.orgId, active: true }, include: { members: true }, orderBy: { name: "asc" }, take: 200 });
  const ids = [...new Set(teams.flatMap((t) => [t.managerUserId, ...t.members.map((m) => m.userId)]))];
  const users = await db.user.findMany({ where: { organizationId: ctx.orgId, id: { in: ids } }, select: { id: true, name: true, role: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    managerUserId: t.managerUserId,
    managerName: by.get(t.managerUserId)?.name ?? "(no longer in this organization)",
    members: t.members.map((m) => ({ userId: m.userId, name: by.get(m.userId)?.name ?? "(no longer in this organization)", role: by.get(m.userId)?.role ?? "" })),
  }));
}

/** The people who could be put in a team (active salespeople in no team) and who could manage one, for the page's choices. */
export async function teamCandidates(ctx: Ctx) {
  await requireSales(ctx, "sales.configure");
  const [users, taken] = await Promise.all([
    db.user.findMany({ where: { organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" }, take: 1000 }),
    db.crmTeamMember.findMany({ where: { organizationId: ctx.orgId }, select: { userId: true } }),
  ]);
  const inTeam = new Set(taken.map((t) => t.userId));
  return {
    managers: users.filter((u) => u.role === "SALES_MANAGER"),
    members: users.filter((u) => can(u.role, "sales.manage") && !can(u.role, "sales.view.all") && u.role !== "SALES_MANAGER" && !inTeam.has(u.id)),
  };
}
