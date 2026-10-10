/**
 * The tax engine: tax codes (VAT, withholding tax), their rates by date, and the record of what was taxed.
 *
 *  • A rate is proposed by one person and approved by another (never the same person). Approving it ends the rate it
 *    replaces the day before. An approved rate is never edited or deleted (the database refuses, even by SQL); a change is a
 *    new rate from a later date.
 *  • An invoice reads the rate in force on its date. If a default code exists but no rate is in force that day, invoicing
 *    stops with a message rather than quietly charging nothing. A person can still type a rate for a run; that is recorded
 *    on the invoice as typed, not from the engine.
 *  • Every taxed amount on an invoice is written as a TaxTransaction in the invoice's own transaction, which is what the VAT
 *    and withholding reports read. Cancelling the invoice marks them reversed.
 *  • An organization with no tax codes behaves exactly as before: the rates typed for a run, or none.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d } from "@/lib/dates";
import { num } from "@/lib/money";
import { rateOn, rateProblems, type RateRow, type RateStatus, type TaxType } from "@/lib/tax-engine";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

const TYPES = ["VAT", "WHT"] as const;

export const taxCodeSchema = z.object({
  code: z.string().trim().min(2, "Give the code a short name").max(30).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores"),
  name: z.string().trim().min(3, "Describe the tax").max(120),
  type: z.enum(TYPES),
  accountCode: z.string().trim().max(20).optional().transform((v) => (v ? v : undefined)),
  notes: z.string().trim().max(500).optional(),
});
export type TaxCodeInput = z.input<typeof taxCodeSchema>;

const rowOf = (r: { ratePct: unknown; effectiveFrom: Date; effectiveTo: Date | null; status: string }): RateRow => ({
  ratePct: num(r.ratePct),
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  status: r.status as RateStatus,
});

async function loadCode(ctx: Ctx, tx: Tx, id: string) {
  const code = await tx.taxCode.findFirst({ where: { id, organizationId: ctx.orgId }, include: { rates: true } });
  if (!code) throw new BusinessError("Tax code not found.");
  return code;
}

// ───────────────────────────── Codes ─────────────────────────────

export async function saveTaxCode(ctx: Ctx, id: string | null, raw: TaxCodeInput) {
  assertCan(ctx, "tax.manage");
  const v = taxCodeSchema.parse(raw);
  if (v.accountCode && !(await db.glAccount.count({ where: { organizationId: ctx.orgId, code: v.accountCode } }))) throw new BusinessError(`Account ${v.accountCode} isn't in this organization's chart.`);
  return db.$transaction(async (tx) => {
    if (!id) {
      if (await tx.taxCode.count({ where: { organizationId: ctx.orgId, code: v.code } })) throw new BusinessError(`There is already a tax code ${v.code}.`);
      const first = !(await tx.taxCode.count({ where: { organizationId: ctx.orgId, type: v.type } }));
      const c = await tx.taxCode.create({ data: { organizationId: ctx.orgId, code: v.code, name: v.name, type: v.type, accountCode: v.accountCode, notes: v.notes, isDefault: first, createdBy: ctx.name } });
      await logAudit(ctx, { action: "TAX_CODE_CREATE", entity: "TaxCode", entityId: c.id, newValue: { code: v.code, type: v.type, isDefault: first } }, tx);
      return c;
    }
    const existing = await loadCode(ctx, tx, id);
    // the code and its type are what rates and past invoices refer to; the rest can be tidied
    const c = await tx.taxCode.update({ where: { id }, data: { name: v.name, accountCode: v.accountCode ?? null, notes: v.notes ?? null } });
    await logAudit(ctx, { action: "TAX_CODE_UPDATE", entity: "TaxCode", entityId: id, oldValue: { name: existing.name, accountCode: existing.accountCode }, newValue: { name: v.name, accountCode: v.accountCode ?? null } }, tx);
    return c;
  });
}

/** Makes a code the one invoices use for its type. */
export async function setDefaultTaxCode(ctx: Ctx, id: string) {
  assertCan(ctx, "tax.manage");
  return db.$transaction(async (tx) => {
    const c = await loadCode(ctx, tx, id);
    if (!c.active) throw new BusinessError("An inactive tax code can't be the default.");
    await tx.taxCode.updateMany({ where: { organizationId: ctx.orgId, type: c.type, isDefault: true }, data: { isDefault: false } });
    await tx.taxCode.update({ where: { id }, data: { isDefault: true } });
    await logAudit(ctx, { action: "TAX_CODE_DEFAULT", entity: "TaxCode", entityId: id, newValue: { code: c.code, type: c.type } }, tx);
  });
}

