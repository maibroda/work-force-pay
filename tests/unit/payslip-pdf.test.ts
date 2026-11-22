import { inflateSync } from "node:zlib";
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

/**
 * What the pages of a PDF say, read back from the drawn text (the content of a page is plain, with each string written in hex): the text of each page, and where (the height) each piece of text sits. Used to prove that every
 * line is on the payslip and nothing is drawn over the footer.
 */
function pagesOf(bytes: Uint8Array): Promise<Array<Array<{ text: string; y: number }>>> {
  return PDFDocument.load(bytes).then((doc) =>
    doc.getPages().map((page) => {
      const contents = page.node.Contents() as unknown as { asArray?: () => unknown[] };
      const refs = contents.asArray?.() ?? [contents];
      const out: Array<{ text: string; y: number }> = [];
      for (const ref of refs) {
        const s = doc.context.lookup(ref as never) as unknown as { getContents(): Uint8Array };
        let raw = Buffer.from(s.getContents());
        try {
          raw = inflateSync(raw); // the page content is compressed
        } catch {
          /* not compressed */
        }
        const src = raw.toString("latin1");
        for (const m of src.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s+<([0-9A-Fa-f]*)> Tj/g)) out.push({ y: Number(m[2]), text: Buffer.from(m[3], "hex").toString("latin1") });
      }
      return out;
    }),
  );
}

describe("every hourly line is on the payslip, on as many pages as it takes (nothing is hidden)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ siteName: `Row${String(i).padStart(3, "0")} site`, dayClass: "WEEKDAY" as const, minutes: 60 * (i + 1), rate: "1000.00", amount: `${1000 * (i + 1)}.00` }));
  const render = (n: number) => renderPayslipPdf(payslipModel(base({ monthlyGross: 0, hourly: rows(n) })));

  it("shows all 14 lines (the old limit hid every line after the ninth) and never says that lines are left out", async () => {
    const pages = await pagesOf(await render(14));
    const all = pages.flat().map((t) => t.text);
    for (let i = 0; i < 14; i++) expect(all.filter((t) => t.startsWith(`Row${String(i).padStart(3, "0")} site`))).toHaveLength(1);
    expect(all.join("\n")).not.toMatch(/more line/);
  });

  it("carries on to further pages when the lines do not fit: every line once, in order, a 'continued' heading, the totals once at the end, the footer on every page", async () => {
    const bytes = await render(80);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    const pages = await pagesOf(bytes);
    const order = pages.flatMap((p) => p.map((t) => t.text)).filter((t) => /^Row\d{3} site/.test(t)).map((t) => Number(t.slice(3, 6)));
    expect(order).toEqual(Array.from({ length: 80 }, (_, i) => i)); // every line once, in order
    expect(pages[1].some((t) => /continued/i.test(t.text))).toBe(true);
    expect(pages.flat().filter((t) => t.text === "Total")).toHaveLength(1);
    expect(pages[pages.length - 1].some((t) => t.text === "Total")).toBe(true);
    for (const p of pages) expect(p.some((t) => /Confidential|Generated/.test(t.text) && t.y < 120)).toBe(true); // the footer is on every page
    expect(pages.flat().map((t) => t.text).join("\n")).not.toMatch(/more line/);
  });

  it("never draws a line over the footer", async () => {
    const pages = await pagesOf(await render(80));
    for (const p of pages) for (const t of p) if (/^Row\d{3} site/.test(t.text)) expect(t.y).toBeGreaterThan(100);
  });

  it("a payslip with no hourly lines is still one page, and several payslips each start on a new page", async () => {
    expect((await PDFDocument.load(await renderPayslipPdf(payslipModel(base())))).getPageCount()).toBe(1);
    const two = await renderPayslipsPdf([payslipModel(base({ monthlyGross: 0, hourly: rows(80) })), payslipModel(base({ employeeNumber: "EMP-000002" }))]);
    const pages = await pagesOf(two);
    expect(pages[pages.length - 1].some((t) => t.text.includes("EMP-000002"))).toBe(true);
    expect(pages.slice(0, -1).some((p) => p.some((t) => t.text.includes("EMP-000002")))).toBe(false);
  });
});

