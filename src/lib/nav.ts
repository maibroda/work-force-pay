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
    // One entry: the sales module and the bureau's own pipeline, as tabs (SALES_AREA below). The two stay two systems with their own pages and permissions
    items: [{ href: "/sales/leads", label: "Sales", perm: "sales.view", area: "sales" }],
  },
  {
    title: "Your payroll",
    // One entry for the client portal's pages (PORTAL_AREA below)
    items: [{ href: "/portal", label: "Your payroll", perm: "portal.view", area: "portal" }],
  },
  {
    title: "Bureau",
    // One entry: the bureau's clients, service desk and set-up as tabs (BUREAU_AREA below)
    items: [{ href: "/bureau", label: "Bureau", perm: "bureau.view", area: "bureau" }],
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
    // One entry: its pages are tabs inside it (ANALYTICS_AREA below)
    items: [{ href: "/analytics/payroll", label: "Analytics", perm: "analytics.view", area: "analytics" }],
  },
  {
    title: "Reports",
    // One entry: the Reports page, with search; each report is a tab inside it (REPORTS_AREA below)
    items: [{ href: "/reports", label: "Reports", perm: "reports.view", area: "reports" }],
  },
  {
    title: "Settings",
    // One entry: company, people and access, plan and modules, audit and security as tabs (SETTINGS_AREA below)
    items: [{ href: "/settings/organization", label: "Settings", perm: "dashboard.view", area: "settings" }],
  },
];

