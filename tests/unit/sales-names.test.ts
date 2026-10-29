import { describe, expect, it } from "vitest";
import { normalizeCompanyName } from "@/lib/sales/names";

describe("company names are compared by what identifies them", () => {
  it("ignores case, punctuation, spacing and the usual endings", () => {
    const same = ["ABC Security Ltd", "A.B.C. Security Limited", "abc security", "ABC  SECURITY  Nig. Ltd", "ABC Security Plc"];
    for (const n of same) expect(normalizeCompanyName(n), n).toBe("abcsecurity");
    expect(normalizeCompanyName("Lekki Gardens Estate")).toBe(normalizeCompanyName("LEKKI GARDENS ESTATE LTD"));
  });
  it("keeps different companies different, and never reduces a name to nothing", () => {
    expect(normalizeCompanyName("Ikoyi Towers")).not.toBe(normalizeCompanyName("Lekki Towers"));
    expect(normalizeCompanyName("Ltd")).toBe("ltd");
    expect(normalizeCompanyName("Smith & Sons Co")).toBe("smithandsons");
  });
});
