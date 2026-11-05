import type { Permission } from "./auth/permissions";
import { reportPermission } from "./report-access";

export interface NavItem {
  href: string;
  label: string;
  perm: Permission;
  /** Optional sub-heading rendered above this item within its group (e.g. "Reports"). */
  section?: string;
  /** Shown only in a payroll bureau, or while working in one of its clients. */
  bureauOnly?: boolean;
  /** Shown only to a client's own people (the portal roles). */
  clientOnly?: boolean;
  /** Shown only while the organization has switched the sales module on. */
  salesOnly?: boolean;
  /** This entry stands for a whole area (see AREAS): shown if the person may open any page of it, and leading to the first they may open. */
  area?: string;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { title: "Dashboard", items: [{ href: "/", label: "Dashboard", perm: "dashboard.view" }] },
  {
    title: "Sales",
    items: [
      { href: "/sales/leads", label: "Leads", perm: "sales.view", salesOnly: true },
      { href: "/sales/accounts", label: "Accounts", perm: "sales.view", salesOnly: true },
      { href: "/sales/board", label: "Deals Board", perm: "sales.view", salesOnly: true },
      { href: "/sales/opportunities", label: "Deals", perm: "sales.view", salesOnly: true },
      { href: "/sales/tasks", label: "My Tasks", perm: "sales.view", salesOnly: true },
      { href: "/sales/notifications", label: "Notifications", perm: "sales.view", salesOnly: true },
      { href: "/sales/cases", label: "Cases", perm: "sales.view", salesOnly: true },
      { href: "/sales/health", label: "Account Health", perm: "sales.view", salesOnly: true },
      { href: "/sales/reports", label: "Reports", perm: "sales.view", salesOnly: true },
      { href: "/sales/handovers", label: "Handovers", perm: "sales.view", salesOnly: true },
      { href: "/sales/contacts", label: "Contacts", perm: "sales.view", salesOnly: true },
      { href: "/sales/import", label: "Import and Export", perm: "sales.manage", salesOnly: true },
      { href: "/sales/merge", label: "Merge Records", perm: "sales.view.all", salesOnly: true },
      { href: "/sales/automation", label: "Automation", perm: "sales.configure" },
      { href: "/sales/cases/settings", label: "Case Settings", perm: "sales.configure" },
      { href: "/sales/teams", label: "Teams", perm: "sales.configure", salesOnly: true },
      { href: "/sales/privacy", label: "Privacy", perm: "sales.privacy.manage" },
      { href: "/sales/settings", label: "Sales Settings", perm: "sales.configure" },
    ],
  },
  {
    title: "Your payroll",
    items: [
      { href: "/portal", label: "Your Payroll", perm: "portal.view", clientOnly: true },
      { href: "/portal/inputs", label: "Monthly Inputs", perm: "portal.view", clientOnly: true },
      { href: "/portal/queries", label: "Your Queries", perm: "portal.query", clientOnly: true },
      { href: "/portal/employees", label: "Your Employees", perm: "portal.changes", clientOnly: true },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/crm", label: "Sales Pipeline", perm: "crm.view", bureauOnly: true },
      { href: "/crm/leads", label: "Leads", perm: "crm.view", bureauOnly: true },
      { href: "/crm/outreach", label: "Outreach", perm: "crm.view", bureauOnly: true },
      { href: "/crm/proposals", label: "Proposals", perm: "crm.view", bureauOnly: true },
      { href: "/crm/blueprints", label: "Blueprints and quotes", perm: "blueprint.manage", bureauOnly: true },
      { href: "/crm/pricing", label: "Pricing", perm: "crm.view", bureauOnly: true },
      { href: "/health-checks", label: "Health Checks", perm: "healthcheck.view", bureauOnly: true },
      { href: "/crm/partners", label: "Referral Partners", perm: "crm.view", bureauOnly: true },
    ],
  },
  {
    title: "Bureau",
    items: [
      { href: "/bureau", label: "Clients", perm: "bureau.view", bureauOnly: true },
      { href: "/bureau/deadlines", label: "Due This Week", perm: "bureau.view", bureauOnly: true },
      { href: "/bureau/queries", label: "Open Queries", perm: "bureau.view", bureauOnly: true },
      { href: "/service-desk", label: "Service Desk", perm: "query.respond", bureauOnly: true },
      { href: "/settings/client-portal", label: "Client Portal Access", perm: "users.manage", bureauOnly: true },
      { href: "/bureau/rules", label: "Statutory Rule Library", perm: "bureau.view", bureauOnly: true },
      { href: "/bureau/readiness", label: "Launch Checklist", perm: "bureau.view", bureauOnly: true },
    ],
  },
  {
    title: "Workforce / Personnel",
    items: [
      // everything about employees sits inside this one entry, as a row of tabs across the top of its pages (EMPLOYEE_SECTIONS below)
      { href: "/employees", label: "Employees", perm: "employee.view" },
    ],
  },
  {
    title: "HR",
    // One entry: recruitment, onboarding, employment, leave, exit, privacy and the HR setup as tabs (HR_AREA below)
    items: [{ href: "/hr", label: "HR", perm: "hr.view", area: "hr" }],
  },
  {
    title: "Payroll",
    // One entry for the whole area: its pages are tabs inside it (PAYROLL_AREA below). The entry leads to the first page the person may open.
    items: [{ href: "/payroll/runs", label: "Payroll", perm: "payroll.view", area: "payroll" }],
  },
  {
    title: "Operations",
    // One entry: deployment, attendance and uniform & kit as tabs (OPERATIONS_AREA below)
    items: [{ href: "/operations/activation", label: "Operations", perm: "operations.view", area: "operations" }],
  },
  {
    title: "Clients & contracts",
    // One entry: its pages are tabs inside it (CLIENTS_AREA below)
    items: [{ href: "/clients", label: "Clients & contracts", perm: "client.view", area: "clients" }],
  },
  {
    title: "Finance",
    // One entry: billing, payables, banking and fixed assets as tabs (FINANCE_AREA below)
    items: [{ href: "/finance/invoices", label: "Finance", perm: "gl.view", area: "finance" }],
  },
  {
    title: "Accounting",
    // One entry: journals, ledger, tax and statements as tabs (ACCOUNTING_AREA below)
    items: [{ href: "/accounting/journals", label: "Accounting", perm: "gl.view", area: "accounting" }],
  },
  {
    title: "Analytics",
    items: [
      { href: "/analytics/payroll", label: "Payroll Analytics", perm: "analytics.view" },
      { href: "/analytics/workforce-cost", label: "Workforce Cost", perm: "analytics.view" },
      { href: "/analytics/client-cost", label: "Client Cost", perm: "analytics.view" },
      { href: "/analytics/profitability", label: "Client Profitability", perm: "analytics.view" },
      {
        href: "/analytics/contract-profitability",
        label: "Contract Profitability",
        perm: "analytics.view",
      },
      { href: "/analytics/cost-centers", label: "Cost Center P&L", perm: "analytics.view" },
      { href: "/analytics/variance", label: "Variance Analysis", perm: "analytics.view" },
      { href: "/analytics/locations", label: "Location Analytics", perm: "analytics.view" },
    ],
  },
  {
    title: "Reports",
    // One entry: the Reports page, with search; each report is a tab inside it (REPORTS_AREA below)
    items: [{ href: "/reports", label: "Reports", perm: "reports.view", area: "reports" }],
  },
  {
    title: "Settings / Support",
    items: [
      { href: "/settings/organization", label: "Organization", perm: "dashboard.view" },
      { href: "/settings/users", label: "Users", perm: "users.manage" },
      { href: "/settings/roles", label: "Roles", perm: "dashboard.view" },
      { href: "/settings/subscription", label: "Subscription", perm: "subscription.view" },
      { href: "/settings/entitlements", label: "Module switch", perm: "subscription.manage" },
      { href: "/settings/price-book", label: "Software price book", perm: "pricebook.manage" },
      { href: "/settings/cost-centers", label: "Cost Centers", perm: "payroll.view" },
      { href: "/settings/numbering", label: "Numbering Rules", perm: "employee.view" },
      { href: "/settings/audit-integrity", label: "Audit Integrity", perm: "audit.view" },
      { href: "/settings/sensitive-access", label: "Who Looked at Sensitive Details", perm: "audit.view" },
    ],
  },
];

