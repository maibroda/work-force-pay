/**
 * A proposal as a PDF. No database here.
 *
 * It carries what the client needs to decide: what is included, what they must do, what it costs (with VAT shown separately), how long the
 * offer stays open, and a place to accept. It never promises a result: the standing note says the proposal describes a service and a price and
 * is not a guarantee. Amounts are written "NGN 1,234.00" because the standard PDF fonts have no naira sign. The document is first laid out as
 * plain lines (testable without a PDF reader), then drawn.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { money, pdfSafe } from "./payslip-pdf";
import type { Quote } from "./pricing";

export type ProposalDoc = {
  bureauName: string;
  number: string;
  issuedOn: string;
  validUntil: string | null;
  preparedFor: { company: string; contact: string; role?: string | null };
  quote: Quote;
  /** True for a draft that has not been sent, so it can't be mistaken for an offer. */
  draft?: boolean;
};

export const NO_GUARANTEE =
  "This proposal describes a service and its price. It is not a guarantee of any result. Your payroll is prepared from the information you give us; you remain responsible for approving it, for funding it, and for the accuracy of what you send.";

export type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "row"; cells: string[]; bold?: boolean }
  | { kind: "gap" };

const date = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m) - 1]} ${y}`;
};

/** The proposal as ordered blocks of text. */
export function proposalBlocks(p: ProposalDoc): Block[] {
  const q = p.quote;
  const rows: Block[] = [
    { kind: "row", cells: ["", "Monthly", "One-off"], bold: true },
    { kind: "row", cells: [`${q.package.name} (${q.headcount} employees, ${q.package.basis === "MINIMUM" ? "monthly minimum applies" : "per-employee fee"})`, money(q.package.monthly), q.package.onboarding ? money(q.package.onboarding) : "-"] },
    ...q.addOns.map<Block>((a) => ({ kind: "row", cells: [a.name, money(a.monthly), a.onboarding ? money(a.onboarding) : "-"] })),
  ];
  // the reason for a discount is for us, not the prospect: it stays on the internal page and out of the document
  if (q.discount > 0) rows.push({ kind: "row", cells: [`Discount (${q.discountPct}%)`, `-${money(q.discount)}`, "-"] });
  rows.push(
    { kind: "row", cells: ["Total, excluding VAT", money(q.monthlyFee), money(q.onboardingFee)], bold: true },
    { kind: "row", cells: [`VAT at ${q.vatRatePct}%`, money(q.vat), money(q.onboardingVat)] },
    { kind: "row", cells: ["Total, including VAT", money(q.monthlyWithVat), money(q.onboardingFee + q.onboardingVat)], bold: true },
  );
  return [
    ...(p.draft ? ([{ kind: "text", text: "DRAFT: not yet sent. This is not an offer." }] as Block[]) : []),
    { kind: "title", text: `Proposal ${p.number}` },
    { kind: "text", text: `${p.bureauName}  |  ${date(p.issuedOn)}${p.validUntil ? `  |  Open until ${date(p.validUntil)}` : ""}` },
    { kind: "gap" },
    { kind: "heading", text: "Prepared for" },
    { kind: "text", text: `${p.preparedFor.company}` },
    { kind: "text", text: `${p.preparedFor.contact}${p.preparedFor.role ? `, ${p.preparedFor.role}` : ""}` },
    { kind: "gap" },
    { kind: "heading", text: `What is included: ${q.package.name}` },
    ...q.scope.map<Block>((s) => ({ kind: "bullet", text: s })),
    ...(q.addOns.length
      ? ([{ kind: "gap" }, { kind: "heading", text: "Add-ons" }, ...q.addOns.map<Block>((a) => ({ kind: "bullet", text: a.description ? `${a.name}: ${a.description}` : a.name }))] as Block[])
      : []),
    { kind: "gap" },
    { kind: "heading", text: "Fees" },
    ...rows,
    { kind: "text", text: `Term: ${q.termMonths} months. Fees are monthly, invoiced in advance of each month's payroll, and the one-off fee covers set-up. Over the term the fees come to ${money(q.contractValue)}, excluding VAT.` },
    { kind: "text", text: `VAT: the fees above exclude VAT, which is added to each invoice at the rate in force (currently ${q.vatRatePct}%).` },
    { kind: "gap" },
    { kind: "heading", text: "What we need from you" },
    ...q.responsibilities.map<Block>((s) => ({ kind: "bullet", text: s })),
    { kind: "gap" },
    { kind: "heading", text: "Please note" },
    { kind: "text", text: NO_GUARANTEE },
    { kind: "gap" },
    { kind: "heading", text: "Acceptance" },
    { kind: "text", text: `To accept, sign below and return a copy to ${p.bureauName}.` },
    { kind: "text", text: "Name: ______________________    Signature: ______________________    Date: ______________" },
  ];
}

