import { describe, expect, it } from "vitest";
import { discoverPages, employeeTabs, matchPage } from "../../scripts/routes";
import { NAV, REPORT_LINKS, SELF_NAV } from "@/lib/nav";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";

const pages = discoverPages();
const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
const staticLinks = [...NAV, ...SELF_NAV].flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));

describe("page discovery", () => {
  it("finds the app's pages and reads each one's permission from its source", () => {
    expect(pages.length).toBeGreaterThan(100);
    expect(matchPage(pages, "/hr/policies")?.perm).toBe("hr.view");
    expect(matchPage(pages, "/settings/hr-policy")?.perm).toBe("hr.configure");
    expect(matchPage(pages, "/me/policies")?.perm).toBeNull(); // any signed-in user
    expect(matchPage(pages, "/hr/policies/abc123")?.route).toBe("/hr/policies/[id]");
    expect(matchPage(pages, "/hr/appraisals/cycle/xyz")?.route).toBe("/hr/appraisals/cycle/[id]");
    expect(matchPage(pages, "/no/such/page")).toBeUndefined();
    expect(matchPage(pages, "/employees/?tab=x")?.route).toBe("/employees");
  });
  it("knows the employee page's tabs", () => {
    const tabs = employeeTabs();
    for (const t of ["overview", "documents", "contacts", "details", "appraisals", "payslips"]) expect(tabs).toContain(t);
  });
});

describe("menus lead somewhere", () => {
  it("every sidebar link points at a page that exists", () => {
    const dead = staticLinks.filter((l) => !matchPage(pages, l.href)).map((l) => `${l.group}: ${l.label} → ${l.href}`);
    expect(dead).toEqual([]);
  });
  it("every Reports hub link points at a page that exists", () => {
    const dead = REPORT_LINKS.filter((l) => !matchPage(pages, l.href)).map((l) => `${l.label} → ${l.href}`);
    expect(dead).toEqual([]);
  });
  it("no link appears twice within a menu group", () => {
    for (const g of [...NAV, ...SELF_NAV]) {
      const hrefs = g.items.map((i) => i.href);
      expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i), g.title).toEqual([]);
    }
  });
  it("a menu item is never shown to a role whose page then refuses it", () => {
    // If the menu's permission is looser than the page's, that role sees a link that leads to "forbidden".
    const bad: string[] = [];
    for (const l of staticLinks) {
      const page = matchPage(pages, l.href);
      if (!page || page.perm === "custom" || page.perm === null) continue;
      for (const r of roles) if (can(r, l.perm) && !can(r, page.perm)) bad.push(`${r} sees "${l.label}" (${l.perm}) but ${l.href} needs ${page.perm}`);
    }
    expect(bad).toEqual([]);
  });
});
