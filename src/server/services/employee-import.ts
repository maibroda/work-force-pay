/**
 * Bulk import of employees from a CSV file. The file is always re-checked on the server when it is imported (the preview is only
 * a preview), nothing is written until it has been checked, and every import leaves an unalterable batch record of who loaded what.
 * Imported employees go through exactly the same creation path as a single one: numbered by the numbering rule, audited, onboarding tasks.
 */
import { randomUUID } from "node:crypto";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { checkImport, type ImportCheck } from "@/lib/employee-import";
import { employeeSchema, createEmployeeInTx } from "./employees";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

async function reference(ctx: Ctx) {
  const [categories, departments, people] = await Promise.all([
    db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, code: true, name: true } }),
    db.department.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, code: true, name: true } }),
    db.employee.findMany({
      where: { organizationId: ctx.orgId },
      select: { employeeNumber: true, firstName: true, lastName: true, accountNumber: true, taxId: true, pensionPin: true, phone: true, dateOfBirth: true },
    }),
  ]);
  return {
    categories,
    departments,
    existing: people.map((p) => ({ ...p, dateOfBirth: p.dateOfBirth ? iso(p.dateOfBirth) : null })),
    today: iso(new Date()),
  };
}

/** Checks a file without writing anything. */
export async function previewEmployeeImport(ctx: Ctx, csv: string): Promise<ImportCheck> {
  assertCan(ctx, "employee.manage");
  return checkImport(csv, await reference(ctx));
}

/**
 * Imports the rows that pass. With `skipErrors` false (the default) a file with any error imports nothing, so a partly loaded
 * client never has to be untangled; with it true the rows with errors are left out and listed on the batch record.
 */
export async function commitEmployeeImport(ctx: Ctx, input: { csv: string; fileName: string; skipErrors?: boolean }) {
  assertCan(ctx, "employee.manage");
  const check = checkImport(input.csv, await reference(ctx));
  if (check.fatal) throw new BusinessError(check.fatal);
  const ready = check.rows.filter((r) => r.employee);
  if (check.summary.errors > 0 && !input.skipErrors)
    throw new BusinessError(`${check.summary.errors} row(s) have errors, so nothing was imported. Fix them in the file and upload it again, or import only the rows that are right.`);
  if (!ready.length) throw new BusinessError("There are no valid rows to import.");

  const fileName = input.fileName.trim().slice(0, 200) || "employees.csv";
  const batchId = randomUUID();
  return db.$transaction(
    async (tx) => {
      await tx.employeeImportBatch.create({
        data: {
          id: batchId,
          organizationId: ctx.orgId,
          fileName,
          rowCount: check.rows.length,
          importedCount: ready.length,
          skippedCount: check.rows.length - ready.length,
          warningCount: ready.filter((r) => r.warnings.length).length,
          outcomes: check.rows.map((r) => ({
            line: r.line,
            name: `${r.raw.firstName ?? ""} ${r.raw.lastName ?? ""}`.trim(),
            outcome: r.employee ? "IMPORTED" : "SKIPPED",
            errors: r.errors,
            warnings: r.warnings,
          })),
          createdBy: ctx.name,
          createdByUserId: ctx.userId,
        },
      });
      const created: { id: string; employeeNumber: string; line: number }[] = [];
      for (const r of ready) {
        const v = employeeSchema.parse(r.employee);
        const emp = await createEmployeeInTx(ctx, tx, v, { importBatchId: batchId });
        created.push({ id: emp.id, employeeNumber: emp.employeeNumber, line: r.line });
      }
      await logAudit(
        ctx,
        { action: "EMPLOYEE_IMPORT", entity: "EmployeeImportBatch", entityId: batchId, newValue: { fileName, imported: created.length, skipped: check.rows.length - created.length } },
        tx,
      );
      return { batchId, imported: created.length, skipped: check.rows.length - created.length, employees: created };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

export async function listImportBatches(ctx: Ctx) {
  assertCan(ctx, "employee.manage");
  return db.employeeImportBatch.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 50 });
}