describe("the client on the payslip (the founder's confirmed decision: show the client name)", () => {
  const hours = (clientName: string | undefined, siteName: string, minutes = 480, amount = "8000.00") => ({ ...(clientName ? { clientName } : {}), siteName, dayClass: "WEEKDAY" as const, minutes, rate: "1000.00", amount });

  it("one client: a Client detail, and the Site column of each hours line reads 'Client - Site'", () => {
    const m = payslipModel(base({ monthlyGross: 0, hourly: [hours("ABC Bank", "Gate 1")] }));
    expect(m.details.find(([k]) => k === "Client")?.[1]).toBe("ABC Bank");
    expect(m.hourly?.rows[0][0]).toBe("ABC Bank - Gate 1");
  });

  it("several clients in the month: 'Clients' lists each once, in the order they first appear, and every hours line names its own client", () => {
    const m = payslipModel(base({ monthlyGross: 0, hourly: [hours("ABC Bank", "Gate 1"), hours("Beta Foods", "Plant"), hours("ABC Bank", "Gate 2")] }));
    expect(m.details.find(([k]) => k === "Clients")?.[1]).toBe("ABC Bank; Beta Foods");
    expect(m.details.find(([k]) => k === "Client")).toBeUndefined();
    expect(m.hourly?.rows.map((r) => r[0]).sort()).toEqual(["ABC Bank - Gate 1", "ABC Bank - Gate 2", "Beta Foods - Plant"]);
  });

  it("an extra pay line (leave, sick or holiday pay) names its client too", () => {
    const m = payslipModel(base({ monthlyGross: 0, hourly: [hours("ABC Bank", "Gate 1")], allowances: [{ kind: "LEAVE_PERCENT", siteName: "Gate 1", clientName: "ABC Bank", baseAmount: "800.00", pct: "2.5", amount: "20.00" }] }));
    expect(m.hourly?.rows.map((r) => r[0])).toEqual(["ABC Bank - Gate 1", "ABC Bank - Gate 1"]);
  });

  it("monthly staff: the client comes from their work locations (the head office is not a client)", () => {
    const m = payslipModel(base({ locations: [{ clientName: "Head Office", beatName: "Head Office", days: 5 }, { clientName: "Global Insurance", beatName: "Tower", days: 20 }] }));
    expect(m.details.find(([k]) => k === "Client")?.[1]).toBe("Global Insurance");
    expect(payslipModel(base()).details.find(([k]) => k === "Client" || k === "Clients")).toBeUndefined(); // only the head office: no client row
  });

  it("with no client named the payslip is as before: no client row, and the Site column shows the site alone", () => {
    const m = payslipModel(base({ monthlyGross: 0, hourly: [hours(undefined, "Gate 1")] }));
    expect(m.details.find(([k]) => k === "Client" || k === "Clients")).toBeUndefined();
    expect(m.hourly?.rows[0][0]).toBe("Gate 1");
  });

  it("shows the client's NAME only: nothing the client is charged, no contract rate and no management share is in what the payslip carries", () => {
    const text = JSON.stringify(payslipModel(base({ monthlyGross: 0, hourly: [hours("ABC Bank", "Gate 1")] })));
    expect(text).not.toMatch(/billing|charge|agreed|management share|contract rate/i);
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
    // all 12 work locations are drawn (the old limit of 8 hid four of them and kept this to one page); that much content needs a second page, and nothing is drawn over the footer
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const pages = await pagesOf(bytes);
    const all = pages.flat();
    for (let i = 0; i < 12; i++) expect(all.some((t) => t.text.includes(`Site ${i}`))).toBe(true);
    for (const t of all) if (t.y < 100) expect(m.footer).toContain(t.text.trim()); // below that height only the (wrapped) footer
  });

  it("puts several payslips in one PDF, a page each", async () => {
    const bytes = await renderPayslipsPdf([payslipModel(base()), payslipModel(base({ employeeNumber: "EMP-000002" })), payslipModel(base({ employeeNumber: "EMP-000003" }))]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});
