/**
 * Payslips as PDFs: one to download, a whole payroll's as a zip, and an option to email each to its employee. Downloading is always available to
 * those allowed to distribute payslips; emailing is off until switched on, only for an approved or locked payroll, once per payslip unless a resend
 * is asked for, and a send that fails is not recorded so it is tried again. Every download and email is audited, because a payslip is salary data.
 */
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { num } from "@/lib/money";
import { payslipModel, renderPayslipPdf, type PayslipInput, type PayslipLine } from "@/lib/payslip-pdf";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getPayslip } from "./payroll";

const OK_RUN = ["APPROVED", "LOCKED", "PAID"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "payslip";

type Rec = NonNullable<Awaited<ReturnType<typeof getPayslip>>>;

async function context(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, bureauOrganization: { select: { name: true } } } });
  return { orgName: org.name, bureauName: org.bureauOrganization?.name ?? null };
}

function inputFrom(rec: Rec, c: { orgName: string; bureauName: string | null }): PayslipInput {
  return {
    orgName: c.orgName,
    bureauName: c.bureauName,
    tagline: c.bureauName === "ThreeRoots Payroll Services" ? "People. Pay. Precision." : null,
    employeeNumber: rec.employeeNumber,
    employeeName: rec.employeeName,
    departmentName: rec.departmentName,
    categoryName: rec.categoryName,
    bankName: rec.bankName,
    accountNumber: rec.accountNumber,
    pensionPin: rec.pensionPin,
    pfa: rec.pfa,
    taxId: rec.taxId,
    daysWorked: num(rec.daysWorked),
    basisDays: rec.basisDays,
    daysAbsent: rec.daysAbsent,
    overtimeHours: num(rec.overtimeHours),
    monthlyGross: num(rec.monthlyGross),
    totalEarnings: num(rec.totalEarnings),
    totalDeductions: num(rec.totalDeductions),
    netPay: num(rec.netPay),
    taxRuleVersion: rec.taxRuleVersion,
    hasOverride: rec.hasOverride,
    lines: rec.lines as PayslipLine[],
    locations: (rec.locations as { clientName: string; beatName: string; days: number }[]) ?? [],
    periodName: rec.run.period.name,
    periodStart: iso(rec.run.period.startDate),
    periodEnd: iso(rec.run.period.endDate),
    runType: rec.run.type,
    runNumber: rec.run.runNumber,
    generatedOn: iso(new Date()),
  };
}

async function pdfFor(rec: Rec, c: { orgName: string; bureauName: string | null }) {
  return Buffer.from(await renderPayslipPdf(payslipModel(inputFrom(rec, c))));
}

const fileNameFor = (rec: Rec) => `payslip-${rec.employeeNumber}-${slug(rec.run.period.name)}${rec.run.type === "SUPPLEMENTARY" ? `-adjustment-${rec.run.runNumber}` : ""}.pdf`;

// ─────────────────────────────── Downloads ───────────────────────────────

/** One payslip as a PDF. Staff who distribute payslips can fetch any; an employee only their own, once the payroll is approved. */
export async function payslipPdf(ctx: Ctx, recordId: string) {
  if (ctx.role === "SUPERVISOR") throw new BusinessError("Payslip not found.");
  if (ctx.role !== "EMPLOYEE") assertCan(ctx, "payslip.distribute");
  const rec = await getPayslip(ctx, recordId);
  if (!rec) throw new BusinessError("Payslip not found.");
  if (ctx.role === "EMPLOYEE" && !OK_RUN.includes(rec.run.status)) throw new BusinessError("Payslip not found.");
  const bytes = await pdfFor(rec, await context(ctx.orgId));
  await logAudit(ctx, { action: "PAYSLIP_PDF_DOWNLOAD", entity: "PayrollRecord", entityId: recordId, newValue: { employee: rec.employeeNumber, period: rec.run.period.name } });
  return { bytes, fileName: fileNameFor(rec) };
}

async function recordsOf(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId }, include: { period: true } });
  if (!run) throw new BusinessError("Payroll run not found.");
  if (!OK_RUN.includes(run.status)) throw new BusinessError("Payslips are distributed once the payroll is approved.");
  const recs = await db.payrollRecord.findMany({ where: { runId, organizationId: ctx.orgId }, select: { id: true }, orderBy: { employeeNumber: "asc" } });
  return { run, ids: recs.map((r) => r.id) };
}

