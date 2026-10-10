import { describe, expect, it } from "vitest";
import { canEditDocument, draftProblems, reversibility, type DocumentStatus, type DraftLine } from "@/lib/journals";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const line = (accountId: string, debit: number, credit: number): DraftLine => ({ accountId, description: "", debit, credit });
const ok = [line("a", 100, 0), line("b", 0, 100)];
const base = { kind: "MANUAL" as const, postingDate: day("2026-08-31"), reverseOn: null };

describe("draftProblems", () => {
  it("finds nothing wrong with a balanced two-line journal", () => {
    expect(draftProblems({ ...base, lines: ok })).toEqual([]);
  });

  it("says what is wrong: too few lines, no date, an imbalance with the difference", () => {
    expect(draftProblems({ ...base, lines: [line("a", 100, 0)] })).toContain("A journal needs at least two lines with an amount.");
    expect(draftProblems({ ...base, postingDate: null, lines: ok })).toContain("Choose the date it posts on.");
    const unbalanced = draftProblems({ ...base, lines: [line("a", 100, 0), line("b", 0, 60)] });
    expect(unbalanced.join(" ")).toMatch(/debits are 100\.00 and credits 60\.00 \(difference 40\.00\)/);
  });

  it("counts in whole kobo, so a hair of floating point isn't an imbalance", () => {
    expect(draftProblems({ ...base, lines: [line("a", 0.1, 0), line("b", 0.2, 0), line("c", 0, 0.3)] })).toEqual([]);
  });

  it("refuses a negative amount, a two-sided line and an amount without an account", () => {
    expect(draftProblems({ ...base, lines: [line("a", -5, 0), line("b", 0, -5)] }).join(" ")).toMatch(/Line 1 has a negative amount/);
    expect(draftProblems({ ...base, lines: [line("a", 100, 40), line("b", 0, 60)] }).join(" ")).toMatch(/Line 1 is both debit and credit/);
    expect(draftProblems({ ...base, lines: [line("", 100, 0), line("b", 0, 100)] }).join(" ")).toMatch(/Line 1 has an amount but no account/);
  });

  it("ignores blank rows", () => {
    expect(draftProblems({ ...base, lines: [...ok, line("", 0, 0)] })).toEqual([]);
  });

  it("makes an accrual say when it reverses, and after the day it posts", () => {
    const accrual = { ...base, kind: "ACCRUAL" as const, lines: ok };
    expect(draftProblems(accrual)).toContain("An accrual needs the date it reverses on.");
    expect(draftProblems({ ...accrual, reverseOn: day("2026-08-31") })).toContain("An accrual must reverse after the day it posts.");
    expect(draftProblems({ ...accrual, reverseOn: day("2026-09-01") })).toEqual([]);
  });
});

describe("canEditDocument", () => {
  const table: Array<[DocumentStatus, boolean]> = [["DRAFT", true], ["REJECTED", true], ["SUBMITTED", false], ["APPROVED", false], ["POSTED", false], ["CANCELLED", false]];
  it.each(table)("%s -> %s", (status, editable) => expect(canEditDocument(status)).toBe(editable));
});

describe("reversibility", () => {
  const manual = { sourceType: "MANUAL_JOURNAL", reversalOfId: null, reversedByNumber: null };
  it("allows a manual journal that hasn't been reversed", () => {
    expect(reversibility(manual)).toEqual({ ok: true });
  });
  it("refuses one that is already reversed, naming the reversal", () => {
    expect(reversibility({ ...manual, reversedByNumber: "JV-000009" }).reason).toMatch(/already been reversed, by JV-000009/);
  });
  it("refuses a reversal itself", () => {
    expect(reversibility({ ...manual, sourceType: "JOURNAL_REVERSAL", reversalOfId: "x" }).reason).toMatch(/itself a reversal/);
  });
  it("refuses a journal made by another part of the system, and says to use its document", () => {
    for (const sourceType of ["CLIENT_INVOICE", "PURCHASE_INVOICE", "PAYROLL_RUN", "FIXED_ASSET", null])
      expect(reversibility({ ...manual, sourceType }).reason, String(sourceType)).toMatch(/through the document that produced it/);
  });
});
