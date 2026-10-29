/**
 * The quote as the client sees it: the sites, posts, number of guards, the monthly rate for each guard and the monthly totals, the validity, and any
 * notes. It never carries the company's cost, margin, rules or how the price was built. Amounts are written "NGN 1,234.00" because the standard PDF fonts
 * have no naira sign. It is laid out as plain blocks first (testable without a PDF reader), then drawn by the shared drawing code.
 */
import { blocksPdf, type Block } from "../proposal-pdf";
import { money } from "../payslip-pdf";

export interface QuoteDoc {
  companyName: string;
  number: string;
  versionNo: number;
  accountName: string;
  issuedOn: string;
  validUntil: string | null;
  notes: string | null;
  rows: Array<{ siteName: string; siteAddress: string | null; postLabel: string | null; shiftPattern: string | null; headcount: number; billPerHead: string; monthly: string }>;
  total: string;
  draft: boolean;
}

export const QUOTE_STANDING_NOTE = "This quote is an offer for the posts and monthly rates shown. It is open until the date above. Amounts exclude VAT unless stated.";

const day = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m) - 1]} ${y}`;
};

export function quoteBlocks(q: QuoteDoc): Block[] {
  return [
    ...(q.draft ? ([{ kind: "text", text: "DRAFT: not yet sent. This is not an offer." }] as Block[]) : []),
    { kind: "title", text: `Quote ${q.number}${q.versionNo > 1 ? ` (version ${q.versionNo})` : ""}` },
    { kind: "text", text: `${q.companyName}  |  ${day(q.issuedOn)}${q.validUntil ? `  |  Open until ${day(q.validUntil)}` : ""}` },
    { kind: "gap" },
    { kind: "heading", text: "Prepared for" },
    { kind: "text", text: q.accountName },
    { kind: "gap" },
    { kind: "heading", text: "Posts and monthly rates" },
    { kind: "row", cells: ["Site, post and guards", "Per guard a month", "Monthly"], bold: true },
    ...q.rows.map<Block>((r) => ({
      kind: "row",
      cells: [[r.siteName, r.postLabel, r.shiftPattern, `${r.headcount} guard${r.headcount === 1 ? "" : "s"}`].filter(Boolean).join(", "), money(Number(r.billPerHead)), money(Number(r.monthly))],
    })),
    { kind: "row", cells: ["Total a month", "", money(Number(q.total))], bold: true },
    ...(q.notes ? ([{ kind: "gap" }, { kind: "heading", text: "Notes" }, { kind: "text", text: q.notes }] as Block[]) : []),
    { kind: "gap" },
    { kind: "text", text: QUOTE_STANDING_NOTE },
  ];
}

export const quoteLines = (q: QuoteDoc): string[] =>
  quoteBlocks(q).flatMap((b) => (b.kind === "gap" ? [] : b.kind === "row" ? [b.cells.filter(Boolean).join("  ")] : [b.text]));

export function quotePdf(q: QuoteDoc): Promise<Uint8Array> {
  return blocksPdf(quoteBlocks(q), { title: `Quote ${q.number} for ${q.accountName}`, author: q.companyName, footer: `${q.companyName}  |  Quote ${q.number}` });
}
