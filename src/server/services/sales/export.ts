/**
 * Exporting leads, accounts or contacts to a CSV: only the records the caller may see, with the same columns the import reads (so a file can be
 * corrected and imported again) plus owner and status. Text a spreadsheet would run as a formula is made harmless. Audited as a count.
 */
import type { Ctx } from "@/lib/auth/context";
import { COLUMNS, csvRow, IMPORT_KINDS, type ImportKind } from "@/lib/sales/import";
import { BusinessError, db } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales } from "./access";

export async function exportCsv(ctx: Ctx, kind: ImportKind) {
  await requireSales(ctx, "sales.view");
  if (!(IMPORT_KINDS as string[]).includes(kind)) throw new BusinessError("Choose leads, accounts or contacts.");
  const where = { organizationId: ctx.orgId, ...ownerFilter(ctx) };
  let head: string[];
  let body: unknown[][];
  if (kind === "LEADS") {
    const rows = await db.crmLead.findMany({ where: { ...where, status: { not: "VOID" } }, orderBy: { number: "asc" } });
    head = [...COLUMNS.LEADS.map((c) => c.header).filter((h) => !["Marketing Consent", "Consent Source"].includes(h)), "Number", "Owner", "Status"];
    body = rows.map((l) => [l.companyName, l.contactName, l.jobTitle, l.phoneE164, l.email, l.industry, l.state, l.lga, l.address, l.source, l.sourceDetail, l.serviceInterest, l.estimatedGuards, l.number, l.ownerName, l.status]);
  } else if (kind === "ACCOUNTS") {
    const rows = await db.crmAccount.findMany({ where: { ...where, status: "ACTIVE" }, orderBy: { name: "asc" } });
    head = [...COLUMNS.ACCOUNTS.map((c) => c.header), "Owner"];
    body = rows.map((a) => [a.name, a.industry, a.accountType, a.state, a.lga, a.address, a.source, a.sourceDetail, a.rcNumber, a.emailDomain, a.ownerName]);
  } else {
    const rows = await db.crmContact.findMany({ where: { ...where, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { account: { select: { name: true } } } });
    head = [...COLUMNS.CONTACTS.map((c) => c.header).filter((h) => !["Marketing Consent", "Consent Source"].includes(h)), "Owner"];
    body = rows.map((c) => [c.firstName, c.lastName, c.account?.name, c.jobTitle, c.roleInDecision, c.phoneE164, c.whatsappE164, c.email, c.ownerName]);
  }
  await logAudit(ctx, { action: "SALES_EXPORT", entity: "CrmExport", entityId: kind, newValue: { kind, rows: body.length } });
  return { fileName: `sales-${kind.toLowerCase()}.csv`, csv: `${[csvRow(head), ...body.map(csvRow)].join("\r\n")}\r\n`, rows: body.length };
}
