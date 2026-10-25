"use server";
import { act } from "./_run";
import * as ps from "@/server/services/payslips";

const PATHS = ["/payroll/runs"];

export async function setPayslipEmailAction(v: Record<string, unknown>) {
  return act(
    "settings.manage",
    async (ctx) => {
      const on = v.emailEnabled === true;
      await ps.setPayslipEmail(ctx, on);
      return { message: on ? "Emailing payslips is on." : "Emailing payslips is off." };
    },
    PATHS,
  );
}

function summary(out: Awaited<ReturnType<typeof ps.emailPayslips>>) {
  const n = (s: string) => out.filter((o) => o.status === s).length;
  const parts = [`${n("SENT")} sent`];
  if (n("ALREADY_SENT")) parts.push(`${n("ALREADY_SENT")} already had theirs`);
  if (n("NO_EMAIL")) parts.push(`${n("NO_EMAIL")} have no email address`);
  if (n("FAILED")) parts.push(`${n("FAILED")} failed (try again)`);
  return parts.join(", ") + ".";
}

export async function emailPayslipsAction(runId: string) {
  return act(
    "payslip.distribute",
    async (ctx) => ({ message: summary(await ps.emailPayslips(ctx, runId)) }),
    PATHS,
  );
}

export async function resendPayslipAction(runId: string, recordId: string) {
  return act(
    "payslip.distribute",
    async (ctx) => ({ message: summary(await ps.emailPayslips(ctx, runId, { recordIds: [recordId], resend: true })) }),
    PATHS,
  );
}
