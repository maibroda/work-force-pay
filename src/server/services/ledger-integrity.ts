/**
 * Ledger integrity check: the safety net under every change to the books.
 *
 * It answers one question — "is the ledger internally consistent, and do the subledgers agree with it?" —
 * without changing anything. It is run before and after every finance migration, in CI, and on a restored backup,
 * so a change that breaks accounting is caught by a failing check rather than by an auditor.
 *
 * Structural checks (ERROR): every journal balances and its header equals its lines; no line is negative or
 * both-sided; every journal has at least two lines; every line's account belongs to the same organization; the
 * whole ledger's debits equal its credits; every locked payroll run has its journal.
 *
 * Reversal checks (ERROR): a journal that reverses another must negate it exactly, account by account, and the
 * original must be in the same organization.
 *
 * Client receipts (ERROR): receivables settled by receipts include what was applied to invoices by allocation, and what a
 * receipt holds unapplied (less refunds) agrees with the client advances account. (WARN) A client's own balance in the
 * receivables account agrees with what they owe on their invoices.
 *
 * Invoice drafts (generated, awaiting approval) are not in the ledger or the subledger and have no tax records until approved.
 *
 * Credit and debit notes (ERROR): an invoice's credits and debits equal its approved notes, and the receivables subledger counts them.
 *
 * Tax checks (ERROR): the tax records of every live invoice add up to the VAT and withholding stored on it, and a cancelled
 * invoice has none left live.
 *
 * Dimension checks (ERROR): a line's client, contract, cost centre and other dimensions must belong to the same
 * organization, and a contract on a line must belong to that line's client.
 *
 * Control checks (ERROR): the receivables subledger (invoices − receipts − deductions) equals the receivables control
 * account, and the payables subledger likewise. A cancelled document counts as nil only if its posting was reversed,
 * so every cancelled document must have its reversing journal.
 *
 * Hygiene (WARN): journal numbers with gaps, which in a ledger that never deletes can only mean a deletion; journals
 * with no accounting period (stamp them with `npm run ledger:backfill-periods`); documents that no journal points at,
 * which means they were never posted or were posted before journals recorded their source.
 *
 * Reads happen in one repeatable-read transaction so a posting that commits while the check runs can't make it
 * disagree with itself.
 */
import { round2, num } from "@/lib/money";
import { DIMENSIONS } from "@/lib/dimensions";
import { db } from "./_base";

export type Severity = "ERROR" | "WARN";

export interface IntegrityFinding {
  check: string;
  severity: Severity;
  message: string;
  /** The journal number, invoice number or account the finding is about. */
  ref?: string;
}

export interface Reconciliation {
  name: string;
  subledger: number;
  control: number;
  difference: number;
}

export interface IntegrityReport {
  organizationId: string;
  organization: string;
  checkedAt: Date;
  /** Row counts, so a restored copy can be compared with the live database. */
  census: Record<string, number>;
  findings: IntegrityFinding[];
  reconciliations: Reconciliation[];
  ok: boolean;
}

/** A payables or receivables subledger: documents raised less what has settled them. Pure, so it can be tested alone. */
export function subledgerBalance(input: {
  documents: Array<{ total: number; status: string }>;
  settled: number;
  /** Documents with this status are excluded (their posting must then have been reversed). */
  excludeStatus?: string;
}): number {
  const raised = input.documents.filter((d) => d.status !== (input.excludeStatus ?? "CANCELLED")).reduce((s, d) => s + d.total, 0);
  return round2(raised - input.settled);
}

const AR_CODE = "1200";
const AP_CODE = "2180";
const TOLERANCE = 0.005;

