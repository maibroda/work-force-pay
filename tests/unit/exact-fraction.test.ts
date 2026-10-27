import { describe, expect, it } from "vitest";
import { Exact } from "@/lib/exact-fraction";
import { koboToString, MoneyError } from "@/lib/money-exact";

const x = (n: number | bigint, d: number | bigint = 1) => Exact.ratio(n, d);
const same = (a: Exact, b: Exact) => expect(a.cmp(b)).toBe(0);

describe("Exact: building a value", () => {
  it("keeps a fraction in lowest terms with a positive bottom", () => {
    expect(x(6, 4).toString()).toBe("3/2");
    expect(x(-6, 4).toString()).toBe("-3/2");
    expect(x(6, -4).toString()).toBe("-3/2");
    expect(x(0, 5).toString()).toBe("0");
    expect(Exact.int(7).toString()).toBe("7");
  });
  it("refuses a bottom of zero, and numbers that are not whole", () => {
    expect(() => x(1, 0)).toThrow(MoneyError);
    expect(() => Exact.int(1.5)).toThrow(MoneyError);
    expect(() => x(1, 2.5)).toThrow(MoneyError);
    expect(() => Exact.int(Number.NaN)).toThrow(MoneyError);
  });
  it("reads decimal text exactly: 2.5 is 5/2, 0.125 is 1/8, -0.1 is -1/10, and 1e-3 is 1/1000", () => {
    same(Exact.decimal("2.5"), x(5, 2));
    same(Exact.decimal("0.125"), x(1, 8));
    same(Exact.decimal("-0.1"), x(-1, 10));
    same(Exact.decimal("1e-3"), x(1, 1000));
    same(Exact.decimal("12"), x(12));
    same(Exact.decimal("2.5E2"), x(250));
  });
  it("refuses text that is not a decimal number", () => {
    for (const bad of ["", "abc", "1.2.3", "1,5", ".", "1e", "--1", "0x10"]) expect(() => Exact.decimal(bad), bad).toThrow(MoneyError);
  });
  it("reads a number through its shortest decimal text, so 0.1 is exactly one tenth (not the binary value)", () => {
    same(Exact.fromNumber(0.1), x(1, 10));
    same(Exact.fromNumber(0.1).add(Exact.fromNumber(0.2)), x(3, 10));
    same(Exact.fromNumber(1e-7), x(1, 10_000_000));
    expect(() => Exact.fromNumber(Number.NaN)).toThrow(MoneyError);
    expect(() => Exact.fromNumber(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe("Exact: arithmetic never loses a digit", () => {
  it("adds, subtracts, multiplies and divides exactly", () => {
    same(x(1, 3).add(x(1, 6)), x(1, 2));
    same(x(1, 3).sub(x(1, 2)), x(-1, 6));
    same(x(2, 3).mul(x(3, 4)), x(1, 2));
    same(x(1, 3).div(x(2, 9)), x(3, 2));
    same(x(5).neg(), x(-5));
    same(x(1, 3).mul(Exact.int(3)), Exact.int(1));
  });
  it("a third times three is exactly one, and a thousand tenths add to exactly a hundred", () => {
    same(x(1, 3).mul(Exact.int(3)), Exact.int(1));
    let sum = Exact.int(0);
    for (let i = 0; i < 1000; i++) sum = sum.add(Exact.fromNumber(0.1));
    same(sum, Exact.int(100));
  });
  it("refuses to divide by zero", () => {
    expect(() => x(1, 3).div(Exact.int(0))).toThrow(MoneyError);
  });
  it("compares, and finds the smaller and the larger", () => {
    expect(x(1, 3).cmp(x(1, 2))).toBe(-1);
    expect(x(1, 2).cmp(x(2, 4))).toBe(0);
    expect(x(-1, 3).cmp(x(-1, 2))).toBe(1);
    same(Exact.min(x(3), x(1, 2), x(2)), x(1, 2));
    same(Exact.max(x(3), x(1, 2), x(2)), x(3));
    expect(() => Exact.min()).toThrow(MoneyError);
    expect(x(0).isZero()).toBe(true);
    expect(x(1, 1000).isZero()).toBe(false);
  });
});

describe("Exact: the final rounding to a whole kobo uses the one shared rule", () => {
  it("rounds half up, once: 5000.025 naira (500,002.5 kobo) becomes 5,000.03", () => {
    expect(koboToString(Exact.decimal("500002.5").round())).toBe("5000.03");
    expect(koboToString(Exact.decimal("500002.4999").round())).toBe("5000.02");
    expect(koboToString(x(1, 2).round())).toBe("0.01");
  });
  it("rounds a negative on its size, so it mirrors the positive, and never gives negative zero", () => {
    expect(koboToString(Exact.decimal("-500002.5").round())).toBe("-5000.03");
    expect(Object.is(x(-1, 3).round(), 0)).toBe(true);
  });
  it("refuses a result too large to hold exactly", () => {
    expect(() => Exact.int(BigInt(Number.MAX_SAFE_INTEGER) + 1n).round()).toThrow(/too large/i);
  });
});

describe("Exact: turning a value into a plain number (display and old callers only)", () => {
  it("gives the nearest number: 1/3 is 0.3333333333333333, 23/200 is 0.115, 7 is 7", () => {
    expect(x(1, 3).toNumber()).toBe(1 / 3);
    expect(x(23, 200).toNumber()).toBe(0.115);
    expect(x(7).toNumber()).toBe(7);
    expect(x(-5, 2).toNumber()).toBe(-2.5);
  });
  it("copes with values larger than a plain number can count exactly", () => {
    const big = Exact.int(10n ** 30n).add(x(1, 3));
    expect(big.toNumber()).toBeCloseTo(1e30, -15);
    expect(Number.isFinite(big.toNumber())).toBe(true);
  });
});
