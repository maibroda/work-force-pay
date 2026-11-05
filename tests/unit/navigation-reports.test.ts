import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { AREAS, NAV, PAYROLL_AREA, REPORTS_AREA, REPORT_LINKS, SELF_NAV, areaEntry, sectionFor, visibleSections } from "@/lib/nav";
import { reportPermission } from "@/lib/report-access";

/**
 * The founder's decision (2026-11-05, on question 5 of docs/plans/navigation-consolidation.md): every report moves into ONE Reports area, with search, instead of being listed in the
 * Payroll, Workforce, Operations, Finance and Settings groups as well as on the Reports page. The Reports page's own list (REPORT_LINKS) is the one source. These tests pin that no
 * report was lost, that nobody can open a report they could not open before, and that no report is listed in two places.
 */
const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "CLIENT_APPROVER", "CLIENT_HR"];
const slug = (href: string) => href.replace("/reports/", "");

/** Reports that used to be listed in other sidebar groups (and the permission that showed them there). */
const OLD_SIDEBAR_REPORTS: Array<[string, Permission]> = [
  ["/reports/location-history", "reports.view"],
  ["/reports/employee-documents", "reports.view"],
  ["/reports/employee-training", "reports.view"],
  ["/reports/work-register", "reports.view"],
  ["/reports/staff-movement", "reports.view"],
  ["/reports/beat-reconciliation", "reports.view"],
  ["/reports/client-beat", "reports.view"],
  ["/reports/audit", "audit.view"],
];

describe("the Reports area is the Reports page's own list, as tabs", () => {
  const listed = REPORT_LINKS.filter((r) => r.href.startsWith("/reports/"));

  it("has every report the Reports page lists, in its order, each a real report page", () => {
    expect(REPORTS_AREA.sections.map((s) => s.href)).toEqual(listed.map((r) => r.href));
    expect(AREAS).toContain(REPORTS_AREA);
    for (const s of REPORTS_AREA.sections) expect(pageRouteFor(s.href), s.href).toBe("/reports/[type]");
  });

  it("opens each report to exactly the roles that could open it before: the permission is the one the report page enforces", () => {
    for (const s of REPORTS_AREA.sections) expect(s.perm, s.href).toBe(reportPermission(slug(s.href)));
    // the ones that were also in a sidebar group keep the permission that showed them there
    for (const [href, perm] of OLD_SIDEBAR_REPORTS) {
      const s = REPORTS_AREA.sections.find((x) => x.href === href)!;
      expect(s, href).toBeDefined();
      for (const r of roles) expect(can(r, s.perm), `${r} on ${href}`).toBe(can(r, perm));
    }
  });

  it("leaves the invoices page (Billing & Receivables) where it is: it is not a report page", () => {
    expect(REPORTS_AREA.sections.map((s) => s.href)).not.toContain("/finance/invoices");
  });

  it("groups the reports by the part of the business they are about, in plain names", () => {
    const groups = [...new Set(REPORTS_AREA.sections.map((s) => s.group))];
    expect(groups).toEqual(["HR", "Workforce", "Payroll", "Operations", "Finance", "Audit"]);
  });
});

describe("no report is listed in two places", () => {
  it("Payroll no longer lists any report page (they are under Reports); it keeps its working pages, PAYE and Pension", () => {
    for (const s of PAYROLL_AREA.sections) expect(s.href.startsWith("/reports/"), s.href).toBe(false);
    const hrefs = PAYROLL_AREA.sections.map((s) => s.href);
    for (const h of ["/payroll/paye", "/payroll/pension", "/payroll/runs", "/payments/batches", "/payments/reconciliation"]) expect(hrefs).toContain(h);
  });

  it("no page is in two areas, and no sidebar group lists a report page any more", () => {
    const all = AREAS.flatMap((a) => a.sections.map((s) => s.href));
    expect(new Set(all).size).toBe(all.length);
    for (const g of [...NAV, ...SELF_NAV]) for (const i of g.items) expect(i.href.startsWith("/reports/"), `${g.title}: ${i.href}`).toBe(false);
  });

  it("every report that was in the Payroll area or another sidebar group is still reachable, under Reports", () => {
    const moved = [...OLD_SIDEBAR_REPORTS.map(([h]) => h), "/reports/payslips", "/reports/payroll-register", "/reports/bank", "/reports/paye", "/reports/pension", "/reports/itf", "/reports/nsitf", "/reports/nhf-medical", "/reports/insurance", "/reports/uniform-kits", "/reports/recruitment-training", "/reports/leave-reliever", "/reports/outsourcing-leave-allowance", "/reports/employer-contributions", "/reports/overtime", "/reports/arrears", "/reports/deductions"];
    for (const h of moved) expect(sectionFor(REPORTS_AREA, h), h).not.toBeNull();
  });
});

describe("the sidebar entry", () => {
  const v = (role: Role) => ({ can: (p: Permission) => can(role, p), allowed: () => true, bureau: false });

  it("is one entry, Reports, that leads to the first report the person may open; none for someone who may open none", () => {
    const group = NAV.find((g) => g.title === "Reports")!;
    expect(group.items).toEqual([expect.objectContaining({ label: "Reports", area: "reports" })]);
    expect(areaEntry(REPORTS_AREA, v("PAYROLL_ADMIN"))?.label).toBe("Reports");
    expect(areaEntry(REPORTS_AREA, v("EMPLOYEE"))).toBeNull();
  });

  it("shows a role exactly the reports it may open: each report appears if and only if the role holds that report's permission", () => {
    for (const r of roles) {
      const shown = new Set(visibleSections(REPORTS_AREA, v(r)).map((s) => s.href));
      for (const s of REPORTS_AREA.sections) expect(shown.has(s.href), `${r} on ${s.href}`).toBe(can(r, reportPermission(slug(s.href))));
    }
    // and the sensitive ones are not shown to a role with reports.view alone
    const onlyReports = visibleSections(REPORTS_AREA, { can: (p) => p === "reports.view", allowed: () => true, bureau: false }).map((s) => s.href);
    for (const h of ["/reports/audit", "/reports/guarantors", "/reports/appraisal-results", "/reports/detail-changes"]) expect(onlyReports, h).not.toContain(h);
    expect(onlyReports).toContain("/reports/payslips");
  });
});
