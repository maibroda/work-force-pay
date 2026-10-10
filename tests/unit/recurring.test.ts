import { describe, expect, it } from "vitest";
import { nextAfter, occurrence, renderDescription, templateProblems, type TemplateFacts } from "@/lib/recurring";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("occurrence", () => {
  it("steps by month, quarter and year from the start date", () => {
    expect(iso(occurrence(day("2026-01-15"), 0, "MONTHLY", false))).toBe("2026-01-15");
    expect(iso(occurrence(day("2026-01-15"), 13, "MONTHLY", false))).toBe("2027-02-15");
    expect(iso(occurrence(day("2026-01-15"), 3, "QUARTERLY", false))).toBe("2026-10-15");
    expect(iso(occurrence(day("2026-03-01"), 2, "YEARLY", false))).toBe("2028-03-01");
  });

  it("stays on the last day for month-end templates, leap years included", () => {
    expect(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map((_, n) => iso(occurrence(day("2026-01-31"), n, "MONTHLY", true)))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(iso(occurrence(day("2027-01-31"), 1, "MONTHLY", true))).toBe("2027-02-28");
    expect(iso(occurrence(day("2028-01-31"), 1, "MONTHLY", true))).toBe("2028-02-29");
  });

  it("clamps a 31st to short months without drifting afterwards", () => {
    const seq = [0, 1, 2, 3].map((n) => iso(occurrence(day("2026-01-31"), n, "MONTHLY", false)));
    expect(seq).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("crosses year ends", () => {
    expect(iso(occurrence(day("2026-11-30"), 3, "MONTHLY", true))).toBe("2027-02-28");
    expect(iso(occurrence(day("2026-12-31"), 1, "QUARTERLY", true))).toBe("2027-03-31");
  });
});

describe("nextAfter", () => {
  it("is the following date, or nothing once it passes the end date", () => {
    expect(iso(nextAfter(day("2026-01-31"), 0, "MONTHLY", true, null))).toBe("2026-02-28");
    expect(iso(nextAfter(day("2026-01-31"), 1, "MONTHLY", true, day("2026-03-31")))).toBe("2026-03-31");
    expect(nextAfter(day("2026-01-31"), 2, "MONTHLY", true, day("2026-03-31"))).toBeNull();
  });
});

describe("renderDescription", () => {
  it("fills in the month, quarter and year the journal posts in", () => {
    expect(renderDescription("Rent for {month}", day("2026-09-30"))).toBe("Rent for September 2026");
    expect(renderDescription("Insurance {quarter} / {year}", day("2026-11-30"))).toBe("Insurance Q4 2026 / 2026");
    expect(renderDescription("No placeholders", day("2026-01-01"))).toBe("No placeholders");
  });
});

describe("templateProblems", () => {
  const line = (accountId: string, debit: number, credit: number) => ({ accountId, description: "", debit, credit });
  const ok: TemplateFacts = {
    name: "Insurance",
    kind: "MANUAL",
    description: "Insurance for {month}",
    frequency: "MONTHLY",
    monthEnd: true,
    startDate: day("2026-08-31"),
    endDate: null,
    reverseAfterDays: null,
    lines: [line("a", 100, 0), line("b", 0, 100)],
  };

  it("accepts a sound template", () => {
    expect(templateProblems(ok)).toEqual([]);
  });

  it("says what is wrong", () => {
    expect(templateProblems({ ...ok, name: "x" })).toContain("Give the template a name.");
    expect(templateProblems({ ...ok, startDate: null })).toContain("Choose the date of the first journal.");
    expect(templateProblems({ ...ok, startDate: day("2026-08-30") })).toContain("Posting on the last day of the month needs the first date to be a month end.");
    expect(templateProblems({ ...ok, endDate: day("2026-07-31") })).toContain("The end date is before the first journal.");
    expect(templateProblems({ ...ok, lines: [line("a", 100, 0), line("b", 0, 60)] }).join(" ")).toMatch(/doesn't balance/);
  });

  it("holds an accrual to a reversal interval", () => {
    expect(templateProblems({ ...ok, kind: "ACCRUAL", reverseAfterDays: null }).join(" ")).toMatch(/days after which it reverses/);
    expect(templateProblems({ ...ok, kind: "ACCRUAL", reverseAfterDays: 1 })).toEqual([]);
    expect(templateProblems({ ...ok, kind: "ACCRUAL", reverseAfterDays: 400 }).join(" ")).toMatch(/1 to 90/);
  });
});
