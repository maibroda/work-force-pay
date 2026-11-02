"use server";
import { act } from "./_run";
import { addTeamMember, createTeam, deactivateTeam, removeTeamMember } from "@/server/services/sales/teams";

type V = Record<string, unknown>;
const PATHS = ["/sales/teams"];

/** Starts a team with its manager (a sales manager). Only the company administrator may. */
export async function createTeamAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await createTeam(ctx, { name: String(v.name ?? ""), managerUserId: String(v.managerUserId ?? "") });
    return { message: "Team created. Add its members next." };
  }, PATHS);
}

export async function addTeamMemberAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await addTeamMember(ctx, String(v.teamId ?? ""), String(v.userId ?? ""));
    return { message: "Added. Their manager now sees their records." };
  }, PATHS);
}

export async function removeTeamMemberAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await removeTeamMember(ctx, String(v.teamId ?? ""), String(v.userId ?? ""));
    return { message: "Removed. Their manager no longer sees their records." };
  }, PATHS);
}

export async function closeTeamAction(v: V) {
  return act("sales.configure", async (ctx) => {
    const n = await deactivateTeam(ctx, String(v.teamId ?? ""));
    return { message: `Team closed. ${n} member(s) are free to join another team.` };
  }, PATHS);
}
