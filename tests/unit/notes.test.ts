import { describe, expect, it } from "vitest";
import { amountDue, effectiveTotal, noteProblems, suggestedVat, type NoteFacts } from "@/lib/notes";
import { buildStatement } from "@/lib/statements";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const today = day("2026-10-10");
const facts: NoteFacts = { invoiceNumber: "INV-1", invoiceDate: day("2026-06-30"), cancelled: false, balance: 4_030_000, netLeft: 4_000_000, vatLeft: 30_000 };
const credit = { type: "CREDIT" as const, netAmount: 1_000_000, vatAmount: 7_500, noteDate: day("2026-09-15"), reason: "Two guards billed for a closed post" };

describe("amountDue and effectiveTotal", () => {
  const inv = { totalAmount: 4_030_000, totalDebits: 503_750, totalCredits: 1_007_500, amountPaid: 1_000_000, totalDeductions: 30_000 };
  it("count the notes, to the kobo", () => {
    expect(effectiveTotal(inv)).toBe(3_526_250);
    expect(amountDue(inv)).toBe(2_496_250);
    expect(amountDue({ totalAmount: 100.1, totalDebits: 0.2, totalCredits: 0.1, amountPaid: 0, totalDeductions: 0 })).toBe(100.2);
  });
});

describe("noteProblems", () => {
  it("accepts a sound credit note and a debit note", () => {
    expect(noteProblems(credit, facts, today)).toEqual([]);
    expect(noteProblems({ ...credit, type: "DEBIT", netAmount: 9_000_000, vatAmount: 50_000 }, facts, today)).toEqual([]); // a debit isn't limited by what is owed
  });

  it("says what is wrong", () => {
    expect(noteProblems({ ...credit, netAmount: 0 }, facts, today)).toContain("The net amount must be greater than zero.");
    expect(noteProblems({ ...credit, vatAmount: -1 }, facts, today)).toContain("VAT can't be negative.");
    expect(noteProblems({ ...credit, reason: "short" }, facts, today).join(" ")).toMatch(/at least 10 characters/);
    expect(noteProblems({ ...credit, noteDate: day("2026-06-01") }, facts, today).join(" ")).toMatch(/before the invoice \(2026-06-30\)/);
    expect(noteProblems({ ...credit, noteDate: day("2026-10-11") }, facts, today)).toContain("A note can't be dated in the future.");
    expect(noteProblems({ ...credit, noteDate: null }, facts, today)).toContain("Choose the date of the note.");
    expect(noteProblems(credit, { ...facts, cancelled: true }, today).join(" ")).toMatch(/was cancelled/);
  });

  it("limits a credit to what is owed and to what was charged, and says how to deal with an overpayment", () => {
    expect(noteProblems({ ...credit, netAmount: 4_100_000, vatAmount: 0 }, facts, today).join(" ")).toMatch(/more than the 4030000\.00 still owed.*advance and refund/);
    expect(noteProblems({ ...credit, netAmount: 100, vatAmount: 30_001 }, facts, today).join(" ")).toMatch(/VAT is more than the 30000\.00/);
    expect(noteProblems({ ...credit, netAmount: 600_000, vatAmount: 0 }, { ...facts, netLeft: 500_000 }, today).join(" ")).toMatch(/more than the 500000\.00 of the invoice that has not already been credited/);
    expect(noteProblems({ ...credit, netAmount: 4_000_000, vatAmount: 30_000 }, facts, today)).toEqual([]); // the whole invoice
  });
});

describe("suggestedVat", () => {
  it("applies the invoice's own VAT share of its net charge", () => {
    expect(suggestedVat(1_000_000, 30_000, 4_000_000)).toBe(7_500);
    expect(suggestedVat(333.33, 30_000, 4_000_000)).toBe(2.5);
    expect(suggestedVat(1_000_000, 0, 4_000_000)).toBe(0);
    expect(suggestedVat(1_000_000, 30_000, 0)).toBe(0);
  });
});

describe("a statement with notes", () => {
  const invoices = [{ id: "a", invoiceNumber: "INV-A", invoiceDate: day("2026-06-30"), dueDate: day("2026-07-30"), total: 1000 }];
  it("counts credit notes as settlements and debit notes as extra charges, by date", () => {
    const s = buildStatement(
      invoices,
      [{ id: "c1", invoiceId: "a", date: day("2026-08-01"), kind: "CREDIT_NOTE", reference: "CN-1", amount: 200 }],
      0,
      day("2026-09-01"),
      [{ id: "d1", invoiceId: "a", date: day("2026-08-15"), reference: "DN-1", amount: 50 }],
    );
    expect(s.lines.map((l) => [l.type, l.reference, l.balance])).toEqual([["INVOICE", "INV-A", 1000], ["CREDIT_NOTE", "CN-1", 800], ["DEBIT_NOTE", "DN-1", 850]]);
    expect(s.closing).toBe(850);
    expect(s.outstanding.map((o) => o.balance)).toEqual([850]);
    // as at the start of August neither note had happened
    expect(buildStatement(invoices, [{ id: "c1", invoiceId: "a", date: day("2026-08-01"), kind: "CREDIT_NOTE", reference: "CN-1", amount: 200 }], 0, day("2026-07-15"), [{ id: "d1", invoiceId: "a", date: day("2026-08-15"), reference: "DN-1", amount: 50 }]).closing).toBe(1000);
  });
});
