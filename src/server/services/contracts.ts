/**
 * Employment contracts — the employee's own terms (not the client service `Contract`). Tracks type,
 * probation, notice period and renewals; raises alerts for contracts nearing expiry and probation
 * reviews coming due. One contract per employee is ACTIVE at a time; a renewal or a probation
 * confirmation supersedes the old one and links back to it, so the full history stays intact.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d, iso } from "@/lib/dates";
import { addMonths } from "@/lib/leave";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { assertProbationAppraisalAllows } from "./appraisals";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { nextNumber } from "./numbering";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const EMPLOYMENT_TYPES = ["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"] as const;
type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
const NEEDS_END_DATE: EmploymentType[] = ["FIXED_TERM", "CASUAL", "CONSULTANT", "INTERNSHIP"];
const NO_PROBATION: EmploymentType[] = ["CASUAL", "CONSULTANT", "INTERNSHIP"];
const GONE = ["EXITED", "TERMINATED", "RESIGNED"];

export const contractSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(EMPLOYMENT_TYPES),
  jobTitle: z.string().trim().min(2, "A job title is required"),
  startDate: z.string().min(10, "Start date is required"),
  endDate: opt,
  probationMonths: z.coerce.number().int().min(0).max(24).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  signedDate: opt,
  documentReference: opt,
  notes: opt,
});
export type ContractInput = z.input<typeof contractSchema>;

type Resolved = {
  type: EmploymentType;
  startDate: Date;
  endDate: Date | null;
  probationMonths: number;
  probationEndDate: Date | null;
  noticePeriodDays: number;
};

/** Applies the type rules (end date, probation) and fills policy defaults. */
async function resolveTerms(orgId: string, v: z.output<typeof contractSchema>): Promise<Resolved> {
  const policy = await getHrPolicy(orgId);
  const startDate = d(v.startDate);
  const endDate = v.endDate ? d(v.endDate) : null;
  if (NEEDS_END_DATE.includes(v.type) && !endDate)
    throw new BusinessError(`A ${v.type.replace(/_/g, " ").toLowerCase()} contract needs an end date.`);
  if ((v.type === "PERMANENT" || v.type === "PROBATION") && endDate)
    throw new BusinessError("A permanent or probationary contract has no end date — it runs until it's renewed or ends.");
  if (endDate && endDate <= startDate) throw new BusinessError("The end date must be after the start date.");
  let probationMonths = v.probationMonths ?? (v.type === "PROBATION" ? policy.defaultProbationMonths : 0);
  if (NO_PROBATION.includes(v.type)) probationMonths = 0;
  if (v.type === "PROBATION" && probationMonths < 1)
    throw new BusinessError("A probationary contract needs a probation period of at least 1 month.");
  if (probationMonths > policy.maxProbationMonths)
    throw new BusinessError(`Probation can't be longer than ${policy.maxProbationMonths} month(s) under the HR policy.`);
  return {
    type: v.type,
    startDate,
    endDate,
    probationMonths,
    probationEndDate: probationMonths ? addDays(addMonths(startDate, probationMonths), -1) : null,
    noticePeriodDays: v.noticePeriodDays ?? policy.defaultNoticeDays,
  };
}

export async function createContractInTx(ctx: Ctx, tx: Tx, v: z.output<typeof contractSchema>, previousContractId?: string) {
  const emp = await tx.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (GONE.includes(emp.status)) throw new BusinessError(`${emp.employeeNumber} has already exited.`);
  const terms = await resolveTerms(ctx.orgId, v);
  const contractNumber = await nextNumber(tx, ctx.orgId, "EMPLOYMENT_CONTRACT");
  const contract = await tx.employmentContract.create({
    data: {
      organizationId: ctx.orgId,
      contractNumber,
      employeeId: v.employeeId,
      type: terms.type,
      jobTitle: v.jobTitle,
      startDate: terms.startDate,
      endDate: terms.endDate,
      probationMonths: terms.probationMonths,
      probationEndDate: terms.probationEndDate,
      probationOutcome: terms.probationMonths ? "PENDING" : null,
      noticePeriodDays: terms.noticePeriodDays,
      signedDate: v.signedDate ? d(v.signedDate) : null,
      documentReference: v.documentReference ?? null,
      previousContractId: previousContractId ?? null,
      notes: v.notes ?? null,
      createdBy: ctx.name,
    },
  });
  await logAudit(
    ctx,
    { action: "EMPLOYMENT_CONTRACT_CREATE", entity: "Employee", entityId: v.employeeId, newValue: contract },
    tx,
  );
  return contract;
}

/** Records a new contract for an employee who has none in force (use renew for an existing one). */
export async function createContract(ctx: Ctx, raw: ContractInput) {
  assertCan(ctx, "hr.manage");
  const v = contractSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const active = await tx.employmentContract.findFirst({
      where: { organizationId: ctx.orgId, employeeId: v.employeeId, status: "ACTIVE" },
    });
    if (active)
      throw new BusinessError(`This employee already has an active contract (${active.contractNumber}) — renew it instead.`);
    return createContractInTx(ctx, tx, v);
  });
}

