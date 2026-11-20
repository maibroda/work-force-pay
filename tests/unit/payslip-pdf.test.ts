import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { mask, money, payslipModel, pdfSafe, renderPayslipPdf, renderPayslipsPdf, type PayslipInput } from "@/lib/payslip-pdf";

const base = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  orgName: "Acme Facilities Ltd", bureauName: "ThreeRoots Payroll Services", tagline: "People. Pay. Precision.",
  employeeNumber: "EMP-000001", employeeName: "Adebayo Adeyemi", departmentName: "Lagos HQ", categoryName: "Staff",
  bankName: "GTBank", accountNumber: "0123456789", pensionPin: "PEN100200300400", pfa: "ARM Pension", taxId: "TIN40000000",
  daysWorked: 31, basisDays: 31, daysAbsent: 0, overtimeHours: 0, monthlyGross: 200000, totalEarnings: 200000, totalDeductions: 31500, netPay: 168500,
  taxRuleVersion: "NG-PAYE-NTA2025@2026.1", hasOverride: false,
  lines: [
    { type: "EARNING", code: "BASIC", name: "Basic", amount: 100000 }, { type: "EARNING", code: "HOUSING", name: "Housing", amount: 100000 },
    { type: "DEDUCTION", code: "PAYE", name: "PAYE", amount: 15500 }, { type: "DEDUCTION", code: "PENSION", name: "Employee pension (8%)", amount: 16000 },
    { type: "EMPLOYER", code: "ER_PENSION", name: "Employer pension", amount: 20000 },
  ],
  locations: [{ clientName: "Head Office", beatName: "Head Office", days: 31 }],
  periodName: "October 2026", periodStart: "2026-10-01", periodEnd: "2026-10-31", runType: "REGULAR", runNumber: 1, generatedOn: "2026-10-28", ...over,
});

describe("what a payslip shows", () => {
  it("masks account numbers, tax IDs and pension PINs to their last four characters", () => {
    expect(mask("0123456789")).toBe("******6789");
    expect(mask("PEN100200300400")).toBe("********0400");
    expect(mask("1234")).toBe("****");
    expect(mask("12")).toBe("**");
    expect(mask(null)).toBe("—");
    const m = payslipModel(base());
    const text = JSON.stringify(m);
    expect(text).not.toContain("0123456789");
    expect(text).not.toContain("PEN100200300400");
    expect(text).not.toContain("TIN40000000");
    expect(m.details.find(([k]) => k === "Bank")?.[1]).toBe("GTBank ******6789");
  });

  it("shows only the employee's own earnings and deductions, never what the employer pays on top", () => {
    const m = payslipModel(base());
    expect(m.earnings).toEqual([["Basic", 100000], ["Housing", 100000]]);
    expect(m.deductions).toEqual([["PAYE", 15500], ["Employee pension (8%)", 16000]]);
    expect(JSON.stringify(m)).not.toMatch(/Employer pension/);
    expect(m.totals).toEqual({ earnings: 200000, deductions: 31500, net: 168500 });
  });

  it("lists work locations only for real client sites, labels supplementary runs, and says which rule calculated the tax", () => {
    expect(payslipModel(base()).locations).toEqual([]);
    const m = payslipModel(base({ locations: [{ clientName: "Acme", beatName: "Gate 1", days: 10 }, { clientName: "Acme", beatName: "Gate 1", days: 5 }, { clientName: "Head Office", beatName: "HO", days: 3 }], runType: "SUPPLEMENTARY", runNumber: 2, hasOverride: true }));
    expect(m.locations).toEqual(["Acme - Gate 1: 15 day(s)"]);
    expect(m.subtitle).toBe("Payslip - October 2026 (supplementary #2)");
    expect(m.notes).toEqual(["An employee salary override applied this period.", "PAYE computed with rule NG-PAYE-NTA2025@2026.1."]);
    expect(m.footer).toMatch(/Prepared by ThreeRoots Payroll Services - People\. Pay\. Precision\./);
    expect(payslipModel(base({ bureauName: null })).footer).not.toMatch(/Prepared by/);
  });

  it("writes amounts as NGN, since the standard PDF fonts have no naira sign", () => {
    expect(money(1234567.5)).toBe("NGN 1,234,567.50");
    expect(money(0)).toBe("NGN 0.00");
  });
});

