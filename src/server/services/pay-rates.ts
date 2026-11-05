import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { BusinessError, type Tx } from "./_base";
import { logAudit } from "./audit";

/**
 * Makes the pay rate: closes the previous open one the day before, writes the new one and audits it. Used by createPayRate and when a proposed gross is approved
 * (src/server/services/pay-rate-proposals.ts), which passes the approver's own name as `approvedBy`. The caller has already checked who may do this.
 */
export async function applyPayRate(ctx: Ctx, tx: Tx, v: { employeeId: string; monthlyGross: number | string; structureCode?: string | null; reason: string; approvedBy: string; effectiveFrom: string }) {
  const from = d(v.effectiveFrom);
  const open = await tx.employeePayRate.findMany({
    where: { employeeId: v.employeeId, organizationId: ctx.orgId, effectiveTo: null },
  });
  for (const r of open) {
    if (r.effectiveFrom >= from)
      throw new BusinessError("A pay rate already starts on or after this date.");
    await tx.employeePayRate.update({
      where: { id: r.id },
      data: { effectiveTo: new Date(from.getTime() - 86400000) },
    });
  }
  const rate = await tx.employeePayRate.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      monthlyGross: v.monthlyGross,
      structureCode: v.structureCode || null,
      reason: v.reason,
      approvedBy: v.approvedBy,
      effectiveFrom: from,
    },
  });
  await logAudit(
    ctx,
    {
      action: "EMPLOYEE_PAY_RATE_CHANGE",
      entity: "Employee",
      entityId: v.employeeId,
      newValue: rate,
      reason: v.reason,
    },
    tx,
  );
  return rate;
}
