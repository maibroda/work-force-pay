import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { AREAS, NAV, OPERATIONS_AREA, areaEntry, groupSections, sectionFor, visibleSections } from "@/lib/nav";

/**
 * The founder's review (2026-11-04/05): so many menu entries make the app hard to work in; merge what overlaps (docs/plans/navigation-consolidation.md). Step 5: the 12-entry Operations
 * group becomes ONE entry with its pages as tabs. "Replacements" and "Transfers" were two entries for the same page as "Staff Movement" (it filters by type), so they become filters on
 * that page. These tests pin that no page is lost, that nobody gains or loses access, and that nothing is listed twice.
 */
const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "CLIENT_APPROVER", "CLIENT_HR"];

/** The Operations sidebar group exactly as it was (href and the permission that showed it). */
const OLD: Array<[string, Permission]> = [
  ["/operations/activation", "operations.view"],
  ["/operations/deployments", "operations.view"],
  ["/operations/movements", "operations.view"],
  ["/operations/work-register", "operations.view"],
  ["/operations/attendance", "attendance.record"],
  ["/operations/rosters", "operations.view"],
  ["/operations/absence", "operations.view"],
  ["/operations/movements?type=REPLACEMENT", "operations.view"],
  ["/operations/movements?type=PERMANENT_TRANSFER", "operations.view"],
  ["/inventory", "inventory.view"],
  ["/inventory/packs", "inventory.view"],
  ["/inventory/outstanding", "inventory.view"],
];
const FILTERS = ["/operations/movements?type=REPLACEMENT", "/operations/movements?type=PERMANENT_TRANSFER"];
const hrefs = OPERATIONS_AREA.sections.map((s) => s.href);

describe("the 12-entry Operations group becomes one entry", () => {
  it("has one sidebar entry, Operations, standing for an area", () => {
    const g = NAV.find((x) => x.title === "Operations")!;
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ label: "Operations", area: "operations" });
    expect(AREAS).toContain(OPERATIONS_AREA);
  });

  it("loses no page: every page of the old group is a tab (the two filtered views are filters on Staff movement), each exactly once", () => {
    for (const [h] of OLD) {
      if (FILTERS.includes(h)) continue;
      expect(hrefs.filter((x) => x === h), h).toHaveLength(1);
    }
  });

  it("Replacements and Transfers are not separate entries any more: they are filters on the Staff movement page, which still answers to those addresses", () => {
    for (const f of FILTERS) expect(hrefs).not.toContain(f);
    const page = fs.readFileSync(path.join(process.cwd(), "src", "app", "(app)", "operations", "movements", "page.tsx"), "utf8");
    for (const f of FILTERS) expect(page, f).toContain(f);
    expect(page).toContain('"/operations/movements"'); // the "all" filter
  });

  it("opens each page to exactly the roles that could see it before: same permission per page", () => {
    const was = new Map(OLD);
    for (const s of OPERATIONS_AREA.sections) {
      expect(s.perm, s.href).toBe(was.get(s.href));
      for (const r of roles) expect(can(r, s.perm)).toBe(can(r, was.get(s.href)!));
    }
  });

  it("lists none of those pages as a sidebar entry of its own, none appears in another area, and every tab is a real page", () => {
    const items = NAV.flatMap((g) => g.items).filter((i) => !i.area);
    for (const [h] of OLD) expect(items.map((i) => i.href), h).not.toContain(h);
    const all = AREAS.flatMap((a) => a.sections.map((s) => s.href));
    expect(new Set(all).size).toBe(all.length);
    for (const s of OPERATIONS_AREA.sections) expect(pageRouteFor(s.href), s.href).not.toBeNull();
  });

  it("groups the pages by the job", () => {
    expect(groupSections(OPERATIONS_AREA.sections).map((g) => g.group)).toEqual(["Overview", "Deployment", "Attendance", "Uniform & kit"]);
    expect(OPERATIONS_AREA.sections.filter((s) => s.group === "Attendance").map((s) => s.href)).toEqual(["/operations/work-register", "/operations/attendance", "/operations/rosters", "/operations/absence"]);
  });
});

describe("what a person sees", () => {
  const v = (role: Role) => ({ can: (p: Permission) => can(role, p), allowed: () => true, bureau: false });

  it("shows each role exactly the pages it may open, and no entry to someone with none", () => {
    for (const r of roles) {
      const shown = new Set(visibleSections(OPERATIONS_AREA, v(r)).map((s) => s.href));
      for (const s of OPERATIONS_AREA.sections) expect(shown.has(s.href), `${r} ${s.href}`).toBe(can(r, s.perm));
    }
    expect(areaEntry(OPERATIONS_AREA, v("EMPLOYEE"))).toBeNull();
  });

  it("finds the tab a page is under, including pages inside it, and the longest match for stock", () => {
    expect(sectionFor(OPERATIONS_AREA, "/operations/movements")?.href).toBe("/operations/movements");
    expect(sectionFor(OPERATIONS_AREA, "/operations/deployments/abc")?.href).toBe("/operations/deployments");
    expect(sectionFor(OPERATIONS_AREA, "/inventory/packs")?.href).toBe("/inventory/packs");
    expect(sectionFor(OPERATIONS_AREA, "/inventory/xyz")?.href).toBe("/inventory");
    expect(sectionFor(OPERATIONS_AREA, "/leave")).toBeNull();
  });
});
