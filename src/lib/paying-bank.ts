import { DEFAULT_BANKS, normalizeBankName } from "./bank-codes";

/**
 * Paying banks: the bank a client pays salaries FROM. Pure rules, no database (docs/plans/paying-bank-files.md).
 *
 * Two things differ between paying banks, so both are data and a new bank needs no code:
 *   1. the list of bank codes: a bank's codes are valid ONLY on its own list (the same code can mean a different bank on another bank's list);
 *   2. the layout of the upload file: its columns and where each comes from.
 * An entry in a list that could send money to the wrong place is BLOCKED when the list is read, with the reason, and never put in a file.
 */

// ─────────────────────────────── code lists ───────────────────────────────

export interface ParsedCode {
  name: string;
  code: string;
  aliases: string[];
  blocked: boolean;
  reason?: string;
}

/** Reads a CSV of `bank_name,bank_code` (a header row is skipped). Returns the entries, how many exact repeats were merged, and the rows that could not be read. */
export function parseCodeList(text: string): { entries: ParsedCode[]; mergedRepeats: number; problems: string[] } {
  const rows = splitCsv(text);
  const problems: string[] = [];
  const seen = new Map<string, ParsedCode>();
  const list: ParsedCode[] = [];
  let mergedRepeats = 0;
  rows.forEach((cells, i) => {
    const [name, code] = [(cells[0] ?? "").trim(), (cells[1] ?? "").trim()];
    if (i === 0 && /^bank[_ ]?name$/i.test(name)) return;
    if (!name && !code) return;
    if (!name || !code) {
      problems.push(`Line ${i + 1}: "${cells.join(",")}" needs both a bank name and a code.`);
      return;
    }
    const key = `${normalizeBankName(name)}|${code}`;
    if (seen.has(key)) {
      mergedRepeats += 1;
      return;
    }
    const entry: ParsedCode = { name, code, aliases: [], blocked: false };
    seen.set(key, entry);
    list.push(entry);
  });

  const block = (e: ParsedCode, reason: string) => {
    if (!e.blocked) {
      e.blocked = true;
      e.reason = reason;
    }
  };
  // 1. a test bank, or a code with anything but letters and digits in it
  for (const e of list) {
    if (/\btest\b/i.test(e.name)) block(e, "A test entry in the bank's list: never payable.");
    else if (!/^[A-Za-z0-9]+$/.test(e.code)) block(e, `The code "${e.code}" has characters other than letters and digits, so it is not a real bank code.`);
  }
  // 2. a code shared by two different banks: it cannot be known which is meant
  const byCode = new Map<string, ParsedCode[]>();
  for (const e of list) byCode.set(e.code, [...(byCode.get(e.code) ?? []), e]);
  for (const [code, group] of byCode)
    if (new Set(group.map((g) => normalizeBankName(g.name))).size > 1)
      for (const e of group) block(e, `Shares code ${code} with ${group.filter((g) => g !== e).map((g) => g.name).join(" and ")}: it is not known which bank it is. Ask the bank.`);
  // 3. a bank listed under two different codes
  const byName = new Map<string, ParsedCode[]>();
  for (const e of list) byName.set(normalizeBankName(e.name), [...(byName.get(normalizeBankName(e.name)) ?? []), e]);
  for (const group of byName.values())
    if (new Set(group.map((g) => g.code)).size > 1) for (const e of group) block(e, `${e.name} is listed under more than one code (${group.map((g) => g.code).join(", ")}): it is not known which is right. Ask the bank.`);
  // 4. a code shorter than 3 characters: a leading zero may have been lost, and it is not guessed at
  for (const e of list) if (e.code.length < 3) block(e, `The code "${e.code}" has fewer than 3 characters; a leading zero may have been lost. Ask the bank for the true code.`);

  return { entries: list, mergedRepeats, problems };
}

/**
 * Gives each entry the usual alternative names of the same bank ("GTBank", "GTB", "GT Bank" for "GUARANTY TRUST BANK"), so an employee's record that says "GTBank" finds
 * it. It goes by the NAME only, never by the code (a code means different banks on different lists). A bank the standard list does not know keeps only its own name,
 * and an employee's bank that matches nothing is listed as a problem for a person to put right, not guessed at.
 */
export function addKnownAliases<T extends ParsedCode>(entries: readonly T[]): T[] {
  return entries.map((e) => {
    const key = normalizeBankName(e.name);
    const known = DEFAULT_BANKS.filter((b) => [b.name, ...b.aliases].some((n) => normalizeBankName(n) === key));
    const aliases = [...new Set([...e.aliases, ...known.flatMap((b) => [b.name, ...b.aliases])])].filter((n) => normalizeBankName(n) !== key);
    return { ...e, aliases };
  });
}

/** The unblocked entry a free-text bank name stands for on THIS list, a blocked entry if that is all it matches, or null. A name matching two codes matches nothing. */
export function resolveInList<T extends ParsedCode>(name: string | null | undefined, entries: readonly T[]): T | null {
  const key = normalizeBankName(name ?? "");
  if (!key) return null;
  const hits = entries.filter((b) => [b.name, ...b.aliases].some((n) => normalizeBankName(n) === key));
  const usable = hits.filter((h) => !h.blocked);
  if (usable.length) return new Set(usable.map((h) => h.code)).size === 1 ? usable[0] : null;
  return hits[0] ?? null;
}

// ─────────────────────────────── layouts ───────────────────────────────

