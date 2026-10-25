import { describe, expect, it } from "vitest";
import { checkInputs, inputTemplateCsv, LARGE_AMOUNT, MAX_AMOUNT, MAX_INPUT_ROWS, parseAmount, parseType, parseYesNo, TRACKER_KIND, type InputEmployee } from "@/lib/client-inputs";

const employees: InputEmployee[] = [
  { id: "e1", employeeNumber: "EMP-000001", name: "Ada Obi", status: "ACTIVE" },
  { id: "e2", employeeNumber: "EMP-000002", name: "Bola Ade", status: "ACTIVE" },
  { id: "e3", employeeNumber: "EMP-000003", name: "Chi Eze", status: "RESIGNED" },
  { id: "e4", employeeNumber: "EMP-000004", name: "Dayo Ola", status: "SUSPENDED" },
];
const HEAD = "Employee Number,Type,Description,Amount,Taxable,Reference,Note";
const check = (rows: string[], existing: Parameters<typeof checkInputs>[1]["existing"] = []) => checkInputs([HEAD, ...rows].join("\n"), { employees, existing });

describe("parsing values", () => {
  it("reads amounts with commas, a naira sign or NGN, and refuses anything else", () => {
    expect(parseAmount("45000")).toBe(45000);
    expect(parseAmount("₦45,000.50")).toBe(45000.5);
    expect(parseAmount("NGN 1,200")).toBe(1200);
    for (const bad of ["", "0", "-5", "12.345", "1e5", "abc", "10%"]) expect(parseAmount(bad), bad).toBeNull();
  });
  it("recognises types by their usual names", () => {
    expect(parseType("Overtime")).toBe("OVERTIME");
    expect(parseType(" salary advance ")).toBe("SALARY_ADVANCE");
    expect(parseType("Fine")).toBe("PENALTY");
    expect(parseType("other")).toBeNull();
    expect(parseType("loan")).toBeNull();
  });
  it("reads yes and no", () => {
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("n")).toBe(false);
    expect(parseYesNo("maybe")).toBeNull();
  });
  it("counts every type towards one of the tracker's inputs", () => {
    expect(TRACKER_KIND.OVERTIME).toBe("OVERTIME");
    expect(TRACKER_KIND.BONUS).toBe("ALLOWANCES");
    expect(TRACKER_KIND.PENALTY).toBe("DEDUCTIONS");
  });
});

describe("the template", () => {
  it("is itself a valid file", () => {
    const staff = employees.slice(0, 3).map((e) => ({ ...e, status: "ACTIVE" }));
    const c = checkInputs(inputTemplateCsv(), { employees: staff, existing: [] });
    expect(c.fatal).toBeNull();
    expect(c.summary.errors).toBe(0);
    expect(c.summary.total).toBe(3);
  });
});

