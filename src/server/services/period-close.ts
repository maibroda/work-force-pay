/**
 * Closing a period: the checks, the close checklist, and the snapshot that becomes the official record of the books.
 *
 *  • Before CLOSE the books are checked as at the last day of the period (see lib/period-close). Hard checks (trial balance,
 *    receivables, payables and client advances against the ledger) cannot be got round; pending work dated in the period can be
 *    closed over by an approver with a written reason, which is kept for good.
 *  • When the period closes, a snapshot of the books as they stood is written in the same transaction: trial balance,
 *    receivables by client and invoice with ageing, payables by vendor, cash and tax balances. It never changes (the database
 *    refuses), so the September report is the September report in November. Reopening and closing again writes a new version
 *    and keeps the old one, marked superseded.
 *  • The report can always be compared with a fresh calculation as at the same date, to show whether anything has moved since.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { canonicalJson, closeBlockers, reconciliationLine, STANDARD_SIGNOFFS, type CloseCheck, type ReconciliationLine } from "@/lib/period-close";
import { AGE_BUCKETS } from "@/lib/statements";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { checkLedgerIntegrity } from "./ledger-integrity";
import { clientStatement } from "./receipts";

type PeriodFacts = { id: string; name: string; startDate: Date; endDate: Date };

// ───────────────────────────── The books as at a date ─────────────────────────────

/** An account's balance (debits less credits) as at a date, from the ledger. */
async function ledgerBalance(orgId: string, code: string, asAt: Date) {
  const a = await db.journalLine.aggregate({ where: { journal: { organizationId: orgId, postingDate: { lte: asAt } }, account: { organizationId: orgId, code } }, _sum: { debit: true, credit: true } });
  return round2(num(a._sum.debit) - num(a._sum.credit));
}

