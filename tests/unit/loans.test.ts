import { describe, expect, it } from "vitest";
import { checkLoanLimits, installmentFor, loanPosition, nextMonth } from "@/lib/loans";

describe("loanPosition", () => {
  it("counts cash and processed deductions as repaid, pending/approved ones as scheduled, and ignores dead ones", () => {
    const p = loanPosition(120000, [
      { kind: "CASH", amount: 10000, deductionStatus: null },
      { kind: "PAYROLL", amount: 10000, deductionStatus: "PROCESSED" },
      { kind: "PAYROLL", amount: 10000, deductionStatus: "APPROVED" },
      { kind: "PAYROLL", amount: 10000, deductionStatus: "PENDING" },
      { kind: "PAYROLL", amount: 10000, deductionStatus: "REJECTED" },
      { kind: "PAYROLL", amount: 10000, deductionStatus: "CANCELLED" },
    ]);
    expect(p).toEqual({ repaid: 20000, scheduled: 20000, outstanding: 100000, unscheduled: 80000 });
  });
  it("never goes negative and treats a fully repaid loan as nothing outstanding", () => {
    expect(loanPosition(50000, [{ kind: "CASH", amount: 60000, deductionStatus: null }])).toEqual({ repaid: 60000, scheduled: 0, outstanding: 0, unscheduled: 0 });
  });
  it("a settlement deduction counts like a payroll one", () => {
    expect(loanPosition(40000, [{ kind: "SETTLEMENT", amount: 40000, deductionStatus: "APPROVED" }])).toMatchObject({ scheduled: 40000, unscheduled: 0 });
  });
});

describe("installmentFor and nextMonth", () => {
  it("rounds up to the kobo so the last instalment is never bigger", () => {
    expect(installmentFor(100000, 3)).toBe(33333.34);
    expect(installmentFor(120000, 12)).toBe(10000);
    expect(installmentFor(50000, 1)).toBe(50000);
  });
  it("rolls December into the next year", () => {
    expect(nextMonth(new Date("2026-10-05T00:00:00Z"))).toEqual({ year: 2026, month: 11 });
    expect(nextMonth(new Date("2026-12-31T00:00:00Z"))).toEqual({ year: 2027, month: 1 });
  });
});

describe("checkLoanLimits", () => {
  const limits = { loanMaxGrossMultiple: 3, loanMaxDeductionPct: 33, advanceMaxGrossPct: 50 };
  const base = { type: "LOAN" as const, principal: 200000, installment: 20000, monthlyGross: 100000, existingOutstanding: 0, existingInstallments: 0 };

  it("allows a loan within both limits", () => {
    expect(checkLoanLimits(base, limits)).toBeNull();
  });
  it("blocks a loan above the gross multiple, counting what is already owed", () => {
    expect(checkLoanLimits({ ...base, principal: 350000 }, limits)).toMatch(/3× monthly gross/);
    expect(checkLoanLimits({ ...base, existingOutstanding: 150000 }, limits)).toMatch(/3× monthly gross/);
  });
  it("blocks a repayment above the share of gross, counting other instalments", () => {
    expect(checkLoanLimits({ ...base, installment: 40000 }, limits)).toMatch(/33% of monthly gross/);
    expect(checkLoanLimits({ ...base, installment: 20000, existingInstallments: 15000 }, limits)).toMatch(/33%/);
  });
  it("limits an advance to a share of gross", () => {
    expect(checkLoanLimits({ ...base, type: "SALARY_ADVANCE", principal: 50000 }, limits)).toBeNull();
    expect(checkLoanLimits({ ...base, type: "SALARY_ADVANCE", principal: 60000 }, limits)).toMatch(/50%/);
  });
  it("treats 0 as no limit", () => {
    expect(checkLoanLimits({ ...base, principal: 9_000_000, installment: 900_000 }, { loanMaxGrossMultiple: 0, loanMaxDeductionPct: 0, advanceMaxGrossPct: 0 })).toBeNull();
  });
});
