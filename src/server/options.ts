import type { Ctx } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { fullName, titleCase } from "@/lib/utils";

export const opt = (value: string, label: string) => ({ value, label });
export const enumOptions = (values: readonly string[]) => values.map((v) => opt(v, titleCase(v)));

export async function options(ctx: Ctx) {
  const [categories, departments, clients, contracts, beats, structures, periods, employees] =
    await Promise.all([
      db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } }),
      db.department.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } }),
      db.client.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } }),
      db.contract.findMany({
        where: { organizationId: ctx.orgId },
        include: { client: true },
        orderBy: { contractNumber: "asc" },
      }),
      db.beat.findMany({
        where: { organizationId: ctx.orgId, status: { not: "INACTIVE" } },
        include: { client: true },
        orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      }),
      db.salaryStructure.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } }),
      db.payrollPeriod.findMany({
        where: { organizationId: ctx.orgId },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      }),
      db.employee.findMany({
        where: { organizationId: ctx.orgId, status: { notIn: ["EXITED"] } },
        orderBy: { employeeNumber: "asc" },
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          status: true,
        },
      }),
    ]);
  return {
    categories: categories.map((c) => opt(c.id, c.name)),
    departments: departments.map((c) => opt(c.id, c.name)),
    clients: clients.map((c) => opt(c.id, c.name)),
    contracts: contracts.map((c) => opt(c.id, `${c.contractNumber} — ${c.client.name}: ${c.name}`)),
    beats: beats.map((b) => opt(b.id, `${b.client.name} — ${b.name}`)),
    activeStructures: structures
      .filter((s) => s.status === "ACTIVE")
      .map((s) => opt(s.id, `${s.name}${s.isDefault ? " (default)" : ""}`)),
    structureCodes: structures.filter((s) => s.status === "ACTIVE").map((s) => opt(s.code, s.name)),
    periods: periods.map((p) => opt(p.id, `${p.name} (${p.status.toLowerCase()})`)),
    openPeriods: periods
      .filter((p) => ["OPEN", "PROCESSING", "PENDING_VALIDATION", "PENDING_APPROVAL"].includes(p.status))
      .map((p) => opt(p.id, p.name)),
    employees: employees.map((e) =>
      opt(
        e.id,
        `${e.employeeNumber} — ${fullName(e)}${e.status !== "ACTIVE" ? ` (${e.status.toLowerCase()})` : ""}`,
      ),
    ),
  };
}

export async function runOptions(ctx: Ctx) {
  const runs = await db.payrollRun.findMany({
    where: { organizationId: ctx.orgId },
    include: { period: true },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }, { runNumber: "asc" }],
  });
  return runs.map((r) =>
    opt(
      r.id,
      `${r.period.name} — ${r.type === "REGULAR" ? "Regular" : `Supplementary #${r.runNumber}`} (${r.status.toLowerCase()})`,
    ),
  );
}