/** Every payslip of a payroll in one zip, a PDF each. */
export async function payslipsZip(ctx: Ctx, runId: string) {
  assertCan(ctx, "payslip.distribute");
  const { run, ids } = await recordsOf(ctx, runId);
  const c = await context(ctx.orgId);
  const zip = new JSZip();
  for (const id of ids) {
    const rec = await getPayslip(ctx, id);
    if (rec) zip.file(fileNameFor(rec), await pdfFor(rec, c));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const fileName = `payslips-${slug(run.period.name)}${run.type === "SUPPLEMENTARY" ? `-adjustment-${run.runNumber}` : ""}.zip`;
  await logAudit(ctx, { action: "PAYSLIPS_ZIP_DOWNLOAD", entity: "PayrollRun", entityId: runId, newValue: { payslips: ids.length, fileName } });
  return { buffer, fileName, count: ids.length };
}

// ─────────────────────────────── Email ───────────────────────────────

export async function getPayslipSetting(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  return { emailEnabled: (await db.payslipSetting.findUnique({ where: { organizationId: ctx.orgId } }))?.emailEnabled ?? false };
}

export async function setPayslipEmail(ctx: Ctx, enabled: boolean) {
  assertCan(ctx, "settings.manage");
  await db.payslipSetting.upsert({ where: { organizationId: ctx.orgId }, create: { organizationId: ctx.orgId, emailEnabled: enabled, updatedBy: ctx.name }, update: { emailEnabled: enabled, updatedBy: ctx.name } });
  await logAudit(ctx, { action: "PAYSLIP_EMAIL_SETTING", entity: "PayslipSetting", entityId: ctx.orgId, newValue: { emailEnabled: enabled } });
}

const validEmail = (e: string | null | undefined) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** Who a payroll's payslips could be emailed to, and who already has theirs. */
export async function deliveryOverview(ctx: Ctx, runId: string) {
  assertCan(ctx, "payslip.distribute");
  const { ids } = await recordsOf(ctx, runId).catch(() => ({ ids: [] as string[] }));
  const recs = await db.payrollRecord.findMany({ where: { id: { in: ids } }, select: { id: true, employeeNumber: true, employeeName: true, employee: { select: { email: true } } }, orderBy: { employeeNumber: "asc" } });
  const sent = await db.payslipDelivery.findMany({ where: { organizationId: ctx.orgId, runId }, orderBy: { sentAt: "desc" } });
  const sentBy = new Map<string, (typeof sent)[number]>();
  for (const s of sent) if (!sentBy.has(s.recordId)) sentBy.set(s.recordId, s);
  const rows = recs.map((r) => ({ recordId: r.id, employeeNumber: r.employeeNumber, employeeName: r.employeeName, email: r.employee.email, hasEmail: validEmail(r.employee.email), sent: sentBy.get(r.id) ?? null }));
  return { rows, withEmail: rows.filter((r) => r.hasEmail).length, withoutEmail: rows.filter((r) => !r.hasEmail).length, alreadySent: rows.filter((r) => r.sent).length, log: sent.slice(0, 15) };
}

export type DeliveryOutcome = { employeeNumber: string; employeeName: string; status: "SENT" | "NO_EMAIL" | "ALREADY_SENT" | "FAILED"; to?: string };

/** Emails each employee their own payslip as a PDF. `resend` sends again to those who already have it. */
export async function emailPayslips(ctx: Ctx, runId: string, opts: { recordIds?: string[]; resend?: boolean } = {}) {
  assertCan(ctx, "payslip.distribute");
  if (!(await getPayslipSetting(ctx)).emailEnabled) throw new BusinessError("Emailing payslips is switched off for this organization. Switch it on first, or download them to send yourself.");
  const { run, ids } = await recordsOf(ctx, runId);
  if (opts.resend && !opts.recordIds?.length) throw new BusinessError("A resend is for named employees, not the whole payroll.");
  const wanted = opts.recordIds?.length ? ids.filter((i) => opts.recordIds!.includes(i)) : ids;
  const c = await context(ctx.orgId);
  const already = new Set((await db.payslipDelivery.findMany({ where: { organizationId: ctx.orgId, runId }, select: { recordId: true } })).map((d) => d.recordId));
  const out: DeliveryOutcome[] = [];
  for (const id of wanted) {
    const rec = await getPayslip(ctx, id);
    if (!rec) continue;
    const base = { employeeNumber: rec.employeeNumber, employeeName: rec.employeeName };
    const to = rec.employee.email?.trim();
    if (!validEmail(to)) {
      out.push({ ...base, status: "NO_EMAIL" });
      continue;
    }
    if (already.has(id) && !opts.resend) {
      out.push({ ...base, status: "ALREADY_SENT", to });
      continue;
    }
    const bytes = await pdfFor(rec, c);
    const first = rec.employee.firstName || rec.employeeName;
    const from = c.bureauName ? `${c.orgName} (payroll by ${c.bureauName})` : c.orgName;
    try {
      await sendEmail({
        to: to!,
        subject: `Your payslip for ${run.period.name}`,
        text: [`Dear ${first},`, "", `Your payslip for ${run.period.name} is attached.`, "", "It contains salary information: please keep it private and do not forward it. If anything looks wrong, tell your HR contact.", "", from].join("\n"),
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><p>Dear ${esc(first)},</p><p>Your payslip for ${esc(run.period.name)} is attached.</p><p>It contains salary information: please keep it private and do not forward it. If anything looks wrong, tell your HR contact.</p><p>${esc(from)}</p></div>`,
        attachments: [{ filename: fileNameFor(rec), content: bytes }],
      });
    } catch (e) {
      logger.error("payslip_email_failed", { employee: rec.employeeNumber, error: e });
      out.push({ ...base, status: "FAILED", to });
      continue;
    }
    await db.payslipDelivery.create({ data: { organizationId: ctx.orgId, runId, recordId: id, employeeId: rec.employeeId, toEmail: to!, checksum: createHash("sha256").update(bytes).digest("hex"), sentBy: ctx.name, sentByUserId: ctx.userId } });
    out.push({ ...base, status: "SENT", to });
  }
  const n = (s: DeliveryOutcome["status"]) => out.filter((o) => o.status === s).length;
  await logAudit(ctx, { action: "PAYSLIPS_EMAILED", entity: "PayrollRun", entityId: runId, newValue: { sent: n("SENT"), noEmail: n("NO_EMAIL"), alreadySent: n("ALREADY_SENT"), failed: n("FAILED") }, reason: opts.resend ? "Resent" : undefined });
  return out;
}
