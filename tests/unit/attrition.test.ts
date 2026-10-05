import { describe, expect, it } from "vitest";
import { exitNature, pct, tenureBand, turnoverRates } from "@/lib/attrition";

describe("tenureBand", () => {
  it("bands leavers by length of service", () => {
    expect(tenureBand(30)).toBe("Under 6 months");
    expect(tenureBand(181)).toBe("Under 6 months");
    expect(tenureBand(182)).toBe("6–12 months");
    expect(tenureBand(364)).toBe("6–12 months");
    expect(tenureBand(365)).toBe("1–2 years");
    expect(tenureBand(729)).toBe("1–2 years");
    expect(tenureBand(730)).toBe("2–5 years");
    expect(tenureBand(1825)).toBe("2–5 years");
    expect(tenureBand(1826)).toBe("5+ years");
  });
});

describe("exitNature", () => {
  it("treats resignation as voluntary, dismissal and absconding as involuntary, the rest as neither", () => {
    expect(exitNature("RESIGNATION")).toBe("VOLUNTARY");
    expect(exitNature("TERMINATION")).toBe("INVOLUNTARY");
    expect(exitNature("ABSCONDMENT")).toBe("INVOLUNTARY");
    for (const t of ["END_OF_CONTRACT", "RETIREMENT", "DECEASED"]) expect(exitNature(t)).toBe("OTHER");
  });
});

describe("turnoverRates", () => {
  it("is leavers over average headcount, and scales that to a year", () => {
    expect(turnoverRates(3, 5, 3, 151)).toEqual({ average: 4, rate: 75, annualised: 181.3 });
    expect(turnoverRates(10, 100, 100, 365)).toEqual({ average: 100, rate: 10, annualised: 10 });
  });
  it("doesn't divide by zero when there is no headcount", () => {
    expect(turnoverRates(0, 0, 0, 30)).toEqual({ average: 0, rate: 0, annualised: 0 });
  });
  it("percentages guard an empty total", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBe(0);
  });
});