export const SELF_NAV: NavGroup[] = [
  {
    title: "My Workspace",
    items: [
      { href: "/supervisor", label: "Today's Work Register", perm: "attendance.record" },
      { href: "/me", label: "My Dashboard", perm: "self.view" },
      { href: "/me/leave", label: "My Leave", perm: "leave.apply" },
      { href: "/me/contacts", label: "My Contacts", perm: "self.view" },
      { href: "/me/details", label: "My Bank & Tax Details", perm: "self.view" },
      { href: "/me/policies", label: "My Policies", perm: "self.view" },
      { href: "/me/my-data", label: "My Data", perm: "self.view" },
      { href: "/me/appraisals", label: "My Appraisals", perm: "self.view" },
      { href: "/me/grievances", label: "My Grievances", perm: "relations.raise" },
      { href: "/settings/security", label: "My Security", perm: "self.security" },
    ],
  },
];

// ───────────────────────────── Areas: one sidebar entry, its pages as tabs ─────────────────────────────

/**
 * An area is a part of the app that used to be dozens of sidebar entries (the founder's review of 2026-11-04: so many entries make the app hard to work in). It is ONE entry in the
 * sidebar; its pages are shown as two rows of tabs across the top of each of them: the jobs (groups) and, under the active job, its pages. Every page keeps its address and its own
 * permission and module check; this only decides where it is listed. See docs/plans/navigation-consolidation.md.
 */
