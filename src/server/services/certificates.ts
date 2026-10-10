/**
 * Withholding tax certificates received from clients, and their reconciliation to the tax the clients withheld.
 *
 * A certificate is evidence and is never edited or deleted (the database refuses); a wrong one is voided with a reason and entered
 * again. Receipts (the tax withheld, with the certificate number the client quoted) and deductions of the withholding type carry
 * the references, and the reconciliation compares what was withheld against each number with what its certificate says.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { certificateKey, reconcileCertificates, uncertified, type Withheld } from "@/lib/certificates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

export const certificateSchema = z.object({
  clientId: z.string().min(1, "Choose the client"),
  certificateNumber: z.string().trim().min(2, "Enter the number printed on the certificate").max(80),
  issueDate: z.string().min(10, "Choose the date on the certificate"),
  receivedDate: z.string().min(10, "Choose the date it was received"),
  amount: z.coerce.number().positive("The amount must be greater than zero"),
  document: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CertificateInput = z.input<typeof certificateSchema>;

export async function registerCertificate(ctx: Ctx, raw: CertificateInput) {
  assertCan(ctx, "tax.manage");
  const v = certificateSchema.parse(raw);
  const issueDate = d(v.issueDate);
  const receivedDate = d(v.receivedDate);
  if (Number.isNaN(issueDate.getTime()) || Number.isNaN(receivedDate.getTime())) throw new BusinessError("A date isn't valid.");
  if (receivedDate < issueDate) throw new BusinessError("A certificate can't be received before it was issued.");
  if (receivedDate > today()) throw new BusinessError("The received date can't be in the future.");
  const key = certificateKey(v.certificateNumber);
  if (!key) throw new BusinessError("The certificate number needs letters or digits.");
  return db.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: v.clientId, organizationId: ctx.orgId }, select: { id: true, name: true } });
    if (!client) throw new BusinessError("Client not found.");
    if (await tx.taxCertificate.count({ where: { organizationId: ctx.orgId, clientId: client.id, numberKey: key, voidedAt: null } }))
      throw new BusinessError(`Certificate ${v.certificateNumber} from ${client.name} is already on the register. If it was entered wrongly, void it first.`);
    const cert = await tx.taxCertificate.create({
      data: { organizationId: ctx.orgId, clientId: client.id, certificateNumber: v.certificateNumber, numberKey: key, issueDate, receivedDate, amount: round2(v.amount), document: v.document || null, notes: v.notes || null, recordedBy: ctx.name },
    });
    await logAudit(ctx, { action: "TAX_CERTIFICATE_REGISTER", entity: "TaxCertificate", entityId: cert.id, newValue: { client: client.name, certificateNumber: v.certificateNumber, amount: round2(v.amount) } }, tx);
    return cert;
  });
}

export async function voidCertificate(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "tax.manage");
  if (!reason || reason.trim().length < 10) throw new BusinessError("Say why the certificate is being voided (at least 10 characters).");
  return db.$transaction(async (tx) => {
    const cert = await tx.taxCertificate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!cert) throw new BusinessError("Certificate not found.");
    if (cert.voidedAt) throw new BusinessError("This certificate has already been voided.");
    const u = await tx.taxCertificate.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: ctx.name, voidReason: reason.trim() } });
    await logAudit(ctx, { action: "TAX_CERTIFICATE_VOID", entity: "TaxCertificate", entityId: id, oldValue: { certificateNumber: cert.certificateNumber, amount: num(cert.amount) }, reason }, tx);
    return u;
  });
}

export async function listCertificates(ctx: Ctx, filter: { clientId?: string; includeVoided?: boolean } = {}) {
  assertCan(ctx, "gl.view");
  return db.taxCertificate.findMany({
    where: { organizationId: ctx.orgId, ...(filter.clientId ? { clientId: filter.clientId } : {}), ...(filter.includeVoided ? {} : { voidedAt: null }) },
    include: { client: { select: { name: true } } },
    orderBy: [{ receivedDate: "desc" }, { certificateNumber: "asc" }],
    take: 500,
  });
}

/** What clients withheld against each certificate number, compared with the certificates on the register. */
export async function certificateReconciliation(ctx: Ctx, filter: { clientId?: string } = {}) {
  assertCan(ctx, "gl.view");
  const scope = { organizationId: ctx.orgId, ...(filter.clientId ? { clientId: filter.clientId } : {}) };
  const [receipts, deductions, certs, clients, ledger] = await Promise.all([
    db.clientReceipt.findMany({ where: { ...scope, invoiceId: null, whtWithheld: { gt: 0 } }, select: { clientId: true, receiptNumber: true, whtReference: true, whtWithheld: true } }),
    db.clientInvoiceDeduction.findMany({ where: { ...scope, type: "WITHHOLDING_TAX" }, select: { clientId: true, supportingDocument: true, amount: true, invoice: { select: { invoiceNumber: true } } } }),
    db.taxCertificate.findMany({ where: { ...scope, voidedAt: null } }),
    db.client.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } }),
    db.journalLine.aggregate({ where: { journal: { organizationId: ctx.orgId }, account: { organizationId: ctx.orgId, code: "1220" }, ...(filter.clientId ? { clientId: filter.clientId } : {}) }, _sum: { debit: true, credit: true } }),
  ]);
  const withheld: Withheld[] = [
    ...receipts.map((r) => ({ clientId: r.clientId, reference: r.whtReference ?? "", amount: num(r.whtWithheld), source: `Receipt ${r.receiptNumber}` })),
    ...deductions.map((x) => ({ clientId: x.clientId, reference: x.supportingDocument, amount: num(x.amount), source: `Deduction on ${x.invoice.invoiceNumber}` })),
  ];
  const rows = reconcileCertificates(withheld, certs.map((c) => ({ id: c.id, clientId: c.clientId, certificateNumber: c.certificateNumber, amount: num(c.amount) })));
  const name = new Map(clients.map((c) => [c.id, c.name]));
  const totalWithheld = round2(withheld.reduce((s, w) => s + w.amount, 0));
  return {
    rows: rows.map((r) => ({ ...r, client: name.get(r.clientId) ?? "—" })),
    totals: {
      withheld: totalWithheld,
      certified: round2(certs.reduce((s, c) => s + num(c.amount), 0)),
      uncertified: round2(uncertified(rows)),
      ledger: round2(num(ledger._sum.debit) - num(ledger._sum.credit)),
    },
  };
}
