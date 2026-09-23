import type { Permission } from "./auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  perm: Permission;
  /** Optional sub-heading rendered above this item within its group (e.g. "Reports"). */
  section?: string;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { title: "Dashboard", items: [{ href: "/", label: "Dashboard", perm: "dashboard.view" }] },
  {
    title: "Workforce / Personnel",
    items: [
      { href: "/employees", label: "Employees", perm: "employee.view" },
      { href: "/employees/categories", label: "Employee Categories", perm: "employee.view" },
      { href: "/employees/departments", label: "Departments", perm: "employee.view" },
      { href: "/employees/bank", label: "Bank Information", perm: "employee.sensitive" },
      { href: "/employees/pension", label: "Pension Information", perm: "employee.sensitive" },
      { href: "/employees/tax", label: "Tax Information", perm: "employee.sensitive" },
      { href: "/operations/deployments", label: "Employee Assignments", perm: "operations.view" },
      { href: "/employees/org-chart", label: "Org Chart", perm: "employee.view" },
      {
        href: "/reports/location-history",
        label: "Employee Location History",
        perm: "reports.view",
        section: "Personnel reports",
      },
      { href: "/reports/employee-documents", label: "Employee Documents", perm: "reports.view" },
      { href: "/reports/employee-training", label: "Training & Certifications", perm: "reports.view" },
    ],
  },
  {
    title: "Payroll",
    items: [
      { href: "/payroll/structures", label: "Salary Structures", perm: "structure.view" },
      { href: "/payroll/components", label: "Salary Components", perm: "structure.view" },
      { href: "/payroll/periods", label: "Payroll Periods", perm: "payroll.view" },
      { href: "/payroll/runs", label: "Payroll Runs", perm: "payroll.view" },
      { href: "/payroll/earnings", label: "Earnings", perm: "payroll.view" },
      { href: "/payroll/deductions", label: "Deductions", perm: "payroll.view" },
      { href: "/payroll/overtime", label: "Overtime", perm: "payroll.view" },
      { href: "/payroll/arrears", label: "Arrears", perm: "payroll.view" },
      { href: "/payroll/paye", label: "PAYE", perm: "payroll.view" },
      { href: "/payroll/pension", label: "Pension", perm: "payroll.view" },
      { href: "/payroll/control", label: "Payroll Validation", perm: "payroll.view" },
      { href: "/payroll/approval", label: "Payroll Approval", perm: "payroll.view" },
      { href: "/payroll/lock", label: "Payroll Lock", perm: "payroll.view" },
      { href: "/payroll/supplementary", label: "Supplementary Payroll", perm: "payroll.view" },
      {
        href: "/payments/batches",
        label: "Payment Batches",
        perm: "payroll.view",
        section: "Payments",
      },
      { href: "/payments/transactions", label: "Payment Transactions", perm: "payroll.view" },
      { href: "/payments/reconciliation", label: "Bank Reconciliation", perm: "payroll.view" },
      { href: "/payments/remittance", label: "Statutory Remittance", perm: "payroll.view" },
      {
        href: "/reports/payroll-register",
        label: "Payroll Register",
        perm: "reports.view",
        section: "Payroll reports",
      },
      { href: "/reports/payslips", label: "Payslips", perm: "reports.view" },
      { href: "/reports/overtime", label: "Overtime Report", perm: "reports.view" },
      { href: "/reports/arrears", label: "Arrears Report", perm: "reports.view" },
      { href: "/reports/deductions", label: "Deductions Report", perm: "reports.view" },
      { href: "/reports/pension", label: "Pension Schedule", perm: "reports.view" },
      { href: "/reports/paye", label: "PAYE Schedule", perm: "reports.view" },
      { href: "/reports/bank", label: "Bank Payment Schedule", perm: "reports.view" },
      { href: "/reports/itf", label: "ITF Schedule", perm: "reports.view" },
      { href: "/reports/nsitf", label: "NSITF Schedule", perm: "reports.view" },
      { href: "/reports/nhf-medical", label: "NHF / Medical Schedule", perm: "reports.view" },
      { href: "/reports/insurance", label: "Insurance Schedule", perm: "reports.view" },
      { href: "/reports/uniform-kits", label: "Uniform & Kits Schedule", perm: "reports.view" },
      {
        href: "/reports/recruitment-training",
        label: "Recruitment, Training & Vetting Schedule",
        perm: "reports.view",
      },
      { href: "/reports/leave-reliever", label: "Annual Leave Reliever Schedule", perm: "reports.view" },
      {
        href: "/reports/outsourcing-leave-allowance",
        label: "Outsourcing Leave Allowance Schedule",
        perm: "reports.view",
      },
    ],
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
      {
        href: "/reports/work-register",
        label: "Work Register Report",
        perm: "reports.view",
        section: "Operations reports",
      },
      { href: "/reports/staff-movement", label: "Staff Movement Report", perm: "reports.view" },
      { href: "/reports/beat-reconciliation", label: "Beat Reconciliation", perm: "reports.view" },
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
      { href: "/contracts/rates", label: "Client Salary Structures", perm: "client.view" },
      {
        href: "/finance/invoices",
        label: "Billing & Receivables",
        perm: "client.view",
        section: "Billing",
      },
      { href: "/accounting/journals", label: "Payroll Journals", perm: "gl.view", section: "Accounting" },
      { href: "/accounting/mapping", label: "Payroll GL Mapping", perm: "gl.view" },
      { href: "/accounting/accounts", label: "Chart of Accounts", perm: "gl.view" },
      {
        href: "/reports/client-beat",
        label: "Client / Beat Report",
        perm: "reports.view",
        section: "Finance reports",
      },
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
      { href: "/analytics/variance", label: "Variance Analysis", perm: "analytics.view" },
      { href: "/analytics/locations", label: "Location Analytics", perm: "analytics.view" },
    ],
  },
  {
    title: "Settings / Support",
    items: [
      { href: "/settings/organization", label: "Organization", perm: "dashboard.view" },
      { href: "/settings/users", label: "Users", perm: "users.manage" },
      { href: "/settings/roles", label: "Roles", perm: "dashboard.view" },
      { href: "/settings/statutory", label: "Statutory Rules", perm: "payroll.view" },
      { href: "/settings/payroll-rules", label: "Payroll Rules", perm: "payroll.view" },
      { href: "/settings/employer-costs", label: "Employer Cost Rules", perm: "payroll.view" },
      { href: "/settings/numbering", label: "Numbering Rules", perm: "employee.view" },
      { href: "/reports/audit", label: "Audit Logs", perm: "audit.view" },
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
    ],
  },
];

/** Every downloadable/report-registry report, grouped for the Reports hub page. */
export const REPORT_LINKS: Array<{ href: string; label: string; group: string }> = [
  { href: "/reports/location-history", label: "Employee Location History", group: "Workforce / Personnel" },
  { href: "/reports/employee-documents", label: "Employee Documents", group: "Workforce / Personnel" },
  {
    href: "/reports/employee-training",
    label: "Training & Certifications",
    group: "Workforce / Personnel",
  },
  { href: "/reports/payroll-register", label: "Payroll Register", group: "Payroll" },
  { href: "/reports/payslips", label: "Payslips", group: "Payroll" },
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
