import type { Ctx } from "@/lib/auth/context";
import { num } from "@/lib/money";
import { groupPayeByState, STATE_NOT_RECORDED } from "@/lib/nigeria-states";
import { payeDueInfo, type DueInfo, type PayeTiming } from "@/lib/paye-dates";
import { totalOf } from "@/lib/payroll/pay-inputs";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { EMPLOYER_COST_FIELDS, type EmployerCostField } from "./reports";

/** RemittanceType value for each employer add-on cost field. */
const EMPLOYER_COST_REMITTANCE_TYPE: Record<EmployerCostField, string> = {
  itf: "ITF",
  nsitf: "NSITF",
  nhfMedical: "NHF_MEDICAL",
  insurance: "INSURANCE",
  uniformKits: "UNIFORM_KITS",
  recruitmentTraining: "RECRUITMENT_TRAINING",
  leaveReliever: "LEAVE_RELIEVER",
  outsourcingLeaveAllowance: "OUTSOURCING_LEAVE_ALLOWANCE",
};

/** Creates one payment batch per bank from a LOCKED payroll run. */
export async function createPaymentBatches(ctx: Ctx, runId: string) {
  assertCan(ctx, "payment.manage");
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId } });
  if (!run) throw new BusinessError("Payroll run not found.");
  if (run.status !== "LOCKED")
    throw new BusinessError("Payments can only be generated from a locked payroll.");
  const existing = await db.paymentBatch.count({ where: { runId } });
  if (existing) throw new BusinessError("Payment batches already exist for this payroll run.");
  const records = await db.payrollRecord.findMany({ where: { runId, netPay: { gt: 0 } } });
  const byBank = new Map<string, typeof records>();
  for (const r of records)
    byBank.set(r.bankName ?? "UNKNOWN BANK", [...(byBank.get(r.bankName ?? "UNKNOWN BANK") ?? []), r]);
  return db.$transaction(async (tx) => {
    const batches = [];
    for (const [bank, list] of [...byBank.entries()].sort()) {
      const batchNumber = await nextNumber(tx, ctx.orgId, "PAYMENT_BATCH");
      const b = await tx.paymentBatch.create({
        data: {
          organizationId: ctx.orgId,
          runId,
          batchNumber,
          bankName: bank,
          totalAmount: totalOf(list.map((r) => num(r.netPay))),
          count: list.length,
          createdBy: ctx.name,
          transactions: {
            create: list.map((r) => ({
              organizationId: ctx.orgId,
              recordId: r.id,
              employeeId: r.employeeId,
              amount: r.netPay,
              bankName: r.bankName,
              accountNumber: r.accountNumber,
              accountName: r.accountName,
            })),
          },
        },
      });
      batches.push(b);
    }
    await logAudit(
      ctx,
      {
        action: "PAYMENT_BATCHES_CREATE",
        entity: "PayrollRun",
        entityId: runId,
        newValue: { batches: batches.length },
      },
      tx,
    );
    return batches;
  });
}

export async function markBatchPaid(ctx: Ctx, batchId: string) {
  assertCan(ctx, "payment.manage");
  const b = await db.paymentBatch.findFirst({
    where: { id: batchId, organizationId: ctx.orgId },
    include: { run: true },
  });
  if (!b) throw new BusinessError("Payment batch not found.");
  if (b.status === "PAID") throw new BusinessError("Batch is already paid.");
  await db.$transaction(async (tx) => {
    const txns = await tx.paymentTransaction.findMany({ where: { batchId } });
    for (const t of txns)
      await tx.paymentTransaction.update({
        where: { id: t.id },
        data: { status: "PAID", bankReference: `${b.batchNumber}-${t.id.slice(-6).toUpperCase()}` },
      });
    await tx.paymentBatch.update({ where: { id: batchId }, data: { status: "PAID" } });
    const unpaid = await tx.paymentBatch.count({ where: { runId: b.runId, status: { not: "PAID" } } });
    if (!unpaid) {
      await tx.payrollRun.update({ where: { id: b.runId }, data: { status: "PAID" } });
      if (b.run.type === "REGULAR")
        // A period Finance has already closed stays closed.
        await tx.payrollPeriod.updateMany({
          where: { id: b.run.periodId, status: { not: "CLOSED" } },
          data: { status: "PAID" },
        });
    }
    await logAudit(
      ctx,
      {
        action: "PAYMENT_BATCH_PAID",
        entity: "PaymentBatch",
        entityId: batchId,
        newValue: { amount: num(b.totalAmount) },
      },
      tx,
    );
  });
}

