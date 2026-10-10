/**
 * Pure rules for a client statement and receivables ageing. No database here.
 *
 * A statement lists what was billed to a client and what settled it, in date order with a running balance, as at a date. The
 * closing balance is what the client owes: the sum of what is outstanding on each invoice, which is also the client's balance
 * in the receivables control account. Ageing puts what is owed into buckets by how long past its due date it is.
 */

const cents = (n: number) => Math.round(n * 100);

export const AGE_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** How many days past due an amount is on a date (negative: not yet due). */
export function daysPastDue(dueDate: Date, asOf: Date): number {
  return Math.round((asOf.getTime() - dueDate.getTime()) / 86_400_000);
}

export function bucketFor(dueDate: Date, asOf: Date): AgeBucket {
  const d = daysPastDue(dueDate, asOf);
  if (d <= 0) return AGE_BUCKETS[0];
  if (d <= 30) return AGE_BUCKETS[1];
  if (d <= 60) return AGE_BUCKETS[2];
  if (d <= 90) return AGE_BUCKETS[3];
  return AGE_BUCKETS[4];
}

export interface StatementInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  total: number;
}

export interface StatementSettlement {
  id: string;
  /** The invoice it settles. */
  invoiceId: string;
  /** When it took effect. */
  date: Date;
  /** When it was reversed, if it was: it counts until then. */
  reversedOn?: Date | null;
  kind: "RECEIPT" | "TAX_WITHHELD" | "DEDUCTION" | "CREDIT_NOTE";
  reference: string;
  amount: number;
}

/** An extra charge on an invoice: a debit note. */
export interface StatementCharge {
  id: string;
  invoiceId: string;
  date: Date;
  reference: string;
  amount: number;
}

export interface StatementLine {
  date: Date;
  type: "INVOICE" | "DEBIT_NOTE" | "RECEIPT" | "TAX_WITHHELD" | "DEDUCTION" | "CREDIT_NOTE";
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface Statement {
  lines: StatementLine[];
  /** What is outstanding on each invoice as at the date, oldest due first (only those still owing). */
  outstanding: Array<{ invoiceId: string; invoiceNumber: string; dueDate: Date; balance: number; daysPastDue: number; bucket: AgeBucket }>;
  /** Advances held for the client (money received and not yet applied), as at the date. */
  advances: number;
  closing: number;
  /** Closing balance less advances held: what the client owes net of what they have paid on account. */
  net: number;
  ageing: Record<AgeBucket, number>;
}

/** Builds a statement as at a date from a client's invoices and what settled them. */
export function buildStatement(invoices: StatementInvoice[], settlements: StatementSettlement[], advances: number, asOf: Date, charges: StatementCharge[] = []): Statement {
  const live = (s: StatementSettlement) => s.date <= asOf && (!s.reversedOn || s.reversedOn > asOf);
  const items: Array<Omit<StatementLine, "balance"> & { order: number }> = [];
  for (const inv of invoices.filter((i) => i.invoiceDate <= asOf))
    items.push({ date: inv.invoiceDate, type: "INVOICE", reference: inv.invoiceNumber, description: `Invoice ${inv.invoiceNumber}, due ${inv.dueDate.toISOString().slice(0, 10)}`, debit: inv.total, credit: 0, order: 0 });
  const numberOf = new Map(invoices.map((i) => [i.id, i.invoiceNumber]));
  const label = { RECEIPT: "Payment received", TAX_WITHHELD: "Tax withheld by client", DEDUCTION: "Deduction applied", CREDIT_NOTE: "Credit note" } as const;
  for (const c of charges.filter((x) => x.date <= asOf)) items.push({ date: c.date, type: "DEBIT_NOTE", reference: c.reference, description: `Debit note against ${numberOf.get(c.invoiceId) ?? "an invoice"}`, debit: c.amount, credit: 0, order: 0 });
  for (const s of settlements.filter(live)) items.push({ date: s.date, type: s.kind, reference: s.reference, description: `${label[s.kind]} against ${numberOf.get(s.invoiceId) ?? "an invoice"}`, debit: 0, credit: s.amount, order: 1 });
  items.sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order || a.reference.localeCompare(b.reference) || a.description.localeCompare(b.description));
  let running = 0;
  const lines: StatementLine[] = items.map((l) => {
    running += cents(l.debit) - cents(l.credit);
    return { date: l.date, type: l.type, reference: l.reference, description: l.description, debit: l.debit, credit: l.credit, balance: running / 100 };
  });

  const ageing = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0])) as Record<AgeBucket, number>;
  const outstanding: Statement["outstanding"] = [];
  for (const inv of invoices.filter((i) => i.invoiceDate <= asOf)) {
    const settled = settlements.filter((s) => s.invoiceId === inv.id && live(s)).reduce((a, s) => a + cents(s.amount), 0);
    const extra = charges.filter((c) => c.invoiceId === inv.id && c.date <= asOf).reduce((a, c) => a + cents(c.amount), 0);
    const left = cents(inv.total) + extra - settled;
    if (left === 0) continue;
    const bucket = bucketFor(inv.dueDate, asOf);
    ageing[bucket] = (cents(ageing[bucket]) + left) / 100;
    outstanding.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, dueDate: inv.dueDate, balance: left / 100, daysPastDue: daysPastDue(inv.dueDate, asOf), bucket });
  }
  outstanding.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.invoiceNumber.localeCompare(b.invoiceNumber));
  const closing = outstanding.reduce((a, o) => a + cents(o.balance), 0) / 100;
  return { lines, outstanding, advances, closing, net: (cents(closing) - cents(advances)) / 100, ageing };
}

/** CSV of a statement, for opening in a spreadsheet. */
export function statementCsv(clientName: string, asOf: Date, s: Statement): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    [q("Statement of account"), q(clientName), q(`as at ${asOf.toISOString().slice(0, 10)}`)],
    [],
    ["Date", "Type", "Reference", "Description", "Debit", "Credit", "Balance"].map(q),
    ...s.lines.map((l) => [q(l.date.toISOString().slice(0, 10)), q(l.type), q(l.reference), q(l.description), l.debit.toFixed(2), l.credit.toFixed(2), l.balance.toFixed(2)]),
    [],
    [q("Closing balance"), "", "", "", "", "", s.closing.toFixed(2)],
    [q("Advances held"), "", "", "", "", "", s.advances.toFixed(2)],
    [q("Net owed"), "", "", "", "", "", s.net.toFixed(2)],
    [],
    ["Ageing", ...AGE_BUCKETS].map(q),
    [q("Amount"), ...AGE_BUCKETS.map((b) => s.ageing[b].toFixed(2))],
  ];
  return rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
}