export const renewSchema = z.object({
  type: z.enum(EMPLOYMENT_TYPES).optional(),
  jobTitle: opt,
  startDate: opt,
  endDate: opt,
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  signedDate: opt,
  documentReference: opt,
  notes: opt,
});

/** Supersedes the active contract with a new one (extension, new terms, or conversion to permanent). */
export async function renewContract(ctx: Ctx, id: string, raw: z.input<typeof renewSchema>) {
  assertCan(ctx, "hr.manage");
  const r = renewSchema.parse(raw);
  const old = await db.employmentContract.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Contract not found.");
  if (old.status !== "ACTIVE") throw new BusinessError("Only the active contract can be renewed.");
  const startStr = r.startDate ?? (old.endDate ? iso(addDays(old.endDate, 1)) : undefined);
  if (!startStr) throw new BusinessError("Give the start date of the renewed contract.");
  const startDate = d(startStr);
  if (startDate <= old.startDate) throw new BusinessError("The renewal must start after the current contract started.");
  const type = r.type ?? (old.type === "PROBATION" ? "PERMANENT" : old.type);
  return db.$transaction(async (tx) => {
    await tx.employmentContract.update({
      where: { id },
      data: {
        status: "SUPERSEDED",
        ...(!old.endDate || old.endDate >= startDate ? { endDate: addDays(startDate, -1) } : {}),
      },
    });
    const next = await createContractInTx(
      ctx,
      tx,
      {
        employeeId: old.employeeId,
        type,
        jobTitle: r.jobTitle ?? old.jobTitle,
        startDate: startStr,
        endDate: r.endDate,
        probationMonths: 0,
        noticePeriodDays: r.noticePeriodDays ?? old.noticePeriodDays,
        signedDate: r.signedDate,
        documentReference: r.documentReference,
        notes: r.notes,
      },
      old.id,
    );
    await logAudit(
      ctx,
      { action: "EMPLOYMENT_CONTRACT_RENEW", entity: "Employee", entityId: old.employeeId, oldValue: old, newValue: next },
      tx,
    );
    return next;
  });
}

export const probationDecisionSchema = z.object({
  decision: z.enum(["CONFIRMED", "FAILED", "EXTENDED"]),
  note: opt,
  extensionMonths: z.coerce.number().int().min(1).max(12).optional(),
  effectiveDate: opt,
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
});

/** HR's probation review: confirm (converting a probationary contract to permanent), extend, or fail. */
export async function decideProbation(ctx: Ctx, id: string, raw: z.input<typeof probationDecisionSchema>) {
  assertCan(ctx, "hr.approve");
  const v = probationDecisionSchema.parse(raw);
  const c = await db.employmentContract.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new BusinessError("Contract not found.");
  if (c.status !== "ACTIVE") throw new BusinessError("Only an active contract has a probation to review.");
  if (c.probationOutcome !== "PENDING" && c.probationOutcome !== "EXTENDED")
    throw new BusinessError(c.probationOutcome ? `Probation was already ${c.probationOutcome.toLowerCase()}.` : "This contract has no probation.");
  if (v.decision !== "CONFIRMED" && (!v.note || v.note.length < 5))
    throw new BusinessError("Record the reason for this probation decision.");

  if (v.decision === "EXTENDED") {
    const policy = await getHrPolicy(ctx.orgId);
    if (!v.extensionMonths) throw new BusinessError("Say how many months to extend probation by.");
    const total = c.probationMonths + v.extensionMonths;
    if (total > policy.maxProbationMonths)
      throw new BusinessError(`Probation would reach ${total} month(s); the HR policy allows at most ${policy.maxProbationMonths}.`);
    const updated = await db.employmentContract.update({
      where: { id },
      data: {
        probationMonths: total,
        probationEndDate: addDays(addMonths(addDays(c.probationEndDate!, 1), v.extensionMonths), -1),
        probationOutcome: "EXTENDED",
        probationExtensions: { increment: 1 },
        notes: [c.notes, `Probation extended ${v.extensionMonths}m: ${v.note}`].filter(Boolean).join("\n"),
      },
    });
    await logAudit(ctx, { action: "PROBATION_EXTEND", entity: "Employee", entityId: c.employeeId, oldValue: c, newValue: updated, reason: v.note });
    return { contract: updated, next: null };
  }

  if (v.decision === "FAILED") {
    const updated = await db.employmentContract.update({
      where: { id },
      data: { probationOutcome: "FAILED", notes: [c.notes, `Probation failed: ${v.note}`].filter(Boolean).join("\n") },
    });
    await logAudit(ctx, { action: "PROBATION_FAIL", entity: "Employee", entityId: c.employeeId, oldValue: c, newValue: updated, reason: v.note });
    return { contract: updated, next: null };
  }

  // CONFIRMED
  await assertProbationAppraisalAllows(ctx.orgId, c);
  return db.$transaction(async (tx) => {
    const confirmed = await tx.employmentContract.update({ where: { id }, data: { probationOutcome: "CONFIRMED" } });
    let next = null;
    if (c.type === "PROBATION") {
      const startStr = v.effectiveDate ?? iso(addDays(c.probationEndDate ?? todayUtc(), 1));
      if (d(startStr) <= c.startDate) throw new BusinessError("The confirmation date must be after the contract started.");
      await tx.employmentContract.update({
        where: { id },
        data: { status: "SUPERSEDED", endDate: addDays(d(startStr), -1) },
      });
      next = await createContractInTx(
        ctx,
        tx,
        {
          employeeId: c.employeeId,
          type: "PERMANENT",
          jobTitle: c.jobTitle,
          startDate: startStr,
          probationMonths: 0,
          noticePeriodDays: v.noticePeriodDays ?? c.noticePeriodDays,
          notes: v.note ? `Confirmed after probation: ${v.note}` : "Confirmed after probation",
        },
        c.id,
      );
    }
    await logAudit(ctx, { action: "PROBATION_CONFIRM", entity: "Employee", entityId: c.employeeId, oldValue: c, newValue: next ?? confirmed, reason: v.note }, tx);
    return { contract: confirmed, next };
  });
}

