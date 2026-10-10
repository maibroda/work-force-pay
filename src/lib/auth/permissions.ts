export type Role =
  | "SUPER_ADMIN"
  | "COMPANY_ADMIN"
  | "HR_ADMIN"
  | "OPERATIONS"
  | "PAYROLL_ADMIN"
  | "FINANCE"
  | "AUDITOR"
  | "SUPERVISOR"
  | "EMPLOYEE";

export const PERMISSIONS = [
  "dashboard.view",
  "employee.view",
  "employee.manage",
  "employee.sensitive", // bank / tax / pension details
  "hr.view", // documents, training/certifications, disciplinary records, onboarding/exit
  "hr.manage", // record documents/training, raise disciplinary actions, run onboarding/exit checklists
  "hr.approve", // sign off disciplinary actions, exits, requisitions and job offers (maker/checker)
  "hr.configure", // edit the HR & lifecycle policy and the onboarding / exit checklist templates
  "relations.raise", // raise your own grievance or confidential concern (self-service)
  "settlement.manage", // prepare end-of-service settlements (compute, add manual lines, submit)
  "settlement.approve", // approve and release settlements into payroll (never the preparer)
  "client.view",
  "client.manage",
  "structure.view",
  "structure.manage",
  "override.manage",
  "operations.view",
  "operations.manage",
  "attendance.record",
  "movement.approve",
  "payroll.view",
  "payroll.run",
  "payroll.inputs", // overtime / arrears / deductions entry
  "payroll.inputs.approve",
  "payroll.approve",
  "payroll.lock",
  "payroll.override", // finance override of critical validation issues
  "payment.manage",
  "reports.view",
  "analytics.view",
  "settings.manage",
  "users.manage",
  "audit.view",
  "self.view",
  "self.security", // change own password, manage own 2FA, sign out of other sessions
  "leave.view", // see leave requests & balances (supervisors: their own guards only)
  "leave.apply", // apply for own annual leave
  "leave.approve", // approve / reject leave (supervisors: their own guards only)
  "leave.manage", // apply on behalf, edit the leave policy
  "gl.view",
  "gl.manage", // chart of accounts, payroll-head mapping, manual GL posting
  "inventory.view", // see uniform & kit stock, and what each employee holds
  "inventory.manage", // receive, adjust, issue and take back stock; maintain kit packs
  "loan.manage", // request staff loans & advances, schedule repayments, record cash repayments
  "loan.approve", // approve / reject loans and write off bad debt (never the requester)
  "appraisal.view", // see every appraisal and cycle
  "appraisal.manage", // launch and close cycles, assign reviewers, edit the criteria
  "appraisal.review", // rate the staff you're assigned to review
  "appraisal.approve", // sign off a submitted appraisal (never its reviewer)
  "employee.approve", // approve a change to an employee's bank, tax or pension details (never the requester)
  "period.close", // soft-close an accounting period, and still post into a soft-closed one
  "period.approve", // close a soft-closed period (never the person who soft-closed it) and lock a closed one
  "period.reopen", // reopen a soft-closed or closed period, with a reason
  "journal.manage", // draft, edit and submit manual journals, and request a reversal
  "journal.approve", // approve and post manual journals, approve a reversal, never the person who prepared it
  "tax.manage", // set up tax codes and propose rates
  "tax.approve", // approve or turn down a proposed tax rate, never the person who proposed it
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];
const READ_ALL: Permission[] = [
  "dashboard.view",
  "employee.view",
  "employee.sensitive",
  "hr.view",
  "client.view",
  "structure.view",
  "operations.view",
  "payroll.view",
  "reports.view",
  "analytics.view",
  "audit.view",
  "leave.view",
  "gl.view",
  "inventory.view",
  "appraisal.view",
  "self.security",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  COMPANY_ADMIN: ALL,
  HR_ADMIN: [
    "dashboard.view",
    "employee.view",
    "employee.manage",
    "employee.sensitive",
    "employee.approve",
    "hr.view",
    "hr.manage",
    "hr.approve",
    "hr.configure",
    "settlement.manage",
    "inventory.view",
    "inventory.manage",
    "loan.manage",
    "appraisal.view",
    "appraisal.manage",
    "appraisal.review",
    "appraisal.approve",
    "client.view",
    "structure.view",
    "override.manage",
    "operations.view",
    "payroll.view",
    "payroll.inputs",
    "reports.view",
    "audit.view",
    "leave.view",
    "leave.approve",
    "leave.manage",
    "self.security",
  ],
  OPERATIONS: [
    "dashboard.view",
    "employee.view",
    "client.view",
    "client.manage",
    "structure.view",
    "operations.view",
    "operations.manage",
    "attendance.record",
    "movement.approve",
    "payroll.inputs",
    "reports.view",
    "leave.view",
    "inventory.view",
    "inventory.manage",
    "self.security",
  ],
  PAYROLL_ADMIN: [
    "dashboard.view",
    "employee.view",
    "employee.sensitive",
    "client.view",
    "structure.view",
    "structure.manage",
    "override.manage",
    "operations.view",
    "payroll.view",
    "payroll.run",
    "payroll.inputs",
    "payroll.inputs.approve",
    "payment.manage",
    "settlement.manage",
    "loan.manage",
    "reports.view",
    "analytics.view",
    "audit.view",
    "leave.view",
    "gl.view",
    "inventory.view",
    "self.security",
  ],
  FINANCE: [
    ...READ_ALL,
    "payroll.inputs.approve",
    "payroll.approve",
    "payroll.lock",
    "payroll.override",
    "payment.manage",
    "settlement.approve",
    "loan.approve",
    "employee.approve",
    "gl.manage",
    "period.close",
    "journal.manage",
    "tax.manage",
  ],
  AUDITOR: READ_ALL,
  SUPERVISOR: [
    "dashboard.view",
    "operations.view",
    "attendance.record",
    "self.view",
    "self.security",
    "leave.view",
    "leave.approve",
    "leave.apply",
    "relations.raise",
    "appraisal.review",
  ],
  EMPLOYEE: ["self.view", "self.security", "leave.apply", "relations.raise"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`You do not have permission to perform this action (${permission}).`);
    this.name = "ForbiddenError";
  }
}
