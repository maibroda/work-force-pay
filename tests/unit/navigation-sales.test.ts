import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { AREAS, BUREAU_AREA, NAV, PORTAL_AREA, SALES_AREA, areaEntry, groupSections, sectionFor, visibleSections, type Area } from "@/lib/nav";

/**
 * The founder's review (2026-11-04/05): so many menu entries make the app hard to work in; merge what overlaps; the two Sales areas become ONE (decision of 2026-11-05)
 * (docs/plans/navigation-consolidation.md). Step 6: the sales module's group (18 entries) and the bureau's own sales pipeline (8 entries) become one entry, Sales; the Bureau group (7)
 * and the client portal's "Your payroll" group (4) each become one entry. Only the MENU is merged: the two sales systems keep their own data, pages and permissions (CLAUDE.md: the
 * bureau's pipeline and the sales module never share a file or a permission), and every page still shows only to who saw it before: by permission, bureau, sales switch or client role.
 */
type Old = { perm: Permission; bureau?: boolean; sales?: boolean; client?: boolean };
const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "SALES_REP", "SALES_MANAGER", "ACCOUNT_MANAGER", "CLIENT_APPROVER", "CLIENT_HR"];

/** Every page of the old groups: href, the permission that showed it, and the flag that hid it from the wrong kind of organization or person. */
const OLD_SALES: Record<string, Old> = {
  "/sales/leads": { perm: "sales.view", sales: true },
  "/sales/accounts": { perm: "sales.view", sales: true },
  "/sales/board": { perm: "sales.view", sales: true },
  "/sales/opportunities": { perm: "sales.view", sales: true },
  "/sales/tasks": { perm: "sales.view", sales: true },
  "/sales/notifications": { perm: "sales.view", sales: true },
  "/sales/cases": { perm: "sales.view", sales: true },
  "/sales/health": { perm: "sales.view", sales: true },
  "/sales/reports": { perm: "sales.view", sales: true },
  "/sales/handovers": { perm: "sales.view", sales: true },
  "/sales/contacts": { perm: "sales.view", sales: true },
  "/sales/import": { perm: "sales.manage", sales: true },
  "/sales/merge": { perm: "sales.view.all", sales: true },
  "/sales/automation": { perm: "sales.configure" },
  "/sales/cases/settings": { perm: "sales.configure" },
  "/sales/teams": { perm: "sales.configure", sales: true },
  "/sales/privacy": { perm: "sales.privacy.manage" },
  "/sales/settings": { perm: "sales.configure" },
  "/crm": { perm: "crm.view", bureau: true },
  "/crm/leads": { perm: "crm.view", bureau: true },
  "/crm/outreach": { perm: "crm.view", bureau: true },
  "/crm/proposals": { perm: "crm.view", bureau: true },
  "/crm/blueprints": { perm: "blueprint.manage", bureau: true },
  "/crm/pricing": { perm: "crm.view", bureau: true },
  "/health-checks": { perm: "healthcheck.view", bureau: true },
  "/crm/partners": { perm: "crm.view", bureau: true },
};
const OLD_BUREAU: Record<string, Old> = {
  "/bureau": { perm: "bureau.view", bureau: true },
  "/bureau/deadlines": { perm: "bureau.view", bureau: true },
  "/bureau/queries": { perm: "bureau.view", bureau: true },
  "/service-desk": { perm: "query.respond", bureau: true },
  "/settings/client-portal": { perm: "users.manage", bureau: true },
  "/bureau/rules": { perm: "bureau.view", bureau: true },
  "/bureau/readiness": { perm: "bureau.view", bureau: true },
};
const OLD_PORTAL: Record<string, Old> = {
  "/portal": { perm: "portal.view", client: true },
  "/portal/inputs": { perm: "portal.view", client: true },
  "/portal/queries": { perm: "portal.query", client: true },
  "/portal/employees": { perm: "portal.changes", client: true },
};
const CASES: Array<[string, Area, Record<string, Old>]> = [
  ["Sales", SALES_AREA, OLD_SALES],
  ["Bureau", BUREAU_AREA, OLD_BUREAU],
  ["Your payroll", PORTAL_AREA, OLD_PORTAL],
];
/** What the old sidebar did for one item: the permission, and the three flags. */
const oldVisible = (o: Old, role: Role, f: { bureau: boolean; sales: boolean; client: boolean }) => can(role, o.perm) && (!o.bureau || f.bureau) && (!o.sales || f.sales) && (!o.client || f.client);
const FLAGS = [false, true].flatMap((bureau) => [false, true].flatMap((sales) => [false, true].map((client) => ({ bureau, sales, client }))));