/** Bank statement CSV: account_number,amount[,reference] — matched on account + amount. */
export async function reconcileBatch(ctx: Ctx, batchId: string, csv: string) {
  assertCan(ctx, "payment.manage");
  const b = await db.paymentBatch.findFirst({
    where: { id: batchId, organizationId: ctx.orgId },
    include: { transactions: true },
  });
  if (!b) throw new BusinessError("Payment batch not found.");
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const header = lines[0].toLowerCase().split(",");
  const ai = header.indexOf("account_number");
  const mi = header.indexOf("amount");
  if (ai < 0 || mi < 0) throw new BusinessError("Statement needs account_number and amount columns.");
  const pending = [...b.transactions.filter((t) => !t.reconciled)];
  const unmatched: string[] = [];
  let matched = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const acct = cols[ai]?.trim();
    const amt = Number(cols[mi]);
    const idx = pending.findIndex((t) => t.accountNumber === acct && Math.abs(num(t.amount) - amt) < 0.01);
    if (idx >= 0) {
      await db.paymentTransaction.update({
        where: { id: pending[idx].id },
        data: { reconciled: true, reconciledAt: new Date() },
      });
      pending.splice(idx, 1);
      matched++;
    } else unmatched.push(line);
  }
  await logAudit(ctx, {
    action: "BANK_RECONCILIATION",
    entity: "PaymentBatch",
    entityId: batchId,
    newValue: { matched, unmatched: unmatched.length, outstanding: pending.length },
  });
  return { matched, unmatchedStatementLines: unmatched, outstandingTransactions: pending.length };
}

export async function listBatches(ctx: Ctx, runId?: string) {
  return db.paymentBatch.findMany({
    where: { organizationId: ctx.orgId, ...(runId ? { runId } : {}) },
    include: { run: { include: { period: true } }, _count: { select: { transactions: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listTransactions(ctx: Ctx, batchId?: string) {
  return db.paymentTransaction.findMany({
    where: { organizationId: ctx.orgId, ...(batchId ? { batchId } : {}) },
    include: { employee: true, batch: true },
    orderBy: [{ batch: { batchNumber: "desc" } }, { employee: { employeeNumber: "asc" } }],
    take: 1000,
  });
}

/** PAYE (one line per state of residence) and pension (per PFA, employee + employer) remittance schedules. */
export async function generateRemittances(ctx: Ctx, runId: string) {
  assertCan(ctx, "payment.manage");
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId } });
  if (!run) throw new BusinessError("Payroll run not found.");
  if (!["LOCKED", "PAID"].includes(run.status))
    throw new BusinessError("Remittances can only be generated from a locked payroll.");
  const existing = await db.statutoryRemittance.count({ where: { runId } });
  if (existing) throw new BusinessError("Remittances already generated for this run.");
  const records = await db.payrollRecord.findMany({ where: { runId } });
  const paye = totalOf(records.map((r) => num(r.paye)));
  const byPfa = new Map<string, { ee: number; er: number; n: number }>();
  for (const r of records) {
    if (!num(r.employeePension) && !num(r.employerPension)) continue;
    const k = r.pfa ?? "PFA NOT SPECIFIED";
    const cur = byPfa.get(k) ?? { ee: 0, er: 0, n: 0 };
    cur.ee = totalOf([cur.ee, num(r.employeePension)]);
    cur.er = totalOf([cur.er, num(r.employerPension)]);
    cur.n += 1;
    byPfa.set(k, cur);
  }
  const allocations = await db.payrollAllocation.findMany({ where: { runId } });
  const employerCosts = (Object.keys(EMPLOYER_COST_FIELDS) as EmployerCostField[])
    .map((field) => {
      const withAmt = allocations.filter((a) => num(a[field]) > 0);
      return {
        field,
        total: totalOf(withAmt.map((r) => num(r[field]))),
        headcount: new Set(withAmt.map((a) => a.employeeId)).size,
      };
    })
    .filter((c) => c.total > 0);
  // PAYE goes to the tax authority of each worker's state of residence: one line per state (anyone without a recognised state is on "State not recorded").
  const payeLines = groupPayeByState(records.map((r) => ({ payeState: r.payeState, paye: num(r.paye) })));
  await db.$transaction(async (tx) => {
    for (const line of payeLines)
      await tx.statutoryRemittance.create({
        data: {
          organizationId: ctx.orgId,
          runId,
          type: "PAYE",
          payee: line.state === STATE_NOT_RECORDED ? `${STATE_NOT_RECORDED} (PAYE)` : `${line.state} Internal Revenue Service (PAYE)`,
          employeeAmount: line.paye,
          employerAmount: 0,
          totalAmount: line.paye,
          headcount: line.headcount,
        },
      });
    for (const [pfa, v] of byPfa)
      await tx.statutoryRemittance.create({
        data: {
          organizationId: ctx.orgId,
          runId,
          type: "PENSION",
          payee: pfa,
          employeeAmount: v.ee,
          employerAmount: v.er,
          totalAmount: totalOf([v.ee, v.er]),
          headcount: v.n,
        },
      });
    for (const c of employerCosts)
      await tx.statutoryRemittance.create({
        data: {
          organizationId: ctx.orgId,
          runId,
          type: EMPLOYER_COST_REMITTANCE_TYPE[c.field] as never,
          payee: EMPLOYER_COST_FIELDS[c.field].payee,
          employeeAmount: 0,
          employerAmount: c.total,
          totalAmount: c.total,
          headcount: c.headcount,
        },
      });
    await logAudit(
      ctx,
      {
        action: "STATUTORY_REMITTANCE_GENERATE",
        entity: "PayrollRun",
        entityId: runId,
        newValue: { paye, payeStates: payeLines.length, pfas: byPfa.size, employerCostTypes: employerCosts.length },
      },
      tx,
    );
  });
}

export async function listRemittances(ctx: Ctx, opts: { runId?: string; type?: string } = {}) {
  return db.statutoryRemittance.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(opts.runId ? { runId: opts.runId } : {}),
      ...(opts.type ? { type: opts.type as never } : {}),
    },
    include: { run: { include: { period: true } } },
    orderBy: [{ createdAt: "desc" }, { type: "asc" }],
  });
}