export async function trialBalanceAsAt(orgId: string, asAt: Date) {
  const grouped = await db.journalLine.groupBy({ by: ["accountId"], where: { journal: { organizationId: orgId, postingDate: { lte: asAt } } }, _sum: { debit: true, credit: true } });
  const accounts = await db.glAccount.findMany({ where: { organizationId: orgId, id: { in: grouped.map((g) => g.accountId) } }, select: { id: true, code: true, name: true, type: true } });
  const by = new Map(accounts.map((a) => [a.id, a]));
  return grouped
    .map((g) => {
      const net = round2(num(g._sum.debit) - num(g._sum.credit));
      const a = by.get(g.accountId)!;
      return { code: a.code, name: a.name, type: a.type as string, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** What every client owes (and holds in advances) as at a date, by client and by invoice, from the receivables subledger. */
export async function receivablesAsAt(ctx: Ctx, asAt: Date) {
  assertCan(ctx, "gl.view");
  const clients = await db.client.findMany({ where: { organizationId: ctx.orgId, OR: [{ invoices: { some: {} } }, { receipts: { some: {} } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const out = { total: 0, advances: 0, clients: [] as Array<{ clientId: string; name: string; owed: number; advances: number; ledger: number; ageing: Record<string, number> }>, invoices: [] as Array<{ invoiceId: string; number: string; clientId: string; client: string; dueDate: string; balance: number; daysPastDue: number; bucket: string }> };
  for (const c of clients) {
    const s = await clientStatement(ctx, c.id, iso(asAt));
    if (s.closing === 0 && s.advances === 0) continue;
    out.total = round2(out.total + s.closing);
    out.advances = round2(out.advances + s.advances);
    out.clients.push({ clientId: c.id, name: c.name, owed: s.closing, advances: s.advances, ledger: s.ledger, ageing: Object.fromEntries(AGE_BUCKETS.map((b) => [b, s.ageing[b]])) });
    for (const o of s.outstanding) out.invoices.push({ invoiceId: o.invoiceId, number: o.invoiceNumber, clientId: c.id, client: c.name, dueDate: iso(o.dueDate), balance: o.balance, daysPastDue: o.daysPastDue, bucket: o.bucket });
  }
  return out;
}

/** What is owed to each vendor as at a date. A bill cancelled after the date was still owed on it. */
export async function payablesAsAt(orgId: string, asAt: Date) {
  const [bills, payments, deductions] = await Promise.all([
    db.purchaseInvoice.findMany({ where: { organizationId: orgId, invoiceDate: { lte: asAt } }, select: { id: true, vendorId: true, totalAmount: true, status: true } }),
    db.vendorPayment.findMany({ where: { organizationId: orgId, paidDate: { lte: asAt } }, select: { vendorId: true, amount: true } }),
    db.purchaseInvoiceDeduction.findMany({ where: { organizationId: orgId }, select: { vendorId: true, amount: true, createdAt: true } }),
  ]);
  const cancelled = bills.filter((b) => b.status === "CANCELLED");
  const cancelDates = new Map(
    cancelled.length ? (await db.journalEntry.findMany({ where: { organizationId: orgId, source: "AP_INVOICE_CANCEL", sourceType: "PURCHASE_INVOICE", sourceId: { in: cancelled.map((b) => b.id) } }, select: { sourceId: true, postingDate: true } })).map((j) => [j.sourceId, j.postingDate] as const) : [],
  );
  const owed = new Map<string, number>();
  const bump = (vendorId: string, n: number) => owed.set(vendorId, round2((owed.get(vendorId) ?? 0) + n));
  for (const b of bills) if (b.status !== "CANCELLED" || (cancelDates.get(b.id)?.getTime() ?? 0) > asAt.getTime()) bump(b.vendorId, num(b.totalAmount));
  for (const p of payments) bump(p.vendorId, -num(p.amount));
  for (const x of deductions) if (d(iso(x.createdAt)) <= asAt) bump(x.vendorId, -num(x.amount));
  const vendors = await db.vendor.findMany({ where: { organizationId: orgId, id: { in: [...owed.keys()] } }, select: { id: true, name: true } });
  const name = new Map(vendors.map((v) => [v.id, v.name]));
  const rows = [...owed.entries()].filter(([, v]) => v !== 0).map(([vendorId, v]) => ({ vendorId, name: name.get(vendorId) ?? "—", owed: v })).sort((a, b) => a.name.localeCompare(b.name));
  return { total: round2(rows.reduce((s, r) => s + r.owed, 0)), vendors: rows };
}

/** Each subledger against its control account as at a date, and whether the trial balance balances. */
export async function reconciliationsAsAt(ctx: Ctx, asAt: Date) {
  assertCan(ctx, "gl.view");
  const [ar, ap, tb, arGl, apGl, advGl] = await Promise.all([receivablesAsAt(ctx, asAt), payablesAsAt(ctx.orgId, asAt), trialBalanceAsAt(ctx.orgId, asAt), ledgerBalance(ctx.orgId, "1200", asAt), ledgerBalance(ctx.orgId, "2180", asAt), ledgerBalance(ctx.orgId, "2192", asAt)]);
  const debit = round2(tb.reduce((s, r) => s + r.debit, 0));
  const credit = round2(tb.reduce((s, r) => s + r.credit, 0));
  const lines: ReconciliationLine[] = [
    reconciliationLine("TRIAL_BALANCE", "Trial balance: total debits against total credits", debit, credit),
    reconciliationLine("AR_GL", "Receivables: clients' invoices less what settled them, against the receivables account (1200)", ar.total, arGl),
    reconciliationLine("AP_GL", "Payables: suppliers' bills less what settled them, against the payables account (2180)", ap.total, round2(-apGl)),
    reconciliationLine("ADVANCES_GL", "Client advances held, against the client advances account (2192)", ar.advances, round2(-advGl)),
  ];
  return { lines, ar, ap, trial: { rows: tb, debit, credit } };
}

// ───────────────────────────── The close checks ─────────────────────────────

async function waivedCodes(periodId: string) {
  return new Set((await db.closeWaiver.findMany({ where: { periodId }, select: { checkCode: true } })).map((w) => w.checkCode));
}

/** Everything checked before a period closes. */
export async function evaluateClose(ctx: Ctx, period: PeriodFacts): Promise<{ checks: CloseCheck[]; reconciliations: ReconciliationLine[] }> {
  assertCan(ctx, "gl.view");
  const range = { gte: period.startDate, lte: period.endDate };
  const org = ctx.orgId;
  const [rec, waived, drafts, journals, reversals, notes, refunds, recurring, draftJournals, runs, orgRow, items] = await Promise.all([
    reconciliationsAsAt(ctx, period.endDate),
    waivedCodes(period.id),
    db.clientInvoice.count({ where: { organizationId: org, status: { in: ["DRAFT", "SUBMITTED"] }, invoiceDate: range } }),
    db.journalDocument.count({ where: { organizationId: org, status: { in: ["SUBMITTED", "APPROVED"] }, postingDate: range } }),
    db.journalReversal.count({ where: { organizationId: org, status: "PENDING", reverseDate: range } }),
    db.clientNote.count({ where: { organizationId: org, status: "PENDING", noteDate: range } }),
    db.clientRefund.count({ where: { organizationId: org, status: "PENDING", refundDate: range } }),
    db.recurringJournal.count({ where: { organizationId: org, active: true, nextRunDate: { lte: period.endDate } } }),
    db.journalDocument.count({ where: { organizationId: org, status: { in: ["DRAFT", "REJECTED"] }, postingDate: range } }),
    db.payrollRun.findMany({ where: { organizationId: org, status: { in: ["LOCKED", "PAID"] }, period: { endDate: range } }, select: { id: true } }),
    db.organization.findUniqueOrThrow({ where: { id: org }, select: { closeChecklistRequired: true } }),
    db.closeChecklistItem.findMany({ where: { periodId: period.id } }),
  ]);
  const unpostedRuns = runs.length ? runs.length - (await db.journalEntry.findMany({ where: { organizationId: org, runId: { in: runs.map((r) => r.id) } }, select: { runId: true }, distinct: ["runId"] })).length : 0;
  const integrity = (await checkLedgerIntegrity(org)).findings.filter((f) => f.severity === "ERROR" && f.check !== "PAYROLL_UNPOSTED");

  const checks: CloseCheck[] = rec.lines.map((l) => ({
    code: l.code,
    label: l.label,
    kind: "HARD" as const,
    status: l.agrees ? ("PASS" as const) : ("FAIL" as const),
    detail: l.agrees ? `Agree at ${l.ledger.toFixed(2)}.` : `${l.subledger.toFixed(2)} against ${l.ledger.toFixed(2)}: out by ${l.difference.toFixed(2)}. The period cannot close until this is put right.`,
  }));
  const pending = (code: string, label: string, count: number, what: string): CloseCheck => ({ code, label, kind: "PENDING", status: count ? "FAIL" : "PASS", detail: count ? `${count} ${what} dated in this period.` : "None.", count, waived: waived.has(code) });
  checks.push(
    pending("PENDING_INVOICES", "Invoice drafts awaiting approval", drafts, "invoice draft(s) not yet approved and posted"),
    pending("PENDING_JOURNALS", "Manual journals awaiting posting", journals, "manual journal(s) submitted or approved but not posted"),
    pending("PENDING_REVERSALS", "Reversals awaiting approval", reversals, "journal reversal(s) waiting for approval"),
    pending("PENDING_NOTES", "Credit and debit notes awaiting approval", notes, "credit or debit note(s) waiting for approval"),
    pending("PENDING_REFUNDS", "Client refunds awaiting approval", refunds, "client refund(s) waiting for approval"),
  );
  // sign-offs: compulsory only where the organization says so
  const done = new Map(items.map((i) => [i.code, i]));
  for (const s of STANDARD_SIGNOFFS) {
    const ok = !!done.get(s.code)?.done;
    checks.push({ code: `SIGNOFF_${s.code}`, label: `Sign-off: ${s.label}`, kind: orgRow.closeChecklistRequired ? "PENDING" : "ADVISORY", status: ok ? "PASS" : orgRow.closeChecklistRequired ? "FAIL" : "WARN", detail: ok ? `Signed off by ${done.get(s.code)!.doneBy}.` : "Not signed off yet.", count: ok ? 0 : 1, waived: waived.has(`SIGNOFF_${s.code}`) });
  }
  checks.push(
    { code: "DRAFT_JOURNALS", label: "Draft manual journals", kind: "ADVISORY", status: draftJournals ? "WARN" : "PASS", detail: draftJournals ? `${draftJournals} draft journal(s) dated in this period have not been submitted.` : "None." },
    { code: "RECURRING_DUE", label: "Recurring journals due", kind: "ADVISORY", status: recurring ? "WARN" : "PASS", detail: recurring ? `${recurring} recurring template(s) have journals due on or before the end of this period that have not been generated.` : "None." },
    { code: "PAYROLL_POSTED", label: "Locked payroll posted to the ledger", kind: "ADVISORY", status: unpostedRuns ? "WARN" : "PASS", detail: unpostedRuns ? `${unpostedRuns} locked payroll run(s) ending in this period have no journal.` : "Every locked payroll run in this period has its journal." },
    { code: "INTEGRITY", label: "Ledger integrity check", kind: "ADVISORY", status: integrity.length ? "WARN" : "PASS", detail: integrity.length ? `${integrity.length} integrity finding(s): ${integrity.slice(0, 2).map((f) => f.message).join(" ")}` : "No errors." },
  );
  return { checks, reconciliations: rec.lines };
}

/** Refuses to close a period whose books are out, or which has pending work nobody has chosen to close over. */
export async function assertReadyToClose(ctx: Ctx, period: PeriodFacts) {
  const { checks } = await evaluateClose(ctx, period);
  const stop = closeBlockers(checks);
  if (stop.length) {
    const hard = stop.some((c) => c.kind === "HARD");
    throw new BusinessError(
      `${period.name} can't be closed yet: ${stop.slice(0, 3).map((c) => `${c.label.toLowerCase()} (${c.detail.replace(/\.$/, "")})`).join("; ")}${stop.length > 3 ? `; and ${stop.length - 3} more` : ""}. ${hard ? "" : "An approver can close over pending work with a reason. "}See the close centre for the period.`,
    );
  }
}

// ───────────────────────────── The snapshot ─────────────────────────────

const sha = (data: unknown) => createHash("sha256").update(canonicalJson(data)).digest("hex");

/** Works out the books at the end of a period, ready to be written. Heavy, so done before the closing transaction opens. */
export async function prepareSnapshot(ctx: Ctx, period: PeriodFacts) {
  const rec = await reconciliationsAsAt(ctx, period.endDate);
  const balances = Object.fromEntries(await Promise.all([["cash", "1230"], ["vatPayable", "2190"], ["whtReceivable", "1220"], ["whtPayable", "2195"], ["clientAdvances", "2192"]].map(async ([k, code]) => [k, await ledgerBalance(ctx.orgId, code, period.endDate)] as const)));
  const arLine = rec.lines.find((l) => l.code === "AR_GL")!;
  const apLine = rec.lines.find((l) => l.code === "AP_GL")!;
  const data = {
    period: { name: period.name, start: iso(period.startDate), end: iso(period.endDate) },
    trialBalance: rec.trial.rows,
    receivables: { total: rec.ar.total, ledger: arLine.ledger, advances: rec.ar.advances, clients: rec.ar.clients, invoices: rec.ar.invoices },
    payables: { total: rec.ap.total, ledger: apLine.ledger, vendors: rec.ap.vendors },
    balances,
  };
  const raw = await db.journalLine.aggregate({ where: { journal: { organizationId: ctx.orgId, postingDate: { lte: period.endDate } } }, _sum: { debit: true, credit: true } });
  return { data, ar: rec.ar.total, arLedger: arLine.ledger, ap: rec.ap.total, apLedger: apLine.ledger, trialDebit: rec.trial.debit, trialCredit: rec.trial.credit, lineDebit: round2(num(raw._sum.debit)), lineCredit: round2(num(raw._sum.credit)) };
}

export type PreparedSnapshot = Awaited<ReturnType<typeof prepareSnapshot>>;

/**
 * Writes the official record of the books at the end of a period, inside the transaction that closes it. If the ledger moved while
 * the snapshot was being worked out the close is refused, so a snapshot can never disagree with the ledger it records.
 */
export async function writeSnapshot(ctx: Ctx, tx: Tx, period: PeriodFacts, prepared: PreparedSnapshot) {
  const sums = async (code?: string) => {
    const a = await tx.journalLine.aggregate({ where: { journal: { organizationId: ctx.orgId, postingDate: { lte: period.endDate } }, ...(code ? { account: { organizationId: ctx.orgId, code } } : {}) }, _sum: { debit: true, credit: true } });
    return { debit: round2(num(a._sum.debit)), credit: round2(num(a._sum.credit)) };
  };
  const [all, arNow, apNow] = await Promise.all([sums(), sums("1200"), sums("2180")]);
  if (all.debit !== prepared.lineDebit || all.credit !== prepared.lineCredit || round2(arNow.debit - arNow.credit) !== prepared.arLedger || round2(apNow.credit - apNow.debit) !== prepared.apLedger)
    throw new BusinessError("The ledger changed while the period was being closed. Nothing has been closed; try again.");
  const { data } = prepared;
  const last = await tx.periodSnapshot.findFirst({ where: { periodId: period.id }, orderBy: { version: "desc" }, select: { version: true } });
  const snap = await tx.periodSnapshot.create({
    data: {
      organizationId: ctx.orgId,
      periodId: period.id,
      version: (last?.version ?? 0) + 1,
      asAt: period.endDate,
      takenBy: ctx.name,
      takenByUserId: ctx.userId,
      data: data as never,
      arTotal: prepared.ar,
      arLedger: prepared.arLedger,
      apTotal: prepared.ap,
      apLedger: prepared.apLedger,
      trialDebit: prepared.trialDebit,
      trialCredit: prepared.trialCredit,
      checksum: sha(data),
    },
  });
  await logAudit(ctx, { action: "PERIOD_SNAPSHOT", entity: "PeriodSnapshot", entityId: snap.id, newValue: { period: period.name, version: snap.version, receivables: prepared.ar, payables: prepared.ap, checksum: snap.checksum } }, tx);
  return snap;
}

/** A reopened period's snapshot no longer stands for it; it is kept, marked superseded. */
export async function supersedeSnapshots(ctx: Ctx, tx: Tx, periodId: string) {
  await tx.periodSnapshot.updateMany({ where: { periodId, supersededAt: null }, data: { supersededAt: new Date(), supersededBy: ctx.name } });
}

export type SnapshotData = {
  period: { name: string; start: string; end: string };
  trialBalance: Array<{ code: string; name: string; type: string; debit: number; credit: number }>;
  receivables: { total: number; ledger: number; advances: number; clients: Array<{ clientId: string; name: string; owed: number; advances: number; ledger: number; ageing: Record<string, number> }>; invoices: Array<{ invoiceId: string; number: string; clientId: string; client: string; dueDate: string; balance: number; daysPastDue: number; bucket: string }> };
  payables: { total: number; ledger: number; vendors: Array<{ vendorId: string; name: string; owed: number }> };
  balances: Record<string, number>;
};

// ───────────────────────────── The close centre and the receivables report ─────────────────────────────

async function loadPeriod(ctx: Ctx, periodId: string) {
  const p = await db.accountingPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId }, include: { fiscalYear: { select: { name: true } } } });
  if (!p) throw new BusinessError("Period not found.");
  return p;
}

export async function ensureChecklist(orgId: string, periodId: string) {
  await db.closeChecklistItem.createMany({ data: STANDARD_SIGNOFFS.map((s, i) => ({ organizationId: orgId, periodId, code: s.code, label: s.label, sortOrder: i })), skipDuplicates: true });
}

export async function closeCentre(ctx: Ctx, periodId: string) {
  assertCan(ctx, "gl.view");
  const period = await loadPeriod(ctx, periodId);
  await ensureChecklist(ctx.orgId, periodId);
  const [evaluation, checklist, snapshots, waivers, org] = await Promise.all([
    evaluateClose(ctx, period),
    db.closeChecklistItem.findMany({ where: { periodId }, orderBy: { sortOrder: "asc" } }),
    db.periodSnapshot.findMany({ where: { periodId }, orderBy: { version: "desc" }, select: { id: true, version: true, takenAt: true, takenBy: true, checksum: true, supersededAt: true, arTotal: true, apTotal: true } }),
    db.closeWaiver.findMany({ where: { periodId }, orderBy: { createdAt: "asc" } }),
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { closeChecklistRequired: true } }),
  ]);
  return { period, ...evaluation, blockers: closeBlockers(evaluation.checks), checklist, snapshots, waivers, checklistRequired: org.closeChecklistRequired };
}

export const signOffSchema = z.object({ done: z.boolean(), note: z.string().trim().max(300).optional() });

/** Signs a checklist item off (or takes the sign-off back). */
export async function signOff(ctx: Ctx, periodId: string, code: string, done: boolean, note?: string) {
  assertCan(ctx, "period.close");
  const period = await loadPeriod(ctx, periodId);
  if (period.status === "LOCKED") throw new BusinessError("A locked period's checklist can't change.");
  await ensureChecklist(ctx.orgId, periodId);
  return db.$transaction(async (tx) => {
    const item = await tx.closeChecklistItem.findFirst({ where: { periodId, code } });
    if (!item) throw new BusinessError("Checklist item not found.");
    const u = await tx.closeChecklistItem.update({ where: { id: item.id }, data: done ? { done: true, doneBy: ctx.name, doneByUserId: ctx.userId, doneAt: new Date(), note: note?.trim() || null } : { done: false, doneBy: null, doneByUserId: null, doneAt: null, note: note?.trim() || item.note } });
    await logAudit(ctx, { action: done ? "CLOSE_SIGNOFF" : "CLOSE_SIGNOFF_UNDO", entity: "AccountingPeriod", entityId: periodId, newValue: { period: period.name, item: item.label }, reason: note }, tx);
    return u;
  });
}

/** Chooses to close a period over a pending item. Hard checks can't be waived. Recorded for good. */
export async function waiveCheck(ctx: Ctx, periodId: string, checkCode: string, reason: string) {
  assertCan(ctx, "period.approve");
  if (!reason || reason.trim().length < 15) throw new BusinessError("Say why the period is being closed over this, in a sentence or two. It is recorded.");
  const period = await loadPeriod(ctx, periodId);
  if (period.status === "CLOSED" || period.status === "LOCKED") throw new BusinessError("This period is already closed.");
  const { checks } = await evaluateClose(ctx, period);
  const check = checks.find((c) => c.code === checkCode);
  if (!check) throw new BusinessError("That isn't a check on this period.");
  if (check.kind !== "PENDING") throw new BusinessError(check.kind === "HARD" ? "The books have to agree to close a period: this can't be waived. Put the difference right." : "That check is for information only and doesn't stop the period closing.");
  if (check.status !== "FAIL") throw new BusinessError("Nothing is outstanding on that check.");
  return db.$transaction(async (tx) => {
    const w = await tx.closeWaiver.create({ data: { organizationId: ctx.orgId, periodId, checkCode, reason: reason.trim(), waivedBy: ctx.name, waivedByUserId: ctx.userId } });
    await logAudit(ctx, { action: "CLOSE_WAIVE", entity: "AccountingPeriod", entityId: periodId, newValue: { period: period.name, check: check.label, outstanding: check.count }, reason }, tx);
    return w;
  });
}

export async function setCloseChecklistRequired(ctx: Ctx, required: boolean) {
  assertCan(ctx, "period.approve");
  const old = (await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { closeChecklistRequired: true } })).closeChecklistRequired;
  await db.organization.update({ where: { id: ctx.orgId }, data: { closeChecklistRequired: required } });
  await logAudit(ctx, { action: "CLOSE_CHECKLIST_SETTING", entity: "Organization", entityId: ctx.orgId, oldValue: { required: old }, newValue: { required } });
  return required;
}

/** The receivables report for a period: the official snapshot if it is closed, else a live calculation labelled as such. */
export async function arReport(ctx: Ctx, periodId: string) {
  assertCan(ctx, "gl.view");
  const period = await loadPeriod(ctx, periodId);
  const snap = await db.periodSnapshot.findFirst({ where: { periodId, supersededAt: null }, orderBy: { version: "desc" } });
  if (snap) {
    const data = snap.data as unknown as SnapshotData;
    return { period, official: true as const, takenAt: snap.takenAt, takenBy: snap.takenBy, version: snap.version, checksumOk: sha(data) === snap.checksum, data };
  }
  const rec = await reconciliationsAsAt(ctx, period.endDate);
  const ar = rec.lines.find((l) => l.code === "AR_GL")!;
  const live: SnapshotData = {
    period: { name: period.name, start: iso(period.startDate), end: iso(period.endDate) },
    trialBalance: rec.trial.rows,
    receivables: { total: rec.ar.total, ledger: ar.ledger, advances: rec.ar.advances, clients: rec.ar.clients, invoices: rec.ar.invoices },
    payables: { total: rec.ap.total, ledger: rec.lines.find((l) => l.code === "AP_GL")!.ledger, vendors: rec.ap.vendors },
    balances: {},
  };
  return { period, official: false as const, takenAt: null, takenBy: null, version: null, checksumOk: true, data: live };
}

/** Compares a closed period's snapshot with a fresh calculation as at the same date: has anything moved since? */
export async function snapshotDrift(ctx: Ctx, periodId: string) {
  assertCan(ctx, "gl.view");
  const period = await loadPeriod(ctx, periodId);
  const snap = await db.periodSnapshot.findFirst({ where: { periodId, supersededAt: null }, orderBy: { version: "desc" } });
  if (!snap) return null;
  const data = snap.data as unknown as SnapshotData;
  const now = await receivablesAsAt(ctx, period.endDate);
  const was = new Map(data.receivables.clients.map((c) => [c.clientId, c.owed]));
  const is = new Map(now.clients.map((c) => [c.clientId, c.owed]));
  const names = new Map([...data.receivables.clients, ...now.clients].map((c) => [c.clientId, c.name]));
  const moved = [...new Set([...was.keys(), ...is.keys()])]
    .map((id) => ({ clientId: id, name: names.get(id) ?? "—", snapshot: was.get(id) ?? 0, now: is.get(id) ?? 0, difference: round2((is.get(id) ?? 0) - (was.get(id) ?? 0)) }))
    .filter((r) => r.difference !== 0);
  return { snapshotTotal: data.receivables.total, nowTotal: now.total, difference: round2(now.total - data.receivables.total), moved, checksumOk: sha(data) === snap.checksum };
}