export const LAYOUT_SOURCES = ["DEBIT_ACCOUNT", "CREDIT_ACCOUNT", "BANK_CODE", "BENEFICIARY_NAME", "NARRATION", "AMOUNT", "FIXED"] as const;
export type LayoutSource = (typeof LAYOUT_SOURCES)[number];
export interface LayoutColumn {
  header: string;
  source: LayoutSource;
  /** The value, for a FIXED column. */
  fixed?: string;
}
export interface PayingLayout {
  fileType: "XLSX" | "CSV";
  sheetName: string;
  columns: LayoutColumn[];
  /** The longest narration the bank accepts, when it says so. */
  narrationMax: number | null;
  /** The most rows the bank accepts in one file, when it says so. */
  maxRows: number | null;
}

/** First Bank's upload template, exactly as supplied: six headers, no sample row. Amount and narration rules are the founder's to confirm. */
export const FIRST_BANK_LAYOUT: PayingLayout = {
  fileType: "XLSX",
  sheetName: "Sheet1",
  columns: [
    { header: "DebitAccountNo", source: "DEBIT_ACCOUNT" },
    { header: "CreditAccountNo", source: "CREDIT_ACCOUNT" },
    { header: "CreditBankCode", source: "BANK_CODE" },
    { header: "BeneficiaryName", source: "BENEFICIARY_NAME" },
    { header: "Narration", source: "NARRATION" },
    { header: "Amount", source: "AMOUNT" },
  ],
  narrationMax: null,
  maxRows: null,
};

/** The generic layout the app has always produced. */
export const GENERIC_LAYOUT: PayingLayout = {
  fileType: "XLSX",
  sheetName: "Payments",
  columns: [
    { header: "Name", source: "BENEFICIARY_NAME" },
    { header: "Account Number", source: "CREDIT_ACCOUNT" },
    { header: "Bank Code", source: "BANK_CODE" },
    { header: "Amount", source: "AMOUNT" },
    { header: "Payment Description", source: "NARRATION" },
  ],
  narrationMax: null,
  maxRows: null,
};

/** Plain-language problems with a layout (empty when it can pay people). */
export function validateLayout(l: PayingLayout): string[] {
  const out: string[] = [];
  if (!l.columns?.length) return ["The layout has no columns."];
  const seen = new Set<string>();
  for (const c of l.columns) {
    if (!c.header?.trim()) out.push("Every column needs a header.");
    else if (seen.has(c.header.trim().toLowerCase())) out.push(`The header "${c.header}" is used more than once.`);
    seen.add((c.header ?? "").trim().toLowerCase());
    if (!(LAYOUT_SOURCES as readonly string[]).includes(c.source)) out.push(`"${c.source}" is not a known source (use ${LAYOUT_SOURCES.join(", ")}).`);
    if (c.source === "FIXED" && !(c.fixed ?? "").length) out.push(`The fixed column "${c.header}" needs a value.`);
  }
  const has = (s: LayoutSource) => l.columns.some((c) => c.source === s);
  if (!has("CREDIT_ACCOUNT")) out.push("The layout needs a column for the beneficiary account (CREDIT_ACCOUNT).");
  if (!has("BANK_CODE")) out.push("The layout needs a column for the bank code (BANK_CODE).");
  if (!has("AMOUNT")) out.push("The layout needs a column for the amount (AMOUNT).");
  if (l.narrationMax !== null && (!Number.isInteger(l.narrationMax) || l.narrationMax < 1)) out.push("The narration limit must be a whole number of characters.");
  if (l.maxRows !== null && (!Number.isInteger(l.maxRows) || l.maxRows < 1)) out.push("The row limit must be a whole number.");
  return out;
}

/** One column per line: `Header = SOURCE` (or `Header = FIXED:value`). */
export function layoutToText(l: PayingLayout): string {
  return l.columns.map((c) => `${c.header} = ${c.source}${c.source === "FIXED" ? `:${c.fixed ?? ""}` : ""}`).join("\n");
}

export function parseLayoutText(text: string, base: Pick<PayingLayout, "fileType" | "sheetName" | "narrationMax" | "maxRows">): PayingLayout {
  const columns: LayoutColumn[] = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.lastIndexOf("=");
      if (at < 1) throw new Error(`"${line}" is not a column. Write each as Header = SOURCE.`);
      const header = line.slice(0, at).trim();
      const right = line.slice(at + 1).trim();
      if (right.toUpperCase().startsWith("FIXED:")) return { header, source: "FIXED" as const, fixed: right.slice(6) };
      return { header, source: right.toUpperCase() as LayoutSource };
    });
  return { fileType: base.fileType, sheetName: base.sheetName, narrationMax: base.narrationMax, maxRows: base.maxRows, columns };
}

export interface FileRowLike {
  transactionId: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  amount: number;
  description: string;
}

/** The header and the rows of the file, cell by cell, plus which columns must be written as text (so a leading zero survives). */
export function layoutCells(layout: PayingLayout, rows: readonly FileRowLike[], debitAccount: string | null): { header: string[]; body: Array<Array<string | number>>; textColumns: number[] } {
  const value = (c: LayoutColumn, r: FileRowLike): string | number => {
    switch (c.source) {
      case "DEBIT_ACCOUNT": return debitAccount ?? "";
      case "CREDIT_ACCOUNT": return r.accountNumber;
      case "BANK_CODE": return r.bankCode;
      case "BENEFICIARY_NAME": return r.name;
      case "NARRATION": return r.description;
      case "AMOUNT": return r.amount;
      case "FIXED": return c.fixed ?? "";
    }
  };
  const textColumns = layout.columns.flatMap((c, i) => (["DEBIT_ACCOUNT", "CREDIT_ACCOUNT", "BANK_CODE"].includes(c.source) ? [i] : []));
  return { header: layout.columns.map((c) => c.header), body: rows.map((r) => layout.columns.map((c) => value(c, r))), textColumns };
}

// ─────────────────────────────── csv reading ───────────────────────────────

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
