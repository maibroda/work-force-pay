import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { isIsoDate } from "@/lib/pay-rate";
import type { BasisRow } from "@/lib/paid-days";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

/**
 * The paid-days basis agreed with each client, set on the contract (the founder, 2026-11-05; docs/plans/paid-days-basis.md). It is PROPOSED by someone who manages clients and APPROVED by a second
 * person, the payroll manager (the same maker and checker rule as personal pay rates), before it counts: a pending or rejected proposal never changes pay. It takes effect from the FIRST DAY of a
 * pay month (the basis in force at the start of the month applies to the whole month), is effective-dated, and its history is never overwritten. A contract with no approved row keeps the company's
 * payroll rule. Everything is for the caller's company only; another company's contract or proposal is "not found". Audit entries carry ids and field names.
 */
const BASES = ["CALENDAR_DAYS", "WORKING_DAYS"] as const;

export interface BasisInput {
  contractId: string;
  basis: string;
  excludePublicHolidays?: boolean;
  workingDaysPerWeek?: number | null;
  effectiveFrom: string;
  reason: string;
}

export async function proposeBasis(ctx: Ctx, raw: BasisInput) {
  assertCan(ctx, "client.manage");
  if (!(BASES as readonly string[]).includes(raw.basis)) throw new BusinessError("The basis must be calendar days or working days.");
  const basis = raw.basis as (typeof BASES)[number];
  const perWeek = raw.workingDaysPerWeek ?? null;
  const exclude = Boolean(raw.excludePublicHolidays);
  if (perWeek !== null && ![5, 6, 7].includes(perWeek)) throw new BusinessError("The working week must be 5 (Monday to Friday), 6 (Monday to Saturday) or 7 days.");
  if (basis === "CALENDAR_DAYS" && (perWeek !== null || exclude)) throw new BusinessError("A working week and public holidays apply only to the working-days basis.");
  const reason = (raw.reason ?? "").trim();
  if (reason.length < 3) throw new BusinessError("Give a reason (at least a few words), for example “Agreed with the client”.");
  if (!isIsoDate(raw.effectiveFrom)) throw new BusinessError("Effective from must be a valid date (YYYY-MM-DD).");
  if (raw.effectiveFrom.slice(8, 10) !== "01") throw new BusinessError("A basis takes effect from the first day of a month, because the basis in force at the start of a pay month applies to the whole month.");
  return db.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({ where: { id: raw.contractId, organizationId: ctx.orgId }, select: { id: true } });
    if (!contract) throw new BusinessError("Contract not found.");
    if (await tx.contractPayBasis.findFirst({ where: { organizationId: ctx.orgId, contractId: contract.id, status: "PENDING" }, select: { id: true } }))
      throw new BusinessError("There is already a pending paid-days proposal for this contract: decide it or withdraw it first.");
    const row = await tx.contractPayBasis.create({
      data: { organizationId: ctx.orgId, contractId: contract.id, basis, excludePublicHolidays: exclude, workingDaysPerWeek: perWeek, effectiveFrom: d(raw.effectiveFrom), reason, proposedBy: ctx.name, proposedByUserId: ctx.userId },
    });
    await logAudit(ctx, { action: "PAY_BASIS_PROPOSED", entity: "ContractPayBasis", entityId: row.id, newValue: { contractId: contract.id, fields: ["basis", "excludePublicHolidays", "workingDaysPerWeek", "effectiveFrom", "reason"] } }, tx);
    return row;
  });
}

async function loadOwn(ctx: Ctx, id: string, tx: Tx) {
  const row = await tx.contractPayBasis.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!row) throw new BusinessError("Paid-days proposal not found.");
  return row;
}
const assertPending = (status: string) => {
  if (status !== "PENDING") throw new BusinessError(`This proposal is already ${status.toLowerCase()}.`);
};

/** Approval makes the setting count: it closes the contract's previous open setting the day before, and fails (changing nothing) if a setting already starts on or after this date. */
export async function approveBasis(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "payrate.approve");
  return db.$transaction(async (tx) => {
    const p = await loadOwn(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId === ctx.userId) throw new BusinessError("You made this proposal: someone else has to approve it.");
    const open = await tx.contractPayBasis.findMany({ where: { organizationId: ctx.orgId, contractId: p.contractId, status: "APPROVED", effectiveTo: null } });
    for (const r of open) {
      if (r.effectiveFrom >= p.effectiveFrom) throw new BusinessError("A paid-days basis already starts on or after this date.");
      await tx.contractPayBasis.update({ where: { id: r.id }, data: { effectiveTo: new Date(p.effectiveFrom.getTime() - 86400000) } });
    }
    const done = await tx.contractPayBasis.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "PAY_BASIS_APPROVED", entity: "ContractPayBasis", entityId: id, newValue: { contractId: p.contractId, effectiveFrom: iso(p.effectiveFrom) } }, tx);
    return done;
  });
}

export async function rejectBasis(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "payrate.approve");
  if ((note ?? "").trim().length < 3) throw new BusinessError("Give a reason for rejecting it.");
  return db.$transaction(async (tx) => {
    const p = await loadOwn(ctx, id, tx);
    assertPending(p.status);
    const done = await tx.contractPayBasis.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
    await logAudit(ctx, { action: "PAY_BASIS_REJECTED", entity: "ContractPayBasis", entityId: id, newValue: { contractId: p.contractId } }, tx);
    return done;
  });
}

/** The person who made a proposal may withdraw it while it is pending. */
export async function cancelBasis(ctx: Ctx, id: string) {
  assertCan(ctx, "client.manage");
  return db.$transaction(async (tx) => {
    const p = await loadOwn(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId !== ctx.userId) throw new BusinessError("You can withdraw only your own proposals.");
    const done = await tx.contractPayBasis.update({ where: { id }, data: { status: "CANCELLED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date() } });
    await logAudit(ctx, { action: "PAY_BASIS_WITHDRAWN", entity: "ContractPayBasis", entityId: id, newValue: { contractId: p.contractId } }, tx);
    return done;
  });
}

/** A contract's proposals and settings, newest first (empty for another company's contract). */
export async function listBases(ctx: Ctx, contractId: string) {
  assertCan(ctx, "client.view");
  return db.contractPayBasis.findMany({ where: { organizationId: ctx.orgId, contractId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
}

/** Every proposal waiting for a decision, for the approval queue. */
export async function listPendingBases(ctx: Ctx) {
  assertCan(ctx, "client.view");
  return db.contractPayBasis.findMany({ where: { organizationId: ctx.orgId, status: "PENDING" }, include: { contract: { select: { id: true, contractNumber: true, name: true, client: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } });
}

/** What the pay run needs: the approved settings that overlap the period, as the pure rules read them. */
export async function loadApprovedBases(tx: Tx, orgId: string, from: Date, to: Date): Promise<BasisRow[]> {
  const rows = await tx.contractPayBasis.findMany({ where: { organizationId: orgId, status: "APPROVED", effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } });
  return rows.map((r) => ({
    contractId: r.contractId,
    status: r.status,
    setting: { basis: r.basis, excludePublicHolidays: r.excludePublicHolidays, workingDaysPerWeek: r.workingDaysPerWeek },
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));
}

/** Every proposal and setting, newest first, with the contract and client names, for the Paid days page. */
export async function listAllBases(ctx: Ctx) {
  assertCan(ctx, "client.view");
  return db.contractPayBasis.findMany({
    where: { organizationId: ctx.orgId },
    include: { contract: { select: { id: true, contractNumber: true, name: true, client: { select: { name: true } } } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
}