export interface AreaSection {
  href: string;
  label: string;
  perm: Permission;
  /** The job it belongs to (the first row of tabs). */
  group: string;
  bureauOnly?: boolean;
  /** Other pages folded into this one: they show this tab as the one you are on (for example every salary component sits under Salary structures). */
  also?: string[];
}
export interface Area {
  key: string;
  title: string;
  /** The page the sidebar entry opens (a landing page with search). Without one it opens the first page the person may open. */
  home?: string;
  sections: AreaSection[];
}

/**
 * Payroll: 38 sidebar entries became one, grouped by the job. Three entries (Validation, Approval, Lock) were all redirects to the payroll runs page and are gone from the menu (their
 * addresses still work); Settlements stays with HR Lifecycle; Salary components is a view of the salary structures; the contract rates sit beside the salary structures they use; and the
 * payroll-related settings sit here instead of among the other settings.
 */
export const PAYROLL_AREA: Area = {
  key: "payroll",
  title: "Payroll",
  sections: [
    { group: "Run payroll", href: "/payroll/runs", label: "Payroll runs", perm: "payroll.view" },
    { group: "Run payroll", href: "/payroll/periods", label: "Payroll periods", perm: "payroll.view" },
    { group: "Run payroll", href: "/payroll/calendar", label: "Payroll calendar", perm: "payroll.view" },
    { group: "Run payroll", href: "/payroll/client-inputs", label: "Client inputs", perm: "payroll.view", bureauOnly: true },
    { group: "Run payroll", href: "/payroll/supplementary", label: "Supplementary payroll", perm: "payroll.view" },
    { group: "Run payroll", href: "/payroll/quick-payslip", label: "Quick payslip", perm: "payroll.view" },
    { group: "Pay inputs", href: "/payroll/earnings", label: "Earnings", perm: "payroll.view" },
    { group: "Pay inputs", href: "/payroll/deductions", label: "Deductions", perm: "payroll.view" },
    { group: "Pay inputs", href: "/payroll/loans", label: "Staff loans & advances", perm: "payroll.view" },
    { group: "Pay inputs", href: "/payroll/overtime", label: "Overtime", perm: "payroll.view" },
    { group: "Pay inputs", href: "/payroll/arrears", label: "Arrears", perm: "payroll.view" },
    { group: "Pay setup", href: "/payroll/structures", label: "Salary structures", perm: "structure.view", also: ["/payroll/components"] },
    { group: "Pay setup", href: "/contracts/rates", label: "Contract rates", perm: "client.view" },
    { group: "Pay setup", href: "/settings/statutory", label: "Statutory rules", perm: "payroll.view" },
    { group: "Pay setup", href: "/settings/payroll-rules", label: "Payroll rules", perm: "payroll.view" },
    { group: "Pay setup", href: "/settings/employer-costs", label: "Employer cost rules", perm: "payroll.view" },
    { group: "Pay setup", href: "/settings/recurring-deductions", label: "Recurring deductions", perm: "payroll.view" },
    { group: "Pay out", href: "/payments/batches", label: "Payment batches", perm: "payroll.view" },
    { group: "Pay out", href: "/payments/transactions", label: "Payment transactions", perm: "payroll.view" },
    { group: "Pay out", href: "/payments/reconciliation", label: "Salary payment reconciliation", perm: "payroll.view" },
    { group: "Pay out", href: "/payments/paying-banks", label: "Paying banks", perm: "payment.manage" },
    { group: "Pay out", href: "/payments/bank-codes", label: "Bank list & codes", perm: "payment.manage" },
    { group: "Pay out", href: "/payments/remittance", label: "Statutory remittance", perm: "payroll.view" },
    { group: "Tax & pension", href: "/payroll/paye", label: "PAYE", perm: "payroll.view" },
    { group: "Tax & pension", href: "/payroll/pension", label: "Pension", perm: "payroll.view" },
  ],
};