describe("the hours section of an hourly person's payslip (phase 4c)", () => {
  const hourly = [
    { siteName: "Gate 1", dayClass: "WEEKDAY" as const, minutes: 480, rate: "1000.00", amount: "8000.00" },
    { siteName: "Gate 1", dayClass: "WEEKEND" as const, minutes: 510, rate: "1500.00", amount: "12750.00" },
  ];
  it("is nothing for a monthly payslip, which keeps its monthly gross and its days", () => {
    const m = payslipModel(base());
    expect(m.hourly).toBeNull();
    expect(m.details.find(([k]) => k === "Monthly gross")?.[1]).toBe("NGN 200,000.00");
    expect(m.attendance).toMatch(/Days worked 31 of 31/);
  });
  it("lists the hours, the rate and the pay for each kind of day, then the totals", () => {
    const m = payslipModel(base({ monthlyGross: 0, daysWorked: 2, hourly }));
    expect(m.hourly).toEqual({
      columns: ["Site", "Day type", "Hours", "Rate / hour (NGN)", "Amount (NGN)"],
      rows: [["Gate 1", "Weekday", "8 h", "1,000.00", "8,000.00"], ["Gate 1", "Weekend", "8 h 30 min", "1,500.00", "12,750.00"]],
      total: ["Total", "", "16 h 30 min", "", "20,750.00"],
    });
  });
  it("says paid by the hour instead of a monthly gross of nothing, and does not compare the days with the month", () => {
    const m = payslipModel(base({ monthlyGross: 0, daysWorked: 2, hourly }));
    expect(m.details.find(([k]) => k === "Monthly gross")).toBeUndefined();
    expect(m.details.find(([k]) => k === "Pay basis")?.[1]).toBe("Paid by the hour");
    expect(m.attendance).toBe("Days worked 2; absent 0; overtime 0 hour(s)");
  });
  it("a person with monthly pay and hours keeps the monthly gross", () => {
    const m = payslipModel(base({ monthlyGross: 90000, hourly }));
    expect(m.details.find(([k]) => k === "Monthly gross")?.[1]).toBe("NGN 90,000.00");
    expect(m.hourly).not.toBeNull();
  });
  it("draws on the one page, even with many sites and kinds of day", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ siteName: `Site number ${i} with a long name`, dayClass: "WEEKDAY" as const, minutes: 60 * (i + 1), rate: "1000.00", amount: `${1000 * (i + 1)}.00` }));
    const bytes = await renderPayslipPdf(payslipModel(base({ monthlyGross: 0, hourly: many })));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("text a PDF can draw", () => {
  it("removes accents, straightens quotes and replaces what the font cannot draw", () => {
    expect(pdfSafe("Ọlá Adéwálé")).toBe("Ola Adewale");
    expect(pdfSafe("O’Brien – “Ngozi”")).toBe("O'Brien - \"Ngozi\"");
    expect(pdfSafe("Pay ₦500 \u{1F600}")).toBe("Pay ?500 ?");
    expect(pdfSafe("Plain ASCII, 123.")).toBe("Plain ASCII, 123.");
  });
});

describe("the PDF", () => {
  it("is a one-page PDF for a payslip, with the title set", async () => {
    const bytes = await renderPayslipPdf(payslipModel(base()));
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Acme Facilities Ltd Payslip - October 2026");
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  });

  it("survives names, columns and notes the font and the page were not made for", async () => {
    const m = payslipModel(
      base({
        orgName: "Ẹ̀gbọ́n & Sons Nigeria Limited, trading as a very long business name indeed Ltd",
        employeeName: "Oluwaseyifunmitan Adébáyọ̀ Chukwuemeka-Abubakar Ngozi Okonkwo-Eze",
        lines: [...Array.from({ length: 25 }, (_, i) => ({ type: "EARNING", code: `E${i}`, name: `Allowance number ${i} with a long explanatory name for the line`, amount: 1000 * (i + 1) })), { type: "DEDUCTION", code: "X", name: "Loan repayment ₦ plan", amount: 5000 }],
        locations: Array.from({ length: 12 }, (_, i) => ({ clientName: `Client ${i}`, beatName: `Site ${i}`, days: 2 })),
      }),
    );
    const bytes = await renderPayslipPdf(m);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("puts several payslips in one PDF, a page each", async () => {
    const bytes = await renderPayslipsPdf([payslipModel(base()), payslipModel(base({ employeeNumber: "EMP-000002" })), payslipModel(base({ employeeNumber: "EMP-000003" }))]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});
