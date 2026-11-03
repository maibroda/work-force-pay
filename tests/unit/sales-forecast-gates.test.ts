import { describe, expect, it } from "vitest";
import { annualValueKobo, checkProbability, forecastByCloseMonth, totalsOf, weightedValueKobo } from "@/lib/sales/forecast";
import { missingForStage, type GateFacts } from "@/lib/sales/gates";
import { koboToString } from "@/lib/money-exact";

describe("a deal's weighted value is exact to the kobo", () => {
  it("is the monthly value times the probability over 100, rounded half up once", () => {
    expect(koboToString(weightedValueKobo("1500000.00", 50))).toBe("750000.00");
    expect(koboToString(weightedValueKobo("1000000.00", 35))).toBe("350000.00");
    expect(koboToString(weightedValueKobo("0.05", 10))).toBe("0.01"); // 0.5 kobo rounds up
    expect(koboToString(weightedValueKobo("0.04", 10))).toBe("0.00"); // 0.4 kobo rounds down
    expect(koboToString(weightedValueKobo("33.33", 33))).toBe("11.00"); // 10.9989 naira
    expect(koboToString(weightedValueKobo("100.01", 50))).toBe("50.01"); // 50.005 rounds up
    expect(koboToString(weightedValueKobo("123456789.99", 100))).toBe("123456789.99");
    expect(koboToString(weightedValueKobo("500.00", 0))).toBe("0.00");
  });
  it("accepts only a whole probability from 0 to 100, and an amount of whole kobo", () => {
    for (const p of [-1, 101, 12.5, Number.NaN]) expect(() => checkProbability(p), String(p)).toThrow(/0 to 100/);
    expect(() => weightedValueKobo("10.005", 50)).toThrow(/whole kobo/);
  });
  it("derives the annual value from the monthly one and never stores it", () => {
    expect(koboToString(annualValueKobo("1500000.50"))).toBe("18000006.00");
  });
  it("totals are the exact sum of each deal's own rounded weighted value, with no drift over many deals", () => {
    const deals = Array.from({ length: 1000 }, () => ({ monthlyContractValue: "100.01", probability: 50 }));
    expect(totalsOf(deals)).toEqual({ count: 1000, value: "100010.00", weighted: "50010.00" }); // 1000 x 50.01 (each 50.005 rounded up once)
    expect(totalsOf([])).toEqual({ count: 0, value: "0.00", weighted: "0.00" });
  });
});

describe("the forecast by expected close month", () => {
  it("groups open deals by month, oldest first, with undated deals last", () => {
    const f = forecastByCloseMonth([
      { monthlyContractValue: "1000000.00", probability: 50, expectedCloseDate: new Date("2026-12-15T00:00:00Z") },
      { monthlyContractValue: "2000000.00", probability: 20, expectedCloseDate: "2026-11-30" },
      { monthlyContractValue: "500000.00", probability: 100, expectedCloseDate: new Date("2026-12-01T00:00:00Z") },
      { monthlyContractValue: "300000.00", probability: 10, expectedCloseDate: null },
    ]);
    expect(f).toEqual([
      { month: "2026-11", count: 1, value: "2000000.00", weighted: "400000.00" },
      { month: "2026-12", count: 2, value: "1500000.00", weighted: "1000000.00" },
      { month: "No close date", count: 1, value: "300000.00", weighted: "30000.00" },
    ]);
  });
});

const facts = (over: Partial<GateFacts> = {}): GateFacts => ({ monthlyContractValue: "0.00", expectedStartDate: null, contractTermMonths: null, primaryContactId: null, accountContactCount: 0, lostReason: null, hasQuote: null, ...over });

describe("stage gates", () => {
  it("names exactly what is missing, in plain words", () => {
    expect(missingForStage(["expectedStartDate", "contact"], facts())).toEqual(["the expected start date", "a contact on the deal (or at least one on its account)"]);
    expect(missingForStage(["monthlyContractValue", "contractTermMonths", "expectedStartDate"], facts())).toHaveLength(3);
    expect(missingForStage(["lostReason"], facts())).toEqual(["the reason it was lost"]);
  });
  it("passes when everything is there, and counts a contact on the account as enough", () => {
    expect(missingForStage(["monthlyContractValue", "contractTermMonths", "expectedStartDate"], facts({ monthlyContractValue: "1500000.00", contractTermMonths: 12, expectedStartDate: "2027-01-01" }))).toEqual([]);
    expect(missingForStage(["contact"], facts({ primaryContactId: "c1" }))).toEqual([]);
    expect(missingForStage(["contact"], facts({ accountContactCount: 2 }))).toEqual([]);
    expect(missingForStage([], facts())).toEqual([]);
  });
  it("needs a value above zero and a term of at least one month", () => {
    expect(missingForStage(["monthlyContractValue"], facts({ monthlyContractValue: "0.00" }))).toHaveLength(1);
    expect(missingForStage(["contractTermMonths"], facts({ contractTermMonths: 0 }))).toHaveLength(1);
  });
  it("checks a quote only once quotes exist, and blocks on an unknown requirement instead of passing it", () => {
    expect(missingForStage(["quote"], facts({ hasQuote: null }))).toEqual([]); // the quote builder is not on yet
    expect(missingForStage(["quote"], facts({ hasQuote: false }))).toEqual(["a quote that has been sent or accepted"]);
    expect(missingForStage(["quote"], facts({ hasQuote: true }))).toEqual([]);
    expect(missingForStage(["somethingNew"], facts())).toEqual(['(an unknown requirement "somethingNew")']);
  });
});
