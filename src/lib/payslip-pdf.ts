/**
 * The payslip as a PDF. No database here.
 *
 * A payslip shows the employee's own earnings and deductions only: what the company pays on top (employer pension, ITF, NSITF, insurance) is
 * for the employer reports, never the payslip. Account numbers, the pension PIN and the tax ID are masked to their last four characters, since
 * the file may be forwarded or emailed. The document is first laid out as plain text lines (testable without a PDF reader), then drawn.
 * Amounts are written "NGN 1,234.56": the standard PDF fonts have no naira sign, and a missing glyph on a payslip is worse than a letter code.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type PayslipLine = { type: string; code: string; name: string; amount: number };

export type PayslipInput = {
  orgName: string;
  /** The payroll bureau that prepared it, when there is one. */
  bureauName?: string | null;
  tagline?: string | null;
  employeeNumber: string;
  employeeName: string;
  departmentName: string | null;
  categoryName: string;
  bankName: string | null;
  accountNumber: string | null;
  pensionPin: string | null;
  pfa: string | null;
  taxId: string | null;
  daysWorked: number;
  basisDays: number;
  daysAbsent: number;
  overtimeHours: number;
  monthlyGross: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  taxRuleVersion: string;
  hasOverride: boolean;
  lines: PayslipLine[];
  locations: { clientName: string; beatName: string; days: number }[];
  periodName: string;
  periodStart: string;
  periodEnd: string;
  runType: string;
  runNumber: number;
  generatedOn: string;
};

/** The last four characters, the rest hidden: "******6789". Short values are hidden entirely. */
export function mask(v: string | null | undefined): string {
  if (!v) return "—";
  const s = v.trim();
  return s.length <= 4 ? "*".repeat(s.length) : `${"*".repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}`;
}

export const money = (n: number) => `NGN ${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Text the standard PDF fonts can draw: accents removed, anything outside Latin-1 (and the C1 controls) replaced. */
export function pdfSafe(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e\xa1-\xff]/gu, "?");
}

export type PayslipModel = {
  heading: string;
  subtitle: string;
  details: [string, string][];
  earnings: [string, number][];
  deductions: [string, number][];
  totals: { earnings: number; deductions: number; net: number };
  locations: string[];
  attendance: string;
  notes: string[];
  footer: string;
};

export function payslipModel(p: PayslipInput): PayslipModel {
  const own = p.lines.filter((l) => l.type === "EARNING" || l.type === "DEDUCTION");
  const real = p.locations.filter((l) => l.clientName !== "Head Office");
  const byPlace = new Map<string, number>();
  for (const l of real) byPlace.set(`${l.clientName} - ${l.beatName}`, (byPlace.get(`${l.clientName} - ${l.beatName}`) ?? 0) + l.days);
  return {
    heading: p.orgName,
    subtitle: `Payslip - ${p.periodName}${p.runType === "SUPPLEMENTARY" ? ` (supplementary #${p.runNumber})` : ""}`,
    details: [
      ["Employee no.", p.employeeNumber],
      ["Name", p.employeeName],
      ["Department", p.departmentName ?? "-"],
      ["Category", p.categoryName],
      ["Pay period", `${p.periodStart} to ${p.periodEnd}`],
      ["Bank", p.bankName ? `${p.bankName} ${mask(p.accountNumber)}` : "-"],
      ["Tax ID", mask(p.taxId)],
      ["Pension PIN", mask(p.pensionPin)],
      ["Pension fund", p.pfa ?? "-"],
      ["Monthly gross", money(p.monthlyGross)],
    ],
    earnings: own.filter((l) => l.type === "EARNING").map((l) => [l.name, l.amount]),
    deductions: own.filter((l) => l.type === "DEDUCTION").map((l) => [l.name, l.amount]),
    totals: { earnings: p.totalEarnings, deductions: p.totalDeductions, net: p.netPay },
    locations: [...byPlace.entries()].map(([k, days]) => `${k}: ${days} day(s)`),
    attendance: `Days worked ${p.daysWorked} of ${p.basisDays}; absent ${p.daysAbsent}; overtime ${p.overtimeHours} hour(s)`,
    notes: [...(p.hasOverride ? ["An employee salary override applied this period."] : []), `PAYE computed with rule ${p.taxRuleVersion}.`],
    footer: `${p.bureauName ? `Prepared by ${p.bureauName}${p.tagline ? ` - ${p.tagline}` : ""}. ` : ""}Generated ${p.generatedOn}. Confidential: this payslip contains salary information.`,
  };
}

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const RULE = rgb(0.8, 0.8, 0.84);

/** Draws one payslip on an A4 page and returns the finished PDF. */
export async function renderPayslipPdf(model: PayslipModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${model.heading} ${model.subtitle}`));
  doc.setCreator("WorkforcePay");
  await drawPayslip(doc, model);
  return doc.save();
}

