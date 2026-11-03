import { describe, expect, it } from "vitest";
import { QUOTE_STANDING_NOTE, quoteBlocks, quoteLines, quotePdf, type QuoteDoc } from "@/lib/sales/quote-pdf";

const doc = (over: Partial<QuoteDoc> = {}): QuoteDoc => ({
  companyName: "Shield Guards Ltd",
  number: "SQ-00001",
  versionNo: 1,
  accountName: "Lekki Gardens Estate",
  issuedOn: "2026-10-29",
  validUntil: "2026-12-31",
  notes: "Prices exclude VAT.",
  rows: [
    { siteName: "Lekki Gardens Phase 1", siteAddress: null, postLabel: "Main gate", shiftPattern: "24/7", headcount: 12, billPerHead: "120000.00", monthly: "1440000.00" },
    { siteName: "Lekki Gardens Phase 2", siteAddress: null, postLabel: null, shiftPattern: null, headcount: 1, billPerHead: "150000.00", monthly: "150000.00" },
  ],
  total: "1590000.00",
  draft: false,
  ...over,
});

describe("the quote the client receives", () => {
  it("lists each post with its guards, the rate for each guard and the monthly amount, then the total, the validity and the notes", () => {
    const lines = quoteLines(doc());
    expect(lines).toEqual(
      expect.arrayContaining([
        "Quote SQ-00001",
        "Shield Guards Ltd  |  29 October 2026  |  Open until 31 December 2026",
        "Lekki Gardens Estate",
        "Lekki Gardens Phase 1, Main gate, 24/7, 12 guards  NGN 120,000.00  NGN 1,440,000.00",
        "Lekki Gardens Phase 2, 1 guard  NGN 150,000.00  NGN 150,000.00",
        "Total a month  NGN 1,590,000.00",
        "Prices exclude VAT.",
        QUOTE_STANDING_NOTE,
      ]),
    );
  });
  it("marks a draft so it cannot be taken for an offer, and shows the version of a revised quote", () => {
    expect(quoteLines(doc({ draft: true }))[0]).toMatch(/DRAFT: not yet sent/);
    expect(quoteLines(doc({ versionNo: 2 }))).toContain("Quote SQ-00001 (version 2)");
  });
  it("says nothing of the company's costs, margin, pension, ITF or how the price was built", () => {
    const text = JSON.stringify(quoteBlocks(doc()));
    expect(text).not.toMatch(/cost|margin|pension|ITF|NSITF|employer|salary structure|rule/i);
  });
  it("draws as a real PDF", async () => {
    const bytes = await quotePdf(doc());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });
});
