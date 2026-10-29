/**
 * Paying banks: the bank a client pays salaries FROM. Each has its own list of bank codes (a bank's codes are valid only on its own list) and its own upload file
 * layout, both kept as data, so a new bank needs no code (docs/plans/paying-bank-files.md). A list is never edited: a newer list from the bank is imported as a new
 * version, and every file records the version it used. Entries that could send money to the wrong place are blocked when a list is read (see lib/paying-bank.ts).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { normalizeBankName } from "@/lib/bank-codes";
import { BUILT_IN_CODE_LISTS, type BuiltInListKey } from "@/lib/bank-code-lists";
import { ACCESS_BANK_LAYOUT, addKnownAliases, FIRST_BANK_LAYOUT, parseCodeList, parseLayoutText, resolveInList, validateLayout, type ParsedCode, type PayingLayout } from "@/lib/paying-bank";
import type { BankLookup } from "@/lib/payment-file";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

const BUILT_IN_LAYOUTS: Partial<Record<BuiltInListKey, PayingLayout>> = { ACCESS_BANK: ACCESS_BANK_LAYOUT, FIRST_BANK: FIRST_BANK_LAYOUT };

const account = z.string().trim().regex(/^\d{10}$/, "The debit account number must be 10 digits.");

function asLayout(json: unknown): PayingLayout | null {
  return json && typeof json === "object" ? (json as PayingLayout) : null;
}

async function findBank(client: Tx | typeof db, ctx: Ctx, id: string) {
  const bank = await client.payingBank.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!bank) throw new BusinessError("Paying bank not found.");
  return bank;
}

/** Reads, checks and saves a list as the bank's next version. */
async function writeCodeSet(tx: Tx, ctx: Ctx, bank: { id: string; name: string }, text: string, sourceName: string) {
  const parsed = parseCodeList(text);
  if (parsed.problems.length) throw new BusinessError(`The list cannot be read: ${parsed.problems.slice(0, 3).join(" ")}${parsed.problems.length > 3 ? ` (and ${parsed.problems.length - 3} more)` : ""}`);
  if (!parsed.entries.length) throw new BusinessError("The list has no banks in it.");
  const entries = addKnownAliases(parsed.entries);
  const last = await tx.bankCodeSet.findFirst({ where: { payingBankId: bank.id }, orderBy: { version: "desc" }, select: { version: true } });
  const blockedCount = entries.filter((e) => e.blocked).length;
  const set = await tx.bankCodeSet.create({
    data: {
      organizationId: ctx.orgId, payingBankId: bank.id, version: (last?.version ?? 0) + 1, sourceName, sourceSha256: createHash("sha256").update(text).digest("hex"),
      entryCount: entries.length, blockedCount, importedBy: ctx.name,
    },
  });
  await tx.payingBankCode.createMany({ data: entries.map((e) => ({ codeSetId: set.id, name: e.name, code: e.code, aliases: e.aliases, blocked: e.blocked, blockedReason: e.reason ?? null })) });
  await logAudit(ctx, { action: "BANK_CODE_SET_IMPORT", entity: "PayingBank", entityId: bank.id, newValue: { bank: bank.name, version: set.version, source: sourceName, entries: entries.length, blocked: blockedCount, sha256: set.sourceSha256.slice(0, 16) } }, tx);
  return set;
}

export const createPayingBankSchema = z.object({
  name: z.string().trim().min(2, "The bank's name is required"),
  /** Starts the bank from a list (and, where its upload template is known, the layout) supplied with the app. */
  builtIn: z.enum(["ACCESS_BANK", "FIRST_BANK"]).optional(),
  debitAccountNumber: z.string().optional(),
});

export async function createPayingBank(ctx: Ctx, raw: z.input<typeof createPayingBankSchema>) {
  assertCan(ctx, "payment.manage");
  const v = createPayingBankSchema.parse(raw);
  const debit = v.debitAccountNumber?.trim() ? account.parse(v.debitAccountNumber) : null;
  const existing = await db.payingBank.findMany({ where: { organizationId: ctx.orgId }, select: { name: true } });
  if (existing.some((b) => normalizeBankName(b.name) === normalizeBankName(v.name))) throw new BusinessError(`A paying bank called "${v.name}" already exists.`);
  return db.$transaction(async (tx) => {
    const layout = v.builtIn ? BUILT_IN_LAYOUTS[v.builtIn] ?? null : null;
    const bank = await tx.payingBank.create({
      data: { organizationId: ctx.orgId, name: v.name, layout: layout ? (layout as never) : undefined, debitAccountNumber: debit, isDefault: existing.length === 0, createdBy: ctx.name },
    });
    await logAudit(ctx, { action: "PAYING_BANK_CREATE", entity: "PayingBank", entityId: bank.id, newValue: { name: bank.name, layout: layout ? layout.columns.map((c) => c.header) : null, startedFrom: v.builtIn ?? null } }, tx);
    if (v.builtIn) await writeCodeSet(tx, ctx, bank, BUILT_IN_CODE_LISTS[v.builtIn].csv, BUILT_IN_CODE_LISTS[v.builtIn].source);
    return bank;
  });
}

