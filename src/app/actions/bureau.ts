"use server";
import { act } from "./_run";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { logAudit } from "@/server/services/audit";
import * as bureau from "@/server/services/bureau";

type V = Record<string, unknown>;
const PATHS = ["/bureau"];

/**
 * Work in a client organization (or go back to the bureau's own). Access is checked here and again on every request afterwards;
 * entering a client is recorded in the client's own audit log.
 */
export async function switchOrganizationAction(targetOrgId: string) {
  return act(undefined, async (ctx) => {
    if (!(await bureau.canSwitchTo(ctx, targetOrgId))) throw new BusinessError("You do not have access to that organization.");
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const target = await db.organization.findUniqueOrThrow({ where: { id: targetOrgId }, select: { name: true } });
    await createSession({ userId: user.id, orgId: targetOrgId, role: user.role, name: user.name, email: user.email, employeeId: user.employeeId });
    if (targetOrgId !== user.organizationId)
      await logAudit({ ...ctx, orgId: targetOrgId, homeOrgId: user.organizationId }, { action: "CLIENT_ORG_ENTER", entity: "Organization", entityId: targetOrgId });
    return { message: `Now working in ${target.name}.`, redirectTo: "/" };
  });
}

/** Form action for the banner: back to the bureau's own organization. */
export async function returnToBureauAction() {
  const { getSession } = await import("@/lib/auth/session");
  const { redirect } = await import("next/navigation");
  const ctx = await getSession();
  if (!ctx?.homeOrgId) return redirect("/");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  await createSession({ userId: user.id, orgId: user.organizationId, role: user.role, name: user.name, email: user.email, employeeId: user.employeeId });
  return redirect("/bureau");
}

export async function enableBureauAction() {
  return act(
    "bureau.manage",
    async (ctx) => {
      await bureau.enableBureau(ctx);
      return { message: "This organization is now a payroll bureau." };
    },
    PATHS,
  );
}

export async function onboardClientAction(v: V) {
  return act(
    "bureau.manage",
    async (ctx) => {
      const r = await bureau.onboardClient(ctx, v as never);
      return { message: `${r.client.name} onboarded.`, redirectTo: `/bureau/clients/${r.client.id}` };
    },
    PATHS,
  );
}

export async function updateEngagementAction(clientOrgId: string, v: V) {
  return act(
    "bureau.manage",
    async (ctx) => {
      await bureau.updateEngagement(ctx, clientOrgId, v as never);
      return { message: "Engagement updated." };
    },
    PATHS,
  );
}

export async function grantAccessAction(clientOrgId: string, v: V) {
  return act(
    "bureau.manage",
    async (ctx) => {
      await bureau.grantAccess(ctx, String(v.userId ?? ""), clientOrgId);
      return { message: "Access given." };
    },
    PATHS,
  );
}

export async function revokeAccessAction(clientOrgId: string, userId: string) {
  return act(
    "bureau.manage",
    async (ctx) => {
      await bureau.revokeAccess(ctx, userId, clientOrgId);
      return { message: "Access removed." };
    },
    PATHS,
  );
}

export async function bringForwardStaffTwoFactorAction(v: V) {
  return act(
    "bureau.manage",
    async (ctx) => {
      await bureau.bringForwardStaffTwoFactor(ctx, { from: String(v.from ?? "") });
      return { message: "The start day has been brought forward." };
    },
    PATHS,
  );
}
