import { describe, expect, it } from "vitest";
import { MoneyError } from "@/lib/money-exact";
import { checkLoanLimits, installmentFor, loanPosition } from "@/lib/loans";

/**
 * Loans in exact arithmetic. The instalment keeps its rule of rounding UP to the kobo (so the last instalment is never larger than the rest);
 * what changes is that it is now exact: it used to tip over by a kobo when the division was exact. Limits compare in whole kobo.
 */
describe("the instalment rounds UP to the kobo, exactly", () => {
  it("an exact division gets no extra kobo: ₦262,976.78 in one instalment is ₦262,976.78 (it was ₦262,976.79)", () => {
    expect(installmentFor(262976.78, 1)).toBe(262976.78);
  });
  it("a remainder rounds up: ₦100,000 ÷ 3 = 33,333.33… → ₦33,333.34; ₦0.01 ÷ 3 → ₦0.01", () => {
    expect(installmentFor(100000, 3)).toBe(33333.34);
    expect(installmentFor(0.01, 3)).toBe(0.01);
  });
  it("keeps the usual figures", () => {
    expect(installmentFor(120000, 12)).toBe(10000);
    expect(installmentFor(50000, 1)).toBe(50000);
    expect(installmentFor(1000, 0)).toBe(1000); // a count of 0 is treated as 1, as before
  });
  it("a principal typed with more than two decimals is taken to the kobo first, half up: 1,000.005 → 1,000.01; ÷ 2 = 500.005 → 500.01", () => {
    expect(installmentFor(1000.005, 1)).toBe(1000.01);
    expect(installmentFor(1000.005, 2)).toBe(500.01);
  });
  it("agrees with an independent calculation: the smallest whole number of kobo that covers the principal in that many instalments", () => {
    for (let count = 1; count <= 60; count++)
      for (let p = 500_00; p <= 5_000_000_00; p += 99_991) {
        const want = (BigInt(p) + BigInt(count) - 1n) / BigInt(count);
        expect(Math.round(installmentFor(p / 100, count) * 100), `${p / 100} in ${count}`).toBe(Number(want));
      }
  });
  it("the instalments always cover the loan and the last is never larger: count × instalment ≥ principal, less than count kobo over", () => {
    for (let count = 1; count <= 24; count++) {
      const p = 123456.78;
      const inst = Math.round(installmentFor(p, count) * 100);
      const over = inst * count - Math.round(p * 100);
      expect(over).toBeGreaterThanOrEqual(0);
      expect(over).toBeLessThan(count);
    }
  });
  it("refuses a principal that is not a number", () => {
    expect(() => installmentFor(Number.NaN, 3)).toThrow(MoneyError);
  });
});

describe("a loan's position is worked in whole kobo", () => {
  it("adds exactly: three repayments of ₦0.10 and ₦0.20 leave ₦0.30 repaid", () => {
    const p = loanPosition(1, [
      { kind: "CASH", amount: 0.1, deductionStatus: null },
      { kind: "CASH", amount: 0.2, deductionStatus: null },
    ]);
    expect(p).toEqual({ repaid: 0.3, scheduled: 0, outstanding: 0.7, unscheduled: 0.7 });
  });
  it("a thousand small repayments add up exactly", () => {
    const items = Array.from({ length: 1000 }, () => ({ kind: "CASH" as const, amount: 0.07, deductionStatus: null }));
    expect(loanPosition(100, items)).toEqual({ repaid: 70, scheduled: 0, outstanding: 30, unscheduled: 30 });
  });
});

describe("the affordability limits compare in whole kobo", () => {
  const limits = { loanMaxGrossMultiple: 2.5, loanMaxDeductionPct: 0, advanceMaxGrossPct: 50 };
  const loan = { type: "LOAN" as const, principal: 0, installment: 0, monthlyGross: 33333.33, existingOutstanding: 0, existingInstallments: 0 };
  it("a loan may reach the limit rounded half up to the kobo: 2.5 × ₦33,333.33 = 83,333.325 → ₦83,333.33 is allowed, ₦83,333.34 is not", () => {
    expect(checkLoanLimits({ ...loan, principal: 83333.33 }, limits)).toBeNull();
    expect(checkLoanLimits({ ...loan, principal: 83333.34 }, limits)).toMatch(/2\.5× monthly gross \(₦83,333\.33\)/);
  });
  it("what is already owed counts: the same limit with ₦0.01 already outstanding", () => {
    expect(checkLoanLimits({ ...loan, principal: 83333.32, existingOutstanding: 0.01 }, limits)).toBeNull();
    expect(checkLoanLimits({ ...loan, principal: 83333.33, existingOutstanding: 0.01 }, limits)).toMatch(/2\.5× monthly gross/);
  });
  it("an advance may reach its share of the gross: 50% of ₦100,000.01 = 50,000.005 → ₦50,000.01 is allowed, ₦50,000.02 is not", () => {
    const adv = { ...loan, type: "SALARY_ADVANCE" as const, monthlyGross: 100000.01 };
    expect(checkLoanLimits({ ...adv, principal: 50000.01 }, limits)).toBeNull();
    expect(checkLoanLimits({ ...adv, principal: 50000.02 }, limits)).toMatch(/50% of monthly gross \(₦50,000\.01\)/);
  });
  it("the monthly repayment limit: 33% of ₦100,000.03 = 33,000.0099 → ₦33,000.01 is allowed, ₦33,000.02 is not", () => {
    const l = { loanMaxGrossMultiple: 0, loanMaxDeductionPct: 33, advanceMaxGrossPct: 0 };
    const x = { ...loan, monthlyGross: 100000.03, principal: 1000 };
    expect(checkLoanLimits({ ...x, installment: 33000.01 }, l)).toBeNull();
    expect(checkLoanLimits({ ...x, installment: 33000.02 }, l)).toMatch(/33% of monthly gross/);
  });
  it("exactly at the limit is allowed (a float cap such as 0.33 × 100,000 was a hair over)", () => {
    const l = { loanMaxGrossMultiple: 0, loanMaxDeductionPct: 33, advanceMaxGrossPct: 0 };
    expect(checkLoanLimits({ ...loan, monthlyGross: 100000, principal: 1000, installment: 33000 }, l)).toBeNull();
  });
  it("0 means no limit", () => {
    expect(checkLoanLimits({ ...loan, principal: 9_000_000, installment: 900_000 }, { loanMaxGrossMultiple: 0, loanMaxDeductionPct: 0, advanceMaxGrossPct: 0 })).toBeNull();
  });
});
