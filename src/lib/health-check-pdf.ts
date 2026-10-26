/**
 * The one-page summary of a health check. No database here.
 *
 * Everything on it is process evidence: how many controls were seen in place, in part or not seen, and the findings with what to do about them,
 * most serious first. It does not score the business or call it compliant. It always carries the disclaimer that this is a limited review and that
 * detailed reviews are separately scoped. It stays on one page: findings are drawn, most serious first, for as long as they fit above the
 * disclaimer, and the rest are counted and left to the full findings log.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { pdfSafe } from "./payslip-pdf";
import { AREA_LABELS, DISCLAIMER, SEVERITY_LABELS, summarise, type FindingFacts, type ItemFacts } from "./health-check";

export type SummaryDoc = {
  bureauName: string;
  number: string;
  company: string;
  contact: string;
  title: string;
  issuedOn: string | null;
  conductedOn: string | null;
  periodReviewed: string | null;
  employeesInScope: number | null;
  scopeNote: string | null;
  assessedBy: string;
  reviewedBy: string | null;
  headline: string | null;
  items: ItemFacts[];
  findings: FindingFacts[];
  /** An unissued check is stamped as a draft so it can't be mistaken for the finished summary. */
  draft: boolean;
};

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.48);
const RULE = rgb(0.8, 0.82, 0.85);
const SEV = { HIGH: rgb(0.72, 0.1, 0.1), MEDIUM: rgb(0.75, 0.45, 0.0), LOW: rgb(0.2, 0.4, 0.7), OBSERVATION: rgb(0.4, 0.43, 0.48) };
const PAGE = { w: 595.28, h: 841.89 };
const M = 42;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of pdfSafe(text).split(/\s+/).filter(Boolean)) {
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

/** The plain-text content in reading order (every finding, whether or not it fits the page), for tests and previews. */
export function summaryLines(d: SummaryDoc): string[] {
  const s = summarise(d.items, d.findings);
  return [
    ...(d.draft ? ["DRAFT: not yet reviewed or issued."] : []),
    "Payroll Health Check: summary",
    `${d.company} | ${d.number}`,
    `Controls assessed: ${s.totals.total - s.totals.notApplicable - s.totals.notAssessed} | seen in place ${s.totals.inPlace} | seen in part ${s.totals.partly} | not seen ${s.totals.notSeen} | not applicable ${s.totals.notApplicable}`,
    ...s.areas.map((a) => `${a.label}: in place ${a.inPlace}, in part ${a.partly}, not seen ${a.notSeen}`),
    ...s.ordered.map((f) => `${SEVERITY_LABELS[f.severity]}: ${f.title} | ${f.recommendation}`),
    DISCLAIMER,
  ];
}

/** Draws the summary. `shown` of the `total` findings fit on the page; the rest are counted on it. */
export async function summaryPdf(d: SummaryDoc): Promise<{ bytes: Uint8Array; shown: number; total: number }> {
  const s = summarise(d.items, d.findings);
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Payroll Health Check ${d.number} for ${d.company}`));
  doc.setAuthor(pdfSafe(d.bureauName));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const W = PAGE.w - 2 * M;
  let y = PAGE.h - M;
  const text = (t: string, x: number, size: number, f: PDFFont = font, color = INK) => page.drawText(pdfSafe(t), { x, y, size, font: f, color });
  const rule = () => page.drawLine({ start: { x: M, y: y + 3 }, end: { x: PAGE.w - M, y: y + 3 }, thickness: 0.5, color: RULE });
  const para = (t: string, size = 9, f: PDFFont = font, color = INK, gap = 3) => {
    for (const l of wrap(t, f, size, W)) {
      y -= size + 3;
      text(l, M, size, f, color);
    }
    y -= gap;
  };

  // the disclaimer sits at the foot of the page, always; nothing may be drawn below the line above it
  const disclaimer = wrap(DISCLAIMER, font, 8, W);
  const floor = M + 16 + disclaimer.length * 11 + 12;

  if (d.draft) {
    y -= 10;
    text("DRAFT: not yet reviewed or issued", M, 9, bold, SEV.HIGH);
  }
  y -= 20;
  text("Payroll Health Check: summary", M, 17, bold);
  y -= 15;
  text(`${d.bureauName}  |  ${d.number}${d.issuedOn ? `  |  Issued ${d.issuedOn}` : ""}`, M, 9, font, MUTED);
  y -= 22;
  text("Prepared for", M, 8.5, bold, MUTED);
  y -= 12;
  text(`${d.company}  (${d.contact})`, M, 10.5, bold);
  y -= 14;
  const facts = [d.periodReviewed ? `Period reviewed: ${d.periodReviewed}` : null, d.employeesInScope ? `Employees in scope: ${d.employeesInScope}` : null, d.conductedOn ? `Review carried out: ${d.conductedOn}` : null, `Assessed by ${d.assessedBy}${d.reviewedBy ? `; reviewed by ${d.reviewedBy}` : ""}`].filter(Boolean) as string[];
  para(facts.join("   |   "), 8.5, font, MUTED, 2);
  if (d.scopeNote) para(`Scope: ${clip(d.scopeNote, 320)}`, 8.5, font, INK, 2);
  if (d.headline) para(clip(d.headline, 380), 9.5, bold, INK, 4);

  // the five areas: how many controls were seen in place, in part, or not seen
  y -= 6;
  text("What was seen, by area", M, 10.5, bold);
  y -= 4;
  rule();
  const cols = [M + W - 210, M + W - 150, M + W - 90, M + W - 30];
  y -= 13;
  ["In place", "In part", "Not seen", "N/A"].forEach((h, i) => text(h, cols[i] - font.widthOfTextAtSize(pdfSafe(h), 8) + 18, 8, bold, MUTED));
  for (const a of s.areas) {
    y -= 14;
    text(AREA_LABELS[a.area], M, 9);
    [a.inPlace, a.partly, a.notSeen, a.notApplicable].forEach((n, i) => text(String(n), cols[i] + 10, 9, i === 2 && n > 0 ? bold : font, i === 2 && n > 0 ? SEV.HIGH : INK));
  }
  y -= 14;
  rule();
  y -= 11;
  text("All areas", M, 9, bold);
  [s.totals.inPlace, s.totals.partly, s.totals.notSeen, s.totals.notApplicable].forEach((n, i) => text(String(n), cols[i] + 10, 9, bold));

  // the findings, most serious first, for as long as they fit
  y -= 22;
  text(`Findings and what to do (${s.ordered.length})`, M, 10.5, bold);
  y -= 4;
  rule();
  let shown = 0;
  for (const f of s.ordered) {
    const title = wrap(f.title, bold, 9, W - 66).slice(0, 2);
    const rec = wrap(`Recommendation: ${clip(f.recommendation, 230)}`, font, 8.5, W - 66).slice(0, 3);
    const needed = 5 + 11 * (title.length + rec.length);
    // leave room for the "further findings" line if this is not the last one
    if (y - needed < floor + (shown + 1 < s.ordered.length ? 16 : 0)) break;
    y -= 5;
    y -= 11;
    text(SEVERITY_LABELS[f.severity].toUpperCase(), M, 7.5, bold, SEV[f.severity]);
    title.forEach((l, i) => {
      if (i > 0) y -= 11;
      text(l, M + 66, 9, bold);
    });
    for (const l of rec) {
      y -= 11;
      text(l, M + 66, 8.5, font, INK);
    }
    shown++;
  }
  if (!s.ordered.length) {
    y -= 14;
    text("No findings were recorded.", M, 9, font, MUTED);
  } else if (shown < s.ordered.length) {
    y -= 15;
    text(`${s.ordered.length - shown} further finding(s) are in the full findings log.`, M, 8.5, font, MUTED);
  }

  page.drawLine({ start: { x: M, y: floor - 4 }, end: { x: PAGE.w - M, y: floor - 4 }, thickness: 0.5, color: RULE });
  let fy = floor - 14;
  for (const l of disclaimer) {
    page.drawText(l, { x: M, y: fy, size: 8, font, color: MUTED });
    fy -= 11;
  }
  return { bytes: await doc.save(), shown, total: s.ordered.length };
}
