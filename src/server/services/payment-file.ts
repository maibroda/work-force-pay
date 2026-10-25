/**
 * The bank payment file: an Excel sheet of Name, Account Number, Bank Code, Amount and Payment Description that the client uploads to their own bank.
 * The app only produces the file; it never moves money. Rows come from the payment batches of a locked payroll, so they are what was frozen
 * with the payroll, not whatever an employee's record says today. A person whose details cannot be used is listed, never guessed at, and the file is
 * only produced without them if that is chosen on purpose and recorded. Every file produced is recorded with a fingerprint.
 */
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { DEFAULT_BANKS, normalizeBankName, resolveBank, type BankEntry } from "@/lib/bank-codes";
import { num } from "@/lib/money";
import { buildPaymentRows, PAYMENT_FILE_HEADERS, type PaymentLine } from "@/lib/payment-file";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

// ─────────────────────────────── Bank codes ───────────────────────────────

/** An organization's bank list, starting it from the standard one the first time it is needed. */
export async function bankList(client: Tx | typeof db, orgId: string) {
  const count = await client.bankCode.count({ where: { organizationId: orgId } });
  if (!count) await client.bankCode.createMany({ data: DEFAULT_BANKS.map((b) => ({ organizationId: orgId, name: b.name, code: b.code, aliases: b.aliases })), skipDuplicates: true });
  return client.bankCode.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
}

export async function listBankCodes(ctx: Ctx) {
  assertCan(ctx, "payment.manage");
  return bankList(db, ctx.orgId);
}

export const bankCodeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "The bank's name is required"),
  code: z.string().trim().regex(/^[0-9]{3,6}$/, "A bank code is 3 to 6 digits"),
  aliases: z
    .string()
    .optional()
    .transform((s) => (s ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)),
  active: z.preprocess((v) => v === undefined || v === true || v === "true" || v === "on", z.boolean()),
});

export async function saveBankCode(ctx: Ctx, raw: z.input<typeof bankCodeSchema>) {
  assertCan(ctx, "payment.manage");
  const v = bankCodeSchema.parse(raw);
  const all = await bankList(db, ctx.orgId);
  // a bank entered by the name of one already listed corrects that one
  const existing = v.id ? all.find((b) => b.id === v.id) : all.find((b) => normalizeBankName(b.name) === normalizeBankName(v.name));
  // no name or alternative name may stand for two different codes, or a bank could be paid under the wrong one
  const mine = [v.name, ...v.aliases].map(normalizeBankName).filter(Boolean);
  for (const other of all.filter((b) => b.id !== existing?.id && b.active))
    if (other.code !== v.code && [other.name, ...other.aliases].some((n) => mine.includes(normalizeBankName(n))))
      throw new BusinessError(`"${other.name}" already uses a name that this entry would also answer to, with code ${other.code}.`);
  const data = { name: existing && !v.id ? existing.name : v.name, code: v.code, aliases: v.aliases, active: v.active };
  const saved = existing
    ? await db.bankCode.update({ where: { id: existing.id }, data })
    : await db.bankCode.create({ data: { organizationId: ctx.orgId, ...data } });
  await logAudit(ctx, { action: existing ? "BANK_CODE_UPDATE" : "BANK_CODE_CREATE", entity: "BankCode", entityId: saved.id, oldValue: existing ? { name: existing.name, code: existing.code, active: existing.active } : undefined, newValue: data });
  return saved;
}

/** Whether a free-text bank name can be turned into a code (used when employees are imported). */
export async function bankResolver(client: Tx | typeof db, orgId: string) {
  const banks = (await bankList(client, orgId)).filter((b) => b.active);
  return (name: string) => resolveBank(name, banks) !== null;
}

// ─────────────────────────────── The file ───────────────────────────────

async function loadRun(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId }, include: { period: { select: { name: true } } } });
  if (!run) throw new BusinessError("Payroll run not found.");
  return run;
}

