import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { pageAllowed } from "@/lib/entitlements/guard";
import { EMPLOYEE_SECTIONS } from "@/lib/nav";
import { EmployeesSections } from "@/components/employees-sections";

/**
 * Everything about employees sits inside "Employees": a row of tabs across the top of its pages (the founder's review of 2026-11-04). Each tab is shown only to a role that may open
 * its page and only while its module is on for the company; every page still checks the same on the server. An employee's own record shows its own tabs instead.
 */
export default async function EmployeesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSession();
  const items = ctx ? EMPLOYEE_SECTIONS.filter((s) => can(ctx.role, s.perm) && pageAllowed(ctx.entitlements, s.href)).map(({ href, label }) => ({ href, label })) : [];
  return (
    <>
      <EmployeesSections items={items} />
      {children}
    </>
  );
}
