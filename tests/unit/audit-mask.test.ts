import { describe, expect, it } from "vitest";
import { lastFour, maskedChange } from "@/lib/audit-mask";

// The founder chose (2026-11-19): bank, tax and pension numbers go into the audit log as their last four characters; the employee's own details (name, date of birth, phone, email, address, account
// name, declared rent) go in as the NAME of the changed field only, never the value. Bank changes keep old and new last four, so the fraud trail still works. Anything the list does not know is
// treated as personal, so a field added to the employee later can never leak by default.

describe("lastFour", () => {
  it("keeps the last four characters and hides the rest", () => {
    expect(lastFour("0123456789")).toBe("****6789");
    expect(lastFour("TIN-1234-5678")).toBe("****5678");
  });
  it("never shows a value of four characters or fewer", () => {
    expect(lastFour("1234")).toBe("****");
    expect(lastFour("12")).toBe("****");
  });
  it("says nothing for an empty value", () => {
    expect(lastFour(null)).toBeNull();
    expect(lastFour(undefined)).toBeNull();
    expect(lastFour("")).toBeNull();
    expect(lastFour("   ")).toBeNull();
  });
});

describe("maskedChange", () => {
  const before = { bankName: "First Bank", accountNumber: "0123456789", accountName: "SECRET NAME", phone: "+2348012345678", stateOfResidence: "Ogun", nhfContributes: false };
  const after = { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "OTHER NAME", phone: "+2348099999999", stateOfResidence: "Lagos", nhfContributes: false };

  it("lists only the fields that changed, by name", () => {
    const c = maskedChange(before, after);
    expect((c.newValue as { changedFields: string[] }).changedFields.sort()).toEqual(["accountName", "accountNumber", "bankName", "phone", "stateOfResidence"]);
  });

  it("shows plain operational values, the last four of a number, and nothing of the employee's own details", () => {
    const c = maskedChange(before, after);
    expect(c.oldValue).toEqual({ bankName: "First Bank", accountNumber: "****6789", stateOfResidence: "Ogun" });
    expect(c.newValue).toMatchObject({ bankName: "Zenith Bank", accountNumber: "****9999", stateOfResidence: "Lagos" });
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/SECRET NAME|OTHER NAME|\+23480|0123456789|2099999999/);
  });

  it("treats a field it does not know as personal", () => {
    const c = maskedChange({ nickname: "A" }, { nickname: "B" });
    expect(c.oldValue).toEqual({});
    expect(c.newValue).toEqual({ changedFields: ["nickname"] });
  });

  it("treats a new record as a change from nothing", () => {
    const c = maskedChange({}, { employeeNumber: "E-1", firstName: "Ada", email: "ada@example.test", taxId: "TIN12345678", categoryId: "c1", departmentId: null });
    expect(c.oldValue).toEqual({});
    expect(c.newValue).toEqual({ employeeNumber: "E-1", taxId: "****5678", categoryId: "c1", changedFields: ["categoryId", "email", "employeeNumber", "firstName", "taxId"].sort() });
    expect(JSON.stringify(c)).not.toMatch(/Ada|ada@example|TIN12345678/);
  });

  it("compares dates and amounts by value, not by object", () => {
    const c = maskedChange({ dateOfBirth: new Date("1990-01-05T00:00:00Z"), annualRent: "250000.00", employmentDate: new Date("2020-01-01T00:00:00Z") }, { dateOfBirth: new Date("1990-01-05T00:00:00Z"), annualRent: 250000, employmentDate: new Date("2021-02-03T00:00:00Z") });
    expect(c.newValue).toEqual({ employmentDate: "2021-02-03", changedFields: ["employmentDate"] });
    expect(c.oldValue).toEqual({ employmentDate: "2020-01-01" });
  });

  it("limits itself to the keys it is given", () => {
    const c = maskedChange(before, after, ["accountNumber", "accountName"]);
    expect((c.newValue as { changedFields: string[] }).changedFields.sort()).toEqual(["accountName", "accountNumber"]);
    expect(c.oldValue).toEqual({ accountNumber: "****6789" });
  });

  it("reports no change as an empty list", () => {
    expect(maskedChange(before, before).newValue).toEqual({ changedFields: [] });
  });
});
