/**
 * The catalogue of what WorkforcePay is sold as: modules, what each needs, the plans, and the "ports" that let a module work with or without its neighbours
 * (docs/plans/module-entitlements.md, step E1). It is data, kept apart from the rules that read it (resolve.ts), so a module, a plan or a dependency changes in one place.
 *
 * NOTHING IN THE APP READS THIS YET. It does not switch anything on or off, change a screen, a permission or a price. Later steps (a subscription for each company, then
 * enforcement) will read it; until then it is a library with tests. Dependencies are the founder's: payroll needs only the core, the CRM needs neither HR nor payroll.
 * Entries marked `assumed` are mine, not the founder's, and are listed for confirmation (the founder accepted my recommendations on 2026-11-03).
 *
 * VERSION: this is one version of the catalogue, dated. Keeping every earlier version with its effective dates (as statutory settings are kept) needs a table, and comes
 * with the subscription tables in step E2.
 */
export const CATALOGUE_VERSION = "2026-11-03";

export const MODULE_KEYS = [
  "core",
  "hr",
  "payroll",
  "time_attendance",
  "contracts_deployment",
  "production_pay",
  "service_charge_pay",
  "crm",
  "client_billing",
  "self_service",
  "analytics",
  "integrations",
  "accounting",
  "payables_procurement",
  "inventory",
  "client_portal",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ChargedPer = "included" | "active_employee" | "crm_user" | "flat";
/** built: it exists in the app; partial: part of it exists; planned: it is sold but not built yet. */
export type BuildStatus = "built" | "partial" | "planned";

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  summary: string;
  /** Every one of these must be present. */
  needs: ModuleKey[];
  /** Each group needs at least one of its modules present ("Deployment OR CRM"). */
  needsOneOf: ModuleKey[][];
  chargedPer: ChargedPer;
  status: BuildStatus;
  /** What is assumed here and not given by the founder, for confirmation. */
  assumed?: string;
}

const m = (d: Omit<ModuleDef, "needsOneOf"> & { needsOneOf?: ModuleKey[][] }): ModuleDef => ({ needsOneOf: [], ...d });

export const MODULES: Record<ModuleKey, ModuleDef> = {
  core: m({ key: "core", name: "Core platform", summary: "Company setup, users and roles, the employee master record, approvals, the audit log. Always on.", needs: [], chargedPer: "included", status: "built" }),
  hr: m({ key: "hr", name: "HR management", summary: "Org structure, employee records, onboarding and exit, leave, HR letters.", needs: ["core"], chargedPer: "active_employee", status: "built", assumed: "The app's HR area is wider than this (recruitment, appraisals, training, grievances); which of it belongs here is to be confirmed." }),
  payroll: m({ key: "payroll", name: "Payroll", summary: "Pay runs, statutory deductions and schedules, payslips, bank files.", needs: ["core"], chargedPer: "active_employee", status: "built" }),
  time_attendance: m({ key: "time_attendance", name: "Time & attendance", summary: "Clocking, shifts, rosters, overtime rules.", needs: ["core"], chargedPer: "active_employee", status: "partial", assumed: "Work register, attendance and rosters exist; clocking does not." }),
  contracts_deployment: m({ key: "contracts_deployment", name: "Contracts & deployment", summary: "Client contracts, rate cards, sites, posts, deployment.", needs: ["core"], chargedPer: "active_employee", status: "built" }),
  production_pay: m({ key: "production_pay", name: "Production pay", summary: "Piece rates, production records, team pools.", needs: ["payroll"], chargedPer: "active_employee", status: "planned" }),
  service_charge_pay: m({ key: "service_charge_pay", name: "Sales & service-charge pay", summary: "Commission, service-charge pools.", needs: ["payroll"], chargedPer: "active_employee", status: "planned" }),
  crm: m({ key: "crm", name: "CRM", summary: "Leads, accounts, pipeline, activities, quotes, cases.", needs: ["core"], chargedPer: "crm_user", status: "built" }),
  client_billing: m({ key: "client_billing", name: "Client billing", summary: "Invoices and receivables.", needs: [], needsOneOf: [["contracts_deployment", "crm"]], chargedPer: "flat", status: "built", assumed: "The app's invoices are made from contracts and deployed days, so on the CRM alone a client has nothing to invoice; the founder's rule (deployment or CRM) is kept as given." }),
  self_service: m({ key: "self_service", name: "Employee self-service", summary: "Portal, SMS and WhatsApp payslips, leave requests.", needs: [], needsOneOf: [["payroll", "hr"]], chargedPer: "active_employee", status: "partial", assumed: "The employee's own pages exist; SMS and WhatsApp payslips do not." }),
  analytics: m({ key: "analytics", name: "Analytics", summary: "Dashboards, labour cost, contract margin.", needs: ["core"], chargedPer: "flat", status: "built" }),
  integrations: m({ key: "integrations", name: "Integrations", summary: "Public API, accounting and GL export (for example Sage).", needs: ["core"], chargedPer: "flat", status: "planned", assumed: "There is no public API yet." }),
  accounting: m({ key: "accounting", name: "Accounting", summary: "General ledger, journals, periods and close, tax codes and withholding certificates, fixed assets, bank reconciliation.", needs: ["core"], chargedPer: "flat", status: "built", assumed: "Its own module by the founder's decision of 2026-11-02; what it needs and how it is charged are assumed." }),
  payables_procurement: m({ key: "payables_procurement", name: "Payables and procurement", summary: "Purchase orders, goods received and three-way match, suppliers' bills.", needs: ["accounting"], chargedPer: "flat", status: "built", assumed: "Its own module by the founder's decision of 2026-11-02; it is assumed to need Accounting (its bills post to the ledger) and to be charged flat." }),
  client_portal: m({ key: "client_portal", name: "Client portal", summary: "The client's own people: approve payroll, download payslips and registers, send monthly inputs, raise queries.", needs: ["payroll"], chargedPer: "flat", status: "built", assumed: "Its own module by the founder's ruling of 2026-11-03. It first needed Contracts & deployment; E3 found that would lock every bureau client's portal (the portal runs in the client's own organization, whose default plan has Payroll and not deployment), and everything the portal does is payroll, so it now needs Payroll (on my recommendation; to be confirmed). Charged flat, as recommended." }),
  inventory: m({ key: "inventory", name: "Inventory", summary: "Stock and what is issued to employees.", needs: ["core"], chargedPer: "flat", status: "built", assumed: "Its own module by the founder's decision of 2026-11-02; what it needs and how it is charged are assumed." }),
};

