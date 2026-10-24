import { describe, expect, it } from "vitest";
import { closingLines, yearEndProblems, type PlBalance, type YearPeriod } from "@/lib/year-end";

const period = (number: number, status: YearPeriod["status"], journals: number): YearPeriod => ({ number, name: `P${number}`, status, journals });
const all = (status: YearPeriod["status"], journals = 1) => Array.from({ length: 12 }, (_, i) => period(i + 1, status, journals));

describe("yearEndProblems", () => {
  it("is ready when every earlier period with postings is closed and the last still accepts postings", () => {
    const ps = [...all("CLOSED").slice(0, 11), period(12, "SOFT_CLOSED", 1)];
    expect(yearEndProblems({ name: "FY2026", closed: false }, ps)).toEqual([]);
    expect(yearEndProblems({ name: "FY2026", closed: false }, [...all("CLOSED").slice(0, 11), period(12, "OPEN", 0)])).toEqual([]);
  });

  it("names each earlier period with postings that is still open, ignoring empty ones", () => {
    const ps = all("OPEN", 0);
    ps[2] = period(3, "OPEN", 4);
    ps[5] = period(6, "SOFT_CLOSED", 2);
    const out = yearEndProblems({ name: "FY2026", closed: false }, ps);
    expect(out).toEqual(["P3 has postings and is still open. Close it first.", "P6 has postings and is still soft closed. Close it first."]);
  });

  it("explains a last period that is already closed or locked", () => {
    expect(yearEndProblems({ name: "FY2026", closed: false }, [...all("CLOSED").slice(0, 11), period(12, "CLOSED", 3)]).join(" ")).toMatch(/already closed.*Reopen it, with a reason/);
    expect(yearEndProblems({ name: "FY2026", closed: false }, [...all("LOCKED").slice(0, 11), period(12, "LOCKED", 3)]).join(" ")).toMatch(/already locked.*can't be reopened/);
  });

  it("says a year already closed is closed, and a year with no periods has none", () => {
    expect(yearEndProblems({ name: "FY2026", closed: true }, all("CLOSED"))).toEqual(["FY2026 has already been closed."]);
    expect(yearEndProblems({ name: "FY2026", closed: false }, [])).toEqual(["This year has no periods."]);
  });
});

describe("closingLines", () => {
  const bal = (accountId: string, debit: number, credit: number, dimensions: Record<string, string> = {}): PlBalance => ({ accountId, dimensions, debit, credit });

  it("clears each income balance with a debit and each expense balance with a credit, and credits the profit to retained earnings", () => {
    const { lines, profit } = closingLines([bal("rev", 0, 12_000_000), bal("cost", 1_500_000, 0, { costCenterId: "cc1" })], "re");
    expect(profit).toBe(10_500_000);
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([["rev", 12_000_000, 0], ["cost", 0, 1_500_000], ["re", 0, 10_500_000]]);
    expect(lines[1].dimensions).toEqual({ costCenterId: "cc1" }); // the expense keeps its cost centre, so the dimension report still nets to nil
    expect(lines[2].dimensions).toEqual({});
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });

  it("debits retained earnings for a loss", () => {
    const { lines, profit } = closingLines([bal("rev", 0, 100), bal("cost", 400, 0)], "re");
    expect(profit).toBe(-300);
    expect(lines.at(-1)).toMatchObject({ accountId: "re", debit: 300, credit: 0 });
  });

  it("keeps separate dimension combinations separate, works to the kobo, and skips balances that are already nil", () => {
    const { lines, profit } = closingLines([bal("rev", 0.1, 100.3, { contractId: "a" }), bal("rev", 0, 50.05, { contractId: "b" }), bal("cost", 10, 10), bal("x", 0, 0)], "re");
    expect(lines).toHaveLength(3);
    expect(profit).toBe(150.25);
    expect(lines.filter((l) => l.accountId === "rev").map((l) => l.debit)).toEqual([100.2, 50.05]);
  });

  it("makes no lines at all when there is nothing to close", () => {
    expect(closingLines([], "re")).toEqual({ lines: [], profit: 0 });
    expect(closingLines([bal("rev", 5, 5)], "re")).toEqual({ lines: [], profit: 0 });
  });
});