/** What the person may see: their permissions, the company's modules, and whether they are in a bureau. */
export interface Visibility {
  can: (perm: Permission) => boolean;
  allowed: (href: string) => boolean;
  bureau: boolean;
}

/** The pages of an area this person may open, in the area's order. */
export function visibleSections(area: Area, v: Visibility): AreaSection[] {
  return area.sections.filter((s) => v.can(s.perm) && v.allowed(s.href) && (!s.bureauOnly || v.bureau));
}

/** The sidebar entry for an area: its name, leading to the first page the person may open; null (no entry) if they may open none. */
export function areaEntry(area: Area, v: Visibility): { href: string; label: string } | null {
  const first = visibleSections(area, v)[0];
  return first ? { href: area.home ?? first.href, label: area.title } : null;
}

/** The visible pages grouped by job, in the order each job first appears. */
export function groupSections<T extends { group: string }>(sections: T[]): Array<{ group: string; sections: T[] }> {
  const out: Array<{ group: string; sections: T[] }> = [];
  for (const s of sections) {
    const g = out.find((x) => x.group === s.group);
    if (g) g.sections.push(s);
    else out.push({ group: s.group, sections: [s] });
  }
  return out;
}

/** Which tab a page is under: its own address, a page inside it, or a page folded into it; the longest match wins; null if it is no page of the area. */
export function sectionFor<S extends { href: string; also?: string[] }>(area: { sections: S[] }, pathname: string): S | null {
  const p = trimSlash(pathname);
  let best: { s: S; len: number } | null = null;
  for (const s of area.sections)
    for (const h of [s.href, ...(s.also ?? [])]) {
      const base = trimSlash(h);
      if ((p === base || p.startsWith(base + "/")) && (!best || base.length > best.len)) best = { s, len: base.length };
    }
  return best?.s ?? null;
}

/** A page someone can jump to, and where it sits (for the Go to search). */
export interface JumpPage {
  href: string;
  label: string;
  where: string;
}

