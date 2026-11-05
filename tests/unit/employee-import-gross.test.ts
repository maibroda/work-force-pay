import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, checkImport, importTemplateCsv, type ExistingPerson } from "@/lib/employee-import";
import { parseTypedAmount } from "@/lib/pay-rate";

/**
 * The founder's decision of 2026-11-05: the monthly gross may be entered in the bulk import, as a PROPOSAL (a payroll manager approves it before it counts). A gross that cannot be
 * read, or a salary structure that does not exist, does not stop the person being captured: they are saved without a pay rate and the row says what to fix (incomplete records must be
 * capturable). The amount is the MONTHLY gross; an annual package is not accepted.
 */
const ref = {
  categories: [{ id: "c1", code: "OFFICE", name: "Office Staff" }],
  departments: [] as { id: string; code: string; name: string }[],
  existing: [] as ExistingPerson[],
  today: "2026-11-05",
  structureCodes: ["OFFICE", "GUARD"],
};
const csv = (gross: string, structure = "") => `First Name,Last Name,Employment Date,Category,Monthly Gross,Salary Structure\nAda,Obi,01/11/2026,OFFICE,${gross},${structure}`;
const row = (gross: string, structure = "", r = ref) => checkImport(csv(gross, structure), r).rows[0];

describe("the template and the columns", () => {
  it("has Monthly Gross and Salary Structure columns, optional, with a plain explanation", () => {
    const gross = IMPORT_COLUMNS.find((c) => c.key === "monthlyGross")!;
    const structure = IMPORT_COLUMNS.find((c) => c.key === "salaryStructure")!;
    expect(gross).toMatchObject({ header: "Monthly Gross", required: false });
    expect(gross.help).toMatch(/monthly/i);
    expect(gross.help).toMatch(/approv/i);
    expect(structure).toMatchObject({ header: "Salary Structure", required: false });
    const header = importTemplateCsv().split("\n")[0];
    expect(header).toContain("Monthly Gross");
    expect(header).toContain("Salary Structure");
  });
});

describe("a monthly gross in the file becomes a proposal", () => {
  it("carries the amount as exact text, the structure as the company spells its code, and the employment date as the day it starts", () => {
    const r = row("250000.50", "office");
    expect(r.errors).toEqual([]);
    expect(r.employee).toMatchObject({ monthlyGross: "250000.50", salaryStructure: "OFFICE" });
    expect(r.employee?.employmentDate).toBe("2026-11-01");
  });

  it("reads what Excel shows: a naira sign, NGN, spaces and thousands commas", () => {
    for (const typed of ['"₦250,000"', '"NGN 250,000.00"', '"250,000"', "250000"]) expect(row(typed).employee?.monthlyGross, typed).toMatch(/^250000(\.00)?$/);
  });

  it("says nothing about a blank gross (most staff are paid from a contract rate) and carries no proposal", () => {
    const r = row("");
    expect(r.employee?.monthlyGross).toBeUndefined();
    expect(r.warnings.filter((w) => /gross/i.test(w))).toEqual([]);
  });
});

describe("a gross that cannot be used does not stop the person being captured", () => {
  it("saves them without a pay rate and warns, naming what was typed and what is accepted, for an annual figure, too many decimals, a word, zero or a negative", () => {
    for (const bad of ["3000000 per annum", "1000.555", "abc", "0", "-5", "1e6"]) {
      const r = row(`"${bad}"`);
      expect(r.errors, bad).toEqual([]);
      expect(r.employee, bad).toBeDefined();
      expect(r.employee?.monthlyGross, bad).toBeUndefined();
      expect(r.warnings.join(" "), bad).toMatch(/Monthly gross "[^"]*" is not a monthly amount.*left blank/i);
    }
  });

  it("does the same for a salary structure the company does not have, and proposes no pay rate (the gross would be split by the wrong structure)", () => {
    const r = row("250000", "NOPE");
    expect(r.errors).toEqual([]);
    expect(r.employee?.monthlyGross).toBeUndefined();
    expect(r.employee?.salaryStructure).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/Salary structure "NOPE".*not.*no pay rate was proposed/i);
  });

  it("ignores a salary structure given without a gross", () => {
    const r = row("", "OFFICE");
    expect(r.employee?.salaryStructure).toBeUndefined();
  });

  it("checks nothing about structures when the company's structure list is not supplied", () => {
    const { structureCodes: _unused, ...rest } = ref;
    void _unused;
    expect(row("250000", "ANYTHING", rest as typeof ref).employee?.monthlyGross).toBe("250000");
  });
});

describe("parseTypedAmount (the import's reading of what was typed)", () => {
  it("strips a naira sign, NGN or N, spaces and valid thousands commas, then applies the strict monthly-gross rule", () => {
    expect(parseTypedAmount("₦250,000")).toBe("250000");
    expect(parseTypedAmount("NGN 1,250,000.50")).toBe("1250000.50");
    expect(parseTypedAmount("N 75000")).toBe("75000");
    expect(parseTypedAmount("  75 000 ")).toBe("75000");
  });
  it("still refuses a comma that is not a thousands separator, a decimal comma, and everything the strict rule refuses", () => {
    for (const bad of ["1,5", "12,34", "1,000,00", "250000,50", "per annum", "1000.555", "0", ""]) expect(parseTypedAmount(bad), bad).toBeNull();
  });
});