const blank = (v: unknown) => v === "" || v === null;
const limit = (name: string) => z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number({ message: `${name} must be a whole number.` }).int(`${name} must be a whole number.`).min(1, `${name} must be at least 1.`));

export interface SavePayingBankInput {
  id: string;
  debitAccountNumber?: string | null;
  /** One column per line, `Header = SOURCE`. */
  layoutText?: string;
  fileType?: "XLSX" | "CSV";
  sheetName?: string;
  /** A number, or "" to say the bank states no limit. */
  narrationMax?: number | string | null;
  maxRows?: number | string | null;
  active?: boolean;
  isDefault?: boolean;
}

export async function savePayingBank(ctx: Ctx, input: SavePayingBankInput) {
  assertCan(ctx, "payment.manage");
  const bank = await findBank(db, ctx, input.id);
  const old = asLayout(bank.layout);
  const data: Record<string, unknown> = {};

  if (input.debitAccountNumber !== undefined) data.debitAccountNumber = blank(input.debitAccountNumber) || !String(input.debitAccountNumber).trim() ? null : account.parse(input.debitAccountNumber);
  if (input.active !== undefined) data.active = input.active;

  const touchesLayout = input.layoutText !== undefined || input.fileType !== undefined || input.sheetName !== undefined || input.narrationMax !== undefined || input.maxRows !== undefined;
  if (touchesLayout) {
    const next = {
      fileType: input.fileType ?? old?.fileType ?? "XLSX",
      sheetName: input.sheetName?.trim() || old?.sheetName || "Sheet1",
      narrationMax: input.narrationMax === undefined ? old?.narrationMax ?? null : blank(input.narrationMax) ? null : limit("The narration limit").parse(input.narrationMax),
      maxRows: input.maxRows === undefined ? old?.maxRows ?? null : blank(input.maxRows) ? null : limit("The row limit").parse(input.maxRows),
    };
    let layout: PayingLayout;
    if (input.layoutText !== undefined) {
      try {
        layout = parseLayoutText(input.layoutText, next);
      } catch (e) {
        throw new BusinessError((e as Error).message);
      }
    } else if (old) layout = { ...old, ...next };
    else throw new BusinessError("Give the layout's columns first (one per line, Header = SOURCE).");
    const problems = validateLayout(layout);
    if (problems.length) throw new BusinessError(problems.join(" "));
    data.layout = layout as never;
  }

  const saved = await db.$transaction(async (tx) => {
    if (input.isDefault === true) await tx.payingBank.updateMany({ where: { organizationId: ctx.orgId, id: { not: bank.id } }, data: { isDefault: false } });
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    const row = await tx.payingBank.update({ where: { id: bank.id }, data });
    await logAudit(
      ctx,
      {
        action: "PAYING_BANK_UPDATE", entity: "PayingBank", entityId: bank.id,
        oldValue: { active: bank.active, debitAccount: bank.debitAccountNumber ? "set" : null, layout: old ? old.columns.map((c) => c.header) : null, narrationMax: old?.narrationMax ?? null, maxRows: old?.maxRows ?? null },
        newValue: { active: row.active, debitAccount: row.debitAccountNumber ? "set" : null, layout: asLayout(row.layout)?.columns.map((c) => c.header) ?? null, narrationMax: asLayout(row.layout)?.narrationMax ?? null, maxRows: asLayout(row.layout)?.maxRows ?? null },
      },
      tx,
    );
    return row;
  });
  return { ...saved, layout: asLayout(saved.layout) };
}

export interface AssignPayingBankInput {
  /** The bank to pay from, or null to go back to the default. */
  payingBankId: string | null;
  /** Employee numbers, separated by commas, spaces or new lines. */
  employeeNumbers?: string;
  /** Everyone in this category. */
  categoryId?: string;
}

