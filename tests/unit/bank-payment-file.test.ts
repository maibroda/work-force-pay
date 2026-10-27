import { describe, expect, it } from "vitest";
import { DEFAULT_BANKS, normalizeBankName, resolveBank } from "@/lib/bank-codes";
import { buildPaymentRows, type PaymentLine } from "@/lib/payment-file";

describe("bank names", () => {
  it("are reduced to what identifies the bank", () => {
    expect(normalizeBankName("Guaranty Trust Bank Plc")).toBe("guarantytrust");
    expect(normalizeBankName("  First Bank of Nigeria Ltd ")).toBe("first");
    expect(normalizeBankName("Access Bank (Diamond)")).toBe("accessdiamond");
    expect(normalizeBankName("")).toBe("");
  });

  it("are matched to a code by name or alternative name, ignoring case and punctuation", () => {
    for (const [name, code] of [["GTBank", "058"], ["gtb", "058"], ["GT Bank", "058"], ["Guaranty Trust Bank", "058"], ["FIRST BANK OF NIGERIA", "011"], ["UBA", "033"], ["United Bank for Africa", "033"], ["Zenith Bank Plc", "057"], ["Stanbic IBTC Bank", "221"], ["F.C.M.B", "214"]] as const)
      expect(resolveBank(name, DEFAULT_BANKS)?.code, name).toBe(code);
    expect(resolveBank("Access Bank", DEFAULT_BANKS)?.code).toBe("044");
    expect(resolveBank("Access Bank (Diamond)", DEFAULT_BANKS)?.code).toBe("063");
  });

  it("finds nothing for an unknown or empty name, and refuses a name that points at two codes", () => {
    expect(resolveBank("Moniepoint", DEFAULT_BANKS)).toBeNull();
    expect(resolveBank(null, DEFAULT_BANKS)).toBeNull();
    expect(resolveBank("   ", DEFAULT_BANKS)).toBeNull();
    const clash = [{ name: "Alpha Bank", code: "111", aliases: ["AB"] }, { name: "Beta Bank", code: "222", aliases: ["AB"] }];
    expect(resolveBank("AB", clash)).toBeNull();
    expect(resolveBank("Alpha", clash)?.code).toBe("111");
  });

  it("has every code as digits, and no name that answers to two codes", () => {
    for (const b of DEFAULT_BANKS) expect(b.code).toMatch(/^\d{3}$/);
    const seen = new Map<string, string>();
    for (const b of DEFAULT_BANKS)
      for (const n of [b.name, ...b.aliases].map(normalizeBankName)) {
        expect(seen.get(n) ?? b.code, `${n} appears under two codes`).toBe(b.code);
        seen.set(n, b.code);
      }
  });
});

const line = (over: Partial<PaymentLine> = {}): PaymentLine => ({ transactionId: "t1", employeeNumber: "EMP-000001", name: "Chinedu Okafor", bankName: "GTBank", accountNumber: "0123456789", accountName: "CHINEDU OKAFOR", amount: 95200.5, ...over });

describe("building the payment rows", () => {
  it("makes a row per person with the account name, a text account number, the bank code and the amount", () => {
    const r = buildPaymentRows([line()], DEFAULT_BANKS, "Salary October 2026");
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([{ transactionId: "t1", name: "CHINEDU OKAFOR", accountNumber: "0123456789", bankCode: "058", amount: 95200.5, description: "Salary October 2026" }]);
    expect(r.total).toBe(95200.5);
  });

  it("falls back to the employee's name when there is no account name, and tidies spacing", () => {
    expect(buildPaymentRows([line({ accountName: null, name: "Ada  Obi" })], DEFAULT_BANKS, "x").rows[0].name).toBe("Ada Obi");
  });

  it("lists, rather than guesses at, anyone whose details can't be used", () => {
    const r = buildPaymentRows(
      [
        line({ transactionId: "a", accountNumber: null }),
        line({ transactionId: "b", accountNumber: "12345" }),
        line({ transactionId: "c", bankName: "Moniepoint" }),
        line({ transactionId: "d", bankName: null }),
        line({ transactionId: "e", amount: 0 }),
        line({ transactionId: "f", accountNumber: "0123 456 789", bankName: "uba" }),
      ],
      DEFAULT_BANKS,
      "x",
    );
    expect(r.problems.map((p) => p.transactionId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.problems[0].problems).toEqual(["No account number."]);
    expect(r.problems[1].problems[0]).toMatch(/is not 10 digits/);
    expect(r.problems[2].problems[0]).toMatch(/not in the bank list/);
    expect(r.problems[3].problems).toEqual(["No bank name."]);
    expect(r.problems[4].problems).toEqual(["Nothing to pay."]);
    expect(r.rows.map((x) => x.transactionId)).toEqual(["f"]);
    expect(r.rows[0]).toMatchObject({ accountNumber: "0123456789", bankCode: "033" }); // spaces removed, name matched
  });

  it("warns about two payments to the same account without dropping either", () => {
    const r = buildPaymentRows([line({ transactionId: "a" }), line({ transactionId: "b", employeeNumber: "EMP-000002", name: "Someone Else" })], DEFAULT_BANKS, "x");
    expect(r.rows).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/Same account as EMP-000001/);
  });

  it("totals in kobo without drift", () => {
    const r = buildPaymentRows([line({ transactionId: "a", amount: 0.1 }), line({ transactionId: "b", accountNumber: "1111111111", amount: 0.2 })], DEFAULT_BANKS, "x");
    expect(r.total).toBe(0.3);
  });

  it("rounds an amount with digits below a kobo half up, once, and says so: 95,200.505 → 95,200.51 (it was 95,200.50)", () => {
    const r = buildPaymentRows([line({ amount: 95200.505 })], DEFAULT_BANKS, "x");
    expect(r.problems).toEqual([]);
    expect(r.rows[0].amount).toBe(95200.51);
    expect(r.total).toBe(95200.51);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/95200\.505.*95200\.51|rounded/i);
  });

  it("rounds down below the half and stays quiet about nothing: 95,200.504 → 95,200.50; a normal amount raises no warning", () => {
    expect(buildPaymentRows([line({ amount: 95200.504 })], DEFAULT_BANKS, "x").rows[0].amount).toBe(95200.5);
    expect(buildPaymentRows([line({ amount: 95200.5 })], DEFAULT_BANKS, "x").warnings).toEqual([]);
  });

  it("an amount that rounds to nothing, or is not a number, is listed as a problem rather than paid", () => {
    const r = buildPaymentRows([line({ transactionId: "a", amount: 0.004 }), line({ transactionId: "b", accountNumber: "2222222222", amount: Number.NaN })], DEFAULT_BANKS, "x");
    expect(r.rows).toEqual([]);
    expect(r.problems.map((p) => [p.transactionId, p.problems[0]])).toEqual([["a", "Nothing to pay."], ["b", "The amount is not a number."]]);
  });

  it("the total is the sum of the rounded rows, to the kobo, however many", () => {
    // 300 amounts of 1,234.565 + i/100 naira, each exactly half a kobo: each rounds up to 123,457 + i kobo
    const lines = Array.from({ length: 300 }, (_, i) => line({ transactionId: `t${i}`, employeeNumber: `E${i}`, accountNumber: String(1000000000 + i), amount: Number(((123456.5 + i) / 100).toFixed(3)) }));
    const r = buildPaymentRows(lines, DEFAULT_BANKS, "x");
    expect(r.rows).toHaveLength(300);
    // 300 × 123,457 + (0 + 1 + … + 299) = 37,037,100 + 44,850 kobo
    expect(Math.round(r.total * 100)).toBe(37_081_950);
  });
});
