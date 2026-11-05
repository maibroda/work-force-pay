import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { AREAS, HR_AREA, NAV, PAYROLL_AREA, REPORTS_AREA, areaEntry, groupSections, searchPages, sectionFor, visibleSections } from "@/lib/nav";

/**
 * The founder's review (2026-11-04): about 170 menu entries over 239 pages is hard to work in; merge the pages that overlap, make the menu easy to find your way around
 * (docs/plans/navigation-consolidation.md). Payroll first: its 38 sidebar entries become ONE entry, "Payroll", with its pages as tabs inside it, grouped by the job. These tests pin
 * that no page was lost, that nobody gained or lost access to a page, that the duplicates are gone, and how the tab rows and the "Go to" search behave.
 */
const all: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "CLIENT_APPROVER", "CLIENT_HR"];

/** The Payroll group of the sidebar exactly as it was before (href and the permission that showed it), so nothing can be lost or opened to someone new by accident. */
const OLD_PAYROLL: Array<[string, Permission]> = [
  ["/payroll/structures", "structure.view"],
  ["/payroll/components", "structure.view"],
  ["/payroll/periods", "payroll.view"],
  ["/payroll/calendar", "payroll.view"],
  ["/payroll/client-inputs", "payroll.view"],
  ["/payroll/runs", "payroll.view"],
  ["/payroll/quick-payslip", "payroll.view"],
  ["/payroll/earnings", "payroll.view"],
  ["/payroll/deductions", "payroll.view"],
  ["/payroll/loans", "payroll.view"],
  ["/payroll/overtime", "payroll.view"],
  ["/payroll/arrears", "payroll.view"],
  ["/payroll/paye", "payroll.view"],
  ["/payroll/pension", "payroll.view"],
  ["/payroll/control", "payroll.view"],
  ["/payroll/approval", "payroll.view"],
  ["/payroll/lock", "payroll.view"],
  ["/payroll/supplementary", "payroll.view"],
  ["/payroll/settlements", "payroll.view"],
  ["/payments/batches", "payroll.view"],
  ["/payments/transactions", "payroll.view"],
  ["/payments/bank-codes", "payment.manage"],
  ["/payments/paying-banks", "payment.manage"],
  ["/payments/reconciliation", "payroll.view"],
  ["/payments/remittance", "payroll.view"],
  ["/reports/payroll-register", "reports.view"],
  ["/reports/payslips", "reports.view"],
  ["/reports/employer-contributions", "reports.view"],
  ["/reports/overtime", "reports.view"],
  ["/reports/arrears", "reports.view"],
  ["/reports/deductions", "reports.view"],
  ["/reports/pension", "reports.view"],
  ["/reports/paye", "reports.view"],
  ["/reports/bank", "reports.view"],
  ["/reports/itf", "reports.view"],
  ["/reports/nsitf", "reports.view"],
  ["/reports/nhf-medical", "reports.view"],
  ["/reports/insurance", "reports.view"],
  ["/reports/uniform-kits", "reports.view"],
  ["/reports/recruitment-training", "reports.view"],
  ["/reports/leave-reliever", "reports.view"],
  ["/reports/outsourcing-leave-allowance", "reports.view"],
];
/** Pages that sat in other sidebar groups but belong to payroll, brought in so related pages are together (the founder's example: a salary structure and the contract rates that use it). */
const BROUGHT_IN: Array<[string, Permission]> = [
  ["/contracts/rates", "client.view"],
  ["/settings/statutory", "payroll.view"],
  ["/settings/payroll-rules", "payroll.view"],
  ["/settings/employer-costs", "payroll.view"],
  ["/settings/recurring-deductions", "payroll.view"],
];
/** Menu entries that were duplicates: the page they led to is reachable from one place only now. */
const SPLIT_OUT = { settlements: "/payroll/settlements" }; // End-of-Service Settlements was in HR Lifecycle and in Payroll: it stays with HR
const REDIRECTS = ["/payroll/control", "/payroll/approval", "/payroll/lock"]; // three entries that all led to the payroll runs page

const hrefs = PAYROLL_AREA.sections.map((s) => s.href);
// the reports moved out of Payroll into the Reports area (the founder's decision of 2026-11-05: every report in one place), so a page is reachable if it is a Payroll tab or a Reports tab
const reachable = new Set([...hrefs, ...PAYROLL_AREA.sections.flatMap((s) => s.also ?? []), ...REPORTS_AREA.sections.map((s) => s.href)]);