/** Several payslips in one PDF, one per page. */
export async function renderPayslipsPdf(models: PayslipModel[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreator("WorkforcePay");
  for (const m of models) await drawPayslip(doc, m);
  return doc.save();
}

async function drawPayslip(doc: PDFDocument, m: PayslipModel) {
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 48;
  const right = 595.28 - 48;
  let y = 841.89 - 56;

  const text = (s: string, x: number, size = 9.5, f: PDFFont = font, color = INK) => page.drawText(pdfSafe(s), { x, y, size, font: f, color });
  const rightText = (s: string, xRight: number, size = 9.5, f: PDFFont = font) => {
    const t = pdfSafe(s);
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color: INK });
  };
  const rule = (gap = 8) => {
    y -= gap;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: RULE });
    y -= gap + 4;
  };
  const clip = (s: string, f: PDFFont, size: number, max: number) => {
    let t = pdfSafe(s);
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2);
    return t === pdfSafe(s) ? t : `${t}...`;
  };

  text(m.heading, left, 16, bold);
  rightText("PAYSLIP", right, 11, bold);
  y -= 16;
  text(m.subtitle, left, 10, font, MUTED);
  rule();

  // employee details in two columns
  const colW = (right - left) / 2;
  for (let i = 0; i < m.details.length; i += 2) {
    for (const [j, x] of [left, left + colW].entries()) {
      const d = m.details[i + j];
      if (!d) continue;
      page.drawText(pdfSafe(d[0]), { x, y, size: 8.5, font, color: MUTED });
      page.drawText(clip(d[1], bold, 9.5, colW - 96), { x: x + 84, y, size: 9.5, font: bold, color: INK });
    }
    y -= 15;
  }
  rule(4);

  // earnings and deductions side by side
  const mid = left + colW + 12;
  const top = y;
  const column = (x0: number, xr: number, title: string, rows: [string, number][], total: number, totalLabel: string) => {
    let yy = top;
    page.drawText(title, { x: x0, y: yy, size: 8.5, font: bold, color: MUTED });
    yy -= 15;
    for (const [name, amount] of rows) {
      page.drawText(clip(name, font, 9.5, xr - x0 - 90), { x: x0, y: yy, size: 9.5, font, color: INK });
      const t = pdfSafe(amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      page.drawText(t, { x: xr - font.widthOfTextAtSize(t, 9.5), y: yy, size: 9.5, font, color: INK });
      yy -= 14;
    }
    page.drawLine({ start: { x: x0, y: yy + 8 }, end: { x: xr, y: yy + 8 }, thickness: 0.5, color: RULE });
    yy -= 6;
    page.drawText(totalLabel, { x: x0, y: yy, size: 9.5, font: bold, color: INK });
    const t = pdfSafe(total.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    page.drawText(t, { x: xr - bold.widthOfTextAtSize(t, 9.5), y: yy, size: 9.5, font: bold, color: INK });
    return yy;
  };
  const a = column(left, left + colW - 12, "EARNINGS (NGN)", m.earnings, m.totals.earnings, "Total earnings");
  const b = column(mid, right, "DEDUCTIONS (NGN)", m.deductions, m.totals.deductions, "Total deductions");
  y = Math.min(a, b) - 30; // clear of the totals line before the net pay box
  rule(2);

  // net pay
  page.drawRectangle({ x: left, y: y - 8, width: right - left, height: 30, color: rgb(0.95, 0.96, 0.98), borderColor: RULE, borderWidth: 0.6 });
  text("NET PAY", left + 10, 11, bold);
  rightText(money(m.totals.net), right - 10, 13, bold);
  y -= 34;

  if (m.locations.length) {
    text("WORK LOCATIONS", left, 8.5, bold, MUTED);
    y -= 14;
    for (const l of m.locations.slice(0, 8)) {
      text(l, left);
      y -= 13;
    }
    y -= 4;
  }
  text(m.attendance, left, 9, font, MUTED);
  y -= 14;
  for (const n of m.notes) {
    text(n, left, 8.5, font, MUTED);
    y -= 12;
  }

  // footer, wrapped to the page
  const words = pdfSafe(m.footer).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, 8) > right - left) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  let fy = 56 + lines.length * 11;
  for (const l of lines) {
    page.drawText(l, { x: left, y: fy, size: 8, font, color: MUTED });
    fy -= 11;
  }
  page.drawLine({ start: { x: left, y: 56 + lines.length * 11 + 8 }, end: { x: right, y: 56 + lines.length * 11 + 8 }, thickness: 0.5, color: RULE });
}