export async function checkLedgerIntegrity(orgId: string): Promise<IntegrityReport> {
  return db.$transaction(
    async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
      const findings: IntegrityFinding[] = [];
      const add = (check: string, severity: Severity, message: string, ref?: string) => findings.push({ check, severity, message, ref });

      const journals = await tx.journalEntry.findMany({
        where: { organizationId: orgId },
        include: {
          lines: {
            include: {
              account: { select: { organizationId: true, code: true } },
              client: { select: { organizationId: true } },
              contract: { select: { organizationId: true, clientId: true } },
              beat: { select: { organizationId: true } },
              costCenter: { select: { organizationId: true } },
              department: { select: { organizationId: true } },
              employee: { select: { organizationId: true } },
              fixedAsset: { select: { organizationId: true } },
              region: { select: { organizationId: true } },
              branch: { select: { organizationId: true } },
              profitCentre: { select: { organizationId: true } },
              project: { select: { organizationId: true } },
            },
          },
        },
        orderBy: { entryNumber: "asc" },
      });

      let ledgerDebit = 0;
      let ledgerCredit = 0;
      for (const j of journals) {
        const debit = round2(j.lines.reduce((s, l) => s + num(l.debit), 0));
        const credit = round2(j.lines.reduce((s, l) => s + num(l.credit), 0));
        ledgerDebit += debit;
        ledgerCredit += credit;
        if (Math.abs(debit - credit) >= TOLERANCE) add("JOURNAL_BALANCE", "ERROR", `Debits ${debit} and credits ${credit} differ.`, j.entryNumber);
        if (Math.abs(debit - num(j.totalDebit)) >= TOLERANCE || Math.abs(credit - num(j.totalCredit)) >= TOLERANCE)
          add("JOURNAL_HEADER", "ERROR", `Header totals (${num(j.totalDebit)} / ${num(j.totalCredit)}) don't match the lines (${debit} / ${credit}).`, j.entryNumber);
        if (j.lines.length < 2) add("JOURNAL_LINES", "ERROR", `Only ${j.lines.length} line(s); a posting needs at least two.`, j.entryNumber);
        for (const l of j.lines) {
          if (num(l.debit) < 0 || num(l.credit) < 0) add("LINE_NEGATIVE", "ERROR", `A line has a negative amount on ${l.accountCode}.`, j.entryNumber);
          if (num(l.debit) > 0 && num(l.credit) > 0) add("LINE_BOTH_SIDES", "ERROR", `A line is both debit and credit on ${l.accountCode}.`, j.entryNumber);
          for (const dim of DIMENSIONS) {
            const target = l[dim.relation] as { organizationId: string } | null;
            if (target && target.organizationId !== orgId) add("LINE_DIMENSION_ORG", "ERROR", `A line's ${dim.label.toLowerCase()} belongs to another organization.`, j.entryNumber);
          }
          if (l.clientId && l.contract && l.contract.clientId !== l.clientId) add("LINE_DIMENSION_MISMATCH", "ERROR", `A line's contract doesn't belong to its client.`, j.entryNumber);
          if (l.account.organizationId !== orgId) add("LINE_ACCOUNT_ORG", "ERROR", `A line posts to an account of another organization (${l.accountCode}).`, j.entryNumber);
          else if (l.account.code !== l.accountCode) add("LINE_ACCOUNT_CODE", "WARN", `Line says ${l.accountCode} but the account is ${l.account.code}.`, j.entryNumber);
        }
      }
      if (Math.abs(round2(ledgerDebit) - round2(ledgerCredit)) >= TOLERANCE)
        add("TRIAL_BALANCE", "ERROR", `Whole ledger: debits ${round2(ledgerDebit)} vs credits ${round2(ledgerCredit)}.`);

      // A reversal must cancel its original exactly, account by account.
      const byId = new Map(journals.map((j) => [j.id, j]));
      const net = (j: (typeof journals)[number]) => {
        const m = new Map<string, number>();
        for (const l of j.lines) m.set(l.accountId, round2((m.get(l.accountId) ?? 0) + num(l.debit) - num(l.credit)));
        return m;
      };
      for (const j of journals) {
        if (!j.reversalOfId) continue;
        const original = byId.get(j.reversalOfId);
        if (!original) {
          add("REVERSAL_ORIGINAL", "ERROR", "Reverses a journal that isn't in this organization.", j.entryNumber);
          continue;
        }
        const a = net(original);
        const b = net(j);
        const accounts = new Set([...a.keys(), ...b.keys()]);
        const off = [...accounts].filter((id) => Math.abs(round2((a.get(id) ?? 0) + (b.get(id) ?? 0))) >= TOLERANCE);
        if (off.length) add("REVERSAL_MISMATCH", "ERROR", `Doesn't cancel ${original.entryNumber} exactly: ${off.length} account(s) don't net to nil.`, j.entryNumber);
      }

      // Numbering: a ledger that never deletes has no gaps.
      const seq = journals.map((j) => Number(j.entryNumber.replace(/\D/g, ""))).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      for (let i = 1; i < seq.length; i++)
        if (seq[i] - seq[i - 1] > 1) add("NUMBER_GAP", "WARN", `Journal numbers jump from ${seq[i - 1]} to ${seq[i]}; something may have been deleted.`);

      const noPeriod = journals.filter((j) => !j.periodId);
      if (noPeriod.length) add("JOURNAL_NO_PERIOD", "WARN", `${noPeriod.length} journal(s) have no accounting period; run npm run ledger:backfill-periods.`, noPeriod[0].entryNumber);

      // Every locked payroll run should have posted.
      const posted = new Set(journals.map((j) => j.runId).filter(Boolean));
      const runs = await tx.payrollRun.findMany({ where: { organizationId: orgId, status: { in: ["LOCKED", "PAID"] } }, select: { id: true, runNumber: true } });
      for (const r of runs) if (!posted.has(r.id)) add("PAYROLL_UNPOSTED", "ERROR", `A locked payroll run has no journal.`, `run ${r.runNumber}`);

      // Tax records: what the VAT and withholding reports read must agree with the invoices.
      const taxed = await tx.clientInvoice.findMany({
        where: { organizationId: orgId },
        select: { invoiceNumber: true, status: true, vatAmount: true, whtAmount: true, taxTransactions: { where: { reversed: false, sourceType: "CLIENT_INVOICE" }, select: { kind: true, taxAmount: true } } },
      });
      for (const inv of taxed) {
        const live = (kind: string) => round2(inv.taxTransactions.filter((t) => t.kind === kind).reduce((s, t) => s + num(t.taxAmount), 0));
        const [vat, wht] = ["CANCELLED", "DRAFT", "SUBMITTED"].includes(inv.status) ? [0, 0] : [num(inv.vatAmount), num(inv.whtAmount)]; // a draft has no tax records yet
        if (Math.abs(live("OUTPUT_VAT") - round2(vat)) >= TOLERANCE) add("TAX_VAT_RECORDS", "ERROR", `VAT records total ${live("OUTPUT_VAT")} but the invoice says ${round2(vat)}.`, inv.invoiceNumber);
        if (Math.abs(live("EXPECTED_WHT") - round2(wht)) >= TOLERANCE) add("TAX_WHT_RECORDS", "ERROR", `Withholding records total ${live("EXPECTED_WHT")} but the invoice says ${round2(wht)}.`, inv.invoiceNumber);
      }

      // Subledgers against their control accounts.
      const balanceOf = async (code: string) => {
        const a = await tx.journalLine.aggregate({ where: { journal: { organizationId: orgId }, account: { code } }, _sum: { debit: true, credit: true } });
        return round2(num(a._sum.debit) - num(a._sum.credit));
      };
      const reconciliations: Reconciliation[] = [];
      const reconcile = (name: string, subledger: number, controlBalance: number, sign: 1 | -1) => {
        const control = round2(controlBalance * sign);
        const difference = round2(subledger - control);
        reconciliations.push({ name, subledger, control, difference });
        if (Math.abs(difference) >= TOLERANCE) add("SUBLEDGER", "ERROR", `${name}: subledger ${subledger} vs ledger ${control} (difference ${difference}).`);
      };

      const [invoices, receipts, deductions, bills, payments, billDeductions, allocated, advanceReceipts, refunded, approvedNotes] = await Promise.all([
        tx.clientInvoice.findMany({ where: { organizationId: orgId }, select: { id: true, clientId: true, totalAmount: true, totalCredits: true, totalDebits: true, status: true, invoiceNumber: true } }),
        tx.clientReceipt.aggregate({ where: { organizationId: orgId, invoiceId: { not: null } }, _sum: { amount: true } }), // single-invoice receipts; the others settle through allocations
        tx.clientInvoiceDeduction.aggregate({ where: { organizationId: orgId }, _sum: { amount: true } }),
        tx.purchaseInvoice.findMany({ where: { organizationId: orgId }, select: { totalAmount: true, status: true, invoiceNumber: true } }),
        tx.vendorPayment.aggregate({ where: { organizationId: orgId }, _sum: { amount: true } }),
        tx.purchaseInvoiceDeduction.aggregate({ where: { organizationId: orgId }, _sum: { amount: true } }),
        tx.receiptAllocation.findMany({ where: { organizationId: orgId, reversedAt: null }, select: { cashAmount: true, whtAmount: true, invoice: { select: { clientId: true } } } }),
        tx.clientReceipt.aggregate({ where: { organizationId: orgId, invoiceId: null }, _sum: { amount: true, whtWithheld: true } }),
        tx.clientRefund.aggregate({ where: { organizationId: orgId, status: "APPROVED" }, _sum: { amount: true } }),
        tx.clientNote.findMany({ where: { organizationId: orgId, status: "APPROVED" }, select: { type: true, totalAmount: true, invoiceId: true, clientId: true } }),
      ]);
      const noteTotal = (type: "CREDIT" | "DEBIT") => round2(approvedNotes.filter((n) => n.type === type).reduce((s, n) => s + num(n.totalAmount), 0));
      for (const i of invoices) {
        const mine = (type: "CREDIT" | "DEBIT") => round2(approvedNotes.filter((n) => n.invoiceId === i.id && n.type === type).reduce((s, n) => s + num(n.totalAmount), 0));
        if (Math.abs(mine("CREDIT") - num(i.totalCredits)) >= TOLERANCE || Math.abs(mine("DEBIT") - num(i.totalDebits)) >= TOLERANCE)
          add("NOTE_TOTALS", "ERROR", `The invoice's credits (${num(i.totalCredits)}) and debits (${num(i.totalDebits)}) differ from its approved notes (${mine("CREDIT")} / ${mine("DEBIT")}).`, i.invoiceNumber);
      }
      const allocatedGross = round2(allocated.reduce((s, a) => s + num(a.cashAmount) + num(a.whtAmount), 0));
      // Documents that no journal points at (posted before journals recorded their source, or never posted).
      const sourced = new Set(journals.filter((j) => j.sourceType && j.sourceId).map((j) => `${j.sourceType}:${j.sourceId}`));
      const unlinked = async (label: string, type: string, rows: Promise<Array<{ id: string }>>) => {
        const missing = (await rows).filter((r) => !sourced.has(`${type}:${r.id}`));
        if (missing.length) add("DOCUMENT_NO_JOURNAL", "WARN", `${missing.length} ${label} have no journal pointing at them: never posted, or posted before journals recorded their source.`);
      };
      await unlinked("client invoice(s)", "CLIENT_INVOICE", tx.clientInvoice.findMany({ where: { organizationId: orgId, status: { notIn: ["DRAFT", "SUBMITTED"] } }, select: { id: true } }));
      await unlinked("client receipt(s)", "CLIENT_RECEIPT", tx.clientReceipt.findMany({ where: { organizationId: orgId }, select: { id: true } }));
      await unlinked("vendor bill(s)", "PURCHASE_INVOICE", tx.purchaseInvoice.findMany({ where: { organizationId: orgId }, select: { id: true } }));
      await unlinked("vendor payment(s)", "VENDOR_PAYMENT", tx.vendorPayment.findMany({ where: { organizationId: orgId }, select: { id: true } }));

      const cancelledAr = invoices.filter((i) => i.status === "CANCELLED");
      const postedInvoices = invoices.filter((i) => i.status !== "DRAFT" && i.status !== "SUBMITTED"); // a draft is not in the ledger or the subledger
      const cancelledAp = bills.filter((i) => i.status === "CANCELLED");
      reconcile(
        "Receivables (client subledger vs account 1200)",
        subledgerBalance({ documents: postedInvoices.map((i) => ({ total: num(i.totalAmount), status: i.status })), settled: num(receipts._sum.amount) + num(deductions._sum.amount) + allocatedGross + noteTotal("CREDIT") - noteTotal("DEBIT") }),
        await balanceOf(AR_CODE),
        1,
      );
      reconcile(
        "Client advances (receipts held vs account 2192)",
        round2(num(advanceReceipts._sum.amount) + num(advanceReceipts._sum.whtWithheld) - allocatedGross - num(refunded._sum.amount)),
        await balanceOf("2192"),
        -1,
      );
      // Each client's own balance: invoices less what settled them, against the client's lines in the receivables account.
      {
        const owed = new Map<string, number>();
        const bump = (clientId: string | null | undefined, n: number) => clientId && owed.set(clientId, round2((owed.get(clientId) ?? 0) + n));
        for (const i of postedInvoices) if (i.status !== "CANCELLED") bump(i.clientId, num(i.totalAmount));
        const [legacy, ded] = await Promise.all([
          tx.clientReceipt.groupBy({ by: ["clientId"], where: { organizationId: orgId, invoiceId: { not: null } }, _sum: { amount: true } }),
          tx.clientInvoiceDeduction.groupBy({ by: ["clientId"], where: { organizationId: orgId }, _sum: { amount: true } }),
        ]);
        for (const r of legacy) bump(r.clientId, -num(r._sum.amount));
        for (const r of ded) bump(r.clientId, -num(r._sum.amount));
        for (const a of allocated) bump(a.invoice.clientId, -(num(a.cashAmount) + num(a.whtAmount)));
        for (const n of approvedNotes) bump(n.clientId, n.type === "CREDIT" ? -num(n.totalAmount) : num(n.totalAmount));
        const byClient = await tx.journalLine.groupBy({ by: ["clientId"], where: { journal: { organizationId: orgId }, account: { organizationId: orgId, code: AR_CODE }, clientId: { not: null } }, _sum: { debit: true, credit: true } });
        const ledgerOf = new Map(byClient.map((r) => [r.clientId as string, round2(num(r._sum.debit) - num(r._sum.credit))]));
        const off = [...new Set([...owed.keys(), ...ledgerOf.keys()])].filter((c) => Math.abs((owed.get(c) ?? 0) - (ledgerOf.get(c) ?? 0)) >= TOLERANCE);
        if (off.length) add("AR_CLIENT_BALANCE", "WARN", `${off.length} client(s) have a balance in the receivables account that differs from what their invoices say is owed (lines without a client, or older postings).`);
      }
      reconcile(
        "Payables (vendor subledger vs account 2180)",
        subledgerBalance({ documents: bills.map((i) => ({ total: num(i.totalAmount), status: i.status })), settled: num(payments._sum.amount) + num(billDeductions._sum.amount) }),
        await balanceOf(AP_CODE),
        -1,
      );
      const reversed = new Set(
        journals
          .filter((j) => j.source === "AR_INVOICE_CANCEL" || j.source === "AP_INVOICE_CANCEL")
          .map((j) => j.description.match(/^Reversal of (?:client invoice|vendor bill) (.+) \(cancelled\)$/)?.[1])
          .filter((x): x is string => !!x),
      );
      for (const i of cancelledAr) if (!reversed.has(i.invoiceNumber)) add("CANCELLED_NOT_REVERSED", "ERROR", `Invoice is cancelled but its receivable and revenue were never reversed in the ledger.`, i.invoiceNumber);
      for (const i of cancelledAp) if (!reversed.has(i.invoiceNumber)) add("CANCELLED_NOT_REVERSED", "ERROR", `Vendor bill is cancelled but its payable and expense were never reversed in the ledger.`, i.invoiceNumber);

      const [employees, clients, payrollRecords, journalCount] = await Promise.all([
        tx.employee.count({ where: { organizationId: orgId } }),
        tx.client.count({ where: { organizationId: orgId } }),
        tx.payrollRecord.count({ where: { organizationId: orgId } }),
        tx.journalEntry.count({ where: { organizationId: orgId } }),
      ]);
      return {
        organizationId: orgId,
        organization: org.name,
        checkedAt: new Date(),
        census: { employees, clients, payrollRecords, invoices: invoices.length, receipts: await tx.clientReceipt.count({ where: { organizationId: orgId } }), vendorBills: bills.length, journals: journalCount, journalLines: journals.reduce((s, j) => s + j.lines.length, 0) },
        findings,
        reconciliations,
        ok: !findings.some((f) => f.severity === "ERROR"),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 120_000, maxWait: 30_000 },
  );
}

export async function checkAllOrganizations(): Promise<IntegrityReport[]> {
  const orgs = await db.organization.findMany({ select: { id: true }, orderBy: { code: "asc" } });
  const out: IntegrityReport[] = [];
  for (const o of orgs) out.push(await checkLedgerIntegrity(o.id));
  return out;
}
