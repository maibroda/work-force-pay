"use server";
import { act } from "./_run";
import * as emp from "@/server/services/employees";
import * as nr from "@/server/services/numbering";
import * as users from "@/server/services/users";
import { db } from "@/lib/db";
import { logAudit } from "@/server/services/audit";

type V = Record<string, unknown>;

export async function createEmployeeAction(v: V) {
  return act(
    "employee.manage",
    async (ctx) => {
      const e = await emp.createEmployee(ctx, v as emp.EmployeeInput);
      return {
        message: `Employee created — number ${e.employeeNumber} generated automatically.`,
        redirectTo: `/employees/${e.id}`,
      };
    },
    ["/employees"],
  );
}
export async function updateEmployeeAction(id: string, v: V) {
  return act(
    "employee.manage",
    async (ctx) => {
      await emp.updateEmployee(ctx, id, v as emp.EmployeeInput, v.changeReason as string | undefined);
      return { message: "Employee updated." };
    },
    ["/employees"],
  );
}
export async function createOverrideAction(v: V) {
  return act(
    "override.manage",
    async (ctx) => {
      await emp.createSalaryOverride(ctx, v as never);
      return { message: "Employee Salary Override recorded (base structure unchanged)." };
    },
    ["/employees"],
  );
}
export async function createPayRateAction(v: V) {
  return act(
    "override.manage",
    async (ctx) => {
      await emp.createPayRate(ctx, v as never);
      return { message: "Effective-dated pay rate added." };
    },
    ["/employees"],
  );
}
export async function createCategoryAction(v: V) {
  return act(
    "employee.manage",
    async (ctx) => {
      await emp.createCategory(ctx, v as never);
    },
    ["/employees/categories"],
  );
}
export async function createDepartmentAction(v: V) {
  return act(
    "employee.manage",
    async (ctx) => {
      await emp.createDepartment(ctx, v as never);
    },
    ["/employees/departments"],
  );
}
export async function updateNumberingAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await nr.updateNumberingRule(ctx, {
        entity: String(v.entity),
        prefix: String(v.prefix ?? ""),
        separator: String(v.separator ?? "-"),
        digits: Number(v.digits),
        nextNumber: Number(v.nextNumber),
      });
      return { message: "Numbering rule updated." };
    },
    ["/settings/numbering"],
  );
}
export async function createUserAction(v: V) {
  return act(
    "users.manage",
    async (ctx) => {
      await users.createUser(ctx, v as never);
      return { message: "User created." };
    },
    ["/settings/users"],
  );
}
export async function setUserActiveAction(id: string, active: boolean) {
  return act(
    "users.manage",
    async (ctx) => {
      await users.setUserActive(ctx, id, active);
    },
    ["/settings/users"],
  );
}
export async function updateOrganizationAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      const old = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
      const o = await db.organization.update({
        where: { id: ctx.orgId },
        data: {
          name: String(v.name),
          address: (v.address as string) ?? null,
          phone: (v.phone as string) ?? null,
          email: (v.email as string) ?? null,
        },
      });
      await logAudit(ctx, {
        action: "ORGANIZATION_UPDATE",
        entity: "Organization",
        entityId: o.id,
        oldValue: old,
        newValue: o,
      });
    },
    ["/settings/organization"],
  );
}
