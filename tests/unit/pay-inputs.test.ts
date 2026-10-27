import { describe, expect, it } from "vitest";
import { Exact } from "@/lib/exact-fraction";
import { MoneyError } from "@/lib/money-exact";
import { NTA_2025_BANDS, type TaxRuleDef } from "@/lib/payroll/paye";
import {
  arrearsDifference,
  arrearsImpacts,
  correctedAmountFor,
  minus,
  overtimeAmountAcceptable,
  overtimePay,
  pensionableShareFromPercentages,
  pensionableShareOf,
  percentOfAmount,
  totalOf,
} from "@/lib/payroll/pay-inputs";

/**
 * The arithmetic behind overtime pay, arrears and recurring deductions, in exact arithmetic. Every expected figure is worked by hand.
 * A "tie" is an amount that ends in exactly half a kobo: half up goes UP. Today's floating-point arithmetic rounded these down by a kobo.
 */
const RULE: TaxRuleDef = {
  code: "T",
  version: "1",
  bands: NTA_2025_BANDS,
  reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true }],
  exemptions: [],
};

describe("overtime pay: hours × the hourly rate, rounded half up to the kobo once", () => {
  it("ties go up: 0.5 h × ₦256.21 = 128.105 → ₦128.11 (was ₦128.10)", () => {
    expect(overtimePay(0.5, 256.21)).toBe(128.11);
  });
  it("1.5 h × ₦525.01 = 787.515 → ₦787.52, and 2.5 h × ₦33.33 = 83.325 → ₦83.33", () => {
    expect(overtimePay(1.5, 525.01)).toBe(787.52);
    expect(overtimePay(2.5, 33.33)).toBe(83.33);
  });
  it("keeps the figures that were already right", () => {
    expect(overtimePay(8, 525)).toBe(4200);
    expect(overtimePay(1, 312.53)).toBe(312.53);
    expect(overtimePay(0, 500)).toBe(0);
  });
  it("an hourly rate typed with more than two decimals is worked exactly: 1 h × ₦100.005 = 100.005 → ₦100.01", () => {
    expect(overtimePay(1, 100.005)).toBe(100.01);
  });
  it("agrees with an independent calculation across half-hour steps and rates", () => {
    for (let h2 = 1; h2 <= 80; h2++)
      for (let r = 20_000; r <= 120_000; r += 997) {
        const exact = (BigInt(r) * BigInt(h2) * 2n + 2n) / 4n; // r kobo × (h2 / 2) hours, rounded half up
        expect(Math.round(overtimePay(h2 / 2, r / 100) * 100), `${h2 / 2}h × ${r / 100}`).toBe(Number(exact));
      }
  });
  it("refuses hours or a rate that are not numbers", () => {
    expect(() => overtimePay(Number.NaN, 100)).toThrow(MoneyError);
    expect(() => overtimePay(1, Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe("an entered overtime amount may differ from the calculated one by up to one kobo", () => {
  it("exactly one kobo apart is accepted, in either direction (it was refused: 128.11 − 128.10 came out as 0.0100000000000051)", () => {
    expect(overtimeAmountAcceptable(128.11, 128.1)).toBe(true);
    expect(overtimeAmountAcceptable(128.09, 128.1)).toBe(true);
  });
  it("two kobo apart is refused, and the same amount is accepted", () => {
    expect(overtimeAmountAcceptable(128.12, 128.1)).toBe(false);
    expect(overtimeAmountAcceptable(128.08, 128.1)).toBe(false);
    expect(overtimeAmountAcceptable(128.1, 128.1)).toBe(true);
  });
  it("a typed amount with more than two decimals is compared exactly: 128.115 against 128.105 is one kobo", () => {
    expect(overtimeAmountAcceptable(128.115, 128.105)).toBe(true);
    expect(overtimeAmountAcceptable(128.1151, 128.105)).toBe(false);
  });
});

describe("a recurring percentage deduction", () => {
  it("1% of ₦51,254.50 = 512.545 → ₦512.55 (was ₦512.54)", () => {
    expect(percentOfAmount(51254.5, 1)).toBe(512.55);
  });
  it("2.5% of ₦200,000.20 = 5,000.005 → ₦5,000.01; 7.5% of ₦111 = 8.325 → ₦8.33", () => {
    expect(percentOfAmount(200000.2, 2.5)).toBe(5000.01);
    expect(percentOfAmount(111, 7.5)).toBe(8.33);
  });
  it("keeps the usual figures: 5% of ₦300,000 is ₦15,000; 0% is nothing", () => {
    expect(percentOfAmount(300000, 5)).toBe(15000);
    expect(percentOfAmount(300000, 0)).toBe(0);
  });
  it("refuses an amount part-way through a kobo and a percentage with more than four decimals", () => {
    expect(() => percentOfAmount(100.005, 5)).toThrow(MoneyError);
    expect(() => percentOfAmount(100, 5.12345)).toThrow(MoneyError);
  });
});

describe("adding and subtracting stored amounts", () => {
  it("totalOf adds exactly: 0.1 + 0.2 is 0.3, a thousand 0.1s are 100, an empty list is 0", () => {
    expect(totalOf([0.1, 0.2])).toBe(0.3);
    expect(totalOf(Array.from({ length: 1000 }, () => 0.1))).toBe(100);
    expect(totalOf([])).toBe(0);
    expect(totalOf([-5.05, 5.05])).toBe(0);
  });
  it("minus subtracts exactly: 300.30 − 100.10 − 0.20 = 200", () => {
    expect(minus(300.3, 100.1, 0.2)).toBe(200);
    expect(minus(5)).toBe(5);
  });
  it("both refuse an amount part-way through a kobo", () => {
    expect(() => totalOf([1, 2.005])).toThrow(MoneyError);
    expect(() => minus(1, 0.004)).toThrow(MoneyError);
  });
});

describe("arrears", () => {
  it("the corrected amount for a part-month: ₦50,003.85 × ₦100.00 earned ÷ ₦3,000.00 monthly = 1,666.795 → ₦1,666.80 (was ₦1,666.79)", () => {
    expect(correctedAmountFor(50003.85, 100, 3000)).toBe(1666.8);
  });
  it("a month with no monthly gross gives nothing, not an error", () => {
    expect(correctedAmountFor(50000, 100, 0)).toBe(0);
  });
  it("the difference is corrected less original, exactly: 100,000.20 − 99,999.90 = 0.30", () => {
    expect(arrearsDifference(99999.9, 100000.2)).toBe(0.3);
    expect(arrearsDifference(100, 90)).toBe(-10);
    expect(arrearsDifference(100, 100)).toBe(0);
  });
  it("the pensionable share is the pension base over the earned gross, or a sum of percentages when there is no record", () => {
    expect(pensionableShareOf(39000, 100000).cmp(Exact.ratio(39, 100))).toBe(0);
    expect(pensionableShareOf(10, 0).isZero()).toBe(true);
    expect(pensionableShareFromPercentages([10, 14, 15]).cmp(Exact.ratio(39, 100))).toBe(0);
    expect(pensionableShareFromPercentages([12.5, 7.5]).cmp(Exact.ratio(1, 5))).toBe(0);
  });

  it("works through a pay rise back-dated: ₦10,000 more on ₦200,000 a month, 39% pensionable, 8% pension", () => {
    // pensionable 10,000 × 0.39 = 3,900; pension 8% = 312. Annual 2,400,000 less pension 76,800 = 2,323,200: the extra 10,000 is all in the 15% band, so tax +1,500.
    const r = arrearsImpacts({ difference: 10000, pensionableShare: Exact.ratio(39, 100), employeePensionRatePct: 8, regularTaxable: 200000, employeePension: 6400, taxRule: RULE });
    expect(r).toEqual({ pensionableImpact: 3900, pensionImpact: 312, taxImpact: 1500, netImpact: 8188 });
  });
  it("a tie in the pensionable part: ₦1,024.09 × ½ = 512.045 → ₦512.05 (was ₦512.04); pension 7.5% = 38.40375 → ₦38.40; tax 153.61; net ₦832.08", () => {
    // regular 100,000 with pension 3,200: tax 15% × (1,200,000 − 38,400 − 800,000) = 54,240 a year = 4,520.00 a month.
    // With the extra 1,024.09 the month's tax is 4,520 + 153.6135 = 4,673.6135 → 4,673.61, so the tax impact is 153.61.
    const r = arrearsImpacts({ difference: 1024.09, pensionableShare: Exact.ratio(1, 2), employeePensionRatePct: 7.5, regularTaxable: 100000, employeePension: 3200, taxRule: RULE });
    expect(r).toEqual({ pensionableImpact: 512.05, pensionImpact: 38.4, taxImpact: 153.61, netImpact: 832.08 });
  });
  it("a correction downwards lowers the tax: −₦10,000 on ₦200,000 gives pension −312 and tax −1,500", () => {
    const r = arrearsImpacts({ difference: -10000, pensionableShare: Exact.ratio(39, 100), employeePensionRatePct: 8, regularTaxable: 200000, employeePension: 6400, taxRule: RULE });
    expect(r).toEqual({ pensionableImpact: -3900, pensionImpact: -312, taxImpact: -1500, netImpact: -8188 });
  });
});
