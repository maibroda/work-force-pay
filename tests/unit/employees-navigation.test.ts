import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { EMPLOYEE_SECTIONS, NAV, employeesSectionActive, showEmployeesSections } from "@/lib/nav";
import { discoverPages, matchPage } from "../../scripts/routes";

/**
 * The review of the app (2026-11-04): the menu listed twelve employee pages as separate items, and the founder asked for them to sit inside "Employees", with Import Employees as
 * one of them, and for an employee's own record to show all of that employee's information. These tests pin the menu and the Employees tab strip; the employee page's sections are
 * pinned at the end.
 */
const pages = discoverPages();
const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
const MOVED = [
  "/employees/import",
  "/employees/categories",
  "/employees/departments",
  "/employees/bank",
  "/employees/pension",
  "/employees/tax",
  "/employees/change-requests",
  "/employees/next-of-kin",
  "/employees/guarantors",
  "/employees/dependants",
  "/operations/deployments",
  "/employees/org-chart",
];
const group = NAV.find((g) => g.title === "Workforce / Personnel")!;

describe("the sidebar", () => {
  it("has one Employees entry for all of this, and none of the pages that moved inside it", () => {
    const hrefs = group.items.map((i) => i.href);
    expect(hrefs).toContain("/employees");
    for (const h of MOVED) expect(hrefs, h).not.toContain(h);
  });

  it("still has the personnel reports and documents below Employees", () => {
    expect(group.items.some((i) => i.href === "/reports/employee-documents")).toBe(true);
  });
});

describe("the tab strip inside Employees", () => {
  it("starts with all employees and has every page that moved out of the sidebar, Import Employees included, under the names the founder gave them", () => {
    expect(EMPLOYEE_SECTIONS[0]).toMatchObject({ href: "/employees", label: "All employees" });
    expect(EMPLOYEE_SECTIONS.map((s) => s.href).sort()).toEqual([...MOVED, "/employees"].sort());
    const label = (href: string) => EMPLOYEE_SECTIONS.find((s) => s.href === href)!.label;
    expect(label("/employees/import")).toBe("Import employees");
    expect(label("/employees/bank")).toBe("Bank information");
    expect(label("/employees/pension")).toBe("Pension information");
    expect(label("/employees/tax")).toBe("Tax information");
    expect(label("/employees/change-requests")).toBe("Detail change requests");
    expect(label("/employees/next-of-kin")).toBe("Next of kin & emergency");
    expect(label("/employees/guarantors")).toBe("Guarantors");
    expect(label("/employees/dependants")).toBe("Dependants & beneficiaries");
    expect(label("/operations/deployments")).toBe("Assignments");
  });

  it("only links to pages that exist, and never twice", () => {
    const dead = EMPLOYEE_SECTIONS.filter((s) => !matchPage(pages, s.href)).map((s) => s.href);
    expect(dead).toEqual([]);
    const hrefs = EMPLOYEE_SECTIONS.map((s) => s.href);
    expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i)).toEqual([]);
  });

  it("is never shown to a role whose page then refuses it (the tab's permission is not looser than the page's)", () => {
    const bad: string[] = [];
    for (const s of EMPLOYEE_SECTIONS) {
      const page = matchPage(pages, s.href);
      if (!page || page.perm === "custom" || page.perm === null) continue;
      for (const r of roles) if (can(r, s.perm) && !can(r, page.perm)) bad.push(`${r} sees "${s.label}" (${s.perm}) but ${s.href} needs ${page.perm}`);
    }
    expect(bad).toEqual([]);
  });

  it("is shown on the section pages, and not on an employee's own record (which has its own tabs) or anywhere else", () => {
    for (const s of EMPLOYEE_SECTIONS.filter((x) => x.href.startsWith("/employees"))) expect(showEmployeesSections(s.href), s.href).toBe(true);
    expect(showEmployeesSections("/employees/")).toBe(true);
    expect(showEmployeesSections("/employees/ckx12abc")).toBe(false); // a record
    expect(showEmployeesSections("/employees/ckx12abc/anything")).toBe(false);
    expect(showEmployeesSections("/payroll/runs")).toBe(false);
    expect(showEmployeesSections("/operations/deployments")).toBe(false); // another area's page: it has its own layout
  });

  it("marks the tab of the page you are on, and only that one", () => {
    expect(EMPLOYEE_SECTIONS.filter((s) => employeesSectionActive(s.href, "/employees/bank")).map((s) => s.href)).toEqual(["/employees/bank"]);
    expect(EMPLOYEE_SECTIONS.filter((s) => employeesSectionActive(s.href, "/employees")).map((s) => s.href)).toEqual(["/employees"]);
    expect(EMPLOYEE_SECTIONS.filter((s) => employeesSectionActive(s.href, "/employees/")).map((s) => s.href)).toEqual(["/employees"]);
  });
});

describe("an employee's own record", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src", "app", "(app)", "employees", "[id]", "page.tsx"), "utf8");
  const overview = src.slice(src.indexOf('{tab === "overview" && ('), src.indexOf('{tab === "assignments" && ('));

  it("shows all of that employee's information on its Overview, each in a section named as the menu used to name it", () => {
    for (const title of ["Personal details", "Employment", "Bank information", "Pension information", "Tax information", "Next of kin & emergency contacts", "Guarantors", "Dependants & beneficiaries", "Current assignment"])
      expect(overview, title).toContain(`title="${title}"`);
  });

  it("shows the sensitive sections only to people allowed to see them", () => {
    for (const title of ["Bank information", "Pension information", "Tax information", "Next of kin & emergency contacts", "Guarantors", "Dependants & beneficiaries"]) {
      const at = overview.indexOf(`title="${title}"`);
      const before = overview.slice(Math.max(0, at - 220), at);
      expect(before, `${title} must be behind the sensitive check`).toMatch(/sensitive/);
    }
  });

  it("names its tabs for what they hold", () => {
    expect(src).toContain('label: "Next of kin, guarantors & dependants"');
    expect(src).toContain('label: "Detail change requests"');
    expect(src).not.toContain('label: "Bank, tax & pension"'); // that tab held only change requests
  });
});
