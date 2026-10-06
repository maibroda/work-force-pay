import type { Permission } from "./auth/permissions";

/**
 * Which permission opens each report. Most reports need only `reports.view`; the ones that expose more
 * sensitive records need the permission that guards those records, so having `reports.view` alone never
 * reaches appraisals, guarantors or bank-change history by way of a download.
 */
const SPECIFIC: Record<string, Permission> = {
  audit: "audit.view",
  "hr-headcount": "hr.view",
  "training-compliance": "hr.view",
  "policy-acknowledgements": "hr.view",
  "appraisal-results": "appraisal.view",
  guarantors: "employee.sensitive",
  "records-completeness": "employee.sensitive",
  "detail-changes": "employee.sensitive",
};

export const reportPermission = (slug: string): Permission => SPECIFIC[slug] ?? "reports.view";
