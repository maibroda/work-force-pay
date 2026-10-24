import type { Field } from "@/components/smart-form";
import { PACKAGES, PACKAGE_LABELS } from "@/server/services/bureau";

type Terms = {
  package?: string;
  startDate?: string;
  termMonths?: number;
  perEmployeeRate?: number;
  monthlyMinimum?: number;
  onboardingFee?: number;
  addOns?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  slaTerms?: string | null;
  dpaReference?: string | null;
  dpaSignedAt?: string;
  notes?: string | null;
};

/** The engagement fields, shared by onboarding a client and editing its terms. */
export function termsFields(t: Terms = {}): Field[] {
  return [
    { name: "package", label: "Package", type: "select", required: true, options: PACKAGES.map((p) => ({ value: p, label: PACKAGE_LABELS[p] })), defaultValue: t.package ?? "PAYROLL_COMPLIANCE" },
    { name: "startDate", label: "Start date", type: "date", required: true, defaultValue: t.startDate },
    { name: "termMonths", label: "Contract term", type: "select", required: true, options: [{ value: "6", label: "6 months" }, { value: "12", label: "12 months" }], defaultValue: String(t.termMonths ?? 12) },
    { name: "perEmployeeRate", label: "Rate per employee per month (₦)", type: "number", min: 0, defaultValue: t.perEmployeeRate ?? 0 },
    { name: "monthlyMinimum", label: "Monthly minimum (₦)", type: "number", min: 0, defaultValue: t.monthlyMinimum ?? 0 },
    { name: "onboardingFee", label: "One-off onboarding fee (₦)", type: "number", min: 0, defaultValue: t.onboardingFee ?? 0 },
    { name: "addOns", label: "Add-ons", placeholder: "e.g. HR letters, statutory filing support", span: 3, defaultValue: t.addOns ?? "" },
    { name: "contactName", label: "Client contact", defaultValue: t.contactName ?? "" },
    { name: "contactEmail", label: "Contact email", type: "email", defaultValue: t.contactEmail ?? "" },
    { name: "contactPhone", label: "Contact phone", defaultValue: t.contactPhone ?? "" },
    { name: "slaTerms", label: "Service levels agreed", type: "textarea", span: 3, placeholder: "Input cut-off, draft turnaround, approval deadline, pay date…", defaultValue: t.slaTerms ?? "" },
    { name: "dpaReference", label: "Data-processing terms reference", defaultValue: t.dpaReference ?? "" },
    { name: "dpaSignedAt", label: "Data-processing terms signed on", type: "date", defaultValue: t.dpaSignedAt ?? "" },
    { name: "notes", label: "Notes", type: "textarea", span: 3, defaultValue: t.notes ?? "" },
  ];
}
