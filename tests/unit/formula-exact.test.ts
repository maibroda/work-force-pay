import { describe, expect, it } from "vitest";
import { Exact } from "@/lib/exact-fraction";
import { evaluateFormula, evaluateFormulaExact, validateFormula } from "@/lib/payroll/formula";

/**
 * The formula evaluator, now in exact fractions. Everything it did before still holds (the first block); what changes is that decimal
 * arithmetic no longer drifts (the second block). Expected values are worked by hand.
 */
describe("formulas: what they always did", () => {
  it("does arithmetic with the usual precedence, brackets and unary minus", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("-5 + 8", {})).toBe(3);
    expect(evaluateFormula("-(2 + 3)", {})).toBe(-5);
    expect(evaluateFormula("10 / 4", {})).toBe(2.5);
  });
  it("reads a percentage as a hundredth, also after a bracket or a name", () => {
    expect(evaluateFormula("MIN(GROSS * 2%, 3000)", { GROSS: 94500 })).toBe(1890);
    expect(evaluateFormula("MIN(GROSS * 2%, 3000)", { GROSS: 200000 })).toBe(3000);
    expect(evaluateFormula("(100 + 50)%", {})).toBe(1.5);
    expect(evaluateFormula("BASIC%", { BASIC: 50 })).toBe(0.5);
  });
  it("knows MIN, MAX and ROUND, and names are not case sensitive", () => {
    expect(evaluateFormula("max(1, 5, 3)", {})).toBe(5);
    expect(evaluateFormula("MIN(4, 2, 9)", {})).toBe(2);
    expect(evaluateFormula("round(2.344)", {})).toBe(2.34);
    expect(evaluateFormula("basic + housing / 2", { BASIC: 100, HOUSING: 50 })).toBe(125);
  });
  it("refuses what it cannot evaluate, with a plain message", () => {
    expect(() => evaluateFormula("process.exit()", {})).toThrow();
    expect(() => evaluateFormula("1 +", {})).toThrow(/unexpected end/i);
    expect(() => evaluateFormula("1 2", {})).toThrow(/trailing/i);
    expect(() => evaluateFormula("(1 + 2", {})).toThrow(/expected "\)"/i);
    expect(() => evaluateFormula("NOPE + 1", {})).toThrow(/unknown variable NOPE/i);
    expect(() => evaluateFormula("FOO(1)", {})).toThrow(/unknown function FOO/i);
    expect(() => evaluateFormula("1 / 0", {})).toThrow(/division by zero/i);
    expect(() => evaluateFormula("1 / (2 - 2)", {})).toThrow(/division by zero/i);
    expect(() => evaluateFormula("MIN()", {})).toThrow(/finite/i);
    expect(() => evaluateFormula("1.2.3", {})).toThrow(/invalid number/i);
    expect(() => evaluateFormula("1 $ 2", {})).toThrow(/unexpected character/i);
  });
  it("validateFormula returns nothing for a good formula and the message for a bad one", () => {
    expect(validateFormula("MIN(GROSS * 2%, 3000)", ["GROSS"])).toBeNull();
    expect(validateFormula("GROSS +", ["GROSS"])).toMatch(/unexpected end/i);
    expect(validateFormula("NOPE * 2", ["GROSS"])).toMatch(/unknown variable/i);
  });
});

describe("formulas: decimal arithmetic is exact", () => {
  it("0.1 + 0.2 is 0.3, not 0.30000000000000004", () => {
    expect(evaluateFormula("0.1 + 0.2", {})).toBe(0.3);
  });
  it("0.07 * 100 is 7, and a third times three is exactly one", () => {
    expect(evaluateFormula("0.07 * 100", {})).toBe(7);
    expect(evaluateFormula("1 / 3 * 3", {})).toBe(1);
  });
  it("33.33% of 100,000 is 33,330, and 12.25% of 84,000.10 is 10,290.01225", () => {
    expect(evaluateFormula("GROSS * 33.33%", { GROSS: 100000 })).toBe(33330);
    expect(evaluateFormula("GROSS * 12.25%", { GROSS: 84000.1 })).toBe(10290.01225);
  });
  it("ROUND takes a value to the kobo, half up: 1.005 becomes 1.01 (it was 1.00), 2.675 becomes 2.68", () => {
    expect(evaluateFormula("ROUND(1.005)", {})).toBe(1.01);
    expect(evaluateFormula("ROUND(2.675)", {})).toBe(2.68);
    expect(evaluateFormula("ROUND(1 / 3)", {})).toBe(0.33);
    expect(evaluateFormula("ROUND(2 / 3)", {})).toBe(0.67);
  });
  it("ROUND of a negative at exactly half goes away from zero, as every other line does: -0.125 becomes -0.13", () => {
    expect(evaluateFormula("ROUND(-0.125)", {})).toBe(-0.13);
    expect(evaluateFormula("ROUND(0.125)", {})).toBe(0.13);
  });
  it("accepts a variable that is a number with floating-point dust, as the decimal it was meant to be", () => {
    expect(evaluateFormula("A + B", { A: 0.1, B: 0.2 })).toBe(0.3);
  });
});

describe("formulas: the exact result is available for the engine", () => {
  it("evaluateFormulaExact keeps a fraction whole: 100 / 7 is exactly 100/7, not a rounded decimal", () => {
    const r = evaluateFormulaExact("BASIC / 7", { BASIC: Exact.int(100) });
    expect(r.cmp(Exact.ratio(100, 7))).toBe(0);
    expect(r.mul(Exact.int(7)).cmp(Exact.int(100))).toBe(0);
  });
  it("takes its variables as exact fractions and its literals as exact decimals", () => {
    const r = evaluateFormulaExact("GROSS * 2.5% + 0.125", { GROSS: Exact.ratio(84000_10, 100) });
    expect(r.cmp(Exact.decimal("2100.0025").add(Exact.decimal("0.125")))).toBe(0);
  });
});
