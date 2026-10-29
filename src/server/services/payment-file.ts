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
import { totalOf } from "@/lib/payroll/pay-inputs";
import { GENERIC_LAYOUT, layoutCells, type FileRowLike, type PayingLayout } from "@/lib/paying-bank";
import { buildPaymentRows, type PaymentLine } from "@/lib/payment-file";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { payingBankForFile } from "./paying-banks";

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

/**
 * What the file would contain, and who cannot be in it, without producing anything. With a paying bank, the bank codes come from THAT bank's own list and the file
 * follows that bank's layout; `blockers` says what stops a file being made for it (no layout yet, no debit account, a narration or row count over its limit).
 */
export async function paymentFilePreview(ctx: Ctx, runId: string, opts: { payingBankId?: string | null } = {}) {
  assertCan(ctx, "payment.manage");
  const run = await loadRun(ctx, runId);
  if (!["LOCKED", "PAID"].includes(run.status)) throw new BusinessError("A bank payment file is made from a locked payroll.");
  const allTxns = await db.paymentTransaction.findMany({ where: { batch: { runId }, organizationId: ctx.orgId }, include: { employee: { select: { employeeNumber: true, firstName: true, middleName: true, lastName: true } } }, orderBy: { employee: { employeeNumber: "asc" } } });
  if (!allTxns.length) throw new BusinessError("Create the payment batches for this payroll first.");
  // one payroll may be paid from several banks: each payment says which (fixed when the batches were made); an older one with none follows the default bank
  const payingNames = new Map((await db.payingBank.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, isDefault: true } })).map((b) => [b.id, b]));
  const defaultId = [...payingNames.values()].find((b) => b.isDefault)?.id ?? null;
  const bankOf = (t: { payingBankId: string | null }) => t.payingBankId ?? defaultId;
  const groups = new Map<string | null, { count: number; amounts: number[] }>();
  for (const t of allTxns) {
    const g = groups.get(bankOf(t)) ?? { count: 0, amounts: [] };
    g.count += 1;
    g.amounts.push(num(t.amount));
    groups.set(bankOf(t), g);
  }
  const split = [...groups.entries()]
    .map(([id, g]) => ({ payingBankId: id, name: id ? payingNames.get(id)?.name ?? "Unknown bank" : "No paying bank chosen", count: g.count, total: totalOf(g.amounts) }))
    .sort((a, b) => (a.payingBankId === null ? 1 : b.payingBankId === null ? -1 : a.name.localeCompare(b.name)));
  const txns = opts.payingBankId ? allTxns.filter((t) => bankOf(t) === opts.payingBankId) : allTxns;
  const lines: PaymentLine[] = txns.map((t) => ({
    transactionId: t.id,
    employeeNumber: t.employee.employeeNumber,
    name: [t.employee.firstName, t.employee.middleName, t.employee.lastName].filter(Boolean).join(" "),
    bankName: t.bankName,
    accountNumber: t.accountNumber,
    accountName: t.accountName,
    amount: num(t.amount),
  }));
  const using = opts.payingBankId ? await payingBankForFile(ctx, opts.payingBankId) : null;
  const banks = using ? [] : (await bankList(db, ctx.orgId)).filter((b) => b.active);
  // the narration on every row names the month the payment is for, in capitals
  const description = `PAYMENT FOR ${run.period.name.toUpperCase()}${run.type === "SUPPLEMENTARY" ? " (ADJUSTMENT)" : ""}`;
  const built = buildPaymentRows(lines, banks as BankEntry[], description, using?.lookup);
  const alreadyPaid = run.status === "PAID" || (await db.paymentBatch.count({ where: { runId, status: "PAID" } })) > 0;
  const blockers = [...(using?.blockers ?? [])];
  const layout = using?.layout ?? null;
  if (layout?.narrationMax && description.length > layout.narrationMax)
    blockers.push(`The narration "${description}" is ${description.length} characters; ${using!.bank.name} accepts at most ${layout.narrationMax} characters.`);
  if (layout?.maxRows && built.rows.length > layout.maxRows)
    blockers.push(`${using!.bank.name} accepts at most ${layout.maxRows} row${layout.maxRows === 1 ? "" : "s"} in one file; this one has ${built.rows.length}.`);
  return { run, description, ...built, payable: txns.length, split, unplaced: groups.get(null)?.count ?? 0, alreadyPaid, payingBank: using && { id: using.bank.id, name: using.bank.name, codeSetVersion: using.codeSetVersion, layout, debitAccountNumber: using.bank.debitAccountNumber }, blockers };
}