describe("checking a file", () => {
  it("accepts clean rows, totals earnings and deductions apart, and defaults the description", () => {
    const c = check(["EMP-000001,Overtime,Weekend cover,45000,Yes,,", "emp-000002,Allowance,,15000,No,,", "EMP-000001,Penalty,Lateness,5000,,HR letter 14 Oct,"]);
    expect(c.summary).toMatchObject({ total: 3, errors: 0, warnings: 0, earnings: 60000, deductions: 5000 });
    expect(c.rows[1].item).toMatchObject({ employeeId: "e2", description: "Allowance", taxable: false, type: "ALLOWANCE" });
    expect(c.rows[2].item).toMatchObject({ type: "PENALTY", reference: "HR letter 14 Oct", taxable: true });
  });

  it("matches employee numbers ignoring case and spaces, and refuses unknown or departed staff", () => {
    const c = check(["emp 000001,Bonus,,100,,,", "EMP-009999,Bonus,,100,,,", "EMP-000003,Bonus,,100,,,", ",Bonus,,100,,,"]);
    expect(c.rows[0].errors).toEqual([]);
    expect(c.rows[1].errors[0]).toMatch(/No employee with number "EMP-009999"/);
    expect(c.rows[2].errors[0]).toMatch(/no longer on the payroll/);
    expect(c.rows[3].errors[0]).toMatch(/number is missing/i);
  });

  it("warns about a suspended employee but lets the row through", () => {
    const r = check(["EMP-000004,Bonus,,100,,,"]).rows[0];
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatch(/suspended/);
    expect(r.item).not.toBeNull();
  });

  it("refuses a missing or unknown type and a bad amount", () => {
    const c = check(["EMP-000001,,,100,,,", "EMP-000001,Gift,,100,,,", "EMP-000001,Bonus,,,,,", "EMP-000001,Bonus,,abc,,,", "EMP-000001,Bonus,,-3,,,"]);
    expect(c.rows.map((r) => r.errors.length)).toEqual([1, 1, 1, 1, 1]);
    expect(c.rows[1].errors[0]).toMatch(/not a type we know/);
    expect(c.rows[0].item).toBeNull();
  });

  it("flags large amounts and refuses silly ones", () => {
    const c = check([`EMP-000001,Bonus,,${LARGE_AMOUNT},,,`, `EMP-000001,Bonus,,${MAX_AMOUNT + 1},,,`]);
    expect(c.rows[0].warnings[0]).toMatch(/unusually large/);
    expect(c.rows[1].errors[0]).toMatch(/typing slip/);
  });

  it("needs a reference for every kind of deduction, but not for earnings", () => {
    const c = check(["EMP-000001,Deduction,Uniform,500,,,", "EMP-000001,Recovery,Overpayment,500,,ab,", "EMP-000001,Bonus,,500,,,"]);
    expect(c.rows[0].errors[0]).toMatch(/needs a reference/);
    expect(c.rows[1].errors[0]).toMatch(/needs a reference/);
    expect(c.rows[2].errors).toEqual([]);
  });

  it("refuses a Taxable value that isn't yes or no, and ignores it on deductions", () => {
    const c = check(["EMP-000001,Bonus,,500,maybe,,", "EMP-000001,Penalty,Late,500,No,HR letter,"]);
    expect(c.rows[0].errors[0]).toMatch(/Yes or No/);
    expect(c.rows[1].warnings[0]).toMatch(/ignored for deductions/);
  });

  it("warns about a repeated row in the file, and about one already entered for the month", () => {
    const c = check(["EMP-000001,Bonus,Diwali,500,,,", "EMP-000001,Bonus,Diwali,500,,,", "EMP-000002,Allowance,Transport,15000,,,"], [{ employeeId: "e2", deduction: false, name: "transport", amount: 15000 }]);
    expect(c.rows[0].warnings).toEqual([]);
    expect(c.rows[1].warnings[0]).toMatch(/repeat of line 2/);
    expect(c.rows[2].warnings[0]).toMatch(/already entered/);
    expect(c.summary.warnings).toBe(2);
  });

  it("does not call an earning and a deduction of the same amount the same thing", () => {
    const r = check(["EMP-000002,Penalty,Transport,15000,,HR letter,"], [{ employeeId: "e2", deduction: false, name: "Transport", amount: 15000 }]).rows[0];
    expect(r.warnings).toEqual([]);
  });

  it("stops the whole file for a missing column, an empty file, or too many rows", () => {
    expect(checkInputs("Employee Number,Description\nEMP-000001,x", { employees, existing: [] }).fatal).toMatch(/missing required column\(s\): Type, Amount/);
    expect(checkInputs(HEAD, { employees, existing: [] }).fatal).toMatch(/no rows/);
    const many = Array.from({ length: MAX_INPUT_ROWS + 1 }, () => "EMP-000001,Bonus,,100,,,");
    expect(check(many).fatal).toMatch(/limit/);
  });

  it("recognises column names loosely, and lists the ones it ignores", () => {
    const c = checkInputs("Staff No,KIND,Value,Colour\nEMP-000001,bonus,100,red", { employees, existing: [] });
    expect(c.fatal).toBeNull();
    expect(c.headers?.unknown).toEqual(["Colour"]);
    expect(c.rows[0].item).toMatchObject({ amount: 100, type: "BONUS" });
  });

  it("reports line numbers as they appear in the file, counting the header", () => {
    const c = check(["EMP-000001,Bonus,,100,,,", "EMP-009999,Bonus,,100,,,"]);
    expect(c.rows.map((r) => r.line)).toEqual([2, 3]);
  });
});