/**
 * Due date, lateness and penalty of PAYE remittance lines, from the tax rule each payroll was calculated under (its filing dates are rule data).
 * A rule with no due day gives no date, and nothing is ever overdue. Other kinds of remittance get nothing.
 */
export async function remittanceTiming(
  ctx: Ctx,
  rows: ReadonlyArray<{ id: string; type: string; status: string; totalAmount: unknown; run: { taxRuleVersion: string | null; period: { year: number; month: number } } }>,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<Map<string, DueInfo>> {
  const out = new Map<string, DueInfo>();
  const paye = rows.filter((r) => r.type === "PAYE");
  if (!paye.length) return out;
  const wanted = [...new Set(paye.map((r) => r.run.taxRuleVersion).filter((v): v is string => !!v))].map((v) => {
    const at = v.lastIndexOf("@");
    return { code: v.slice(0, at), version: v.slice(at + 1), key: v };
  });
  const rules = wanted.length ? await db.taxRule.findMany({ where: { organizationId: ctx.orgId, OR: wanted.map((w) => ({ code: w.code, version: w.version })) } }) : [];
  const timingOf = new Map<string, PayeTiming>(
    rules.map((r) => [`${r.code}@${r.version}`, { dueDay: r.payeDueDay, annualReturnMonth: r.annualReturnMonth, annualReturnDay: r.annualReturnDay, latePenaltyPct: r.latePenaltyPct === null ? null : num(r.latePenaltyPct) }]),
  );
  for (const r of paye) out.set(r.id, payeDueInfo({ type: r.type, status: r.status, totalAmount: num(r.totalAmount as never), period: r.run.period }, (r.run.taxRuleVersion ? timingOf.get(r.run.taxRuleVersion) : undefined) ?? null, today));
  return out;
}

/** Every remittance type with a human label — for the per-type filter/portal on the remittance page. */
export const REMITTANCE_TYPE_LABELS: Record<string, string> = {
  PAYE: "PAYE",
  PENSION: "Pension",
  ITF: "ITF",
  NSITF: "NSITF-ECA",
  NHF_MEDICAL: "NHF / Medical",
  INSURANCE: "Insurance",
  UNIFORM_KITS: "Uniform & Kits",
  RECRUITMENT_TRAINING: "Recruitment, Training & Vetting",
  LEAVE_RELIEVER: "Annual Leave Reliever",
  OUTSOURCING_LEAVE_ALLOWANCE: "Outsourcing Leave Allowance",
};

export async function markRemitted(ctx: Ctx, id: string, reference: string) {
  assertCan(ctx, "payment.manage");
  const r = await db.statutoryRemittance.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Remittance not found.");
  await db.statutoryRemittance.update({ where: { id }, data: { status: "PAID", reference } });
  await logAudit(ctx, {
    action: "STATUTORY_REMITTANCE_PAID",
    entity: "StatutoryRemittance",
    entityId: id,
    newValue: { reference },
  });
}
