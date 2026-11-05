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
    title: "HR Lifecycle",
    items: [
      { href: "/hr", label: "HR Overview", perm: "hr.view" },
      { href: "/hr/requisitions", label: "Job Requisitions", perm: "hr.view", section: "Recruitment" },
      { href: "/hr/candidates", label: "Candidates & Pipeline", perm: "hr.view" },
      { href: "/hr/onboarding", label: "Onboarding Tracker", perm: "hr.view", section: "Onboarding" },
      { href: "/hr/contracts", label: "Employment Contracts", perm: "hr.view", section: "Contracts" },
      { href: "/hr/relations", label: "Employee Relations", perm: "hr.view", section: "Employee relations" },
      { href: "/hr/exits", label: "Exits & Clearance", perm: "hr.view", section: "Exit" },
      { href: "/hr/attrition", label: "Attrition Report", perm: "hr.view" },
      { href: "/hr/training", label: "Training Compliance", perm: "hr.view", section: "Training" },
      { href: "/hr/policies", label: "Policies & Acknowledgements", perm: "hr.view", section: "Policies" },
      { href: "/hr/data-requests", label: "Data Access Requests", perm: "hr.view", section: "Privacy" },
      { href: "/hr/breaches", label: "Data Breaches", perm: "hr.view" },
      { href: "/hr/retention", label: "Records Retention", perm: "hr.view" },
      { href: "/hr/appraisals", label: "Appraisals", perm: "appraisal.view", section: "Performance" },
      { href: "/hr/letters", label: "Letters", perm: "hr.view", section: "Letters" },
      { href: "/payroll/settlements", label: "End-of-Service Settlements", perm: "payroll.view" },
    ],
  },
  {
    title: "Payroll",
    // One entry for the whole area: its pages are tabs inside it (PAYROLL_AREA below). The entry leads to the first page the person may open.
    items: [{ href: "/payroll/runs", label: "Payroll", perm: "payroll.view", area: "payroll" }],
  },
  {
    title: "Operations",
    items: [
      { href: "/operations/activation", label: "Activation Dashboard", perm: "operations.view" },
      { href: "/operations/deployments", label: "Deployment", perm: "operations.view" },
      { href: "/operations/movements", label: "Staff Movement", perm: "operations.view" },
      { href: "/operations/work-register", label: "Work Register", perm: "operations.view" },
      { href: "/operations/attendance", label: "Attendance", perm: "attendance.record" },
      { href: "/operations/rosters", label: "Rosters", perm: "operations.view" },
      { href: "/operations/absence", label: "Absence", perm: "operations.view" },
      { href: "/operations/movements?type=REPLACEMENT", label: "Replacements", perm: "operations.view" },
      { href: "/operations/movements?type=PERMANENT_TRANSFER", label: "Transfers", perm: "operations.view" },
      { href: "/inventory", label: "Stock & Kit", perm: "inventory.view", section: "Uniform & kit" },
      { href: "/inventory/packs", label: "Kit Packs", perm: "inventory.view" },
      { href: "/inventory/outstanding", label: "Kit Held by Staff", perm: "inventory.view" },
    ],
  },
  {
    title: "Leave Management",
    items: [
      { href: "/leave", label: "Leave Management", perm: "leave.view" },
      { href: "/leave/balances", label: "Leave Balances", perm: "leave.view" },
      { href: "/settings/leave", label: "Leave Policy", perm: "leave.manage" },
    ],
  },
  {
    title: "Finance / Accounting",
    items: [
      { href: "/clients", label: "Clients", perm: "client.view" },
      { href: "/contracts", label: "Contracts", perm: "client.view" },
      { href: "/beats/bids", label: "Bids", perm: "client.view" },
      { href: "/beats", label: "Beats / Locations", perm: "client.view" },
      { href: "/beats/strength", label: "Approved Strength", perm: "client.view" },
      {
        href: "/finance/invoices",
        label: "Billing & Receivables",
        perm: "client.view",
        section: "Billing",
      },
      { href: "/finance/billing-rules", label: "Billing Rules", perm: "gl.view", section: "Billing" },
      { href: "/finance/proforma", label: "Proforma Invoices", perm: "client.view", section: "Billing" },
      { href: "/finance/receipts", label: "Client Receipts", perm: "gl.view", section: "Billing" },
      { href: "/finance/notes", label: "Credit & Debit Notes", perm: "gl.view", section: "Billing" },
      { href: "/finance/statements", label: "Receivables Ageing", perm: "gl.view", section: "Billing" },
      {
        href: "/finance/vendors",
        label: "Vendors",
        perm: "gl.view",
        section: "Payables",
      },
      { href: "/finance/payables", label: "Billing & Payables", perm: "gl.view" },
      { href: "/finance/purchase-orders", label: "Purchase Orders", perm: "gl.view" },
      {
        href: "/finance/fixed-assets",
        label: "Fixed Asset Register",
        perm: "gl.view",
        section: "Fixed Assets",
      },
      {
        href: "/finance/bank-accounts",
        label: "Bank Accounts",
        perm: "gl.view",
        section: "Banking",
      },
      { href: "/finance/bank-reconciliation", label: "Operating Account Reconciliation", perm: "gl.view" },
      { href: "/accounting/journals", label: "Journal Entries", perm: "gl.view", section: "Accounting" },
      { href: "/accounting/manual-journals", label: "Manual Journals", perm: "gl.view" },
      { href: "/accounting/recurring-journals", label: "Recurring Journals", perm: "gl.view" },
      { href: "/accounting/reversals", label: "Journal Reversals", perm: "gl.view" },
      { href: "/accounting/tax-codes", label: "Tax Codes & Rates", perm: "gl.view" },
      { href: "/accounting/tax-reports", label: "Tax Reports", perm: "gl.view" },
      { href: "/accounting/wht-certificates", label: "WHT Certificates", perm: "gl.view" },
      { href: "/accounting/periods", label: "Accounting Periods", perm: "gl.view" },
      { href: "/accounting/reconciliations", label: "Reconciliation Centre", perm: "gl.view" },
      { href: "/accounting/ar-report", label: "Monthly Receivables Report", perm: "gl.view" },
      { href: "/accounting/mapping", label: "Payroll GL Mapping", perm: "gl.view" },
      { href: "/accounting/accounts", label: "Chart of Accounts", perm: "gl.view" },
      { href: "/accounting/dimensions", label: "Accounting Dimensions", perm: "gl.view" },
      { href: "/accounting/ledger-by-dimension", label: "Ledger by Dimension", perm: "gl.view" },
      {
        href: "/accounting/trial-balance",
        label: "Trial Balance",
        perm: "gl.view",
        section: "Financial Statements",
      },
      { href: "/accounting/income-statement", label: "Income Statement", perm: "gl.view" },
      { href: "/accounting/balance-sheet", label: "Balance Sheet", perm: "gl.view" },
    ],
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
      { href: "/settings/hr-policy", label: "HR & Lifecycle Policy", perm: "hr.configure" },
      { href: "/settings/checklists", label: "Onboarding & Exit Checklists", perm: "hr.configure" },
      { href: "/settings/letter-templates", label: "Letter Templates", perm: "hr.configure" },
      { href: "/settings/training-requirements", label: "Training Requirements", perm: "hr.configure" },
      { href: "/settings/appraisal-criteria", label: "Appraisal Criteria", perm: "appraisal.manage" },
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
  { href: "/finance/invoices", label: "Billing & Receivables", group: "Finance / Accounting" },
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

export const AREAS: Area[] = [PAYROLL_AREA, REPORTS_AREA];

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
