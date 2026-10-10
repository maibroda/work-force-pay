/**
 * Pure rules for client receipts and their allocation to invoices. No database here.
 *
 * A client receipt is cash in (and perhaps tax the client withheld) that may settle several invoices at once. Whatever is
 * not applied stays with the receipt as an advance, to be applied to invoices later or refunded. Money is in kobo
 * throughout so nothing drifts.
 */

const cents = (n: number) => Math.round(n * 100);
const naira = (c: number) => (c / 100).toFixed(2);

export interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  dueDate: Date;
  /** What is still owed on it. */
  balance: number;
}

export interface AllocationInput {
  invoiceId: string;
  cash: number;
  wht: number;
}

/** What a receipt still has to give: cash and withheld tax not yet applied, and what has been (or is being) refunded. */
export function receiptPosition(r: { amount: number; whtWithheld: number }, active: Array<{ cash: number; wht: number }>, refunded: number) {
  const cashApplied = active.reduce((s, a) => s + cents(a.cash), 0);
  const whtApplied = active.reduce((s, a) => s + cents(a.wht), 0);
  const cashLeft = cents(r.amount) - cashApplied - cents(refunded);
  const whtLeft = cents(r.whtWithheld) - whtApplied;
  return { cashApplied: cashApplied / 100, whtApplied: whtApplied / 100, cashLeft: cashLeft / 100, whtLeft: whtLeft / 100, held: (cashLeft + whtLeft) / 100 };
}

/**
 * Everything wrong with a set of allocations, as plain sentences. `cashAvailable` and `whtAvailable` are what the receipt can
 * still give; `requireAllWht` is true when the receipt is being recorded, when the tax withheld has to be applied in full.
 */
export function allocationProblems(
  allocations: AllocationInput[],
  invoices: Map<string, { invoiceNumber: string; balance: number }>,
  available: { cash: number; wht: number },
  requireAllWht: boolean,
): string[] {
  const out: string[] = [];
  const used = allocations.filter((a) => cents(a.cash) !== 0 || cents(a.wht) !== 0);
  if (!used.length && requireAllWht && cents(available.wht) > 0) out.push("The tax withheld has to be applied to the invoices it was withheld on.");
  const seen = new Set<string>();
  for (const a of used) {
    const inv = invoices.get(a.invoiceId);
    if (!inv) {
      out.push("An allocation names an invoice that isn't open for this client.");
      continue;
    }
    if (seen.has(a.invoiceId)) out.push(`${inv.invoiceNumber} appears twice.`);
    seen.add(a.invoiceId);
    if (cents(a.cash) < 0 || cents(a.wht) < 0) out.push(`${inv.invoiceNumber}: amounts can't be negative.`);
    if (cents(a.cash) + cents(a.wht) > cents(inv.balance)) out.push(`${inv.invoiceNumber}: ${naira(cents(a.cash) + cents(a.wht))} is more than the ${naira(cents(inv.balance))} still owed on it.`);
  }
  const cash = used.reduce((s, a) => s + cents(a.cash), 0);
  const wht = used.reduce((s, a) => s + cents(a.wht), 0);
  if (cash > cents(available.cash)) out.push(`Cash applied (${naira(cash)}) is more than the ${naira(cents(available.cash))} the receipt has left.`);
  if (wht > cents(available.wht)) out.push(`Tax withheld applied (${naira(wht)}) is more than the ${naira(cents(available.wht))} withheld.`);
  if (requireAllWht && wht !== cents(available.wht)) out.push(`All of the tax withheld (${naira(cents(available.wht))}) has to be applied to invoices, but ${naira(wht)} is.`);
  return out;
}

/**
 * Applies cash (and withheld tax) to the oldest invoices first, by due date then number, up to what is left on each. Whatever
 * can't be applied (more cash than is owed) stays unapplied for the caller to hold as an advance.
 */
export function autoAllocate(invoices: OpenInvoice[], cash: number, wht: number): AllocationInput[] {
  let cashLeft = cents(cash);
  let whtLeft = cents(wht);
  const out: AllocationInput[] = [];
  const ordered = [...invoices].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.invoiceNumber.localeCompare(b.invoiceNumber));
  for (const inv of ordered) {
    if (cashLeft <= 0 && whtLeft <= 0) break;
    let room = cents(inv.balance);
    const w = Math.min(whtLeft, room);
    room -= w;
    const c = Math.min(cashLeft, room);
    if (c + w <= 0) continue;
    cashLeft -= c;
    whtLeft -= w;
    out.push({ invoiceId: inv.id, cash: c / 100, wht: w / 100 });
  }
  return out;
}

/** The status an invoice takes from what has settled it. */
export function invoiceStatus(total: number, paid: number, deductions: number): "ISSUED" | "PARTIALLY_PAID" | "PAID" {
  const settled = cents(paid) + cents(deductions);
  if (settled >= cents(total)) return "PAID";
  return settled > 0 ? "PARTIALLY_PAID" : "ISSUED";
}
