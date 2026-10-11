/**
 * Pure rules for matching a vendor bill to its purchase order and to what was actually received. No database here.
 *
 * A bill line against an order line is fine when the quantity billed is no more than what was received (and ordered), and the
 * price is no more than the ordered price. Both have a tolerance the organization sets. A bill that fails any test is an
 * "exception": it can't be paid until a second person approves it. Money is in kobo and quantities in hundredths, so nothing drifts.
 */

export type MatchTolerance = { pricePct: number; qtyPct: number };
export const DEFAULT_TOLERANCE: MatchTolerance = { pricePct: 1, qtyPct: 0 };
export const DEFAULT_BILL_APPROVAL_THRESHOLD = 500000;

export type MatchCode = "UNORDERED_LINE" | "OVER_ORDERED" | "NOT_RECEIVED" | "PRICE_OVER" | "NO_ORDER_OVER_LIMIT" | "POSSIBLE_DUPLICATE";
export type MatchException = { code: MatchCode; message: string; lineIndex?: number };

export const MATCH_CODE_LABELS: Record<MatchCode, string> = {
  UNORDERED_LINE: "Not on the order",
  OVER_ORDERED: "More than ordered",
  NOT_RECEIVED: "Not yet received",
  PRICE_OVER: "Price above the order",
  NO_ORDER_OVER_LIMIT: "No order, over the limit",
  POSSIBLE_DUPLICATE: "Possible duplicate",
};

export type OrderLineFacts = { id: string; description: string; quantity: number; rate: number };
export type BillLineFacts = { orderLineId?: string | null; description: string; quantity: number; rate: number };

const hundredths = (n: number) => Math.round(n * 100);
const kobo = (n: number) => Math.round(n * 100);
const qtyText = (h: number) => (h / 100).toString();
const nairaText = (k: number) => (k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whether `billed` is within `allowed` plus a percentage, compared in whole units so rounding never decides it. */
function within(billed: number, allowed: number, pct: number) {
  return billed * 10000 <= allowed * Math.round(10000 + pct * 100);
}

/**
 * The exceptions for a bill against an order. `received` is the total received per order line (receipts that are not cancelled).
 * An empty result means the bill matches.
 */
export function matchBill(input: {
  orderLines: OrderLineFacts[];
  received: Record<string, number>;
  billLines: BillLineFacts[];
  tolerance?: MatchTolerance;
}): MatchException[] {
  const tol = input.tolerance ?? DEFAULT_TOLERANCE;
  const byId = new Map(input.orderLines.map((l) => [l.id, l]));
  const out: MatchException[] = [];
  // a bill may carry several lines for one order line: tests are on the total billed for it
  const billedByOrderLine = new Map<string, number>();
  input.billLines.forEach((l) => {
    if (l.orderLineId) billedByOrderLine.set(l.orderLineId, (billedByOrderLine.get(l.orderLineId) ?? 0) + hundredths(l.quantity));
  });

  input.billLines.forEach((l, i) => {
    if (!l.orderLineId || !byId.has(l.orderLineId)) {
      out.push({ code: "UNORDERED_LINE", lineIndex: i, message: `"${l.description}" is not a line on the purchase order.` });
      return;
    }
    const o = byId.get(l.orderLineId)!;
    if (kobo(l.rate) * 10000 > kobo(o.rate) * Math.round(10000 + tol.pricePct * 100)) {
      out.push({
        code: "PRICE_OVER",
        lineIndex: i,
        message: `"${l.description}" is billed at ${nairaText(kobo(l.rate))}, the order says ${nairaText(kobo(o.rate))} (more than ${tol.pricePct}% above).`,
      });
    }
  });

  for (const [id, billed] of billedByOrderLine) {
    const o = byId.get(id);
    if (!o) continue;
    const ordered = hundredths(o.quantity);
    const got = hundredths(input.received[id] ?? 0);
    if (!within(billed, ordered, tol.qtyPct)) {
      out.push({ code: "OVER_ORDERED", message: `"${o.description}": billed ${qtyText(billed)}, only ${qtyText(ordered)} ordered.` });
    }
    if (!within(billed, got, tol.qtyPct)) {
      out.push({
        code: "NOT_RECEIVED",
        message: got === 0 ? `"${o.description}": billed ${qtyText(billed)}, nothing received yet.` : `"${o.description}": billed ${qtyText(billed)}, received ${qtyText(got)}.`,
      });
    }
  }
  return out;
}

/** A bill with no purchase order needs approval at or above the organization's limit (a limit of zero means every such bill). */
export function noOrderException(total: number, threshold: number): MatchException | null {
  if (kobo(total) < kobo(threshold) || (kobo(threshold) === 0 && kobo(total) === 0)) return null;
  return {
    code: "NO_ORDER_OVER_LIMIT",
    message: `This bill (${nairaText(kobo(total))}) has no purchase order and is ${kobo(threshold) === 0 ? "above" : "at or above"} the approval limit of ${nairaText(kobo(threshold))}.`,
  };
}

export type MatchSummary = "NOT_REQUIRED" | "MATCHED" | "EXCEPTION";

/** The status a bill gets from its exceptions: with an order it is MATCHED or EXCEPTION; with none, EXCEPTION or NOT_REQUIRED. */
export function matchStatusFor(hasOrder: boolean, exceptions: MatchException[]): MatchSummary {
  if (exceptions.length) return "EXCEPTION";
  return hasOrder ? "MATCHED" : "NOT_REQUIRED";
}

export type ReceiptProgress = "NONE" | "PARTIAL" | "FULL";

/** How much of an order has been received, counting each line up to what was ordered. */
export function receiptProgress(lines: { quantity: number; received: number }[]): ReceiptProgress {
  const ordered = lines.reduce((a, l) => a + hundredths(l.quantity), 0);
  const got = lines.reduce((a, l) => a + Math.min(hundredths(l.received), hundredths(l.quantity)), 0);
  if (got <= 0) return "NONE";
  return got >= ordered ? "FULL" : "PARTIAL";
}

export const RECEIPT_PROGRESS_LABELS: Record<ReceiptProgress, string> = { NONE: "Nothing received", PARTIAL: "Partly received", FULL: "Fully received" };
