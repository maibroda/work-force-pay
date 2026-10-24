import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { commitEmployeeImport, listImportBatches, previewEmployeeImport } from "@/server/services/employee-import";
import { isolatedOrg, uid } from "../helpers";

const HEAD = "First Name,Last Name,Employment Date,Category,Department,Date of Birth,Bank Name,Account Number,Account Name,Tax ID,Pension PIN,PFA";
let n = 0;
const row = (over: Partial<Record<string, string>> = {}) => {
  n++;
  const v = { fn: `Staff${n}`, ln: "Test", ed: "01/02/2026", cat: "GUARD", dep: "OPS", dob: `0${(n % 9) + 1}/05/1990`, bank: "GTBank", acct: String(2000000000 + n), an: `STAFF ${n}`, tax: `TIN${uid()}${n}`, pin: `PEN${uid()}${n}`, pfa: "Stanbic", ...over };
  return [v.fn, v.ln, v.ed, v.cat, v.dep, v.dob, v.bank, v.acct, v.an, v.tax, v.pin, v.pfa].join(",");
};
const file = (...rows: string[]) => [HEAD, ...rows].join("\r\n");

describe("employee import", () => {
  it("imports clean rows through the normal creation path, numbers them, and records the batch", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    const csv = file(row(), row(), row({ dep: "" }));
    const preview = await previewEmployeeImport(hr, csv);
    expect(preview.summary).toMatchObject({ total: 3, errors: 0 });
    expect(await db.employee.count({ where: { organizationId: t.org.id } })).toBe(0); // a preview writes nothing

    const r = await commitEmployeeImport(hr, { csv, fileName: "june-staff.csv" });
    expect(r.imported).toBe(3);
    const emps = await db.employee.findMany({ where: { organizationId: t.org.id }, orderBy: { employeeNumber: "asc" } });
    expect(emps).toHaveLength(3);
    expect(emps.map((e) => e.employeeNumber)).toEqual(["EMP-000001", "EMP-000002", "EMP-000003"]);
    expect(emps.every((e) => e.importBatchId === r.batchId && e.status === "ACTIVE" && e.categoryId === t.guardId)).toBe(true);
    expect(emps[0].departmentId).toBe(t.deptId);
    expect(emps[2].departmentId).toBeNull();

    const batch = await db.employeeImportBatch.findUniqueOrThrow({ where: { id: r.batchId } });
    expect(batch).toMatchObject({ fileName: "june-staff.csv", rowCount: 3, importedCount: 3, skippedCount: 0, createdBy: hr.name, createdByUserId: hr.userId });
    // the usual per-employee records exist too
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "EMPLOYEE_CREATE" } })).toBe(3);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "EMPLOYEE_IMPORT" } })).toBe(1);
    expect(await db.onboardingTask.count({ where: { employeeId: emps[0].id } })).toBeGreaterThan(0);
    expect((await listImportBatches(hr))[0].id).toBe(r.batchId);
  });

  it("imports nothing when any row has an error, unless told to leave the bad rows out", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    const csv = file(row(), row({ cat: "Pilot" }), row({ acct: "123" }), row());
    await expect(commitEmployeeImport(hr, { csv, fileName: "mixed.csv" })).rejects.toThrow(/2 row\(s\) have errors, so nothing was imported/);
    expect(await db.employee.count({ where: { organizationId: t.org.id } })).toBe(0);
    expect(await db.employeeImportBatch.count({ where: { organizationId: t.org.id } })).toBe(0);

    const r = await commitEmployeeImport(hr, { csv, fileName: "mixed.csv", skipErrors: true });
    expect(r).toMatchObject({ imported: 2, skipped: 2 });
    const batch = await db.employeeImportBatch.findUniqueOrThrow({ where: { id: r.batchId } });
    const outcomes = batch.outcomes as { line: number; outcome: string; errors: string[] }[];
    expect(outcomes.map((o) => o.outcome)).toEqual(["IMPORTED", "SKIPPED", "SKIPPED", "IMPORTED"]);
    expect(outcomes[1].errors[0]).toMatch(/Category "Pilot"/);
    expect(outcomes[2].line).toBe(4);
  });

  it("catches rows that repeat someone already imported, so the same file can't be loaded twice", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    const csv = file(row(), row());
    await commitEmployeeImport(hr, { csv, fileName: "a.csv" });
    const again = await previewEmployeeImport(hr, csv);
    expect(again.summary.errors).toBe(2);
    expect(again.rows[0].errors.join(" ")).toMatch(/already held by EMP-0000/);
    await expect(commitEmployeeImport(hr, { csv, fileName: "a.csv" })).rejects.toThrow(/nothing was imported/);
    expect(await db.employee.count({ where: { organizationId: t.org.id } })).toBe(2);
  });

  it("checks the file again on the server and refuses a file with no usable rows or columns", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    await expect(commitEmployeeImport(hr, { csv: "First Name,Surname\nA,B", fileName: "x.csv" })).rejects.toThrow(/missing required column/);
    await expect(commitEmployeeImport(hr, { csv: file(row({ cat: "Nope" })), fileName: "x.csv", skipErrors: true })).rejects.toThrow(/no valid rows/);
  });

  it("is limited to people who can manage employees, and stays inside the organisation", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const csv = file(row());
    await expect(previewEmployeeImport(a.ctx("AUDITOR", null, 1), csv)).rejects.toThrow(/permission/);
    await expect(commitEmployeeImport(a.ctx("FINANCE", null, 1), { csv, fileName: "x.csv" })).rejects.toThrow(/permission/);
    const hrA = a.ctx("HR_ADMIN", null, 1);
    await commitEmployeeImport(hrA, { csv, fileName: "x.csv" });
    expect(await db.employee.count({ where: { organizationId: b.org.id } })).toBe(0);
    expect((await listImportBatches(b.ctx("HR_ADMIN", null, 1))).length).toBe(0);
  });

  it("never lets an import record be changed or removed", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    const r = await commitEmployeeImport(hr, { csv: file(row()), fileName: "keep.csv" });
    await expect(db.employeeImportBatch.update({ where: { id: r.batchId }, data: { fileName: "other.csv" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.employeeImportBatch.delete({ where: { id: r.batchId } })).rejects.toThrow(/cannot be changed or deleted/);
  });
});
