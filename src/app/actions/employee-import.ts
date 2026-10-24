"use server";
import { act } from "./_run";
import * as imp from "@/server/services/employee-import";

type V = Record<string, unknown>;
const PATHS = ["/employees", "/employees/import"];

/** Checks a file without writing anything; the result is in `data`. */
export async function previewEmployeeImportAction(v: V) {
  return act("employee.manage", async (ctx) => {
    const check = await imp.previewEmployeeImport(ctx, String(v.csv ?? ""));
    return { message: "Checked.", data: check };
  });
}

export async function commitEmployeeImportAction(v: V) {
  return act(
    "employee.manage",
    async (ctx) => {
      const r = await imp.commitEmployeeImport(ctx, { csv: String(v.csv ?? ""), fileName: String(v.fileName ?? ""), skipErrors: v.skipErrors === true });
      return {
        message: `${r.imported} employee(s) imported${r.skipped ? `, ${r.skipped} row(s) left out` : ""}.`,
        data: r,
      };
    },
    PATHS,
  );
}
