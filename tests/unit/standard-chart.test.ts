import { describe, expect, it } from "vitest";
import { CLASS_NAMES, CLASS_TYPES, STANDARD_CHART, STATEMENT_LINES, standardAccounts, validateChart, type StdGroup } from "@/lib/standard-chart";
import { DEFAULT_ACCOUNTS } from "@/server/services/accounting";

describe("the standard chart", () => {
  it("is internally sound: unique codes, types the class can hold, known statement lines", () => {
    expect(validateChart()).toEqual([]);
  });

  it("covers all seven classes, with groups and accounts in each", () => {
    for (const n of Object.keys(CLASS_NAMES).map(Number)) {
      const groups = STANDARD_CHART.filter((g) => g.classNumber === n);
      expect(groups.length, `class ${n} has groups`).toBeGreaterThan(0);
      expect(groups.flatMap((g) => g.categories.flatMap((c) => c.accounts)).length, `class ${n} has accounts`).toBeGreaterThan(0);
    }
  });

  it("includes every kind of account the brief names", () => {
    const names = standardAccounts().map((a) => a.name.toLowerCase());
    for (const wanted of [
      "petty cash", "cash in transit", "accounts receivable", "staff loans", "prepayments", "deposits paid", "vat input", "withholding tax receivable",
      "consumables", "uniforms", "land", "buildings", "motor vehicles", "plant & machinery", "security equipment", "it equipment", "office equipment", "furniture", "right-of-use", "accumulated depreciation", "software", "licences",
      "accounts payable", "accrued expenses", "paye tax payable", "pension payable", "nhf", "vat payable", "withholding tax payable", "client deposits", "deferred revenue", "bank overdrafts", "lease liabilities", "provisions",
      "share capital", "share premium", "retained earnings", "current year profit",
      "direct guarding charges", "indirect guarding", "management fees", "consultancy revenue", "training revenue", "technology", "discounts and rebates", "revenue adjustments",
      "relief guard costs", "overtime", "uniform", "audit fees", "legal fees", "software subscriptions", "bank charges", "bad debt", "amortisation", "staff welfare",
      "interest income", "interest expense", "loan charges", "foreign exchange gain", "foreign exchange loss", "other non-operating",
    ])
      expect(
        names.some((n) => n.includes(wanted)),
        `an account for "${wanted}"`,
      ).toBe(true);
  });

  it("holds every account the system already posts to, under the same code, name and type, so installing it can never rename or retype one", () => {
    const std = new Map(standardAccounts().map((a) => [a.code, a]));
    for (const d of DEFAULT_ACCOUNTS) {
      const s = std.get(d.code);
      expect(s, `standard chart has ${d.code}`).toBeDefined();
      expect(s!.name, `name of ${d.code}`).toBe(d.name);
      expect(s!.type, `type of ${d.code}`).toBe(d.type);
    }
  });

  it("marks the accounts that feed a tax", () => {
    const tax = new Map(standardAccounts().filter((a) => a.taxMapping).map((a) => [a.code, a.taxMapping]));
    expect(tax.get("2190")).toBe("VAT_OUTPUT");
    expect(tax.get("1311")).toBe("VAT_INPUT");
    expect(tax.get("1220")).toBe("WHT_RECEIVABLE");
    expect(tax.get("2195")).toBe("WHT_PAYABLE");
    expect(tax.get("2110")).toBe("PAYE");
  });

  it("reports every category under a defined statement line", () => {
    for (const g of STANDARD_CHART) for (const c of g.categories) expect(STATEMENT_LINES[c.statementLine], `${c.code}`).toBeDefined();
  });
});

describe("validateChart on a bad definition", () => {
  const bad = (g: Partial<StdGroup> & { accounts?: Array<{ code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE" }>; line?: string }): StdGroup[] => [
    { code: "GX", classNumber: 1, name: "X", ...g, categories: [{ code: "CX", name: "X", statementLine: (g.line ?? "PPE") as never, accounts: g.accounts ?? [{ code: "1", name: "A", type: "ASSET" }] }] },
  ];

  it("finds a duplicate account code", () => {
    expect(validateChart(bad({ accounts: [{ code: "1", name: "A", type: "ASSET" }, { code: "1", name: "B", type: "ASSET" }] }))).toEqual(["Duplicate account code 1."]);
  });
  it("finds an account type the class can't hold", () => {
    expect(validateChart(bad({ accounts: [{ code: "1", name: "A", type: "INCOME" }] }))[0]).toMatch(/income.*class 1 \(Assets\) can't hold/i);
  });
  it("finds an unknown class and an unknown statement line", () => {
    expect(validateChart(bad({ classNumber: 9 }))[0]).toMatch(/unknown class 9/);
    expect(validateChart(bad({ line: "NOPE" }))[0]).toMatch(/unknown statement line NOPE/);
  });
  it("lets class 7 hold both income and expense, and nothing else holds both", () => {
    expect(CLASS_TYPES[7]).toEqual(["INCOME", "EXPENSE"]);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(CLASS_TYPES[n]).toHaveLength(1);
  });
});