/** What the file would contain, and who cannot be in it, without producing anything. */
export async function paymentFilePreview(ctx: Ctx, runId: string) {
  assertCan(ctx, "payment.manage");
  const run = await loadRun(ctx, runId);
  if (!["LOCKED", "PAID"].includes(run.status)) throw new BusinessError("A bank payment file is made from a locked payroll.");
  const txns = await db.paymentTransaction.findMany({ where: { batch: { runId }, organizationId: ctx.orgId }, include: { employee: { select: { employeeNumber: true, firstName: true, middleName: true, lastName: true } } }, orderBy: { employee: { employeeNumber: "asc" } } });
  if (!txns.length) throw new BusinessError("Create the payment batches for this payroll first.");
  const lines: PaymentLine[] = txns.map((t) => ({
    transactionId: t.id,
    employeeNumber: t.employee.employeeNumber,
    name: [t.employee.firstName, t.employee.middleName, t.employee.lastName].filter(Boolean).join(" "),
    bankName: t.bankName,
    accountNumber: t.accountNumber,
    accountName: t.accountName,
    amount: num(t.amount),
  }));
  const banks = (await bankList(db, ctx.orgId)).filter((b) => b.active);
  const description = `${run.type === "SUPPLEMENTARY" ? "Salary adjustment" : "Salary"} ${run.period.name}`;
  const built = buildPaymentRows(lines, banks as BankEntry[], description);
  const alreadyPaid = run.status === "PAID" || (await db.paymentBatch.count({ where: { runId, status: "PAID" } })) > 0;
  return { run, description, ...built, payable: txns.length, alreadyPaid };
}

async function workbook(rows: { name: string; accountNumber: string; bankCode: string; amount: number; description: string }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "WorkforcePay";
  const ws = wb.addWorksheet("Payments");
  ws.addRow([...PAYMENT_FILE_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 36 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 34 }];
  // account numbers and bank codes are text, so a leading zero survives; amounts are numbers with two decimals
  ws.getColumn(2).numFmt = "@";
  ws.getColumn(3).numFmt = "@";
  ws.getColumn(4).numFmt = "#,##0.00";
  for (const r of rows) ws.addRow([r.name, r.accountNumber, r.bankCode, r.amount, r.description]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Produces the file. If anyone's details cannot be used the file is refused, unless `leaveOutProblems` says to pay them separately,
 * in which case they are named on the record of the export.
 */
export async function exportPaymentFile(ctx: Ctx, runId: string, opts: { leaveOutProblems?: boolean } = {}) {
  assertCan(ctx, "payment.manage");
  const p = await paymentFilePreview(ctx, runId);
  if (p.alreadyPaid) throw new BusinessError("This payroll has already been marked paid, so a payment file is not made again.");
  if (p.problems.length && !opts.leaveOutProblems)
    throw new BusinessError(`${p.problems.length} employee(s) cannot go in the file (${p.problems.slice(0, 3).map((x) => x.employeeNumber).join(", ")}${p.problems.length > 3 ? ", …" : ""}). Put their details right, or choose to leave them out and pay them separately.`);
  if (!p.rows.length) throw new BusinessError("There is nobody to pay in this file.");
  const buffer = await workbook(p.rows);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const fileName = `bank-payment-${safeName(p.run.period.name)}${p.run.type === "SUPPLEMENTARY" ? `-adjustment-${p.run.runNumber}` : ""}.xlsx`;
  const excluded = p.problems.map((x) => ({ employeeNumber: x.employeeNumber, name: x.name, problems: x.problems }));
  const record = await db.paymentFileExport.create({
    data: { organizationId: ctx.orgId, runId, fileName, rowCount: p.rows.length, totalAmount: p.total, excluded, checksum, createdBy: ctx.name, createdByUserId: ctx.userId },
  });
  await logAudit(ctx, {
    action: "PAYMENT_FILE_EXPORT",
    entity: "PayrollRun",
    entityId: runId,
    newValue: { fileName, rows: p.rows.length, total: p.total, excluded: excluded.length, checksum: checksum.slice(0, 16) },
    reason: excluded.length ? `Left out ${excluded.length} employee(s) whose details could not be used: ${excluded.map((x) => x.employeeNumber).join(", ")}` : undefined,
  });
  return { buffer, fileName, record };
}

export async function listExports(ctx: Ctx, runId: string) {
  assertCan(ctx, "payment.manage");
  return db.paymentFileExport.findMany({ where: { organizationId: ctx.orgId, runId }, orderBy: { createdAt: "desc" } });
}
