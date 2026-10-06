import { describe, expect, it } from "vitest";
import { KIND_FIELDS, maskAccount, nameLooksLike, normalizeValue, sameValues } from "@/lib/change-control";

describe("normalizeValue", () => {
  it("treats blanks and nulls alike and trims text", () => {
    expect(normalizeValue("")).toBeNull();
    expect(normalizeValue("   ")).toBeNull();
    expect(normalizeValue(undefined)).toBeNull();
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue("  GTBank ")).toBe("GTBank");
  });
  it("keeps digit strings as text, so leading zeros survive", () => {
    expect(normalizeValue("0123456789")).toBe("0123456789");
    expect(normalizeValue(50000)).toBe(50000);
  });
});

describe("sameValues", () => {
  const f = KIND_FIELDS.BANK;
  const a = { bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OKAFOR" };
  it("is true when nothing differs, ignoring case, spacing and blanks vs missing", () => {
    expect(sameValues(a, { ...a, bankName: " gtbank " }, f)).toBe(true);
    expect(sameValues({ ...a, accountName: null }, { ...a, accountName: "" }, f)).toBe(true);
  });
  it("is false when any field differs", () => {
    expect(sameValues(a, { ...a, accountNumber: "0123456780" }, f)).toBe(false);
    expect(sameValues(a, { ...a, accountName: "ADA OKAFOR JR" }, f)).toBe(false);
  });
  it("compares a number with the same number written as text", () => {
    expect(sameValues({ annualRent: 50000, taxId: "T1" }, { annualRent: "50000", taxId: "t1" }, KIND_FIELDS.TAX)).toBe(true);
    expect(sameValues({ annualRent: 50000 }, { annualRent: 60000 }, ["annualRent"])).toBe(false);
  });
});

describe("nameLooksLike", () => {
  const ada = { firstName: "Ada", lastName: "Okafor" };
  it("accepts the name in any order, case and punctuation", () => {
    expect(nameLooksLike("ADA OKAFOR", ada)).toBe(true);
    expect(nameLooksLike("Okafor, Ada Chidinma", ada)).toBe(true);
    expect(nameLooksLike("okafor-ada", ada)).toBe(true);
  });
  it("flags an account that isn't theirs, or has only one of their names", () => {
    expect(nameLooksLike("BOLA ADEYEMI", ada)).toBe(false);
    expect(nameLooksLike("ADA ADEYEMI", ada)).toBe(false);
    expect(nameLooksLike("OKAFOR TRADING LTD", ada)).toBe(false);
  });
  it("flags a blank account name", () => {
    expect(nameLooksLike("", ada)).toBe(false);
    expect(nameLooksLike(null, ada)).toBe(false);
  });
});

describe("maskAccount", () => {
  it("shows only the last four digits", () => {
    expect(maskAccount("0123456789")).toBe("••••••6789");
    expect(maskAccount("1234")).toBe("1234");
    expect(maskAccount(null)).toBe("—");
  });
});

describe("KIND_FIELDS", () => {
  it("never share a field between kinds", () => {
    const all = Object.values(KIND_FIELDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
