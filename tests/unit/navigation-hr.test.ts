import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { AREAS, HR_AREA, NAV, PAYROLL_AREA, areaEntry, groupSections, sectionFor, visibleSections } from "@/lib/nav";

/**
 * The founder's review (2026-11-04/05): so many menu entries make the app hard to work in; merge what overlaps (docs/plans/navigation-consolidation.md). Step 4: "HR Lifecycle" (16
 * entries) and "Leave Management" (3) become ONE entry, HR, with its pages as tabs grouped by job (recruitment, onboarding, employment, leave, exit, privacy and records), plus the HR
 * settings that were among the other settings. These tests pin that no page is lost, that nobody gains or loses access to a page, and that nothing is listed twice.
 */
const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "CLIENT_APPROVER", "CLIENT_HR"];

/** The "HR Lifecycle" and "Leave Management" sidebar groups, and the HR settings, exactly as they were (href and the permission that showed it). */
const OLD: Array<[string, Permission]> = [
  ["/hr", "hr.view"],
  ["/hr/requisitions", "hr.view"],
  ["/hr/candidates", "hr.view"],
  ["/hr/onboarding", "hr.view"],
  ["/hr/contracts", "hr.view"],
  ["/hr/relations", "hr.view"],
  ["/hr/exits", "hr.view"],
  ["/hr/attrition", "hr.view"],
  ["/hr/training", "hr.view"],
  ["/hr/training-calendar", "hr.view"],
  ["/hr/training-needs", "hr.view"],
  ["/hr/policies", "hr.view"],
  ["/hr/data-requests", "hr.view"],
  ["/hr/breaches", "hr.view"],
  ["/hr/retention", "hr.view"],
  ["/hr/appraisals", "appraisal.view"],
  ["/hr/feedback", "feedback.manage"],
  ["/hr/improvement-plans", "pip.view"],
  ["/hr/recognition", "hr.view"],
  ["/hr/promotions", "hr.view"],
  ["/hr/training-requests", "hr.view"],
  ["/hr/training-evaluations", "hr.view"],
  ["/hr/succession", "succession.manage"],
  ["/settings/career-paths", "hr.configure"],
  ["/hr/welfare-summary", "welfare.manage"],
  ["/hr/letters", "hr.view"],
  ["/hr/documents", "document.view"],
  ["/payroll/settlements", "payroll.view"],
  ["/leave", "leave.view"],
  ["/leave/balances", "leave.view"],
  ["/settings/leave", "leave.manage"],
  // the HR settings, which sat among the other settings
  ["/settings/hr-policy", "hr.configure"],
  ["/settings/checklists", "hr.configure"],
  ["/settings/letter-templates", "hr.configure"],
  ["/settings/training-requirements", "hr.configure"],
  ["/settings/appraisal-criteria", "appraisal.manage"],
];
const hrefs = HR_AREA.sections.map((s) => s.href);

