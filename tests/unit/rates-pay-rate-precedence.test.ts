import { describe, expect, it } from "vitest";
import { loadRateBook } from "@/server/services/rates";
import type { Tx } from "@/server/services/_base";

/**
 * The founder's decision of 2026-11-05 (question 7 on entering a gross by hand): when an employee on a client contract also has a personal pay rate, the personal pay rate wins
 * (for example a supervisor paid differently from colleagues on the same contract). This pins that behaviour, and that the pay run reads ONLY approved pay rates (EmployeePayRate),
 * never a proposal (PayRateProposal): the stand-in database below refuses any table the rate book is not meant to read.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const comp = (code: string, pct: number) => ({ code, name: code, calcType: "PERCENTAGE", percentage: pct, fixedAmount: null, formula: null, taxable: true, pensionable: true, employerCost: false, active: true, sortOrder: 0 });
const structure = (id: string, code: string, isDefault = false) => ({ id, code, name: code, isPartial: false, isDefault, calculationMethod: "PERCENTAGE_OF_GROSS", components: [comp("BASIC", 100)] });

function book(over: { payRates?: unknown[]; rates?: unknown[] } = {}) {
  const tables: Record<string, unknown[]> = {
    contractRate: over.rates ?? [{ id: "cr1", contractId: "k1", categoryId: "cat1", salaryStructureId: "sGuard", agreedRate: 100000, operativeSharePct: null, effectiveFrom: day("2026-01-01"), effectiveTo: null }],
    contract: [{ id: "k1", operativeSharePct: 70, businessLine: "GUARDING" }],
    salaryStructure: [structure("sGuard", "GUARD"), structure("sOffice", "OFFICE"), structure("sDefault", "DEFAULT", true)],
    employeePayRate: over.payRates ?? [],
  };
  const tx = new Proxy({}, { get: (_t, name: string) => (name in tables ? { findMany: async () => tables[name] } : (() => { throw new Error(`The rate book must not read ${name}`); })()) });
  return loadRateBook(tx as unknown as Tx, "org", day("2026-11-01"), day("2026-11-30"), 70);
}
const pr = (over: Record<string, unknown> = {}) => ({ id: "pr1", employeeId: "e1", monthlyGross: 250000, structureCode: null, effectiveFrom: day("2026-10-01"), effectiveTo: null, ...over });
const onContract = { contractId: "k1", categoryId: "cat1", date: day("2026-11-10") };

describe("which rate the pay run uses", () => {
  it("a personal pay rate wins over the contract rate for the same person, and its structure is used when it names one", async () => {
    const r = (await book({ payRates: [pr({ structureCode: "OFFICE" })] })).resolve("e1", onContract)!;
    expect(r.source).toBe("EMPLOYEE_PAY_RATE");
    expect(r.monthlyGross).toBe(250000);
    expect(r.structure.code).toBe("OFFICE");
  });

  it("with no structure named, a personal pay rate on a contract uses the contract rate's structure, and with no contract the company's default structure", async () => {
    const withContract = (await book({ payRates: [pr()] })).resolve("e1", onContract)!;
    expect(withContract.structure.code).toBe("GUARD");
    const noContract = (await book({ payRates: [pr()], rates: [] })).resolve("e1", { contractId: null, categoryId: "cat1", date: day("2026-11-10") })!;
    expect(noContract).toMatchObject({ source: "EMPLOYEE_PAY_RATE", monthlyGross: 250000, agreedRate: null });
    expect(noContract.structure.code).toBe("DEFAULT");
  });

  it("someone with no personal pay rate is paid from the contract rate, and a colleague with one is not affected by it", async () => {
    const b = await book({ payRates: [pr({ employeeId: "e1" })] });
    expect(b.resolve("e2", onContract)).toMatchObject({ source: "CONTRACT_RATE", monthlyGross: 70000 }); // 100000 x 70%
    expect(b.resolve("e1", onContract)).toMatchObject({ source: "EMPLOYEE_PAY_RATE" });
  });

  it("respects the dates: a personal pay rate that starts later does not apply yet, and one that has ended no longer applies", async () => {
    const future = await book({ payRates: [pr({ effectiveFrom: day("2026-11-20") })] });
    expect(future.resolve("e1", { ...onContract, date: day("2026-11-10") })?.source).toBe("CONTRACT_RATE");
    expect(future.resolve("e1", { ...onContract, date: day("2026-11-25") })?.source).toBe("EMPLOYEE_PAY_RATE");
    const ended = await book({ payRates: [pr({ effectiveTo: day("2026-11-05") })] });
    expect(ended.resolve("e1", { ...onContract, date: day("2026-11-10") })?.source).toBe("CONTRACT_RATE");
  });

  it("reads only approved pay rates: it never touches a table of proposals (the stand-in database refuses any other table)", async () => {
    await expect(book({ payRates: [pr()] })).resolves.toBeDefined(); // would throw if it read PayRateProposal
  });
});