export const SELF_NAV: NavGroup[] = [
  {
    title: "My Workspace",
    // One entry for the self-service pages (MY_AREA below): a supervisor's work register, the employee's own details, leave, appraisals, grievances and security
    items: [{ href: "/me", label: "My Workspace", perm: "self.view", area: "me" }],
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
  /** Shown only while the organization has switched the sales module on (as the menu entry was). */
  salesOnly?: boolean;
  /** Shown only to a client's own people, the portal roles (as the menu entry was). */
  clientOnly?: boolean;
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
    { group: "Pay setup", href: "/payroll/holidays", label: "Public holidays", perm: "payroll.view" },
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
  /** The sales module is switched on for the company. Left out: off. */
  sales?: boolean;
  /** The person is one of a client's own people (the portal roles). Left out: no. */
  client?: boolean;
}

/** The pages of an area this person may open, in the area's order. */
export function visibleSections(area: Area, v: Visibility): AreaSection[] {
  return area.sections.filter((s) => v.can(s.perm) && v.allowed(s.href) && (!s.bureauOnly || v.bureau) && (!s.salesOnly || Boolean(v.sales)) && (!s.clientOnly || Boolean(v.client)));
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
    { group: "Contracts", href: "/contracts/pay-basis", label: "Paid days", perm: "client.view" },
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
    { group: "Employee administration", href: "/hr/documents", label: "Employee documents", perm: "document.view" },
    { group: "Employee administration", href: "/hr/exits", label: "Exits & clearance", perm: "hr.view" },
    { group: "Employee administration", href: "/payroll/settlements", label: "End-of-service settlements", perm: "payroll.view" },
    { group: "Employee administration", href: "/hr/attrition", label: "Attrition report", perm: "hr.view" },
    { group: "Performance management", href: "/hr/appraisals", label: "Appraisals", perm: "appraisal.view" },
    { group: "Performance management", href: "/hr/feedback", label: "Feedback", perm: "feedback.manage" },
    { group: "Performance management", href: "/hr/improvement-plans", label: "Improvement plans", perm: "pip.view" },
    { group: "Performance management", href: "/hr/recognition", label: "Recognition", perm: "hr.view" },
    { group: "Performance management", href: "/hr/job-descriptions", label: "Job descriptions & KPIs", perm: "appraisal.view" },
    { group: "Performance management", href: "/settings/appraisal-criteria", label: "Appraisal criteria", perm: "appraisal.manage" },
    { group: "Employee relations", href: "/hr/relations", label: "Employee relations cases", perm: "hr.view" },
    { group: "Employee relations", href: "/hr/welfare-summary", label: "Welfare summary", perm: "welfare.manage" },
    { group: "Disciplinary", href: "/hr/discipline", label: "Disciplinary cases & sanctions", perm: "discipline.view" },
    { group: "Learning & development", href: "/hr/training", label: "Training compliance", perm: "hr.view" },
    { group: "Learning & development", href: "/hr/training-calendar", label: "Training calendar", perm: "hr.view" },
    { group: "Learning & development", href: "/hr/training-needs", label: "Training needs", perm: "hr.view" },
    { group: "Learning & development", href: "/settings/training-requirements", label: "Training requirements", perm: "hr.configure" },
    { group: "Leave", href: "/leave", label: "Leave management", perm: "leave.view" },
    { group: "Leave", href: "/leave/balances", label: "Leave balances", perm: "leave.view" },
    { group: "Leave", href: "/settings/leave", label: "Leave policy", perm: "leave.manage" },
    { group: "Privacy & records", href: "/hr/policies", label: "Policies & acknowledgements", perm: "hr.view" },
    { group: "Privacy & records", href: "/hr/data-requests", label: "Data access requests", perm: "hr.view" },
    { group: "Privacy & records", href: "/hr/breaches", label: "Data breaches", perm: "hr.view" },
    { group: "Privacy & records", href: "/hr/retention", label: "Records retention", perm: "hr.view" },
    { group: "HR setup", href: "/settings/hr-policy", label: "HR & lifecycle policy", perm: "hr.configure" },
    { group: "HR setup", href: "/settings/document-types", label: "Document types", perm: "document.configure" },
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

/**
 * Sales: the sales module's pages (18) and the bureau's own sales pipeline (8) are ONE menu entry (the founder, 2026-11-05), told apart by group and by name ("Bureau leads", "Bureau pipeline").
 * Only the MENU is merged: they remain two systems with their own pages, data and permissions, and every page shows to exactly who saw it before (permission, the sales switch, or
 * being in a bureau). Bureau (7 entries) and the client portal's Your payroll (4) are one entry each.
 */
export const SALES_AREA: Area = {
  key: "sales",
  title: "Sales",
  sections: [
    { group: "Leads & deals", href: "/sales/leads", label: "Leads", perm: "sales.view", salesOnly: true },
    { group: "Leads & deals", href: "/sales/accounts", label: "Accounts", perm: "sales.view", salesOnly: true },
    { group: "Leads & deals", href: "/sales/board", label: "Deals board", perm: "sales.view", salesOnly: true },
    { group: "Leads & deals", href: "/sales/opportunities", label: "Deals", perm: "sales.view", salesOnly: true },
    { group: "Leads & deals", href: "/sales/handovers", label: "Handovers", perm: "sales.view", salesOnly: true },
    { group: "Contacts & cases", href: "/sales/contacts", label: "Contacts", perm: "sales.view", salesOnly: true },
    { group: "Contacts & cases", href: "/sales/cases", label: "Cases", perm: "sales.view", salesOnly: true },
    { group: "Contacts & cases", href: "/sales/health", label: "Account health", perm: "sales.view", salesOnly: true },
    { group: "Activity", href: "/sales/tasks", label: "My tasks", perm: "sales.view", salesOnly: true },
    { group: "Activity", href: "/sales/notifications", label: "Notifications", perm: "sales.view", salesOnly: true },
    { group: "Activity", href: "/sales/reports", label: "Reports", perm: "sales.view", salesOnly: true },
    { group: "Data tools", href: "/sales/import", label: "Import and export", perm: "sales.manage", salesOnly: true },
    { group: "Data tools", href: "/sales/merge", label: "Merge records", perm: "sales.view.all", salesOnly: true },
    { group: "Sales setup", href: "/sales/teams", label: "Teams", perm: "sales.configure", salesOnly: true },
    { group: "Sales setup", href: "/sales/automation", label: "Automation", perm: "sales.configure" },
    { group: "Sales setup", href: "/sales/cases/settings", label: "Case settings", perm: "sales.configure" },
    { group: "Sales setup", href: "/sales/privacy", label: "Privacy", perm: "sales.privacy.manage" },
    { group: "Sales setup", href: "/sales/settings", label: "Sales settings", perm: "sales.configure" },
    { group: "Bureau pipeline", href: "/crm", label: "Bureau pipeline", perm: "crm.view", bureauOnly: true },
    { group: "Bureau pipeline", href: "/crm/leads", label: "Bureau leads", perm: "crm.view", bureauOnly: true },
    { group: "Bureau pipeline", href: "/crm/outreach", label: "Outreach", perm: "crm.view", bureauOnly: true },
    { group: "Bureau pipeline", href: "/crm/proposals", label: "Proposals", perm: "crm.view", bureauOnly: true },
    { group: "Bureau pipeline", href: "/crm/blueprints", label: "Blueprints and quotes", perm: "blueprint.manage", bureauOnly: true },
    { group: "Bureau pipeline", href: "/crm/pricing", label: "Pricing", perm: "crm.view", bureauOnly: true },
    { group: "Bureau pipeline", href: "/crm/partners", label: "Referral partners", perm: "crm.view", bureauOnly: true },
    { group: "Bureau pipeline", href: "/health-checks", label: "Health checks", perm: "healthcheck.view", bureauOnly: true },
  ],
};

export const BUREAU_AREA: Area = {
  key: "bureau",
  title: "Bureau",
  sections: [
    { group: "Clients", href: "/bureau", label: "Clients", perm: "bureau.view", bureauOnly: true },
    { group: "Clients", href: "/bureau/deadlines", label: "Due this week", perm: "bureau.view", bureauOnly: true },
    { group: "Service", href: "/bureau/queries", label: "Open queries", perm: "bureau.view", bureauOnly: true },
    { group: "Service", href: "/service-desk", label: "Service desk", perm: "query.respond", bureauOnly: true },
    { group: "Bureau setup", href: "/settings/client-portal", label: "Client portal access", perm: "users.manage", bureauOnly: true },
    { group: "Bureau setup", href: "/bureau/rules", label: "Statutory rule library", perm: "bureau.view", bureauOnly: true },
    { group: "Bureau setup", href: "/bureau/readiness", label: "Launch checklist", perm: "bureau.view", bureauOnly: true },
  ],
};

export const PORTAL_AREA: Area = {
  key: "portal",
  title: "Your payroll",
  sections: [
    { group: "Payroll", href: "/portal", label: "Your payroll", perm: "portal.view", clientOnly: true },
    { group: "Payroll", href: "/portal/inputs", label: "Monthly inputs", perm: "portal.view", clientOnly: true },
    { group: "Queries", href: "/portal/queries", label: "Your queries", perm: "portal.query", clientOnly: true },
    { group: "Employees", href: "/portal/employees", label: "Your employees", perm: "portal.changes", clientOnly: true },
  ],
};

/**
 * Settings, Analytics and My workspace are one entry each, with their pages as tabs (the founder's review: so many menu entries make the app hard to work in). Settings is what is left of the
 * old Settings group after the payroll, HR and bureau settings moved into their own areas, and the audit report into Reports. "My security" is under My workspace, as it was. Each page
 * keeps its address and the permission that showed it before.
 */
export const SETTINGS_AREA: Area = {
  key: "settings",
  title: "Settings",
  sections: [
    { group: "Company", href: "/settings/organization", label: "Organization", perm: "dashboard.view" },
    { group: "Company", href: "/settings/numbering", label: "Numbering rules", perm: "employee.view" },
    { group: "Company", href: "/settings/cost-centers", label: "Cost centers", perm: "payroll.view" },
    { group: "People & access", href: "/settings/users", label: "Users", perm: "users.manage" },
    { group: "People & access", href: "/settings/roles", label: "Roles", perm: "dashboard.view" },
    { group: "Plan & modules", href: "/settings/subscription", label: "Subscription", perm: "subscription.view" },
    { group: "Plan & modules", href: "/settings/entitlements", label: "Module switch", perm: "subscription.manage" },
    { group: "Plan & modules", href: "/settings/price-book", label: "Software price book", perm: "pricebook.manage" },
    { group: "Audit & security", href: "/settings/audit-integrity", label: "Audit integrity", perm: "audit.view" },
    { group: "Audit & security", href: "/settings/sensitive-access", label: "Who looked at sensitive details", perm: "audit.view" },
  ],
};

export const ANALYTICS_AREA: Area = {
  key: "analytics",
  title: "Analytics",
  sections: [
    { group: "Payroll & workforce cost", href: "/analytics/payroll", label: "Payroll analytics", perm: "analytics.view" },
    { group: "Payroll & workforce cost", href: "/analytics/workforce-cost", label: "Workforce cost", perm: "analytics.view" },
    { group: "Payroll & workforce cost", href: "/analytics/client-cost", label: "Client cost", perm: "analytics.view" },
    { group: "Profitability", href: "/analytics/profitability", label: "Client profitability", perm: "analytics.view" },
    { group: "Profitability", href: "/analytics/contract-profitability", label: "Contract profitability", perm: "analytics.view" },
    { group: "Profitability", href: "/analytics/cost-centers", label: "Cost center P&L", perm: "analytics.view" },
    { group: "Analysis", href: "/analytics/variance", label: "Variance analysis", perm: "analytics.view" },
    { group: "Analysis", href: "/analytics/locations", label: "Location analytics", perm: "analytics.view" },
  ],
};

export const MY_AREA: Area = {
  key: "me",
  title: "My Workspace",
  sections: [
    { group: "Today", href: "/supervisor", label: "Today's work register", perm: "attendance.record" },
    { group: "My details", href: "/me", label: "My dashboard", perm: "self.view" },
    { group: "My details", href: "/me/contacts", label: "My contacts", perm: "self.view" },
    { group: "My details", href: "/me/details", label: "My bank & tax details", perm: "self.view" },
    { group: "My details", href: "/me/my-data", label: "My data", perm: "self.view" },
    { group: "My HR", href: "/me/leave", label: "My leave", perm: "leave.apply" },
    { group: "My HR", href: "/me/appraisals", label: "My appraisals", perm: "self.view" },
    { group: "My HR", href: "/me/feedback", label: "My feedback", perm: "self.view" },
    { group: "My HR", href: "/me/team-feedback", label: "My team's feedback", perm: "feedback.give" },
    { group: "My HR", href: "/me/improvement-plan", label: "My improvement plan", perm: "self.view" },
    { group: "My HR", href: "/me/recognition", label: "My recognition", perm: "self.view" },
    { group: "My HR", href: "/me/recognition-board", label: "Recognition board", perm: "self.view" },
    { group: "My HR", href: "/me/team-recognition", label: "My team's recognition", perm: "recognition.nominate" },
    { group: "My HR", href: "/me/grievances", label: "My cases and support", perm: "relations.raise" },
    { group: "My HR", href: "/me/policies", label: "My policies", perm: "self.view" },
    { group: "My HR", href: "/me/training", label: "My training", perm: "self.view" },
    { group: "My HR", href: "/me/documents", label: "My documents", perm: "self.view" },
    { group: "My security", href: "/settings/security", label: "My security", perm: "self.security" },
  ],
};

export const AREAS: Area[] = [PAYROLL_AREA, OPERATIONS_AREA, HR_AREA, CLIENTS_AREA, FINANCE_AREA, ACCOUNTING_AREA, REPORTS_AREA, SALES_AREA, BUREAU_AREA, PORTAL_AREA, SETTINGS_AREA, ANALYTICS_AREA, MY_AREA];

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