describe("HR Lifecycle and Leave Management become one entry, HR", () => {
  it("has no HR Lifecycle or Leave Management group any more: one entry, HR, standing for an area", () => {
    expect(NAV.find((g) => g.title === "HR Lifecycle")).toBeUndefined();
    expect(NAV.find((g) => g.title === "Leave Management")).toBeUndefined();
    const g = NAV.find((x) => x.title === "HR")!;
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ label: "HR", area: "hr" });
    expect(AREAS).toContain(HR_AREA);
  });

  it("loses no page: every page of the old groups and every HR setting is a tab, exactly once", () => {
    for (const [h] of OLD) expect(hrefs.filter((x) => x === h), h).toHaveLength(1);
  });

  it("opens each page to exactly the roles that could see it before: same permission per page", () => {
    const was = new Map<string, Permission>(OLD);
    for (const s of HR_AREA.sections) {
      // Job descriptions & KPIs was added on 2026-11-06 (they feed the appraisal): it opens to exactly the roles that may open Appraisals
      if (s.href === "/hr/job-descriptions") {
        expect(s.perm).toBe("appraisal.view");
        for (const r of roles) expect(can(r, s.perm), r).toBe(can(r, was.get("/hr/appraisals")!));
        continue;
      }
      // Disciplinary was split from Employee relations on 2026-11-05 (the founder's decision): the new page opens to the new disciplinary permission, which only ever narrows access
      if (s.href === "/hr/discipline") {
        expect(s.perm).toBe("discipline.view");
        for (const r of roles) if (can(r, s.perm)) expect(can(r, "hr.view"), r).toBe(true);
        continue;
      }
      // Document types was added on 2026-11-07 (the document management request): it opens only to those who may configure documents, who are all HR staff
      if (s.href === "/settings/document-types") {
        expect(s.perm).toBe("document.configure");
        for (const r of roles) if (can(r, s.perm)) expect(can(r, "hr.view"), r).toBe(true);
        continue;
      }
      expect(s.perm, s.href).toBe(was.get(s.href));
      for (const r of roles) expect(can(r, s.perm)).toBe(can(r, was.get(s.href)!));
    }
  });

  it("lists none of those pages as a sidebar entry of its own, and none appears in another area (Settlements is in HR only, not in Payroll)", () => {
    const items = NAV.flatMap((g) => g.items).filter((i) => !i.area);
    for (const [h] of OLD) expect(items.map((i) => i.href), h).not.toContain(h);
    const all = AREAS.flatMap((a) => a.sections.map((s) => s.href));
    expect(new Set(all).size).toBe(all.length);
    expect(PAYROLL_AREA.sections.map((s) => s.href)).not.toContain("/payroll/settlements");
  });

  it("has only real pages, each in a named group, and groups them by the job", () => {
    for (const s of HR_AREA.sections) expect(pageRouteFor(s.href), s.href).not.toBeNull();
    // the groups follow the HR functions in the review the founder asked me to consider (2026-11-05): recruitment, employee administration, performance management, employee relations,
    // learning and development; only for pages that exist (the rest is in docs/plans/hr-module-gap-analysis.md)
    expect(groupSections(HR_AREA.sections).map((g) => g.group)).toEqual(["Overview", "Recruitment", "Employee administration", "Performance management", "Employee relations", "Disciplinary", "Learning & development", "Leave", "Privacy & records", "HR setup"]);
  });

  it("puts leave in the same place as the rest of HR, with its policy beside the balances", () => {
    const leave = HR_AREA.sections.filter((s) => s.group === "Leave").map((s) => s.href);
    expect(leave).toEqual(["/leave", "/leave/balances", "/settings/leave"]);
    // exit management is part of employee administration, with probation and confirmation on the employment contract
    const admin = HR_AREA.sections.filter((s) => s.group === "Employee administration").map((s) => s.href);
    for (const h of ["/hr/onboarding", "/hr/contracts", "/hr/exits", "/payroll/settlements", "/hr/attrition", "/hr/letters"]) expect(admin, h).toContain(h);
    expect(HR_AREA.sections.filter((s) => s.group === "Performance management").map((s) => s.href)).toEqual(["/hr/appraisals", "/hr/feedback", "/hr/improvement-plans", "/hr/recognition", "/hr/promotions", "/hr/succession", "/hr/job-descriptions", "/settings/appraisal-criteria", "/settings/career-paths"]);
    expect(HR_AREA.sections.filter((s) => s.group === "Learning & development").map((s) => s.href)).toEqual(["/hr/training", "/hr/training-calendar", "/hr/training-needs", "/hr/training-requests", "/hr/training-evaluations", "/settings/training-requirements"]);
    expect(HR_AREA.sections.filter((s) => s.group === "Employee relations").map((s) => s.href)).toEqual(["/hr/relations", "/hr/welfare-summary"]);
    expect(HR_AREA.sections.filter((s) => s.group === "Disciplinary").map((s) => s.href)).toEqual(["/hr/discipline"]);
  });
});

describe("what a person sees", () => {
  const v = (role: Role) => ({ can: (p: Permission) => can(role, p), allowed: () => true, bureau: false });

  it("shows each role exactly the pages it may open, so a supervisor who may only handle leave still gets in, and an employee has no HR entry", () => {
    for (const r of roles) {
      const shown = new Set(visibleSections(HR_AREA, v(r)).map((s) => s.href));
      for (const s of HR_AREA.sections) expect(shown.has(s.href), `${r} ${s.href}`).toBe(can(r, s.perm));
    }
    const onlyLeave = visibleSections(HR_AREA, { can: (p) => p === "leave.view", allowed: () => true, bureau: false }).map((s) => s.href);
    expect(onlyLeave).toEqual(["/leave", "/leave/balances"]);
    expect(areaEntry(HR_AREA, { can: (p) => p === "leave.view", allowed: () => true, bureau: false })).toEqual({ href: "/leave", label: "HR" });
    expect(areaEntry(HR_AREA, v("EMPLOYEE"))).toBeNull();
  });

  it("finds the tab a page is under, including the pages inside it", () => {
    expect(sectionFor(HR_AREA, "/hr/candidates/abc")?.href).toBe("/hr/candidates");
    expect(sectionFor(HR_AREA, "/hr")?.href).toBe("/hr");
    expect(sectionFor(HR_AREA, "/payroll/settlements")?.href).toBe("/payroll/settlements");
    expect(sectionFor(HR_AREA, "/settings/hr-policy")?.group).toBe("HR setup");
    expect(sectionFor(HR_AREA, "/settings/appraisal-criteria")?.group).toBe("Performance management");
    expect(sectionFor(HR_AREA, "/leave/balances")?.href).toBe("/leave/balances");
  });
});
