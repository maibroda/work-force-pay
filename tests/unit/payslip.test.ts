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

  it("a monthly payslip has no hours section, and keeps its monthly gross", () => {
    const out = html();
    expect(out).not.toContain("Hours worked and pay");
    expect(out).toContain("Monthly gross (contractual)");
  });

  describe("for a person paid by the hour (phase 4c)", () => {
    const hourly = [
      { siteName: "Victoria Island", dayClass: "WEEKDAY" as const, minutes: 480, rate: "1000.00", amount: "8000.00" },
      { siteName: "Victoria Island", dayClass: "WEEKEND" as const, minutes: 510, rate: "1500.00", amount: "12750.00" },
      { siteName: "Victoria Island", dayClass: "HOLIDAY" as const, minutes: 240, rate: "2000.00", amount: "8000.00" },
    ];
    const hourlyHtml = (over: object = {}) => renderToStaticMarkup(createElement(Payslip, { rec: { ...rec, monthlyGross: 0, totalEarnings: 28750, hourly, ...over }, orgName: "Demo" }));
    it("shows the hours worked and the pay for them by kind of day, with the rate and the totals", () => {
      const out = hourlyHtml();
      for (const shown of ["Hours worked and pay", "Weekday", "Weekend", "Public holiday", "8 h", "8 h 30 min", "4 h", "1,000.00", "1,500.00", "2,000.00", "12,750.00", "28,750.00", "20 h 30 min"]) expect(out, shown).toContain(shown);
    });
    it("says the person is paid by the hour instead of showing a contractual monthly gross of nothing", () => {
      const out = hourlyHtml();
      expect(out).not.toContain("Monthly gross (contractual)");
      expect(out).toContain("Paid by the hour");
    });
    it("a person with both monthly pay and hours keeps the monthly gross and also shows the hours", () => {
      const out = hourlyHtml({ monthlyGross: 90000 });
      expect(out).toContain("Monthly gross (contractual)");
      expect(out).toContain("Hours worked and pay");
    });
    it("shows the leave pay as its own line after the hours, counted in the total, with no rate", () => {
      const out = hourlyHtml({ hourlyAllowances: [{ kind: "LEAVE_PERCENT" as const, siteName: "Victoria Island", baseAmount: "28750.00", pct: "10.00", amount: "2875.00" }] });
      expect(out).toContain("Leave pay (10% of 28,750.00)");
      expect(out).toContain("2,875.00");
      expect(out).toContain("31,625.00"); // the total: 28,750.00 of hours and 2,875.00 of leave pay
    });
    it("an old record with no hourly lines at all renders as before", () => {
      expect(renderToStaticMarkup(createElement(Payslip, { rec: { ...rec, hourly: [] }, orgName: "Demo" }))).not.toContain("Hours worked and pay");
    });
  });

  it("still renders when a record has no employer lines at all", () => {
    const out = renderToStaticMarkup(createElement(Payslip, { rec: { ...rec, lines: lines.filter((l) => l.type !== "EMPLOYER") }, orgName: "Demo" }));
    expect(out).toContain("Total earnings");
    expect(out).not.toContain("Employer");
  });
});
