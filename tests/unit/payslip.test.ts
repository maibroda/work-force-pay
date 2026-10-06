import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Payslip } from "@/components/payslip";

const lines = [
  { type: "EARNING", code: "BASIC", name: "Basic Salary", amount: 90000 },
  { type: "EARNING", code: "HOUSING", name: "Housing Allowance", amount: 45000 },
  { type: "DEDUCTION", code: "PAYE", name: "PAYE Tax", amount: 12000 },
  { type: "DEDUCTION", code: "PENSION_EE", name: "Employee Pension (8%)", amount: 10800 },
  // the company's own costs — stored on the record, never shown on the payslip
  { type: "EMPLOYER", code: "PENSION_ER", name: "Employer Pension", amount: 13500 },
  { type: "EMPLOYER", code: "ITF", name: "ITF (Industrial Training Fund)", amount: 1350 },
  { type: "EMPLOYER", code: "NSITF", name: "NSITF-ECA", amount: 1350 },
  { type: "EMPLOYER", code: "INSURANCE", name: "Insurance", amount: 10125 },
  { type: "EMPLOYER", code: "UNIFORM_KITS", name: "Uniform & Kits", amount: 2700 },
];

const rec = {
  employeeNumber: "EMP-000025",
  employeeName: "Ada Okafor",
  departmentName: "Operations",
  categoryName: "Security Guard",
  bankName: "Access Bank",
  accountNumber: "0123456789",
  pensionPin: "PEN100200",
  pfa: "ARM",
  taxId: "TIN-1",
  daysWorked: 30,
  daysAbsent: 0,
  suspensionDays: 0,
  overtimeHours: 0,
  basisDays: 30,
  monthlyGross: 135000,
  totalEarnings: 135000,
  totalDeductions: 22800,
  netPay: 112200,
  // an old caller may still pass this; the payslip must ignore it
  employerPension: 13500,
  taxRuleVersion: "NTA-2025",
  hasOverride: false,
  lines,
  locations: [{ clientName: "ABC Bank", beatName: "Victoria Island", days: 30, from: "2026-09-01", to: "2026-09-30" }],
  run: { type: "REGULAR", runNumber: 1, status: "APPROVED", period: { name: "September 2026", startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-30T00:00:00Z") } },
};

const html = () => renderToStaticMarkup(createElement(Payslip, { rec, orgName: "Demo Security Services Ltd" }));

describe("the payslip", () => {
  it("shows the employee's own earnings, deductions and net pay", () => {
    const out = html();
    for (const shown of ["Basic Salary", "Housing Allowance", "PAYE Tax", "Employee Pension (8%)", "Total earnings", "Total deductions", "Net pay", "Victoria Island", "EMP-000025"]) expect(out, shown).toContain(shown);
    expect(out).toContain("112,200");
  });

  it("never shows what the company pays on top, whatever the record holds", () => {
    const out = html();
    for (const hidden of ["Employer contributions", "not deducted", "Employer Pension", "ITF", "Industrial Training Fund", "NSITF", "Insurance", "Uniform &amp; Kits", "Uniform & Kits", "employer"]) expect(out.toLowerCase(), hidden).not.toContain(hidden.toLowerCase());
    // none of their amounts leak in either
    for (const amount of ["13,500", "1,350", "10,125", "2,700"]) expect(out, amount).not.toContain(amount);
  });

  it("still renders when a record has no employer lines at all", () => {
    const out = renderToStaticMarkup(createElement(Payslip, { rec: { ...rec, lines: lines.filter((l) => l.type !== "EMPLOYER") }, orgName: "Demo" }));
    expect(out).toContain("Total earnings");
    expect(out).not.toContain("Employer");
  });
});
