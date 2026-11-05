import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { pageRouteFor } from "@/lib/entitlements/guard";
import { ACCOUNTING_AREA, AREAS, CLIENTS_AREA, FINANCE_AREA, NAV, REPORT_LINKS, areaEntry, groupSections, sectionFor, visibleSections } from "@/lib/nav";

/**
 * The founder's review (2026-11-04/05): so many menu entries make the app hard to work in; merge what overlaps (docs/plans/navigation-consolidation.md). Step 3: the 30-entry
 * "Finance / Accounting" group was really three jobs, so it becomes three sidebar entries, each with its pages as tabs: Clients & contracts, Finance (billing, payables, banking, assets)
 * and Accounting (journals, ledger, tax, statements). These tests pin that no page is lost, that nobody gains or loses access to a page, and that nothing is listed twice.
 */
const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "BUSINESS_DEV", "CLIENT_APPROVER", "CLIENT_HR"];

/** The "Finance / Accounting" sidebar group exactly as it was (href and the permission that showed it). */
const OLD: Array<[string, Permission]> = [
  ["/clients", "client.view"],
  ["/contracts", "client.view"],
  ["/beats/bids", "client.view"],
  ["/beats", "client.view"],
  ["/beats/strength", "client.view"],
  ["/finance/invoices", "client.view"],
  ["/finance/billing-rules", "gl.view"],
  ["/finance/proforma", "client.view"],
  ["/finance/receipts", "gl.view"],
  ["/finance/notes", "gl.view"],
  ["/finance/statements", "gl.view"],
  ["/finance/vendors", "gl.view"],
  ["/finance/payables", "gl.view"],
  ["/finance/purchase-orders", "gl.view"],
  ["/finance/fixed-assets", "gl.view"],
  ["/finance/bank-accounts", "gl.view"],
  ["/finance/bank-reconciliation", "gl.view"],
  ["/accounting/journals", "gl.view"],
  ["/accounting/manual-journals", "gl.view"],
  ["/accounting/recurring-journals", "gl.view"],
  ["/accounting/reversals", "gl.view"],
  ["/accounting/tax-codes", "gl.view"],
  ["/accounting/tax-reports", "gl.view"],
  ["/accounting/wht-certificates", "gl.view"],
  ["/accounting/periods", "gl.view"],
  ["/accounting/reconciliations", "gl.view"],
  ["/accounting/ar-report", "gl.view"],
  ["/accounting/mapping", "gl.view"],
  ["/accounting/accounts", "gl.view"],
  ["/accounting/dimensions", "gl.view"],
  ["/accounting/ledger-by-dimension", "gl.view"],
  ["/accounting/trial-balance", "gl.view"],
  ["/accounting/income-statement", "gl.view"],
  ["/accounting/balance-sheet", "gl.view"],
];
const NEW_AREAS = [CLIENTS_AREA, FINANCE_AREA, ACCOUNTING_AREA];
const sections = NEW_AREAS.flatMap((a) => a.sections);