describe("the Payroll area is one sidebar entry with its pages inside", () => {
  it("replaces the 38 Payroll sidebar entries by one, named Payroll, that leads into the area", () => {
    const group = NAV.find((g) => g.title === "Payroll")!;
    expect(group.items).toHaveLength(1);
    expect(group.items[0]).toMatchObject({ label: "Payroll", area: "payroll" });
    expect(AREAS).toContain(PAYROLL_AREA);
    const sidebarHrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
    for (const [h] of [...OLD_PAYROLL, ...BROUGHT_IN]) if (h !== "/payroll/runs" && h !== SPLIT_OUT.settlements) expect(sidebarHrefs, `${h} should be a tab now, not a sidebar entry`).not.toContain(h);
  });

  it("loses no page: every page that was in the Payroll group, and the ones brought in, is a tab or sits under one (except Settlements, which stays with HR, and the three redirects)", () => {
    for (const [h] of [...OLD_PAYROLL, ...BROUGHT_IN]) {
      if (h === SPLIT_OUT.settlements || REDIRECTS.includes(h)) continue;
      expect(reachable.has(h), `${h} is no longer reachable from Payroll`).toBe(true);
    }
  });

  it("keeps Settlements in one place (HR Lifecycle) and the three step-pages (Validation, Approval, Lock) as redirects to the runs page, not as three entries", () => {
    expect(hrefs).not.toContain("/payroll/settlements");
    // the HR Lifecycle group became the HR area on 2026-11-05: Settlements is a tab there
    expect(HR_AREA.sections.map((i) => i.href)).toContain("/payroll/settlements");
    for (const r of REDIRECTS) {
      expect(hrefs).not.toContain(r);
      expect(fs.readFileSync(path.join(process.cwd(), "src", "app", "(app)", r, "page.tsx"), "utf8"), r).toMatch(/redirect\(/);
    }
  });

  it("shows nobody a page they could not open before, and hides no page from anybody who could open it before (same permission per page)", () => {
    const was = new Map<string, Permission>([...OLD_PAYROLL, ...BROUGHT_IN, ["/payroll/holidays", "payroll.view"]]); // Public holidays was added on 2026-11-05 (the company's holidays, for the paid-days basis)
    for (const s of [...PAYROLL_AREA.sections, ...REPORTS_AREA.sections.filter((r) => was.has(r.href))]) {
      expect(s.perm, s.href).toBe(was.get(s.href));
      for (const r of all) expect(can(r, s.perm)).toBe(can(r, was.get(s.href)!));
    }
  });

  it("has no page twice, every tab is a real page of ours, and each belongs to a named group", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const s of PAYROLL_AREA.sections) {
      expect(pageRouteFor(s.href), `${s.href} is not a page`).not.toBeNull();
      expect(s.group.length, s.href).toBeGreaterThan(2);
      expect(s.label.length, s.href).toBeGreaterThan(2);
    }
    for (const a of PAYROLL_AREA.sections.flatMap((s) => s.also ?? [])) expect(pageRouteFor(a), a).not.toBeNull();
  });

  it("puts the related pages together: a salary structure beside the contract rates that use it, with every component one click away on the structures tab", () => {
    const by = (h: string) => PAYROLL_AREA.sections.find((s) => s.href === h)!;
    expect(by("/contracts/rates").group).toBe(by("/payroll/structures").group);
    expect(by("/payroll/structures").also).toContain("/payroll/components"); // "Salary components" is no separate entry: it is a view of the structures
    expect(by("/payments/reconciliation").label).toBe("Salary payment reconciliation");
  });
});

