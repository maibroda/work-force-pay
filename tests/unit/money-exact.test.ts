import { describe, expect, it } from "vitest";
import { addKobo, asKobo, koboFromNaira, koboOrZero, koboToNumber, koboToString, MoneyError, mulDiv, mulPct, negKobo, pctToRate, RATE_SCALE, roundRatio, subKobo, sumKobo, toKobo } from "@/lib/money-exact";
import { round2 } from "@/lib/money";

const k = (naira: string) => toKobo(naira);
const out = (kobo: number) => koboToString(asKobo(kobo));

describe("reading an amount in naira", () => {
  it("reads whole naira, one decimal and two decimals as exact kobo", () => {
    expect(k("123")).toBe(12300);
    expect(k("123.4")).toBe(12340);
    expect(k("123.45")).toBe(12345);
    expect(k("0.05")).toBe(5);
    expect(k("-0.05")).toBe(-5);
    expect(k("  12.5 ")).toBe(1250);
    expect(k("0")).toBe(0);
  });
  it("never produces a negative zero", () => {
    expect(Object.is(k("-0"), 0)).toBe(true);
    expect(Object.is(k("-0.00"), 0)).toBe(true);
  });
  it("reads a number only if it is exactly an amount in kobo", () => {
    expect(toKobo(35001.72)).toBe(3500172);
    expect(toKobo(0.1)).toBe(10);
    expect(() => toKobo(0.1 + 0.2)).toThrow(MoneyError); // 0.30000000000000004 is not an amount
    expect(() => toKobo(1 / 3)).toThrow(MoneyError);
  });
  it("reads a stored decimal (Prisma's Decimal) through its plain text, never through a float", () => {
    const decimal = { toFixed: () => "9876543210.01", toString: () => "9.876543210010e+9" };
    expect(toKobo(decimal)).toBe(987654321001);
    expect(toKobo({ toFixed: () => "12.30" })).toBe(1230);
  });
  it("refuses anything that is not a clean amount: sub-kobo digits, text, exponents, blanks, missing values", () => {
    for (const bad of ["12.345", "1e5", "1,234.50", "abc", "", "  ", "12.", ".5", "--1", "NaN", "Infinity", null, undefined, NaN, Infinity, {}, []]) expect(() => toKobo(bad), String(bad)).toThrow(MoneyError);
  });
  it("refuses an amount too large to hold exactly", () => {
    expect(() => toKobo("90071992547409.92")).toThrow(/too large/i);
    expect(toKobo("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("treats a missing database value as zero only when asked to", () => {
    expect(koboOrZero(null)).toBe(0);
    expect(koboOrZero(undefined)).toBe(0);
    expect(koboOrZero("5.50")).toBe(550);
    expect(() => koboOrZero("5.555")).toThrow(MoneyError);
  });
});

describe("writing an amount back out", () => {
  it("writes exact text, two decimals, with the sign", () => {
    expect(out(0)).toBe("0.00");
    expect(out(5)).toBe("0.05");
    expect(out(-5)).toBe("-0.05");
    expect(out(123456)).toBe("1234.56");
    expect(out(-123456)).toBe("-1234.56");
    expect(out(100)).toBe("1.00");
  });
  it("gives back exactly what was read", () => {
    for (let i = -250000; i <= 250000; i += 997) expect(toKobo(out(i))).toBe(i);
  });
  it("offers a plain number for display only, and refuses a value that isn't whole kobo", () => {
    expect(koboToNumber(asKobo(3500172))).toBe(35001.72);
    expect(() => asKobo(1.5)).toThrow(MoneyError);
    expect(() => asKobo(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
    expect(() => asKobo(NaN)).toThrow(MoneyError);
  });
});

describe("reading a rate", () => {
  it("reads a percentage with up to four decimals as an exact whole number of units", () => {
    expect(pctToRate("8")).toBe(80000);
    expect(pctToRate("7.5")).toBe(75000);
    expect(pctToRate("2.5")).toBe(25000);
    expect(pctToRate("12.3456")).toBe(123456);
    expect(pctToRate("0")).toBe(0);
    expect(pctToRate(7.5)).toBe(75000);
    expect(pctToRate({ toFixed: () => "33.3333" })).toBe(333333);
  });
  it("refuses more than four decimals, a negative rate, and anything that is not a number", () => {
    for (const bad of ["12.34567", "-1", "abc", "", null, undefined, NaN, 1 / 3, "1e2"]) expect(() => pctToRate(bad), String(bad)).toThrow(MoneyError);
  });
});

describe("a percentage of an amount, rounded half up to the kobo at that line", () => {
  // Each of these is a tie: the exact answer ends in half a kobo. Worked by hand: 70% of 50,002.45 is 35,001.715, which rounds up to 35,001.72.
  const ties: [string, string, string][] = [
    ["50002.45", "70", "35001.72"],
    ["50001.05", "10", "5000.11"],
    ["50009.80", "2.5", "1250.25"],
    ["51242.50", "1", "512.43"],
    ["54638.90", "15", "8195.84"],
    ["50015.75", "18", "9002.84"],
    ["78101.50", "21", "16401.32"],
    ["71241.50", "23", "16385.55"],
    ["54615.45", "30", "16384.64"],
  ];
  it.each(ties)("%s × %s%% = %s", (amount, pct, expected) => {
    expect(out(mulPct(k(amount), pctToRate(pct)))).toBe(expected);
  });
  it("rounds just below a tie down and just above it up", () => {
    expect(out(mulPct(k("50002.44"), pctToRate("70")))).toBe("35001.71"); // 35,001.708
    expect(out(mulPct(k("50002.46"), pctToRate("70")))).toBe("35001.72"); // 35,001.722
  });
  it("works with rates of up to four decimals", () => {
    expect(out(mulPct(k("1000.00"), pctToRate("7.5")))).toBe("75.00");
    expect(out(mulPct(k("1000.00"), pctToRate("0.0001")))).toBe("0.00"); // 0.001, below half a kobo
    expect(out(mulPct(k("1000000.00"), pctToRate("0.0001")))).toBe("1.00");
    expect(out(mulPct(k("123456.78"), pctToRate("8.125")))).toBe("10030.86"); // 10,030.8642...
  });
  it("is exact at the edges: all of it, none of it", () => {
    expect(mulPct(k("987654.32"), pctToRate("100"))).toBe(k("987654.32"));
    expect(mulPct(k("987654.32"), pctToRate("0"))).toBe(0);
  });
  it("rounds a negative amount half away from zero, so a reversal exactly mirrors the original", () => {
    expect(out(mulPct(k("-50002.45"), pctToRate("70")))).toBe("-35001.72");
    for (const [a, p] of [["50001.05", "10"], ["54638.90", "15"], ["12.34", "7.5"], ["0.07", "50"]] as const)
      expect(mulPct(negKobo(k(a)), pctToRate(p))).toBe(negKobo(mulPct(k(a), pctToRate(p))));
  });
  it("never yields a negative zero", () => {
    expect(Object.is(mulPct(k("-0.01"), pctToRate("1")), 0)).toBe(true);
  });
  it("agrees with an independently worked answer on a large grid of amounts and rates", () => {
    // The oracle is written differently on purpose: whole kobo divided by 10^6 with the remainder compared to half, using BigInt.
    const rates = ["8", "10", "2.5", "1", "15", "18", "21", "23", "25", "70", "30", "7.5", "0.5", "12.3456", "33.3333", "100"];
    let checked = 0;
    for (const r of rates) {
      const rate = BigInt(pctToRate(r));
      for (let amount = 5_000_000n; amount <= 90_000_000n; amount += 997n) {
        const prod = amount * rate;
        const q = prod / 1_000_000n;
        const rem = prod % 1_000_000n;
        const expected = rem * 2n >= 1_000_000n ? q + 1n : q;
        expect(BigInt(mulPct(asKobo(Number(amount)), pctToRate(r)))).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
  });
  it("gets right the cases today's rounding gets wrong (so the old and new utilities are proved to differ, not assumed to)", () => {
    // today's way: floating point. These two are the first disagreements found in the measurement; the exact answer is the second column.
    expect(round2((50002.45 * 70) / 100)).toBe(35001.71);
    expect(out(mulPct(k("50002.45"), pctToRate("70")))).toBe("35001.72");
    expect(round2((50000.55 * 5) / 30)).toBe(8333.42);
    expect(out(mulDiv(k("50000.55"), 5, 30))).toBe("8333.43");
  });
});

describe("an amount multiplied by a whole number over another (days paid over days in the month)", () => {
  it("rounds half up to the kobo", () => {
    expect(out(mulDiv(k("50000.55"), 5, 30))).toBe("8333.43"); // 8,333.425
    expect(out(mulDiv(k("100.00"), 1, 3))).toBe("33.33");
    expect(out(mulDiv(k("100.00"), 2, 3))).toBe("66.67");
    expect(out(mulDiv(k("100.00"), 1, 8))).toBe("12.50");
    expect(out(mulDiv(k("0.01"), 1, 2))).toBe("0.01"); // half a kobo rounds up
    expect(out(mulDiv(k("0.01"), 1, 3))).toBe("0.00");
  });
  it("is the amount itself when the whole month is paid, and zero when none is", () => {
    for (const basis of [28, 30, 31]) {
      expect(mulDiv(k("98765.43"), basis, basis)).toBe(k("98765.43"));
      expect(mulDiv(k("98765.43"), 0, basis)).toBe(0);
    }
  });
  it("rounds a negative amount half away from zero", () => {
    expect(out(mulDiv(k("-50000.55"), 5, 30))).toBe("-8333.43");
    expect(mulDiv(k("-100.00"), 2, 3)).toBe(negKobo(mulDiv(k("100.00"), 2, 3)));
  });
  it("agrees with an independently worked answer for every day count in a 30- and 31-day month", () => {
    for (const basis of [30, 31]) {
      for (let amount = 5_000_000n; amount <= 20_000_000n; amount += 12_347n) {
        for (let paid = 0; paid <= basis; paid++) {
          const prod = amount * BigInt(paid);
          const q = prod / BigInt(basis);
          const rem = prod % BigInt(basis);
          const expected = rem * 2n >= BigInt(basis) ? q + 1n : q;
          expect(BigInt(mulDiv(asKobo(Number(amount)), paid, basis))).toBe(expected);
        }
      }
    }
  });
  it("copes with very large amounts without losing a kobo", () => {
    // ₦9 trillion × 31 / 30: the intermediate product is far beyond what a plain number holds exactly
    expect(out(mulDiv(k("9000000000000.00"), 31, 30))).toBe("9300000000000.00");
    expect(out(mulDiv(k("8999999999999.99"), 31, 31))).toBe("8999999999999.99");
  });
  it("stays exact when the intermediate product is beyond what a plain number holds (the cases floating point silently gets wrong)", () => {
    // 899,999,999,999,999 kobo × 31 = 27,899,999,999,999,969: more than 2^53, so a plain number can't hold it. Exact answer 9,299,999,999,999.99.
    expect(out(mulDiv(k("8999999999999.99"), 31, 30))).toBe("9299999999999.99");
    expect(out(mulPct(k("8999999999999.99"), pctToRate("33.3333")))).toBe("2999997000000.00"); // 2,999,996,999,999.99666... rounds up to the next whole naira
    // and across a grid of very large amounts against the independently worked answer
    const rate = BigInt(pctToRate("33.3333"));
    for (let amount = 800_000_000_000_001n; amount <= 900_000_000_000_000n; amount += 3_333_333_333_337n) {
      const prod = amount * rate;
      const q = prod / 1_000_000n;
      const expected = (prod % 1_000_000n) * 2n >= 1_000_000n ? q + 1n : q;
      expect(BigInt(mulPct(asKobo(Number(amount)), pctToRate("33.3333")))).toBe(expected);
      const prod2 = amount * 31n;
      const q2 = prod2 / 30n;
      const expected2 = (prod2 % 30n) * 2n >= 30n ? q2 + 1n : q2;
      expect(BigInt(mulDiv(asKobo(Number(amount)), 31, 30))).toBe(expected2);
    }
  });
  it("refuses a bottom number that is zero, negative or not whole, a top that is not whole, and a result too large to hold", () => {
    for (const d of [0, -1, 1.5, NaN]) expect(() => mulDiv(k("1"), 1, d), `bottom ${d}`).toThrow(MoneyError);
    for (const n of [1.5, NaN, Infinity]) expect(() => mulDiv(k("1"), n, 30), `top ${n}`).toThrow(MoneyError);
    expect(() => mulDiv(asKobo(Number.MAX_SAFE_INTEGER), 2, 1)).toThrow(/too large/i);
  });
});

describe("adding up", () => {
  it("adds exactly, with no drift (3,000 lines of ₦12,345.67 are exactly ₦37,037,010.00)", () => {
    let float = 0;
    for (let i = 0; i < 3000; i++) float += 12345.67;
    expect(float).not.toBe(37037010); // the floating-point total is a hair out, which is what this utility exists to avoid
    expect(out(sumKobo(Array.from({ length: 3000 }, () => k("12345.67"))))).toBe("37037010.00");
  });
  it("adds nothing to zero, and handles negatives", () => {
    expect(sumKobo([])).toBe(0);
    expect(out(sumKobo([k("100.10"), k("-0.10"), k("-100.00")]))).toBe("0.00");
    expect(Object.is(sumKobo([k("1"), k("-1")]), 0)).toBe(true);
  });
  it("adds and subtracts two amounts, and refuses a total too large to hold", () => {
    expect(out(addKobo(k("0.10"), k("0.20")))).toBe("0.30");
    expect(out(subKobo(k("1.00"), k("1.01")))).toBe("-0.01");
    expect(() => sumKobo([asKobo(Number.MAX_SAFE_INTEGER), asKobo(1)])).toThrow(/too large/i);
    expect(() => addKobo(asKobo(Number.MAX_SAFE_INTEGER), asKobo(1))).toThrow(/too large/i);
  });
});

describe("rounding an exact ratio computed in big whole numbers (used where many exact parts are added before one rounding)", () => {
  it("rounds half up to the kobo, once", () => {
    expect(out(roundRatio(5n, 2n))).toBe("0.03"); // 2.5 kobo
    expect(out(roundRatio(4n, 3n))).toBe("0.01"); // 1.33
    expect(out(roundRatio(7n, 3n))).toBe("0.02"); // 2.33
    expect(out(roundRatio(1n, 2n))).toBe("0.01"); // half a kobo goes up
    expect(out(roundRatio(0n, 7n))).toBe("0.00");
  });
  it("rounds a negative on its size, so it mirrors the positive, and never gives negative zero", () => {
    expect(out(roundRatio(-5n, 2n))).toBe("-0.03");
    expect(out(roundRatio(-1n, 2n))).toBe("-0.01");
    expect(Object.is(roundRatio(-1n, 3n), 0)).toBe(true);
  });
  it("agrees with the percentage rule: an amount times a rate over RATE_SCALE is mulPct", () => {
    const amount = k("50002.45");
    const rate = pctToRate("70");
    expect(roundRatio(BigInt(amount) * BigInt(rate), RATE_SCALE)).toBe(mulPct(amount, rate));
    expect(out(roundRatio(BigInt(amount) * BigInt(rate), RATE_SCALE))).toBe("35001.72");
  });
  it("refuses a denominator that is not above zero, and a result too large to hold", () => {
    expect(() => roundRatio(1n, 0n)).toThrow(MoneyError);
    expect(() => roundRatio(1n, -3n)).toThrow(MoneyError);
    expect(() => roundRatio(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n)).toThrow(/too large/i);
  });
});

describe("the temporary bridge from a naira number (until the services pass kobo)", () => {
  it("reads a number that is a whole number of kobo", () => {
    expect(koboFromNaira(84000)).toBe(8_400_000);
    expect(koboFromNaira(0.05)).toBe(5);
    expect(koboFromNaira(-1234.56)).toBe(-123_456);
    expect(Object.is(koboFromNaira(-0), 0)).toBe(true);
  });
  it("takes floating-point dust left by earlier arithmetic as the kobo it was meant to be", () => {
    expect(koboFromNaira(0.1 + 0.2)).toBe(30);
    expect(koboFromNaira(84000.00000000001)).toBe(8_400_000);
    expect(koboFromNaira(1234.5599999999999)).toBe(123_456);
  });
  it("refuses an amount part-way through a kobo, a number that is not finite, and one too large to hold", () => {
    expect(() => koboFromNaira(84000.005)).toThrow(MoneyError);
    expect(() => koboFromNaira(0.004, "The pension")).toThrow(/The pension/);
    expect(() => koboFromNaira(Number.NaN)).toThrow(MoneyError);
    expect(() => koboFromNaira(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => koboFromNaira(1e15)).toThrow(/too large/i);
  });
});

describe("a worked pay example, end to end (the explain-back example)", () => {
  it("an operative earns 70% of the client rate, pays 8% pension on the pensionable part, with 5 of 30 days paid", () => {
    const clientRate = k("150000.50");
    const share = mulPct(clientRate, pctToRate("70")); // 105,000.35 exactly
    expect(out(share)).toBe("105000.35");
    const paid = mulDiv(share, 5, 30); // 17,500.0583... → 17,500.06
    expect(out(paid)).toBe("17500.06");
    const pension = mulPct(paid, pctToRate("8")); // 1,400.0048 → 1,400.00
    expect(out(pension)).toBe("1400.00");
    expect(out(subKobo(paid, pension))).toBe("16100.06");
  });
});