describe("the 34-entry Finance / Accounting group becomes three sidebar entries", () => {
  it("has no Finance / Accounting group any more: three entries, Clients & contracts, Finance and Accounting, each standing for an area", () => {
    expect(NAV.find((g) => g.title === "Finance / Accounting")).toBeUndefined();
    for (const [title, key] of [["Clients & contracts", "clients"], ["Finance", "finance"], ["Accounting", "accounting"]] as const) {
      const g = NAV.find((x) => x.title === title)!;
      expect(g.items, title).toHaveLength(1);
      expect(g.items[0], title).toMatchObject({ label: title, area: key });
    }
    for (const a of NEW_AREAS) expect(AREAS).toContain(a);
  });

  it("loses no page: every page of the old group is a tab, in exactly one area", () => {
    for (const [h] of OLD) expect(sections.filter((s) => s.href === h), h).toHaveLength(1);
  });

  it("opens each page to exactly the roles that could see it before: same permission per page", () => {
    const was = new Map<string, Permission>([...OLD, ["/contracts/pay-basis", "client.view"]]); // Paid days was added on 2026-11-05 (the paid-days basis agreed per contract)
    for (const s of sections) {
      expect(s.perm, s.href).toBe(was.get(s.href));
      for (const r of roles) expect(can(r, s.perm)).toBe(can(r, was.get(s.href)!));
    }
  });

  it("lists no old page as a sidebar entry of its own (only the three area entries remain, each leading to its first page)", () => {
    const items = NAV.flatMap((g) => g.items).filter((i) => !i.area);
    for (const [h] of OLD) expect(items.map((i) => i.href), h).not.toContain(h);
  });

  it("has no page twice across all areas, and every tab is a real page of ours", () => {
    const all = AREAS.flatMap((a) => a.sections.map((s) => s.href));
    expect(new Set(all).size).toBe(all.length);
    for (const s of sections) expect(pageRouteFor(s.href), s.href).not.toBeNull();
  });

  it("groups the pages by the job", () => {
    expect(groupSections(CLIENTS_AREA.sections).map((g) => g.group)).toEqual(["Clients", "Contracts", "Sites"]);
    expect(groupSections(FINANCE_AREA.sections).map((g) => g.group)).toEqual(["Billing", "Payables", "Banking", "Fixed assets"]);
    expect(groupSections(ACCOUNTING_AREA.sections).map((g) => g.group)).toEqual(["Journals", "Ledger", "Tax", "Statements"]);
  });
});

describe("the overlapping pages", () => {
  const label = (h: string) => sections.find((s) => s.href === h)!.label;

  it("puts the four journal pages together under Journals, as one place", () => {
    const j = ACCOUNTING_AREA.sections.filter((s) => s.group === "Journals").map((s) => s.href);
    expect(j).toEqual(["/accounting/journals", "/accounting/manual-journals", "/accounting/recurring-journals", "/accounting/reversals"]);
  });

  it("names the two bank reconciliations apart and keeps them separate (the founder's decision): operating account here, salary payments under Payroll", () => {
    expect(label("/finance/bank-reconciliation")).toBe("Operating account reconciliation");
  });

  it("tells client invoices from supplier bills: 'Billing & Receivables' and 'Billing & Payables' read as the same thing", () => {
    expect(label("/finance/invoices")).toBe("Client invoices");
    expect(label("/finance/payables")).toBe("Supplier bills");
  });

  it("lists the client invoices page once: it is no longer also on the Reports page (it is not a report)", () => {
    expect(REPORT_LINKS.map((r) => r.href)).not.toContain("/finance/invoices");
  });
});

describe("what a person sees", () => {
  const v = (role: Role) => ({ can: (p: Permission) => can(role, p), allowed: () => true, bureau: false });

  it("shows each role only the pages it may open, and no entry for someone with none (an employee sees none of the three)", () => {
    for (const a of NEW_AREAS) {
      for (const r of roles) {
        const shown = visibleSections(a, v(r)).map((s) => s.href);
        for (const s of a.sections) expect(shown.includes(s.href), `${r} ${s.href}`).toBe(can(r, s.perm));
      }
      expect(areaEntry(a, v("EMPLOYEE")), a.key).toBeNull();
    }
  });

  it("finds the tab a page is under, including pages inside it (a contract, a beat) and the longest match for beats", () => {
    expect(sectionFor(CLIENTS_AREA, "/contracts/abc")?.href).toBe("/contracts");
    expect(sectionFor(CLIENTS_AREA, "/beats/bids")?.href).toBe("/beats/bids");
    expect(sectionFor(CLIENTS_AREA, "/beats/strength")?.href).toBe("/beats/strength");
    expect(sectionFor(CLIENTS_AREA, "/beats/xyz")?.href).toBe("/beats");
    expect(sectionFor(ACCOUNTING_AREA, "/accounting/journals/123")?.href).toBe("/accounting/journals");
    expect(sectionFor(FINANCE_AREA, "/accounting/journals")).toBeNull();
  });
});