export async function setTaxCodeActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "tax.manage");
  return db.$transaction(async (tx) => {
    const c = await loadCode(ctx, tx, id);
    if (!active && c.isDefault) throw new BusinessError("This is the default code for its type. Choose another default first.");
    await tx.taxCode.update({ where: { id }, data: { active } });
    await logAudit(ctx, { action: active ? "TAX_CODE_ACTIVATE" : "TAX_CODE_DEACTIVATE", entity: "TaxCode", entityId: id, newValue: { code: c.code } }, tx);
  });
}

/**
 * Sets up a VAT code and a withholding-tax code, with proposed rates, for an organization that has none. The rates are
 * proposals like any other and need a second person's approval; they are a starting point to be confirmed with a tax
 * adviser, not advice.
 */
export async function installStandardTax(ctx: Ctx) {
  assertCan(ctx, "tax.manage");
  if (await db.taxCode.count({ where: { organizationId: ctx.orgId } })) throw new BusinessError("This organization already has tax codes.");
  return db.$transaction(async (tx) => {
    const specs = [
      { code: "VAT-STD", name: "Value added tax — standard rate", type: "VAT" as const, accountCode: "2190", ratePct: 7.5, from: "2020-02-01", reason: "Standard VAT rate proposed at set-up (7.5% from 1 February 2020); confirm with your tax adviser." },
      { code: "WHT-SERV", name: "Withholding tax — services", type: "WHT" as const, accountCode: "1220", ratePct: 5, from: "2020-01-01", reason: "Withholding rate on services proposed at set-up (5%); confirm with your tax adviser, as it depends on the client and the service." },
    ];
    for (const s of specs) {
      const account = await tx.glAccount.findFirst({ where: { organizationId: ctx.orgId, code: s.accountCode }, select: { id: true } });
      const c = await tx.taxCode.create({ data: { organizationId: ctx.orgId, code: s.code, name: s.name, type: s.type, accountCode: account ? s.accountCode : null, isDefault: true, createdBy: ctx.name } });
      await tx.taxRate.create({ data: { taxCodeId: c.id, ratePct: s.ratePct, effectiveFrom: d(s.from), reason: s.reason, requestedBy: ctx.name, requestedByUserId: ctx.userId } });
    }
    await logAudit(ctx, { action: "TAX_INSTALL_STANDARD", entity: "Organization", entityId: ctx.orgId, newValue: { codes: specs.map((s) => s.code) } }, tx);
  });
}

// ───────────────────────────── Rates ─────────────────────────────

export const rateSchema = z.object({
  ratePct: z.coerce.number(),
  effectiveFrom: z.string().min(10, "Choose the date the rate takes effect"),
  reason: z.string().trim().default(""),
});
export type RateInput = z.input<typeof rateSchema>;

export async function proposeRate(ctx: Ctx, taxCodeId: string, raw: RateInput) {
  assertCan(ctx, "tax.manage");
  const v = rateSchema.parse(raw);
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const code = await loadCode(ctx, tx, taxCodeId);
    const problems = rateProblems({ ratePct: v.ratePct, effectiveFrom: from, reason: v.reason }, code.rates.map(rowOf));
    if (problems.length) throw new BusinessError(problems.slice(0, 2).join(" "));
    if (code.rates.some((r) => r.status === "PENDING")) throw new BusinessError("A rate for this code is already waiting for approval. Decide it first.");
    const rate = await tx.taxRate.create({ data: { taxCodeId, ratePct: v.ratePct, effectiveFrom: from, reason: v.reason.trim(), requestedBy: ctx.name, requestedByUserId: ctx.userId } });
    await logAudit(ctx, { action: "TAX_RATE_PROPOSE", entity: "TaxRate", entityId: rate.id, newValue: { code: code.code, ratePct: v.ratePct, effectiveFrom: v.effectiveFrom }, reason: v.reason }, tx);
    return rate;
  });
}

export async function decideRate(ctx: Ctx, rateId: string, approve: boolean, note?: string) {
  assertCan(ctx, "tax.approve");
  if (!approve && (!note || note.trim().length < 5)) throw new BusinessError("Say why the rate is being turned down.");
  return db.$transaction(async (tx) => {
    const rate = await tx.taxRate.findFirst({ where: { id: rateId, taxCode: { organizationId: ctx.orgId } }, include: { taxCode: { include: { rates: true } } } });
    if (!rate) throw new BusinessError("Rate not found.");
    if (rate.status !== "PENDING") throw new BusinessError("This rate has already been decided.");
    if (rate.requestedByUserId === ctx.userId) throw new BusinessError("You proposed this rate, so someone else has to approve it.");
    const now = new Date();
    if (!approve) {
      const u = await tx.taxRate.update({ where: { id: rateId }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: note!.trim() } });
      await logAudit(ctx, { action: "TAX_RATE_REJECT", entity: "TaxRate", entityId: rateId, reason: note }, tx);
      return u;
    }
    const approved = rate.taxCode.rates.filter((r) => r.status === "APPROVED" && r.id !== rate.id);
    if (approved.some((r) => r.effectiveFrom >= rate.effectiveFrom)) throw new BusinessError("A rate that starts on or after this date is already approved, so this one can't be slotted in before it. Turn it down and propose it again from a later date.");
    // the rate it replaces ends the day before this one starts
    const previous = approved.filter((r) => !r.effectiveTo).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    if (previous) await tx.taxRate.update({ where: { id: previous.id }, data: { effectiveTo: addDays(rate.effectiveFrom, -1) } });
    const u = await tx.taxRate.update({ where: { id: rateId }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "TAX_RATE_APPROVE", entity: "TaxRate", entityId: rateId, newValue: { code: rate.taxCode.code, ratePct: num(rate.ratePct), effectiveFrom: rate.effectiveFrom.toISOString().slice(0, 10) } }, tx);
    return u;
  });
}