/** The Go to search: pages whose label (or place) contains what was typed, best first: a label that starts with it, then one with a word that starts with it, then the rest (a match on where a page sits only if no title matches); a shorter label (a closer match) before a longer one. At most eight. */
export function searchPages<T extends JumpPage>(pages: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const score = (p: T) => {
    const label = p.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (p.where.toLowerCase().includes(q)) return 3;
    return null;
  };
  const scored = pages.map((p, i) => ({ p, i, s: score(p) })).filter((x): x is { p: T; i: number; s: number } => x.s !== null);
  // where a page sits counts only when no page title matches, so a group's name does not drag in unrelated pages
  const hits = scored.some((x) => x.s < 3) ? scored.filter((x) => x.s < 3) : scored;
  return hits
    .sort((a, b) => a.s - b.s || a.p.label.length - b.p.label.length || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

/** Every downloadable/report-registry report, grouped for the Reports hub page. */
export const REPORT_LINKS: Array<{ href: string; label: string; group: string }> = [
  { href: "/reports/hr-headcount", label: "Employee Register", group: "HR Lifecycle" },
  { href: "/reports/training-compliance", label: "Training Compliance", group: "HR Lifecycle" },
  { href: "/reports/policy-acknowledgements", label: "Policy Acknowledgements", group: "HR Lifecycle" },
  { href: "/reports/appraisal-results", label: "Appraisal Results", group: "HR Lifecycle" },
  { href: "/reports/guarantors", label: "Guarantor Register", group: "HR Lifecycle" },
  { href: "/reports/records-completeness", label: "Personal Records Completeness", group: "HR Lifecycle" },
  { href: "/reports/detail-changes", label: "Bank, Tax & Pension Change Log", group: "HR Lifecycle" },
  { href: "/reports/location-history", label: "Employee Location History", group: "Workforce / Personnel" },
  { href: "/reports/employee-documents", label: "Employee Documents", group: "Workforce / Personnel" },
  {
    href: "/reports/employee-training",
    label: "Training & Certifications",
    group: "Workforce / Personnel",
  },
  { href: "/reports/payroll-register", label: "Payroll Register", group: "Payroll" },
  { href: "/reports/payslips", label: "Payslips", group: "Payroll" },
  { href: "/reports/employer-contributions", label: "Employer Contributions", group: "Payroll" },
  { href: "/reports/overtime", label: "Overtime Report", group: "Payroll" },
  { href: "/reports/arrears", label: "Arrears Report", group: "Payroll" },
  { href: "/reports/deductions", label: "Deductions Report", group: "Payroll" },
  { href: "/reports/pension", label: "Pension Schedule", group: "Payroll" },
  { href: "/reports/paye", label: "PAYE Schedule", group: "Payroll" },
  { href: "/reports/bank", label: "Bank Payment Schedule", group: "Payroll" },
  { href: "/reports/itf", label: "ITF Schedule", group: "Payroll" },
  { href: "/reports/nsitf", label: "NSITF Schedule", group: "Payroll" },
  { href: "/reports/nhf-medical", label: "NHF / Medical Schedule", group: "Payroll" },
  { href: "/reports/insurance", label: "Insurance Schedule", group: "Payroll" },
  { href: "/reports/uniform-kits", label: "Uniform & Kits Schedule", group: "Payroll" },
  {
    href: "/reports/recruitment-training",
    label: "Recruitment, Training & Vetting Schedule",
    group: "Payroll",
  },
  { href: "/reports/leave-reliever", label: "Annual Leave Reliever Schedule", group: "Payroll" },
  {
    href: "/reports/outsourcing-leave-allowance",
    label: "Outsourcing Leave Allowance Schedule",
    group: "Payroll",
  },
  { href: "/reports/work-register", label: "Work Register Report", group: "Operations" },
  { href: "/reports/staff-movement", label: "Staff Movement Report", group: "Operations" },
  { href: "/reports/beat-reconciliation", label: "Beat Reconciliation", group: "Operations" },
  { href: "/reports/client-beat", label: "Client / Beat Report", group: "Finance / Accounting" },
  { href: "/reports/audit", label: "Audit Report", group: "Settings / Support" },
];

const REPORT_GROUPS: Record<string, string> = { "HR Lifecycle": "HR", "Workforce / Personnel": "Workforce", Payroll: "Payroll", Operations: "Operations", "Finance / Accounting": "Finance", "Settings / Support": "Audit" };

/**
 * Reports: every report in ONE place (the founder, 2026-11-05), instead of in the Payroll, Workforce, Operations, Finance and Settings groups as well as on the Reports page. The Reports
 * page's own list (REPORT_LINKS) is the one source. Each report opens to exactly the permission its page enforces. The sidebar entry opens the Reports page, which has a search.
 */
export const REPORTS_AREA: Area = {
  key: "reports",
  title: "Reports",
  home: "/reports",
  sections: REPORT_LINKS.filter((r) => r.href.startsWith("/reports/")).map((r) => ({
    href: r.href,
    label: r.label,
    perm: reportPermission(r.href.replace("/reports/", "")),
    group: REPORT_GROUPS[r.group] ?? r.group,
  })),
};

/**
 * The 34-entry "Finance / Accounting" group was really three jobs, so it is three sidebar entries, each with its pages as tabs (the founder's review: merge what overlaps, make it easy
 * to navigate). Each page keeps its address and the permission that showed it before. The four journal pages sit together under Journals; "Billing & Receivables" and "Billing &
 * Payables", which read as the same thing, are Client invoices and Supplier bills; the two bank reconciliations stay separate and are named apart.
 */
export const CLIENTS_AREA: Area = {
  key: "clients",
  title: "Clients & contracts",
  sections: [
    { group: "Clients", href: "/clients", label: "Clients", perm: "client.view" },
    { group: "Contracts", href: "/contracts", label: "Contracts", perm: "client.view" },
    { group: "Contracts", href: "/beats/bids", label: "Bids", perm: "client.view" },
    { group: "Sites", href: "/beats", label: "Beats / locations", perm: "client.view" },
    { group: "Sites", href: "/beats/strength", label: "Approved strength", perm: "client.view" },
  ],
};

export const FINANCE_AREA: Area = {
  key: "finance",
  title: "Finance",
  sections: [
    { group: "Billing", href: "/finance/invoices", label: "Client invoices", perm: "client.view" },
    { group: "Billing", href: "/finance/proforma", label: "Proforma invoices", perm: "client.view" },
    { group: "Billing", href: "/finance/receipts", label: "Client receipts", perm: "gl.view" },
    { group: "Billing", href: "/finance/notes", label: "Credit & debit notes", perm: "gl.view" },
    { group: "Billing", href: "/finance/statements", label: "Receivables ageing", perm: "gl.view" },
    { group: "Billing", href: "/accounting/ar-report", label: "Monthly receivables report", perm: "gl.view" },
    { group: "Billing", href: "/finance/billing-rules", label: "Billing rules", perm: "gl.view" },
    { group: "Payables", href: "/finance/vendors", label: "Vendors", perm: "gl.view" },
    { group: "Payables", href: "/finance/payables", label: "Supplier bills", perm: "gl.view" },
    { group: "Payables", href: "/finance/purchase-orders", label: "Purchase orders", perm: "gl.view" },
    { group: "Banking", href: "/finance/bank-accounts", label: "Bank accounts", perm: "gl.view" },
    { group: "Banking", href: "/finance/bank-reconciliation", label: "Operating account reconciliation", perm: "gl.view" },
    { group: "Fixed assets", href: "/finance/fixed-assets", label: "Fixed asset register", perm: "gl.view" },
  ],
};

export const ACCOUNTING_AREA: Area = {
  key: "accounting",
  title: "Accounting",
  sections: [
    { group: "Journals", href: "/accounting/journals", label: "Journal entries", perm: "gl.view" },
    { group: "Journals", href: "/accounting/manual-journals", label: "Manual journals", perm: "gl.view" },
    { group: "Journals", href: "/accounting/recurring-journals", label: "Recurring journals", perm: "gl.view" },
    { group: "Journals", href: "/accounting/reversals", label: "Journal reversals", perm: "gl.view" },
    { group: "Ledger", href: "/accounting/accounts", label: "Chart of accounts", perm: "gl.view" },
    { group: "Ledger", href: "/accounting/dimensions", label: "Accounting dimensions", perm: "gl.view" },
    { group: "Ledger", href: "/accounting/ledger-by-dimension", label: "Ledger by dimension", perm: "gl.view" },
    { group: "Ledger", href: "/accounting/mapping", label: "Payroll GL mapping", perm: "gl.view" },
    { group: "Ledger", href: "/accounting/periods", label: "Accounting periods", perm: "gl.view" },
    { group: "Ledger", href: "/accounting/reconciliations", label: "Reconciliation centre", perm: "gl.view" },
    { group: "Tax", href: "/accounting/tax-codes", label: "Tax codes & rates", perm: "gl.view" },
    { group: "Tax", href: "/accounting/tax-reports", label: "Tax reports", perm: "gl.view" },
    { group: "Tax", href: "/accounting/wht-certificates", label: "WHT certificates", perm: "gl.view" },
    { group: "Statements", href: "/accounting/trial-balance", label: "Trial balance", perm: "gl.view" },
    { group: "Statements", href: "/accounting/income-statement", label: "Income statement", perm: "gl.view" },
    { group: "Statements", href: "/accounting/balance-sheet", label: "Balance sheet", perm: "gl.view" },
  ],
};

/**
 * HR Lifecycle (16 entries) and Leave Management (3) are one entry, HR, with its pages as tabs grouped by job, plus the HR settings that sat among the other settings (the founder's review:
 * merge what overlaps, make it easy to navigate). End-of-Service Settlements was listed in HR Lifecycle and in Payroll (the same page): it is here only. Each page keeps its address and the
 * permission that showed it before.
 */
export const HR_AREA: Area = {
  key: "hr",
  title: "HR",
  sections: [
    { group: "Overview", href: "/hr", label: "HR overview", perm: "hr.view" },
    { group: "Recruitment", href: "/hr/requisitions", label: "Job requisitions", perm: "hr.view" },
    { group: "Recruitment", href: "/hr/candidates", label: "Candidates & pipeline", perm: "hr.view" },
    { group: "Employee administration", href: "/hr/onboarding", label: "Onboarding tracker", perm: "hr.view" },
    { group: "Employee administration", href: "/hr/contracts", label: "Employment contracts & probation", perm: "hr.view" },
    { group: "Employee administration", href: "/hr/letters", label: "Letters", perm: "hr.view" },
    { group: "Employee administration", href: "/hr/exits", label: "Exits & clearance", perm: "hr.view" },
    { group: "Employee administration", href: "/payroll/settlements", label: "End-of-service settlements", perm: "payroll.view" },
    { group: "Employee administration", href: "/hr/attrition", label: "Attrition report", perm: "hr.view" },
    { group: "Performance management", href: "/hr/appraisals", label: "Appraisals", perm: "appraisal.view" },
    { group: "Performance management", href: "/settings/appraisal-criteria", label: "Appraisal criteria", perm: "appraisal.manage" },
    { group: "Employee relations", href: "/hr/relations", label: "Employee relations cases", perm: "hr.view" },
    { group: "Learning & development", href: "/hr/training", label: "Training compliance", perm: "hr.view" },
    { group: "Learning & development", href: "/settings/training-requirements", label: "Training requirements", perm: "hr.configure" },
    { group: "Leave", href: "/leave", label: "Leave management", perm: "leave.view" },
    { group: "Leave", href: "/leave/balances", label: "Leave balances", perm: "leave.view" },
    { group: "Leave", href: "/settings/leave", label: "Leave policy", perm: "leave.manage" },
    { group: "Privacy & records", href: "/hr/policies", label: "Policies & acknowledgements", perm: "hr.view" },
    { group: "Privacy & records", href: "/hr/data-requests", label: "Data access requests", perm: "hr.view" },
    { group: "Privacy & records", href: "/hr/breaches", label: "Data breaches", perm: "hr.view" },
    { group: "Privacy & records", href: "/hr/retention", label: "Records retention", perm: "hr.view" },
    { group: "HR setup", href: "/settings/hr-policy", label: "HR & lifecycle policy", perm: "hr.configure" },
    { group: "HR setup", href: "/settings/checklists", label: "Onboarding & exit checklists", perm: "hr.configure" },
    { group: "HR setup", href: "/settings/letter-templates", label: "Letter templates", perm: "hr.configure" },
  ],
};

/**
 * The 12-entry Operations group is one entry. "Replacements" and "Transfers" were two entries for the same page as "Staff movement" (it filters by type): they are filters on that page now,
 * and their old addresses still work. Each page keeps its address and the permission that showed it before.
 */
export const OPERATIONS_AREA: Area = {
  key: "operations",
  title: "Operations",
  sections: [
    { group: "Overview", href: "/operations/activation", label: "Activation dashboard", perm: "operations.view" },
    { group: "Deployment", href: "/operations/deployments", label: "Deployments", perm: "operations.view" },
    { group: "Deployment", href: "/operations/movements", label: "Staff movement", perm: "operations.view" },
    { group: "Attendance", href: "/operations/work-register", label: "Work register", perm: "operations.view" },
    { group: "Attendance", href: "/operations/attendance", label: "Attendance", perm: "attendance.record" },
    { group: "Attendance", href: "/operations/rosters", label: "Rosters", perm: "operations.view" },
    { group: "Attendance", href: "/operations/absence", label: "Absence", perm: "operations.view" },
    { group: "Uniform & kit", href: "/inventory", label: "Stock & kit", perm: "inventory.view" },
    { group: "Uniform & kit", href: "/inventory/packs", label: "Kit packs", perm: "inventory.view" },
    { group: "Uniform & kit", href: "/inventory/outstanding", label: "Kit held by staff", perm: "inventory.view" },
  ],
};

export const AREAS: Area[] = [PAYROLL_AREA, OPERATIONS_AREA, HR_AREA, CLIENTS_AREA, FINANCE_AREA, ACCOUNTING_AREA, REPORTS_AREA];

export interface EmployeeSection {
  href: string;
  label: string;
  perm: Permission;
}

/**
 * What sits inside "Employees" (the founder, 2026-11-04: one menu entry, with Import Employees and the rest as its sections). Shown as a row of tabs across the top of the Employees
 * pages, each only to people whose role may open it, and only while its module is on for the company. The employee's own record has its own tabs and shows all of that person's
 * information, so the row is not shown there.
 */
export const EMPLOYEE_SECTIONS: EmployeeSection[] = [
  { href: "/employees", label: "All employees", perm: "employee.view" },
  { href: "/employees/import", label: "Import employees", perm: "employee.manage" },
  { href: "/employees/categories", label: "Employee categories", perm: "employee.view" },
  { href: "/employees/departments", label: "Departments", perm: "employee.view" },
  { href: "/employees/bank", label: "Bank information", perm: "employee.sensitive" },
  { href: "/employees/pension", label: "Pension information", perm: "employee.sensitive" },
  { href: "/employees/pay-rates", label: "Pay rate approvals", perm: "override.manage" },

  { href: "/employees/pfas", label: "Pension fund administrators", perm: "employee.view" },
  { href: "/employees/tax", label: "Tax information", perm: "employee.sensitive" },
  { href: "/employees/change-requests", label: "Detail change requests", perm: "employee.sensitive" },
  { href: "/employees/next-of-kin", label: "Next of kin & emergency", perm: "employee.sensitive" },
  { href: "/employees/guarantors", label: "Guarantors", perm: "employee.sensitive" },
  { href: "/employees/dependants", label: "Dependants & beneficiaries", perm: "employee.sensitive" },
  { href: "/operations/deployments", label: "Assignments", perm: "operations.view" },
  { href: "/employees/org-chart", label: "Org chart", perm: "employee.view" },
];

const trimSlash = (p: string) => p.replace(/\/+$/, "") || "/";
const SECTION_PAGES = new Set(EMPLOYEE_SECTIONS.map((s) => s.href).filter((h) => h.startsWith("/employees")));

/** Whether the row of Employees tabs is shown on this page: on the section pages, not on an employee's own record or anywhere else. */
export function showEmployeesSections(pathname: string): boolean {
  return SECTION_PAGES.has(trimSlash(pathname));
}

/** Whether a tab is the page being shown. */
export function employeesSectionActive(href: string, pathname: string): boolean {
  return trimSlash(href) === trimSlash(pathname);
}