describe("three sidebar groups become three entries; the two Sales areas become one", () => {
  it("has no Bureau group with two Sales groups any more: one entry each, Sales, Bureau and Your payroll, each standing for an area", () => {
    expect(NAV.filter((g) => g.title === "Sales")).toHaveLength(1);
    for (const [title, key] of [["Sales", "sales"], ["Bureau", "bureau"], ["Your payroll", "portal"]] as const) {
      const g = NAV.find((x) => x.title === title)!;
      expect(g.items, title).toHaveLength(1);
      expect(g.items[0], title).toMatchObject({ label: title, area: key });
    }
    for (const [, a] of CASES) expect(AREAS).toContain(a);
  });

  it("loses no page: every page of the old groups is a tab, exactly once, and nothing is listed as a sidebar entry of its own or in two areas", () => {
    const items = NAV.flatMap((g) => g.items).filter((i) => !i.area);
    const all = AREAS.flatMap((a) => a.sections.map((s) => s.href));
    expect(new Set(all).size).toBe(all.length);
    for (const [, area, old] of CASES)
      for (const h of Object.keys(old)) {
        expect(area.sections.filter((s) => s.href === h), h).toHaveLength(1);
        expect(items.map((i) => i.href), h).not.toContain(h);
      }
  });

  it("every tab is a real page of ours, with the permission that showed it before", () => {
    for (const [, area, old] of CASES)
      for (const s of area.sections) {
        expect(pageRouteFor(s.href), s.href).not.toBeNull();
        expect(s.perm, s.href).toBe(old[s.href].perm);
      }
  });
});

describe("nobody gains or loses a page: visibility is identical to the old sidebar for every role and every kind of organization", () => {
  it("shows each page exactly when the old sidebar did (permission, and the bureau, sales-switch or client-role flag)", () => {
    for (const [name, area, old] of CASES)
      for (const role of roles)
        for (const f of FLAGS) {
          const shown = new Set(visibleSections(area, { can: (p) => can(role, p), allowed: () => true, bureau: f.bureau, sales: f.sales, client: f.client }).map((s) => s.href));
          for (const [href, o] of Object.entries(old)) expect(shown.has(href), `${name} ${role} ${JSON.stringify(f)} ${href}`).toBe(oldVisible(o, role, f));
        }
  });

  it("gives an entry only to someone who may open at least one page, and leads it to the first they may open", () => {
    const v = (role: Role, f: { bureau: boolean; sales: boolean; client: boolean }) => ({ can: (p: Permission) => can(role, p), allowed: () => true, ...f });
    expect(areaEntry(SALES_AREA, v("EMPLOYEE", { bureau: true, sales: true, client: true }))).toBeNull();
    expect(areaEntry(SALES_AREA, v("SALES_REP", { bureau: false, sales: true, client: false }))).toEqual({ href: "/sales/leads", label: "Sales" });
    expect(areaEntry(SALES_AREA, v("BUSINESS_DEV", { bureau: true, sales: false, client: false }))?.href).toBe("/crm");
    expect(areaEntry(PORTAL_AREA, v("CLIENT_APPROVER", { bureau: false, sales: false, client: true }))?.href).toBe("/portal");
    expect(areaEntry(PORTAL_AREA, v("CLIENT_APPROVER", { bureau: false, sales: false, client: false }))).toBeNull(); // the client-role flag still gates it
  });
});

describe("the two sales systems stay two systems, told apart", () => {
  it("groups the sales module's pages and the bureau's pipeline separately, so each reads as its own thing", () => {
    const groups = groupSections(SALES_AREA.sections).map((g) => g.group);
    expect(groups).toEqual(["Leads & deals", "Contacts & cases", "Activity", "Data tools", "Sales setup", "Bureau pipeline"]);
    expect(SALES_AREA.sections.filter((s) => s.group === "Bureau pipeline").every((s) => s.href.startsWith("/crm") || s.href === "/health-checks")).toBe(true);
    expect(SALES_AREA.sections.filter((s) => s.group !== "Bureau pipeline").every((s) => s.href.startsWith("/sales"))).toBe(true);
  });

  it("names the bureau's pages so the same word is not on two tabs: 'Bureau leads' and 'Bureau pipeline' beside the module's 'Leads'", () => {
    const label = (h: string) => SALES_AREA.sections.find((s) => s.href === h)!.label;
    expect(label("/sales/leads")).toBe("Leads");
    expect(label("/crm/leads")).toBe("Bureau leads");
    expect(label("/crm")).toBe("Bureau pipeline");
    const labels = SALES_AREA.sections.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("finds the tab a page is under, with the longest match (cases and their settings, the pipeline and its leads)", () => {
    expect(sectionFor(SALES_AREA, "/sales/cases/abc")?.href).toBe("/sales/cases");
    expect(sectionFor(SALES_AREA, "/sales/cases/settings")?.href).toBe("/sales/cases/settings");
    expect(sectionFor(SALES_AREA, "/crm/leads/xyz")?.href).toBe("/crm/leads");
    expect(sectionFor(SALES_AREA, "/crm")?.href).toBe("/crm");
    expect(sectionFor(BUREAU_AREA, "/bureau/deadlines")?.href).toBe("/bureau/deadlines");
    expect(sectionFor(BUREAU_AREA, "/bureau/xyz")?.href).toBe("/bureau");
  });
});