// ───────────────────────────── Reading rates for a document ─────────────────────────────

export interface ResolvedTax {
  taxCodeId: string | null;
  code: string | null;
  ratePct: number;
  /** ENGINE: read from the tax engine by date. TYPED: entered for this run. NONE: no code and nothing typed, so no tax. */
  source: "ENGINE" | "TYPED" | "NONE";
}

/**
 * The rate of one type in force on a date. A typed rate wins; otherwise the rate that day of the code asked for (a billing
 * rule can name one) or, failing that, the default code; otherwise none.
 */
export async function resolveTax(tx: Tx, orgId: string, type: TaxType, date: Date, typed?: number, codeId?: string | null): Promise<ResolvedTax> {
  const code = await tx.taxCode.findFirst({ where: { organizationId: orgId, type, active: true, ...(codeId ? { id: codeId } : { isDefault: true }) }, include: { rates: true } });
  if (codeId && !code) throw new BusinessError("The tax code named by the billing rule is missing or inactive.");
  if (typed !== undefined) return { taxCodeId: code?.id ?? null, code: code?.code ?? null, ratePct: typed, source: "TYPED" };
  if (!code) return { taxCodeId: null, code: null, ratePct: 0, source: "NONE" };
  const rate = rateOn(code.rates.map((r) => ({ ...rowOf(r), id: r.id })), date);
  if (!rate) throw new BusinessError(`No ${type === "VAT" ? "VAT" : "withholding tax"} rate is in force on ${date.toISOString().slice(0, 10)} for ${code.code}. Approve a rate that starts on or before that date (Accounting → Tax Codes & Rates), or type a rate for this run.`);
  return { taxCodeId: code.id, code: code.code, ratePct: rate.ratePct, source: "ENGINE" };
}

// ───────────────────────────── The record of what was taxed ─────────────────────────────

interface InvoiceForTax {
  id: string;
  clientId: string;
  invoiceDate: Date;
  totalIndirectCharge: unknown;
  vatPct: unknown;
  vatAmount: unknown;
  subtotal: unknown;
  whtPct: unknown;
  whtAmount: unknown;
}

/** One taxed amount: what a tax was charged on, at what rate, under which code. */
export interface TaxGroup {
  taxCodeId: string | null;
  taxable: number;
  ratePct: number;
  amount: number;
}

/**
 * Writes the invoice's taxed amounts. Called inside the invoice's own transaction. An invoice whose contracts are billed
 * differently has a group per code, rate and base; without groups the invoice's own totals are recorded as one.
 */
export async function recordInvoiceTax(tx: Tx, orgId: string, inv: InvoiceForTax, codes: { vat: string | null; wht: string | null }, groups?: { vat: TaxGroup[]; wht: TaxGroup[] }) {
  const common = { organizationId: orgId, sourceType: "CLIENT_INVOICE", invoiceId: inv.id, clientId: inv.clientId, taxDate: inv.invoiceDate };
  if (groups) {
    for (const [kind, list] of [["OUTPUT_VAT", groups.vat], ["EXPECTED_WHT", groups.wht]] as const)
      for (const g of list) if (g.amount > 0) await tx.taxTransaction.create({ data: { ...common, kind, taxCodeId: g.taxCodeId, taxableAmount: g.taxable, ratePct: g.ratePct, taxAmount: g.amount } });
    return;
  }
  if (num(inv.vatAmount) > 0)
    await tx.taxTransaction.create({ data: { ...common, kind: "OUTPUT_VAT", taxCodeId: codes.vat, taxableAmount: num(inv.totalIndirectCharge), ratePct: num(inv.vatPct), taxAmount: num(inv.vatAmount) } });
  if (num(inv.whtAmount) > 0)
    await tx.taxTransaction.create({ data: { ...common, kind: "EXPECTED_WHT", taxCodeId: codes.wht, taxableAmount: num(inv.subtotal), ratePct: num(inv.whtPct), taxAmount: num(inv.whtAmount) } });
}

