import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addDays, effectiveStatus, findForbiddenClaims, quote, STARTING_ADDONS, STARTING_CARD, STARTING_PACKAGES, textLines, type PackageTerms, type RateCard } from "@/lib/pricing";
import { NO_GUARANTEE, proposalLines, proposalPdf } from "@/lib/proposal-pdf";

const card: RateCard = { hourlyCost: 3000, softwareFixed: 20000, softwarePerEmployee: 150, overheadPct: 20, targetMarginPct: 40, vatRatePct: 7.5 };
const pkg: PackageTerms = { key: "PAYROLL_COMPLIANCE", name: "Payroll & Compliance", perEmployeeRate: 2500, monthlyMinimum: 75000, onboardingFee: 100000, baseHours: 10, minutesPerEmployee: 12, scope: "A\nB", responsibilities: "X\nY" };
const reports = STARTING_ADDONS.find((a) => a.code === "REPORTS")!;
const nhf = STARTING_ADDONS.find((a) => a.code === "NHF_NHIS")!;
const base = { card, pkg, addOns: [], headcount: 30, termMonths: 12, extraHours: 0, discountPct: 0 };

describe("the quote", () => {
  it("prices per employee, with the monthly minimum as a floor", () => {
    expect(quote(base).package).toMatchObject({ monthly: 75000, basis: "PER_EMPLOYEE" }); // 30 × 2,500 = 75,000: the minimum doesn't bind
    expect(quote({ ...base, headcount: 29 }).package).toMatchObject({ monthly: 75000, basis: "MINIMUM" }); // 72,500 is lifted to the minimum
    expect(quote({ ...base, headcount: 20 }).package).toMatchObject({ monthly: 75000, basis: "MINIMUM" });
    expect(quote({ ...base, headcount: 50 }).package).toMatchObject({ monthly: 125000, basis: "PER_EMPLOYEE" });
  });

  it("adds add-ons by a flat fee plus a fee per employee, and their one-off fees", () => {
    const q = quote({ ...base, addOns: [reports, nhf, { ...reports, code: "SETUP", name: "Set-up", monthlyFee: 0, onboardingFee: 40000 }] });
    expect(q.addOns.map((a) => [a.code, a.monthly, a.onboarding])).toEqual([["REPORTS", 25000, 0], ["NHF_NHIS", 16500, 0], ["SETUP", 0, 40000]]);
    expect(q.listMonthly).toBe(75000 + 25000 + 16500);
    expect(q.onboardingFee).toBe(140000);
  });

  it("applies a discount to the monthly fee only", () => {
    const q = quote({ ...base, discountPct: 10 });
    expect(q).toMatchObject({ listMonthly: 75000, discount: 7500, monthlyFee: 67500, onboardingFee: 100000 });
  });

  it("works out delivery cost from hours, software and overhead, not from headcount alone", () => {
    const q = quote(base);
    // 10 h + 30 × 12 min = 16 h; × 3,000 = 48,000 labour; software 20,000 + 30 × 150 = 24,500; overhead 20% of 72,500 = 14,500
    expect(q.cost).toEqual({ hours: 16, extraHours: 0, labour: 48000, software: 24500, overhead: 14500, total: 87000 });
    // a harder client with the same headcount costs more to serve
    const hard = quote({ ...base, extraHours: 10 });
    expect(hard.cost.hours).toBe(26);
    expect(hard.cost.total).toBe(87000 + 36000);
    expect(hard.listMonthly).toBe(q.listMonthly);
  });

  it("flags a price that doesn't earn the target margin, and one below cost, and gives the floor", () => {
    const q = quote(base); // fee 75,000 against cost 87,000
    expect(q.belowCost).toBe(true);
    expect(q.belowTarget).toBe(true);
    expect(q.marginAmount).toBe(-12000);
    expect(q.marginPct).toBe(-16);
    expect(q.floorMonthly).toBe(145000); // 87,000 / (1 − 0.40)
    const ok = quote({ ...base, headcount: 100 }); // 250,000 fee against cost: 10 + 20 h = 30 h → 90,000 + 35,000 + 25,000 overhead
    expect(ok.cost.total).toBe(150000);
    expect(ok.marginPct).toBe(40);
    expect(ok.belowTarget).toBe(false); // exactly on target is not below it
    expect(ok.belowCost).toBe(false);
  });

  it("a discount can push a good price below target", () => {
    const good = quote({ ...base, headcount: 120 });
    expect(good.belowTarget).toBe(false);
    expect(quote({ ...base, headcount: 120, discountPct: 25 }).belowTarget).toBe(true);
  });

  it("shows VAT separately and the contract value", () => {
    const q = quote({ ...base, headcount: 50 });
    expect(q).toMatchObject({ monthlyFee: 125000, vat: 9375, monthlyWithVat: 134375, onboardingVat: 7500, contractValue: 125000 * 12 + 100000 });
  });

  it("copes with a zero fee without dividing by it", () => {
    const q = quote({ ...base, pkg: { ...pkg, perEmployeeRate: 0, monthlyMinimum: 0 }, discountPct: 0 });
    expect(q.monthlyFee).toBe(0);
    expect(q.marginPct).toBe(-100);
    expect(q.belowTarget).toBe(true);
  });

  it("carries the package's wording as lists", () => {
    const q = quote(base);
    expect(q.scope).toEqual(["A", "B"]);
    expect(q.responsibilities).toEqual(["X", "Y"]);
    expect(textLines("  • one\n- two\n\n   three  ")).toEqual(["one", "two", "three"]);
  });
});

