import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee, updateEmployee, type EmployeeInput } from "@/server/services/employees";
import { updateHrPolicy } from "@/server/services/hr-policy";
import { approveChange, requestChange } from "@/server/services/change-requests";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #228 (the founder chose on 2026-11-19: "last 4 digits + changed fields"): the audit log carries bank, tax and pension numbers as their last four characters, and the employee's own
// details (name, date of birth, phone, email, address, account name, declared rent) as the NAME of the changed field only, never the value. A bank change keeps the old and new last four, so the fraud trail
// still works. The employee record itself holds every value. Every value below is synthetic.

const SECRETS = ["SECRETVILLE", "unique.secret", "+2348031112222", "1991-04-12", "0123456789", "2099999999", "SECRET ACCOUNT NAME", "SECRET NEW NAME", "TIN12345678", "PEN987654321", "Maskcheck", "Zainab", "250000"];
const noValues = (rows: unknown) => {
  const text = JSON.stringify(rows);
  for (const s of SECRETS) expect(text, s).not.toContain(s);
};

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const input: Record<string, unknown> = {
    firstName: "Zainab",
    lastName: "Maskcheck",
    employmentDate: "2024-01-01",
    categoryId: t.guardId,
    dateOfBirth: "1991-04-12",
    phone: "+2348031112222",
    email: "unique.secret@example.test",
    address: "14 Hidden Street, SECRETVILLE",
    stateOfResidence: "Ogun",
    bankName: "First Bank",
    accountNumber: "0123456789",
    accountName: "SECRET ACCOUNT NAME",
  };
  const emp = await createEmployee(hr, input as EmployeeInput);
  const log = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, entityId: emp.id, action }, orderBy: { createdAt: "asc" } });
  return { t, hr, hr2, emp, input, log };
}

describe("the audit log and an employee's master data", () => {
  it("creating an employee records the number, the category and the names of the fields given, never the person's details", async () => {
    const w = await world();
    const rows = await w.log("EMPLOYEE_CREATE");
    expect(rows).toHaveLength(1);
    const nv = rows[0].newValue as Record<string, unknown> & { changedFields: string[] };
    expect(nv).toMatchObject({ employeeNumber: w.emp.employeeNumber, categoryId: w.t.guardId, stateOfResidence: "Ogun", bankName: "First Bank", accountNumber: "****6789" });
    expect(nv.changedFields).toEqual(expect.arrayContaining(["firstName", "lastName", "dateOfBirth", "phone", "email", "address", "accountName", "accountNumber"]));
    noValues(rows);
  });

  it("editing an employee records the names of the changed fields and the plain values, never the person's details", async () => {
    const w = await world();
    await updateEmployee(w.hr, w.emp.id, { ...w.input, phone: "+2348099999999", address: "9 New Road, SECRETVILLE", stateOfResidence: "Lagos" } as EmployeeInput, "Moved house");
    const rows = await w.log("EMPLOYEE_UPDATE");
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toEqual({ stateOfResidence: "Ogun" });
    expect(rows[0].newValue).toEqual({ stateOfResidence: "Lagos", changedFields: ["address", "phone", "stateOfResidence"] });
    expect(rows[0].reason).toBe("Moved house");
    noValues(rows);
    expect(JSON.stringify(rows)).not.toContain("+2348099999999");
  });

  it("a bank change request records the old and new last four and that the account name changed, never the account name or the full number", async () => {
    const w = await world();
    const req = await requestChange(w.hr, w.emp.id, "BANK", { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "SECRET NEW NAME" }, "Employee moved banks");
    const rows = await w.log("CHANGE_REQUEST");
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toEqual({ bankName: "First Bank", accountNumber: "****6789" });
    expect(rows[0].newValue).toEqual({ bankName: "Zenith Bank", accountNumber: "****9999", changedFields: ["accountName", "accountNumber", "bankName"] });
    expect(rows[0].reason).toBe("Employee moved banks");
    noValues(rows);
    expect(req.id).toBeTruthy();
  });

  it("approving a bank change records the same masked picture, so the fraud trail still shows which account changed to which", async () => {
    const w = await world();
    const req = await requestChange(w.hr, w.emp.id, "BANK", { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "SECRET NEW NAME" }, "Employee moved banks");
    await approveChange(w.hr2, req.id, "Confirmed with the employee");
    const rows = await w.log("BANK_INFORMATION_CHANGE");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userName: w.hr2.name, reason: "Employee moved banks" });
    expect(rows[0].oldValue).toEqual({ bankName: "First Bank", accountNumber: "****6789" });
    expect(rows[0].newValue).toMatchObject({ bankName: "Zenith Bank", accountNumber: "****9999" });
    noValues(rows);
    noValues(await w.log("CHANGE_REQUEST_APPROVE"));
  });

  it("a tax and a pension change record the last four of the number and never the declared rent", async () => {
    const w = await world();
    const tax = await requestChange(w.hr, w.emp.id, "TAX", { taxId: "TIN12345678", annualRent: 250000 }, "Employee supplied a tax number");
    await approveChange(w.hr2, tax.id);
    const rows = await w.log("TAX_INFORMATION_CHANGE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toEqual({ taxId: "****5678", changedFields: ["annualRent", "taxId"] });
    const pen = await requestChange(w.hr, w.emp.id, "PENSION", { pensionPin: "PEN987654321" }, "Employee supplied a pension number");
    await approveChange(w.hr2, pen.id);
    const prows = await w.log("PENSION_INFORMATION_CHANGE");
    expect(prows).toHaveLength(1);
    expect(prows[0].newValue).toEqual({ pensionPin: "****4321", changedFields: ["pensionPin"] });
    noValues([...rows, ...prows, ...(await w.log("CHANGE_REQUEST"))]);
  });

  it("a direct edit with change control switched off records the same masked picture", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { sensitiveChangeApproval: false });
    await updateEmployee(w.hr, w.emp.id, { ...w.input, accountNumber: "2099999999", accountName: "SECRET NEW NAME" } as EmployeeInput, "Policy is off");
    for (const action of ["EMPLOYEE_UPDATE", "BANK_INFORMATION_CHANGE"]) {
      const rows = await w.log(action);
      expect(rows, action).toHaveLength(1);
      expect((rows[0].newValue as { changedFields: string[] }).changedFields).toEqual(expect.arrayContaining(["accountNumber", "accountName"]));
      noValues(rows);
    }
    expect((await w.log("BANK_INFORMATION_CHANGE"))[0].oldValue).toEqual({ accountNumber: "****6789" });
  });

  it("the records themselves still hold the full values, for those with access", async () => {
    const w = await world();
    const req = await requestChange(w.hr, w.emp.id, "BANK", { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "SECRET NEW NAME" }, "Employee moved banks");
    const stored = await db.employee.findUniqueOrThrow({ where: { id: w.emp.id } });
    expect(stored).toMatchObject({ phone: "+2348031112222", email: "unique.secret@example.test", accountNumber: "0123456789", accountName: "SECRET ACCOUNT NAME", firstName: "Zainab" });
    const request = await db.employeeChangeRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(JSON.stringify(request.proposed)).toContain("2099999999");
    expect(JSON.stringify(request.previous)).toContain("0123456789");
  });
});