describe("what a person sees of the area", () => {
  const v = (role: Role, bureau = false) => ({ can: (p: Permission) => can(role, p), allowed: () => true, bureau });

  it("is the pages their role may open, in the area's order; the client-inputs tab only in a bureau", () => {
    const pay = visibleSections(PAYROLL_AREA, v("PAYROLL_ADMIN"));
    expect(pay.map((s) => s.href)).not.toContain("/payroll/client-inputs");
    expect(visibleSections(PAYROLL_AREA, v("PAYROLL_ADMIN", true)).map((s) => s.href)).toContain("/payroll/client-inputs");
    expect(pay.map((s) => s.href)).toContain("/payroll/runs");
    expect(visibleSections(PAYROLL_AREA, v("EMPLOYEE"))).toEqual([]);
  });

  it("hides a page of a module the company has not bought (the same check the menu used)", () => {
    const some = visibleSections(PAYROLL_AREA, { can: () => true, allowed: (h) => h !== "/payments/batches", bureau: true });
    expect(some.map((s) => s.href)).not.toContain("/payments/batches");
  });

  it("makes the sidebar entry lead to the first page they can open, so someone who may only read reports still gets in, and no entry at all for someone with nothing", () => {
    expect(areaEntry(PAYROLL_AREA, v("PAYROLL_ADMIN"))).toEqual({ href: "/payroll/runs", label: "Payroll" });
    // someone who may only read reports has no Payroll entry: the reports are under Reports now
    expect(areaEntry(PAYROLL_AREA, { can: (p) => p === "reports.view", allowed: () => true, bureau: false })).toBeNull();
    expect(areaEntry(REPORTS_AREA, { can: (p) => p === "reports.view", allowed: () => true, bureau: false })).toEqual({ href: "/reports", label: "Reports" });
    expect(areaEntry(PAYROLL_AREA, v("EMPLOYEE"))).toBeNull();
  });

  it("groups the visible pages by job, in the order the groups first appear", () => {
    const g = groupSections(visibleSections(PAYROLL_AREA, v("PAYROLL_ADMIN", true)));
    expect(g.map((x) => x.group)).toEqual([...new Set(PAYROLL_AREA.sections.map((s) => s.group))].filter((n) => g.some((x) => x.group === n)));
    expect(g.length).toBeGreaterThanOrEqual(5);
    expect(g.flatMap((x) => x.sections.map((s) => s.href)).sort()).toEqual(visibleSections(PAYROLL_AREA, v("PAYROLL_ADMIN", true)).map((s) => s.href).sort());
  });
});

describe("which tab a page is under", () => {
  it("finds the tab for its own page, for a page inside it, and for the pages folded into it; the longest match wins; anywhere else is none", () => {
    const at = (p: string) => sectionFor(PAYROLL_AREA, p)?.href ?? null;
    expect(at("/payroll/runs")).toBe("/payroll/runs");
    expect(at("/payroll/runs/abc123")).toBe("/payroll/runs");
    expect(at("/payroll/structures/new")).toBe("/payroll/structures");
    expect(at("/payroll/components")).toBe("/payroll/structures");
    expect(at("/payments/batches/")).toBe("/payments/batches");
    expect(at("/reports/payslips")).toBeNull(); // payslips are a report now: under Reports
    expect(sectionFor(REPORTS_AREA, "/reports/payslips")?.href).toBe("/reports/payslips");
    expect(at("/employees")).toBeNull();
    expect(at("/payroll")).toBeNull();
  });
});

describe("the Go to search", () => {
  const pages = [
    { href: "/payroll/runs", label: "Payroll runs", where: "Payroll › Run payroll" },
    { href: "/reports/pension", label: "Pension schedule", where: "Payroll › Tax & schedules" },
    { href: "/payroll/pension", label: "Pension", where: "Payroll › Tax & schedules" },
    { href: "/accounting/journals", label: "Journal entries", where: "Accounting" },
    { href: "/employees/pfas", label: "Pension fund administrators", where: "Employees" },
  ];
  it("finds pages by any word, in any capitals, best match first (a label that starts with it before one that merely contains it)", () => {
    expect(searchPages(pages, "pension").map((p) => p.href)).toEqual(["/payroll/pension", "/reports/pension", "/employees/pfas"]);
    expect(searchPages(pages, "JOURNAL")[0].href).toBe("/accounting/journals");
    expect(searchPages(pages, "run")[0].href).toBe("/payroll/runs");
    expect(searchPages(pages, "fund admin")[0].href).toBe("/employees/pfas");
  });
  it("matches where a page sits only when no page title matches, so a group name does not drag in unrelated pages", () => {
    const grouped = [
      { href: "/a", label: "Pension", where: "Payroll › Tax, pension & schedules" },
      { href: "/b", label: "PAYE schedule", where: "Payroll › Tax, pension & schedules" },
      { href: "/c", label: "ITF schedule", where: "Payroll › Tax, pension & schedules" },
    ];
    expect(searchPages(grouped, "pens").map((p) => p.href)).toEqual(["/a"]); // /b and /c only share the group's name
  });
  it("also matches where a page sits, shows nothing for a blank or unmatched search, and at most eight", () => {
    expect(searchPages(pages, "accounting").map((p) => p.href)).toEqual(["/accounting/journals"]);
    expect(searchPages(pages, "   ")).toEqual([]);
    expect(searchPages(pages, "zzz")).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ href: `/x/${i}`, label: `Report ${i}`, where: "R" }));
    expect(searchPages(many, "report")).toHaveLength(8);
  });
});