/** Called when an exit is approved: the active contract ends on the last working date. */
export async function endActiveContract(tx: Tx, orgId: string, employeeId: string, date: Date, reason: string) {
  await tx.employmentContract.updateMany({
    where: { organizationId: orgId, employeeId, status: "ACTIVE" },
    data: { status: "TERMINATED", terminatedAt: date, terminationReason: reason },
  });
}

/** Flags every ACTIVE contract whose end date has passed as EXPIRED. */
export async function processExpiredContracts(ctx: Ctx) {
  assertCan(ctx, "hr.manage");
  const res = await db.employmentContract.updateMany({
    where: { organizationId: ctx.orgId, status: "ACTIVE", endDate: { lt: todayUtc() } },
    data: { status: "EXPIRED" },
  });
  if (res.count)
    await logAudit(ctx, { action: "EMPLOYMENT_CONTRACT_EXPIRE_SWEEP", entity: "EmploymentContract", newValue: { count: res.count } });
  return res.count;
}

export async function listContracts(
  ctx: Ctx,
  f: { status?: string; type?: string; q?: string; take?: number } = {},
) {
  assertCan(ctx, "hr.view");
  return db.employmentContract.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.type ? { type: f.type as never } : {}),
      ...(f.q
        ? {
            OR: [
              { contractNumber: { contains: f.q, mode: "insensitive" } },
              { jobTitle: { contains: f.q, mode: "insensitive" } },
              { employee: { firstName: { contains: f.q, mode: "insensitive" } } },
              { employee: { lastName: { contains: f.q, mode: "insensitive" } } },
              { employee: { employeeNumber: { contains: f.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { employee: true },
    orderBy: [{ status: "asc" }, { endDate: "asc" }, { startDate: "desc" }],
    take: f.take ?? 300,
  });
}

export async function getContract(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  return db.employmentContract.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { employee: true, previousContract: true, renewals: true },
  });
}

/** Contracts ending soon / already past their end date, probation reviews due, and staff with no contract on file. */
export async function contractAlerts(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const policy = await getHrPolicy(ctx.orgId);
  const today = todayUtc();
  const contractHorizon = addDays(today, policy.contractAlertDays);
  const probationHorizon = addDays(today, policy.probationAlertDays);
  const [ending, probation, noContract] = await Promise.all([
    db.employmentContract.findMany({
      where: { organizationId: ctx.orgId, status: "ACTIVE", endDate: { not: null, lte: contractHorizon } },
      include: { employee: true },
      orderBy: { endDate: "asc" },
    }),
    db.employmentContract.findMany({
      where: {
        organizationId: ctx.orgId,
        status: "ACTIVE",
        probationOutcome: { in: ["PENDING", "EXTENDED"] },
        probationEndDate: { not: null, lte: probationHorizon },
      },
      include: { employee: true },
      orderBy: { probationEndDate: "asc" },
    }),
    db.employee.findMany({
      where: {
        organizationId: ctx.orgId,
        status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] },
        employmentContracts: { none: { status: "ACTIVE" } },
      },
      orderBy: { employeeNumber: "asc" },
      take: 500,
    }),
  ]);
  return {
    today,
    contractAlertDays: policy.contractAlertDays,
    probationAlertDays: policy.probationAlertDays,
    ending: ending.map((c) => ({ ...c, overdue: c.endDate! < today })),
    probation: probation.map((c) => ({ ...c, overdue: c.probationEndDate! < today })),
    noContract,
  };
}
