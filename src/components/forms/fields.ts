import type { Field } from "@/components/smart-form";
import { enumOptions } from "@/server/options";
import { iso } from "@/lib/dates";

type Opts = { value: string; label: string }[];
const NUBAN = { pattern: "^\\d{10}$", patternMessage: "Account number must be 10 digits (NUBAN)" };
export const BANKS = [
  "Access Bank",
  "GTBank",
  "Zenith Bank",
  "First Bank",
  "UBA",
  "Fidelity Bank",
  "Wema Bank",
  "Stanbic IBTC Bank",
  "Union Bank",
  "Sterling Bank",
  "Polaris Bank",
  "FCMB",
  "Ecobank",
  "Keystone Bank",
  "Moniepoint MFB",
  "OPay",
];
export const PFAS = [
  "Stanbic IBTC Pension Managers",
  "Access ARM Pensions",
  "Leadway Pensure PFA",
  "Premium Pension Ltd",
  "Crusader Sterling Pensions",
  "Fidelity Pension Managers",
  "Trustfund Pensions",
  "NLPC Pension Fund Administrators",
  "Tangerine APT Pensions",
];

export function employeeFields(
  o: { categories: Opts; departments: Opts; employees?: Opts },
  e?: Record<string, unknown>,
): Field[] {
  const selfId = e?.id ? String(e.id) : undefined;
  const managerOptions = (o.employees ?? []).filter((x) => x.value !== selfId);
  const v = (k: string) =>
    e?.[k] instanceof Date
      ? iso(e[k] as Date)
      : e?.[k] === null || e?.[k] === undefined
        ? undefined
        : String(e[k]);
  return [
    { name: "firstName", label: "First name", required: true, defaultValue: v("firstName") },
    { name: "middleName", label: "Middle name", defaultValue: v("middleName") },
    { name: "lastName", label: "Last name", required: true, defaultValue: v("lastName") },
    {
      name: "gender",
      label: "Gender",
      type: "select",
      options: enumOptions(["MALE", "FEMALE"]),
      defaultValue: v("gender"),
    },
    { name: "dateOfBirth", label: "Date of birth", type: "date", defaultValue: v("dateOfBirth") },
    { name: "phone", label: "Phone", defaultValue: v("phone") },
    { name: "email", label: "Email", type: "email", defaultValue: v("email") },
    { name: "address", label: "Residential address", defaultValue: v("address"), span: 2 },
    {
      name: "employmentDate",
      label: "Employment date",
      type: "date",
      required: true,
      defaultValue: v("employmentDate"),
    },
    {
      name: "status",
      label: "Employment status",
      type: "select",
      required: true,
      options: enumOptions([
        "ACTIVE",
        "INACTIVE",
        "SUSPENDED",
        "ON_LEAVE",
        "TERMINATED",
        "RESIGNED",
        "EXITED",
      ]),
      defaultValue: v("status") ?? "ACTIVE",
    },
    {
      name: "exitDate",
      label: "Exit date",
      type: "date",
      defaultValue: v("exitDate"),
      help: "Required for leavers",
    },
    {
      name: "categoryId",
      label: "Employee category",
      type: "select",
      required: true,
      options: o.categories,
      defaultValue: v("categoryId"),
    },
    {
      name: "departmentId",
      label: "Department",
      type: "select",
      options: o.departments,
      defaultValue: v("departmentId"),
    },
    {
      name: "reportingManagerId",
      label: "Reports to (org chart)",
      type: "select",
      options: managerOptions,
      defaultValue: v("reportingManagerId"),
    },
    {
      name: "bankName",
      label: "Bank name",
      type: "select",
      options: BANKS.map((b) => ({ value: b, label: b })),
      defaultValue: v("bankName"),
    },
    { name: "accountNumber", label: "Account number", ...NUBAN, defaultValue: v("accountNumber") },
    { name: "accountName", label: "Account name", defaultValue: v("accountName") },
    { name: "taxId", label: "Tax ID (TIN)", defaultValue: v("taxId") },
    {
      name: "annualRent",
      label: "Annual rent (₦) for rent relief",
      type: "number",
      min: 0,
      defaultValue: v("annualRent"),
    },
    { name: "pensionPin", label: "Pension PIN", defaultValue: v("pensionPin") },
    {
      name: "pfa",
      label: "Pension Fund Administrator",
      type: "select",
      options: PFAS.map((b) => ({ value: b, label: b })),
      defaultValue: v("pfa"),
    },
  ];
}
