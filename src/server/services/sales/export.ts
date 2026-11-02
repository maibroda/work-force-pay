/**
 * Exporting leads, accounts or contacts to a CSV: only the records the caller may see, with the same columns the import reads (so a file can be
 * corrected and imported again) plus owner and status. Text a spreadsheet would run as a formula is made harmless. Audited as a count.
 * A role that can read sales records but not change them (Finance, Operations) gets phone numbers and email addresses masked; the people who work the records get them in full.
 */
import { can } from "@/lib/auth/permissions";
import { maskEmail, maskPhone } from "@/lib/sales/privacy";
import type { Ctx } from "@/lib/auth/context";
import { COLUMNS, csvRow, IMPORT_KINDS, type ImportKind } from "@/lib/sales/import";
import { BusinessError, db } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales } from "./access";

/** The most rows one download holds; a company with more downloads it in parts by filtering, and the audit entry says when the cap was reached. */
export const EXPORT_CAP = 20_000;

export async function exportCsv(ctx: Ctx, kind: ImportKind) {
  await requireSales(ctx, "sales.view");
  if (!(IMPORT_KINDS as string[]).includes(kind)) throw new BusinessError("Choose leads, accounts or contacts.");
  const where = { organizationId: ctx.orgId, ...ownerFilter(ctx) };
  const masked = !can(ctx.role, "sales.manage");
  const ph = (v: string | null) => (masked ? maskPhone(v) : v);
  const em = (v: string | null) => (masked ? maskEmail(v) : v);
  let head: string[];
  let body: unknown[][];
  if (kind === "LEADS") {
    const rows = await db.crmLead.findMany({ where: { ...where, status: { not: "VOID" } }, orderBy: { number: "asc" }, take: EXPORT_CAP });
    head = [...COLUMNS.LEADS.map((c) => c.header).filter((h) => !["Marketing Consent", "Consent Source"].includes(h)), "Number", "Owner", "Status"];
    body = rows.map((l) => [l.companyName, l.contactName, l.jobTitle, ph(l.phoneE164), em(l.email), l.industry, l.state, l.lga, l.address, l.source, l.sourceDetail, l.serviceInterest, l.estimatedGuards, l.number, l.ownerName, l.status]);
  } else if (kind === "ACCOUNTS") {
    const rows = await db.crmAccount.findMany({ where: { ...where, status: "ACTIVE" }, orderBy: { name: "asc" }, take: EXPORT_CAP });
    head = [...COLUMNS.ACCOUNTS.map((c) => c.header), "Owner"];
    body = rows.map((a) => [a.name, a.industry, a.accountType, a.state, a.lga, a.address, a.source, a.sourceDetail, a.rcNumber, a.emailDomain, a.ownerName]);
  } else {
    const rows = await db.crmContact.findMany({ where: { ...where, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: EXPORT_CAP, include: { account: { select: { name: true } } } });
    head = [...COLUMNS.CONTACTS.map((c) => c.header).filter((h) => !["Marketing Consent", "Consent Source"].includes(h)), "Owner"];
    body = rows.map((c) => [c.firstName, c.lastName, c.account?.name, c.jobTitle, c.roleInDecision, ph(c.phoneE164), ph(c.whatsappE164), em(c.email), c.ownerName]);
  }
  await logAudit(ctx, { action: "SALES_EXPORT", entity: "CrmExport", entityId: kind, newValue: { kind, rows: body.length, masked, capped: body.length >= EXPORT_CAP } });
  return { fileName: `sales-${kind.toLowerCase()}.csv`, csv: `${[csvRow(head), ...body.map(csvRow)].join("\r\n")}\r\n`, rows: body.length, capped: body.length >= EXPORT_CAP };
}
