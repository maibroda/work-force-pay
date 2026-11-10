import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { ANALYTICS_AREA, AREAS, MY_AREA, NAV, SELF_NAV, SETTINGS_AREA, areaEntry, groupSections, sectionFor, visibleSections, type Area } from "@/lib/nav";

/**
 * The founder's review (2026-11-04/05): so many menu entries make the app hard to work in (docs/plans/navigation-consolidation.md). Step 7, the last: Settings (what is left of it after
 * the payroll, HR and bureau settings moved into their areas), Analytics (8 entries) and My workspace (10 entries, the self-service pages) each become one entry with their pages as
 * tabs. These tests pin that no page is lost, that every page shows to exactly the roles that saw it before, and that nothing is listed twice.
 */
const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "SALES_REP", "CLIENT_APPROVER", "CLIENT_HR"];

const OLD_SETTINGS: Record<string, Permission> = {
  "/settings/organization": "dashboard.view",
  "/settings/users": "users.manage",
  "/settings/roles": "dashboard.view",
  "/settings/subscription": "subscription.view",
  "/settings/entitlements": "subscription.manage",
  "/settings/price-book": "pricebook.manage",
  "/settings/cost-centers": "payroll.view",
  "/settings/numbering": "employee.view",
  "/settings/audit-integrity": "audit.view",
  "/settings/sensitive-access": "audit.view",
};
const OLD_ANALYTICS: Record<string, Permission> = {
  "/analytics/payroll": "analytics.view",
  "/analytics/workforce-cost": "analytics.view",
  "/analytics/client-cost": "analytics.view",
  "/analytics/profitability": "analytics.view",
  "/analytics/contract-profitability": "analytics.view",
  "/analytics/cost-centers": "analytics.view",
  "/analytics/variance": "analytics.view",
  "/analytics/locations": "analytics.view",
};
const OLD_MY: Record<string, Permission> = {
  "/supervisor": "attendance.record",
  "/me": "self.view",
  "/me/leave": "leave.apply",
  "/me/contacts": "self.view",
  "/me/details": "self.view",
  "/me/policies": "self.view",
  "/me/training": "self.view",
  "/me/documents": "self.view",
  "/me/my-data": "self.view",
  "/me/appraisals": "self.view",
  "/me/feedback": "self.view",
  "/me/team-feedback": "feedback.give",
  "/me/improvement-plan": "self.view",
  "/me/recognition": "self.view",
  "/me/career": "self.view",
  "/me/skills": "self.view",
  "/me/team-skills": "skills.assess",
  "/me/team-training": "training.request",
  "/me/team-promotions": "career.propose",
  "/me/recognition-board": "self.view",
  "/me/team-recognition": "recognition.nominate",
  "/me/grievances": "relations.raise",
  "/settings/security": "self.security",
};
const CASES: Array<[string, Area, Record<string, Permission>]> = [
  ["Settings", SETTINGS_AREA, OLD_SETTINGS],
  ["Analytics", ANALYTICS_AREA, OLD_ANALYTICS],
  ["My Workspace", MY_AREA, OLD_MY],
];

describe("Settings, Analytics and My workspace become one entry each", () => {
  it("has one sidebar entry each, standing for an area (My workspace is the self-service group)", () => {
    for (const [title, key] of [["Settings", "settings"], ["Analytics", "analytics"]] as const) {
      const g = NAV.find((x) => x.title === title)!;
      expect(g.items, title).toHaveLength(1);
      expect(g.items[0], title).toMatchObject({ label: title, area: key });
    }
    expect(SELF_NAV).toHaveLength(1);
    expect(SELF_NAV[0].items).toHaveLength(1);
    expect(SELF_NAV[0].items[0]).toMatchObject({ label: "My Workspace", area: "me" });
    for (const [, a] of CASES) expect(AREAS).toContain(a);
  });

  it("loses no page and lists none twice: every old page is a tab exactly once, none is a sidebar entry of its own, none is in two areas", () => {
    const items = [...NAV, ...SELF_NAV].flatMap((g) => g.items).filter((i) => !i.area);
    const all = AREAS.flatMap((a) => a.sections.map((s) => s.href));
    expect(new Set(all).size).toBe(all.length);
    for (const [name, area, old] of CASES)
      for (const h of Object.keys(old)) {
        expect(area.sections.filter((s) => s.href === h), `${name} ${h}`).toHaveLength(1);
        expect(items.map((i) => i.href), h).not.toContain(h);
      }
  });

  it("every tab is a real page of ours, with the permission that showed it before, for every role", () => {
    for (const [, area, old] of CASES)
      for (const s of area.sections) {
        expect(pageRouteFor(s.href), s.href).not.toBeNull();
        expect(s.perm, s.href).toBe(old[s.href]);
        for (const r of roles) expect(can(r, s.perm)).toBe(can(r, old[s.href]));
      }
  });

  it("groups the pages by the job", () => {
    expect(groupSections(SETTINGS_AREA.sections).map((g) => g.group)).toEqual(["Company", "People & access", "Plan & modules", "Audit & security"]);
    expect(groupSections(ANALYTICS_AREA.sections).map((g) => g.group)).toEqual(["Payroll & workforce cost", "Profitability", "Analysis"]);
    expect(groupSections(MY_AREA.sections).map((g) => g.group)).toEqual(["Today", "My details", "My HR", "My security"]);
  });
});

describe("what a person sees", () => {
  const v = (role: Role) => ({ can: (p: Permission) => can(role, p), allowed: () => true, bureau: false });

  it("shows each role exactly the pages it may open, and an entry only to someone who may open one", () => {
    for (const [, area, old] of CASES)
      for (const r of roles) {
        const shown = new Set(visibleSections(area, v(r)).map((s) => s.href));
        for (const [href, perm] of Object.entries(old)) expect(shown.has(href), `${r} ${href}`).toBe(can(r, perm));
      }
    expect(areaEntry(ANALYTICS_AREA, v("EMPLOYEE"))).toBeNull();
  });

  it("leads My workspace to the first page the person may open: a supervisor to today's work register, an employee to their dashboard", () => {
    expect(areaEntry(MY_AREA, v("SUPERVISOR"))?.href).toBe("/supervisor");
    expect(areaEntry(MY_AREA, v("EMPLOYEE"))?.href).toBe("/me");
    expect(areaEntry(MY_AREA, v("EMPLOYEE"))?.label).toBe("My Workspace");
  });

  it("finds the tab a page is under", () => {
    expect(sectionFor(MY_AREA, "/me/leave")?.href).toBe("/me/leave");
    expect(sectionFor(MY_AREA, "/me")?.href).toBe("/me");
    expect(sectionFor(MY_AREA, "/settings/security")?.group).toBe("My security");
    expect(sectionFor(SETTINGS_AREA, "/settings/security")).toBeNull(); // My security is under My workspace, not Settings
    expect(sectionFor(ANALYTICS_AREA, "/analytics/variance")?.href).toBe("/analytics/variance");
  });
});