describe("no guarantees", () => {
  it("catches promises the product must not make", () => {
    expect(findForbiddenClaims("We guarantee zero errors")).toEqual(["guarantee", "zero errors"]);
    expect(findForbiddenClaims("Error-free payroll, 100% accurate")).toEqual(["error-free", "100% accuracy or compliance"]);
    expect(findForbiddenClaims("Certified compliance with PAYE law")).toEqual(["certified compliance"]);
    expect(findForbiddenClaims("You will always be fully compliant")).toEqual(["fully compliant"]);
    expect(findForbiddenClaims("Never late, risk-free")).toEqual(["risk-free", "never late or wrong"]);
  });
  it("lets honest descriptions through", () => {
    expect(findForbiddenClaims("We prepare payroll from the inputs you send, and a second person reviews it.")).toEqual([]);
    expect(findForbiddenClaims("We never hold or move your funds.")).toEqual([]);
    expect(findForbiddenClaims("This is not a guarantee of any result, and there is no guarantee of savings.")).toEqual([]);
    expect(findForbiddenClaims("Our guarantee: payroll on time")).toEqual(["guarantee"]);
    expect(findForbiddenClaims(null)).toEqual([]);
  });
  it("is satisfied by everything the starting rate card says, and by the standing note on every proposal", () => {
    for (const p of STARTING_PACKAGES) expect(findForbiddenClaims(`${p.scope}\n${p.responsibilities}`), p.key).toEqual([]);
    for (const a of STARTING_ADDONS) expect(findForbiddenClaims(`${a.name} ${a.description}`), a.code).toEqual([]);
    expect(findForbiddenClaims(NO_GUARANTEE)).toEqual([]);
  });
});

describe("the starting rate card", () => {
  it("covers every package a proposal can use, with a price that rises with the service", () => {
    expect(STARTING_PACKAGES.map((p) => p.key)).toEqual(["PAYROLL_ESSENTIALS", "PAYROLL_COMPLIANCE", "MANAGED_PAYROLL_PLUS", "ENTERPRISE"]);
    const rates = STARTING_PACKAGES.map((p) => p.perEmployeeRate);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
  });
  it("can quote every package and add-on without error", () => {
    for (const p of STARTING_PACKAGES) {
      const q = quote({ card: STARTING_CARD, pkg: p, addOns: STARTING_ADDONS, headcount: 60, termMonths: 6, extraHours: 0, discountPct: 0 });
      expect(q.monthlyFee).toBeGreaterThan(0);
      expect(Number.isFinite(q.marginPct)).toBe(true);
    }
  });
});

describe("status and dates", () => {
  it("expires a sent proposal after its date", () => {
    expect(effectiveStatus({ status: "SENT", validUntil: "2026-10-31" }, "2026-10-31")).toBe("SENT");
    expect(effectiveStatus({ status: "SENT", validUntil: "2026-10-31" }, "2026-11-01")).toBe("EXPIRED");
    expect(effectiveStatus({ status: "ACCEPTED", validUntil: "2026-10-01" }, "2026-11-01")).toBe("ACCEPTED");
    expect(effectiveStatus({ status: "DRAFT", validUntil: null }, "2026-11-01")).toBe("DRAFT");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-25", 30)).toBe("2026-11-24");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
  });
});

describe("the proposal document", () => {
  const q = quote({ ...base, headcount: 50, addOns: [reports], discountPct: 10 });
  const doc = { bureauName: "ThreeRoots Payroll Services", number: "PR-00001", issuedOn: "2026-10-26", validUntil: "2026-11-25", preparedFor: { company: "Guardian Shield Security", contact: "Col. Ibrahim Musa", role: "Managing Director" }, quote: q };
  const text = proposalLines(doc).join("\n");

  it("says what is included, what it costs with VAT apart, how long it is open, and what is needed from the client", () => {
    expect(text).toContain("Proposal PR-00001");
    expect(text).toContain("Guardian Shield Security");
    expect(text).toContain("Open until 25 November 2026");
    expect(text).toContain("- A");
    expect(text).toContain("Monthly management reports");
    expect(text).toContain("Discount (10%)");
    expect(text).not.toMatch(/pilot|reason/i); // the reason for a discount is internal and never on the document
    expect(text).toContain("Total, excluding VAT");
    expect(text).toContain("VAT at 7.5%");
    expect(text).toContain("Total, including VAT");
    expect(text).toContain("which is added to each invoice at the rate in force");
    expect(text).toContain("- X");
    expect(text).toContain("Acceptance");
  });
  it("carries the no-guarantee note, and marks a draft as not an offer", () => {
    expect(text).toContain(NO_GUARANTEE);
    expect(text).not.toContain("DRAFT");
    expect(proposalLines({ ...doc, draft: true }).join("\n")).toContain("DRAFT: not yet sent. This is not an offer.");
  });
  it("draws a readable PDF with a title and a page footer", async () => {
    const bytes = await proposalPdf(doc);
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(back.getTitle()).toBe("Proposal PR-00001 for Guardian Shield Security");
  });
  it("runs onto a second page when the content is long, without losing any", async () => {
    const long = { ...doc, quote: { ...q, scope: Array.from({ length: 60 }, (_, i) => `Scope item number ${i + 1} describing something in a sentence of reasonable length`) } };
    const back = await PDFDocument.load(await proposalPdf(long));
    expect(back.getPageCount()).toBeGreaterThanOrEqual(2);
  });
  it("copes with accents and a naira sign in names", async () => {
    const bytes = await proposalPdf({ ...doc, preparedFor: { company: "Ọlá & Sons Ltd (₦ group)", contact: "Mrs Nkechi Eze" } });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