type FileResult = { buffer: Buffer; contentType: string; extension: "xlsx" | "csv" };

const csvCell = (v: string | number) => (typeof v === "number" ? v.toFixed(2) : /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Writes the rows to the bank's layout. Account numbers and bank codes are text, so a leading zero survives; amounts are numbers with two decimals. */
async function writeFile(layout: PayingLayout, rows: FileRowLike[], debitAccount: string | null): Promise<FileResult> {
  const cells = layoutCells(layout, rows, debitAccount);
  if (layout.fileType === "CSV") {
    const text = [cells.header, ...cells.body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    return { buffer: Buffer.from(text, "utf8"), contentType: "text/csv; charset=utf-8", extension: "csv" };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "WorkforcePay";
  const ws = wb.addWorksheet(layout.sheetName || "Sheet1");
  ws.addRow(cells.header);
  ws.getRow(1).font = { bold: true };
  layout.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(14, c.header.length + 4, c.source === "BENEFICIARY_NAME" || c.source === "NARRATION" ? 34 : 0);
    if (cells.textColumns.includes(i)) col.numFmt = "@";
    if (c.source === "AMOUNT") col.numFmt = "#,##0.00";
  });
  for (const r of cells.body) ws.addRow(r);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Produces the file. If anyone's details cannot be used the file is refused, unless `leaveOutProblems` says to pay them separately,
 * in which case they are named on the record of the export.
 */
export async function exportPaymentFile(ctx: Ctx, runId: string, opts: { leaveOutProblems?: boolean; payingBankId?: string | null } = {}) {
  assertCan(ctx, "payment.manage");
  const p = await paymentFilePreview(ctx, runId, { payingBankId: opts.payingBankId });
  if (p.blockers.length) throw new BusinessError(p.blockers[0]);
  if (p.alreadyPaid) throw new BusinessError("This payroll has already been marked paid, so a payment file is not made again.");
  if (p.problems.length && !opts.leaveOutProblems)
    throw new BusinessError(`${p.problems.length} employee(s) cannot go in the file (${p.problems.slice(0, 3).map((x) => x.employeeNumber).join(", ")}${p.problems.length > 3 ? ", …" : ""}). Put their details right, or choose to leave them out and pay them separately.`);
  if (!p.rows.length) throw new BusinessError("There is nobody to pay in this file.");
  const layout = p.payingBank?.layout ?? GENERIC_LAYOUT;
  const debit = p.payingBank?.debitAccountNumber ?? null;
  const file = await writeFile(layout, p.rows, debit);
  const buffer = file.buffer;
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const prefix = p.payingBank ? `${safeName(p.payingBank.name).toLowerCase()}-payment` : "bank-payment";
  const fileName = `${prefix}-${safeName(p.run.period.name)}${p.run.type === "SUPPLEMENTARY" ? `-adjustment-${p.run.runNumber}` : ""}.${file.extension}`;
  const excluded = p.problems.map((x) => ({ employeeNumber: x.employeeNumber, name: x.name, problems: x.problems }));
  const record = await db.paymentFileExport.create({
    data: { organizationId: ctx.orgId, runId, fileName, rowCount: p.rows.length, totalAmount: p.total, excluded, checksum, createdBy: ctx.name, createdByUserId: ctx.userId,
      payingBankId: p.payingBank?.id ?? null, codeSetVersion: p.payingBank?.codeSetVersion ?? null, layoutHeaders: p.payingBank ? layout.columns.map((c) => c.header).join("|") : null },
  });
  await logAudit(ctx, {
    action: "PAYMENT_FILE_EXPORT",
    entity: "PayrollRun",
    entityId: runId,
    newValue: { fileName, payingBank: p.payingBank?.name ?? null, codeListVersion: p.payingBank?.codeSetVersion ?? null, rows: p.rows.length, total: p.total, excluded: excluded.length, checksum: checksum.slice(0, 16) },
    reason: excluded.length ? `Left out ${excluded.length} employee(s) whose details could not be used: ${excluded.map((x) => x.employeeNumber).join(", ")}` : undefined,
  });
  return { buffer, fileName, record, contentType: file.contentType };
}

export async function listExports(ctx: Ctx, runId: string) {
  assertCan(ctx, "payment.manage");
  return db.paymentFileExport.findMany({ where: { organizationId: ctx.orgId, runId }, orderBy: { createdAt: "desc" } });
}