export type PlanKey = "payroll_essentials" | "hr_payroll" | "crm" | "workforce_suite" | "custom";

export interface PlanDef {
  key: PlanKey;
  name: string;
  typicalClient: string;
  /** The modules the plan includes. The core is always included. */
  modules: ModuleKey[];
}

export const PLANS: Record<PlanKey, PlanDef> = {
  payroll_essentials: { key: "payroll_essentials", name: "Payroll Essentials", typicalClient: "A firm with its own HR system that only wants payroll done right", modules: ["core", "payroll"] },
  hr_payroll: { key: "hr_payroll", name: "HR + Payroll", typicalClient: "Small and mid-sized firms wanting one people system", modules: ["core", "hr", "payroll", "self_service"] },
  crm: { key: "crm", name: "CRM", typicalClient: "A firm wanting to manage prospects and clients only", modules: ["core", "crm"] },
  workforce_suite: { key: "workforce_suite", name: "Workforce Suite", typicalClient: "Large security, outsourcing or manufacturing firms", modules: [...MODULE_KEYS] },
  custom: { key: "custom", name: "Custom", typicalClient: "Negotiated contracts", modules: ["core"] },
};
/**
 * Any plan can take add-ons. The founder's document says "within its allowed list" but gives no list, so (assumed) any module can be added to any plan as long as its needs
 * are met; a restriction per plan can be added here later.
 */

export type PortKey = "unpaid_leave_for_payroll" | "attendance_for_payroll" | "labour_cost_for_quotes" | "departments";

export interface PortChoice {
  /** Where the answer comes from. */
  source: string;
  label: string;
  /** The modules the client must have for this source to be used; none means it is the fallback. */
  requires: ModuleKey[];
}
export interface PortDef {
  key: PortKey;
  name: string;
  /** In order of preference; the last one has no requirement and is the fallback. */
  choices: PortChoice[];
}

/** Modules never call each other: they ask a port, and the port uses the best source the client has. */
export const PORTS: PortDef[] = [
  { key: "unpaid_leave_for_payroll", name: "Unpaid leave for payroll", choices: [{ source: "hr", label: "HR leave requests", requires: ["hr"] }, { source: "pay_run_days", label: "Days entered on the pay run", requires: [] }] },
  {
    key: "attendance_for_payroll",
    name: "Attendance for payroll",
    choices: [
      { source: "time_attendance", label: "Clock-in and out timesheets", requires: ["time_attendance"] },
      { source: "contracts_deployment", label: "Deployment attendance", requires: ["contracts_deployment"] },
      { source: "pay_run_days", label: "Days entered on the pay run", requires: [] },
    ],
  },
  { key: "labour_cost_for_quotes", name: "Labour cost for CRM quotes", choices: [{ source: "payroll", label: "Real payroll cost", requires: ["payroll"] }, { source: "typed_assumptions", label: "Cost assumptions typed into the quote", requires: [] }] },
  { key: "departments", name: "Departments", choices: [{ source: "hr", label: "The HR organisation structure", requires: ["hr"] }, { source: "core_list", label: "The simple department list in the core", requires: [] }] },
];
