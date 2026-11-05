import { describe, expect, it } from "vitest";
import { checkImport, type ExistingPerson } from "@/lib/employee-import";

/**
 * The PFA in the bulk import is held to the company's list (Employees → Pension fund administrators) once the company has one: a name on the list is stored as the list spells it; a name
 * that is not on it, or is switched off, does not stop the row. The employee is saved without a PFA and the row carries a warning saying what to do (the founder's rule: capture the
 * record now, complete it later). While a company has no list, whatever is typed is kept as before.
 */
const base = {
  categories: [{ id: "c1", code: "GUARD", name: "Security Guard" }],
  departments: [] as { id: string; code: string; name: string }[],
  existing: [] as ExistingPerson[],
  today: "2026-10-24",
};
const csv = (pfa: string) => `First Name,Last Name,Employment Date,Category,PFA\nChinedu,Okafor,01/02/2026,GUARD,${pfa}`;
const list = [
  { name: "Premium Pension Ltd", active: true },
  { name: "Dormant Pension", active: false },
];

describe("the PFA column of the import", () => {
  it("keeps whatever is typed while the company has no list", () => {
    const r = checkImport(csv("Some Typed PFA"), base).rows[0];
    expect(r.employee?.pfa).toBe("Some Typed PFA");
    expect(r.warnings.join(" ")).not.toMatch(/PFA .*list/);
  });

  it("stores a name on the list as the list spells it, whatever the capitals", () => {
    const r = checkImport(csv("premium  PENSION ltd"), { ...base, pfas: list }).rows[0];
    expect(r.errors).toEqual([]);
    expect(r.employee?.pfa).toBe("Premium Pension Ltd");
  });

  it("saves the person without a PFA, with a warning saying where to add it, when the name is not on the list", () => {
    const check = checkImport(csv("Unknown Pensions"), { ...base, pfas: list });
    const r = check.rows[0];
    expect(r.errors).toEqual([]);
    expect(r.employee).toBeDefined();
    expect(r.employee?.pfa).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/PFA "Unknown Pensions" is not on your list.*left blank.*Pension fund administrators/i);
    expect(check.summary).toMatchObject({ errors: 0, warnings: 1 });
  });

  it("does the same for a PFA that is switched off, and says so", () => {
    const r = checkImport(csv("Dormant Pension"), { ...base, pfas: list }).rows[0];
    expect(r.employee?.pfa).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/switched off/i);
  });

  it("is quiet about a blank PFA beyond the existing 'Pension PIN or PFA is missing' warning", () => {
    const r = checkImport(csv(""), { ...base, pfas: list }).rows[0];
    expect(r.employee?.pfa).toBeUndefined();
    expect(r.warnings.filter((w) => /list/.test(w))).toEqual([]);
  });
});
