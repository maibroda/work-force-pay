import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, can, type Permission, type Role } from "@/lib/auth/permissions";

const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
const holding = (p: Permission) => roles.filter((r) => can(r, p)).sort();

// Disciplinary handling (misconduct cases and sanctions) was split from employee relations on 2026-11-05
// (the founder's decision): two permissions, so a person who handles grievances need not handle discipline.
describe("the disciplinary permissions", () => {
  it("exist", () => {
    expect(PERMISSIONS).toContain("discipline.view");
    expect(PERMISSIONS).toContain("discipline.manage");
  });

  it("are held by the people who handle misconduct today, and by nobody new", () => {
    expect(holding("discipline.view" as Permission)).toEqual(["AUDITOR", "COMPANY_ADMIN", "HR_ADMIN", "SUPER_ADMIN"]);
    expect(holding("discipline.manage" as Permission)).toEqual(["COMPANY_ADMIN", "HR_ADMIN", "SUPER_ADMIN"]);
  });

  it("only ever narrow access: nobody holds a disciplinary permission without the matching HR one", () => {
    for (const r of roles) {
      if (can(r, "discipline.view" as Permission)) expect(can(r, "hr.view"), `${r} view`).toBe(true);
      if (can(r, "discipline.manage" as Permission)) {
        expect(can(r, "hr.manage"), `${r} manage`).toBe(true);
        expect(can(r, "discipline.view" as Permission), `${r} manage implies view`).toBe(true);
      }
    }
  });

  it("are kept from the roles that could only read HR records before: finance, operations, payroll and the employee roles", () => {
    for (const r of roles.filter((x) => !["AUDITOR", "COMPANY_ADMIN", "HR_ADMIN", "SUPER_ADMIN"].includes(x))) {
      expect(can(r, "discipline.view" as Permission), r).toBe(false);
      expect(can(r, "discipline.manage" as Permission), r).toBe(false);
    }
  });
});