/** Says which paying bank people are paid from (by employee number and/or category). Takes effect on the NEXT payment batches; batches already made keep theirs. */
export async function assignPayingBank(ctx: Ctx, input: AssignPayingBankInput) {
  assertCan(ctx, "payment.manage");
  const numbers = [...new Set((input.employeeNumbers ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  if (!numbers.length && !input.categoryId) throw new BusinessError("Say who: give employee numbers, a category, or both.");
  const bank = input.payingBankId ? await findBank(db, ctx, input.payingBankId) : null;
  const people = await db.employee.findMany({
    where: { organizationId: ctx.orgId, OR: [...(numbers.length ? [{ employeeNumber: { in: numbers } }] : []), ...(input.categoryId ? [{ categoryId: input.categoryId }] : [])] },
    select: { id: true, employeeNumber: true },
  });
  const found = new Set(people.map((p) => p.employeeNumber));
  const notFound = numbers.filter((n) => !found.has(n));
  if (people.length)
    await db.$transaction(async (tx) => {
      await tx.employee.updateMany({ where: { id: { in: people.map((p) => p.id) }, organizationId: ctx.orgId }, data: { payingBankId: bank?.id ?? null } });
      await logAudit(ctx, { action: "PAYING_BANK_ASSIGN", entity: "PayingBank", entityId: bank?.id ?? "DEFAULT", newValue: { bank: bank?.name ?? "the default bank", people: people.length, byCategory: !!input.categoryId, notFound: notFound.length } }, tx);
    });
  return { assigned: people.length, notFound };
}

export async function listPayingBanks(ctx: Ctx) {
  assertCan(ctx, "payment.manage");
  const banks = await db.payingBank.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { codeSets: { orderBy: { version: "desc" }, take: 1 }, _count: { select: { employees: true } } },
  });
  return banks.map(({ codeSets, _count, ...b }) => {
    const layout = asLayout(b.layout);
    const latest = codeSets[0] ?? null;
    return { ...b, people: _count.employees, layout, hasLayout: !!layout && validateLayout(layout).length === 0, latest: latest && { version: latest.version, entryCount: latest.entryCount, blockedCount: latest.blockedCount, sourceName: latest.sourceName, sourceSha256: latest.sourceSha256, importedAt: latest.importedAt } };
  });
}

/** What reading a list would give, without saving anything (so a person can see what would be blocked first). */
export function previewCodeList(ctx: Ctx, text: string) {
  assertCan(ctx, "payment.manage");
  const p = parseCodeList(text);
  const entries = addKnownAliases(p.entries);
  return { entryCount: entries.length, mergedRepeats: p.mergedRepeats, problems: p.problems, blocked: entries.filter((e) => e.blocked).map((e) => ({ name: e.name, code: e.code, reason: e.reason ?? "" })) };
}

/** Saves a newer list from the bank as the next version; the earlier versions stay as they were. */
export async function importCodeSet(ctx: Ctx, payingBankId: string, text: string, sourceName: string) {
  assertCan(ctx, "payment.manage");
  const bank = await findBank(db, ctx, payingBankId);
  return db.$transaction((tx) => writeCodeSet(tx, ctx, bank, text, sourceName.trim() || "pasted list"));
}

export async function listCodeSetEntries(ctx: Ctx, payingBankId: string, version?: number) {
  assertCan(ctx, "payment.manage");
  const bank = await findBank(db, ctx, payingBankId);
  const set = await db.bankCodeSet.findFirst({ where: { payingBankId: bank.id, ...(version ? { version } : {}) }, orderBy: { version: "desc" } });
  if (!set) return { bank, set: null, entries: [] };
  return { bank, set, entries: await db.payingBankCode.findMany({ where: { codeSetId: set.id }, orderBy: { name: "asc" } }) };
}

/** Everything a bank file needs from a paying bank: its layout, the newest list as a lookup, and anything that stops a file being made. */
export async function payingBankForFile(ctx: Ctx, payingBankId: string) {
  const bank = await findBank(db, ctx, payingBankId);
  const layout = asLayout(bank.layout);
  const blockers: string[] = [];
  if (!bank.active) blockers.push(`${bank.name} is not in use. Turn it on under Paying banks to make a file for it.`);
  const layoutProblems = layout ? validateLayout(layout) : [];
  if (!layout) blockers.push(`${bank.name}'s upload template has not been set up yet, so no file can be made for it. Give its columns under Paying banks.`);
  else if (layoutProblems.length) blockers.push(`${bank.name}'s file layout is not usable: ${layoutProblems.join(" ")}`);
  if (layout && layout.columns.some((c) => c.source === "DEBIT_ACCOUNT") && !bank.debitAccountNumber)
    blockers.push(`No debit account number is set for ${bank.name}; its file puts the company's account on every row. Add it under Paying banks.`);
  const set = await db.bankCodeSet.findFirst({ where: { payingBankId: bank.id }, orderBy: { version: "desc" } });
  if (!set) blockers.push(`${bank.name} has no list of bank codes yet. Import one under Paying banks.`);
  const entries: ParsedCode[] = set
    ? (await db.payingBankCode.findMany({ where: { codeSetId: set.id } })).map((e) => ({ name: e.name, code: e.code, aliases: e.aliases, blocked: e.blocked, reason: e.blockedReason ?? undefined }))
    : [];
  const lookup: BankLookup = (name) => {
    const hit = resolveInList(name, entries);
    return hit ? { code: hit.code, blockedReason: hit.blocked ? hit.reason ?? "Blocked." : undefined, listName: hit.name } : null;
  };
  return { bank, layout, codeSetVersion: set?.version ?? null, lookup, blockers };
}
