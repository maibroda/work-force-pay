"use server";
import { act } from "./_run";
import * as portal from "@/server/services/portal";

type V = Record<string, unknown>;
const PATHS = ["/portal", "/settings/client-portal", "/payroll/runs"];

export async function inviteClientUserAction(v: V) {
  return act(
    "users.manage",
    async (ctx) => {
      const u = await portal.inviteClientUser(ctx, v as never);
      return { message: `Invitation sent to ${u.email}. They choose their own password and set up two-factor sign-in.` };
    },
    PATHS,
  );
}

export async function setClientApprovalRequiredAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      const on = v.required === true;
      await portal.setClientApprovalRequired(ctx, on);
      return { message: on ? "Payrolls now need the client's approval before they can be locked." : "Payrolls no longer need the client's approval." };
    },
    PATHS,
  );
}

export async function clientApproveAction(runId: string, comment?: string) {
  return act(
    "portal.approve",
    async (ctx) => {
      await portal.clientApproveRun(ctx, runId, comment);
      return { message: "Thank you. Your approval is recorded and the bureau has been notified on its payroll page." };
    },
    PATHS,
  );
}

export async function clientRejectAction(runId: string, comment?: string) {
  return act(
    "portal.approve",
    async (ctx) => {
      await portal.clientRejectRun(ctx, runId, comment ?? "");
      return { message: "Sent back to the bureau with your comment.", redirectTo: "/portal" };
    },
    PATHS,
  );
}