/** The same content as plain lines, for tests and previews. */
export function proposalLines(p: ProposalDoc): string[] {
  return proposalBlocks(p).flatMap((b) => (b.kind === "gap" ? [""] : b.kind === "row" ? [b.cells.join("  |  ")] : b.kind === "bullet" ? [`- ${b.text}`] : [b.text]));
}

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.48);
const RULE = rgb(0.8, 0.82, 0.85);
const PAGE = { w: 595.28, h: 841.89 };
const M = 50;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of pdfSafe(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Any document laid out as blocks, drawn as a PDF (the proposal and the sales quote both use it). */
export async function blocksPdf(blocks: Block[], meta: { title: string; author: string; footer: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(meta.title));
  doc.setAuthor(pdfSafe(meta.author));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M;
  const width = PAGE.w - 2 * M;
  const need = (h: number) => {
    if (y - h < M + 20) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - M;
    }
  };

  for (const b of blocks) {
    if (b.kind === "gap") {
      y -= 8;
      continue;
    }
    if (b.kind === "title") {
      need(30);
      page.drawText(pdfSafe(b.text), { x: M, y: y - 16, size: 18, font: bold, color: INK });
      y -= 28;
    } else if (b.kind === "heading") {
      need(26);
      page.drawText(pdfSafe(b.text), { x: M, y: y - 11, size: 11.5, font: bold, color: INK });
      page.drawLine({ start: { x: M, y: y - 16 }, end: { x: PAGE.w - M, y: y - 16 }, thickness: 0.6, color: RULE });
      y -= 24;
    } else if (b.kind === "text" || b.kind === "bullet") {
      const indent = b.kind === "bullet" ? 12 : 0;
      const lines = wrap(b.text, font, 9.5, width - indent);
      need(lines.length * 13);
      lines.forEach((l, i) => {
        if (b.kind === "bullet" && i === 0) page.drawText("-", { x: M + 2, y: y - 10, size: 9.5, font, color: MUTED });
        page.drawText(l, { x: M + indent, y: y - 10, size: 9.5, font, color: INK });
        y -= 13;
      });
      y -= 2;
    } else if (b.kind === "row") {
      const f = b.bold ? bold : font;
      const colW = [width - 2 * 110, 110, 110];
      const label = wrap(b.cells[0], f, 9.5, colW[0] - 8);
      need(label.length * 13 + 4);
      label.forEach((l, i) => {
        page.drawText(l, { x: M, y: y - 10 - i * 13, size: 9.5, font: f, color: INK });
      });
      // the two money columns are right-aligned to their own edge
      [1, 2].forEach((c) => {
        const t = pdfSafe(b.cells[c] ?? "");
        const rightEdge = M + width - (c === 1 ? 110 : 0);
        page.drawText(t, { x: rightEdge - f.widthOfTextAtSize(t, 9.5), y: y - 10, size: 9.5, font: f, color: INK });
      });
      y -= label.length * 13 + 3;
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: PAGE.w - M, y: y + 1 }, thickness: 0.3, color: RULE });
    }
  }
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(pdfSafe(`${meta.footer}  |  Page ${i + 1} of ${pages.length}`), { x: M, y: 28, size: 8, font, color: MUTED });
  });
  return doc.save();
}

export function proposalPdf(p: ProposalDoc): Promise<Uint8Array> {
  return blocksPdf(proposalBlocks(p), { title: `Proposal ${p.number} for ${p.preparedFor.company}`, author: p.bureauName, footer: `${p.bureauName}  |  Proposal ${p.number}` });
}