/** Marks an invoice's tax records reversed (it was cancelled). */
export async function reverseInvoiceTax(tx: Tx, invoiceId: string) {
  await tx.taxTransaction.updateMany({ where: { invoiceId, reversed: false }, data: { reversed: true, reversedAt: new Date() } });
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listTaxCodes(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const codes = await db.taxCode.findMany({ where: { organizationId: ctx.orgId }, include: { rates: { orderBy: { effectiveFrom: "desc" } } }, orderBy: [{ type: "asc" }, { code: "asc" }] });
  return codes.map((c) => ({ ...c, current: rateOn(c.rates.map((r) => ({ ...rowOf(r), id: r.id })), today) }));
}

export async function pendingRates(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  return db.taxRate.findMany({ where: { status: "PENDING", taxCode: { organizationId: ctx.orgId } }, include: { taxCode: { select: { code: true, name: true } } }, orderBy: { createdAt: "asc" } });
}

/** What invoices would use today, for the invoicing form. */
export async function defaultsOn(ctx: Ctx, date: Date) {
  assertCan(ctx, "gl.view");
  const out: Record<TaxType, ResolvedTax | { error: string }> = { VAT: { taxCodeId: null, code: null, ratePct: 0, source: "NONE" }, WHT: { taxCodeId: null, code: null, ratePct: 0, source: "NONE" } };
  for (const t of TYPES) {
    try {
      out[t] = await resolveTax(db, ctx.orgId, t, date);
    } catch (e) {
      out[t] = { error: e instanceof BusinessError ? e.message : "Could not read the rate." };
    }
  }
  return out;
}

/** VAT charged and withholding expected on invoices dated in a range, by month, and what clients have actually withheld. */
export async function taxReport(ctx: Ctx, range: { from: Date; to: Date }) {
  assertCan(ctx, "gl.view");
  const where = { organizationId: ctx.orgId, reversed: false, taxDate: { gte: range.from, lte: range.to } };
  const rows = await db.taxTransaction.findMany({ where, include: { invoice: { select: { id: true, invoiceNumber: true, client: { select: { id: true, name: true } } } } }, orderBy: { taxDate: "asc" } });
  const months = new Map<string, { month: string; vatTaxable: number; vat: number; whtExpected: number; invoices: Set<string> }>();
  const clients = new Map<string, { clientId: string; name: string; vat: number; whtExpected: number }>();
  for (const r of rows) {
    const month = r.taxDate.toISOString().slice(0, 7);
    const m = months.get(month) ?? { month, vatTaxable: 0, vat: 0, whtExpected: 0, invoices: new Set<string>() };
    const c = clients.get(r.clientId ?? "") ?? { clientId: r.clientId ?? "", name: r.invoice?.client.name ?? "—", vat: 0, whtExpected: 0 };
    if (r.kind === "OUTPUT_VAT") {
      m.vatTaxable += num(r.taxableAmount);
      m.vat += num(r.taxAmount);
      c.vat += num(r.taxAmount);
    } else {
      m.whtExpected += num(r.taxAmount);
      c.whtExpected += num(r.taxAmount);
    }
    if (r.invoiceId) m.invoices.add(r.invoiceId);
    months.set(month, m);
    clients.set(c.clientId, c);
  }
  const withheld = await db.clientInvoiceDeduction.aggregate({ where: { organizationId: ctx.orgId, type: "WITHHOLDING_TAX", createdAt: { gte: range.from, lte: new Date(range.to.getTime() + 86_400_000 - 1) } }, _sum: { amount: true } });
  // all-time tie-out: VAT on live invoices against the VAT payable the invoice journals booked, net of cancellations
  const [liveVat, booked] = await Promise.all([
    db.taxTransaction.aggregate({ where: { organizationId: ctx.orgId, kind: "OUTPUT_VAT", reversed: false }, _sum: { taxAmount: true } }),
    db.journalLine.aggregate({ where: { journal: { organizationId: ctx.orgId, source: { in: ["AR_INVOICE", "AR_INVOICE_CANCEL", "AR_CREDIT_NOTE", "AR_DEBIT_NOTE"] } }, account: { organizationId: ctx.orgId, code: "2190" } }, _sum: { credit: true, debit: true } }),
  ]);
  const taxRecords = num(liveVat._sum.taxAmount);
  const ledger = num(booked._sum.credit) - num(booked._sum.debit);
  return {
    months: [...months.values()].map((m) => ({ ...m, invoices: m.invoices.size })).sort((a, b) => a.month.localeCompare(b.month)),
    clients: [...clients.values()].sort((a, b) => b.vat + b.whtExpected - (a.vat + a.whtExpected)),
    whtWithheld: num(withheld._sum.amount),
    tieOut: { taxRecords, ledger, difference: Math.round((taxRecords - ledger) * 100) / 100 },
  };
}
