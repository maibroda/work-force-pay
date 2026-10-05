import { describe, expect, it } from "vitest";
import { d } from "@/lib/dates";
import { DEFAULT_TEMPLATES, fieldsUsed, LETTER_FIELDS, LETTER_TYPES, renderTemplate, serviceLength, unknownFields } from "@/lib/letters";

describe("renderTemplate", () => {
  it("fills placeholders, tolerating spaces, and repeats", () => {
    expect(renderTemplate("Dear {{ recipient }}, {{recipient}}!", { recipient: "Ada" })).toBe("Dear Ada, Ada!");
  });
  it("shows a dash for a missing or blank value instead of leaving a hole", () => {
    expect(renderTemplate("Ends {{endDate}} / {{x}}", { endDate: "  " })).toBe("Ends — / —");
  });
  it("never interprets values as markup or as further placeholders", () => {
    expect(renderTemplate("{{recipient}}", { recipient: "<script>alert(1)</script> {{today}}" })).toBe("<script>alert(1)</script> {{today}}");
  });
});

describe("placeholder checking", () => {
  it("lists the fields a text uses, once each", () => {
    expect(fieldsUsed("{{a}} {{ b }} {{a}} {not}")).toEqual(["a", "b"]);
  });
  it("flags fields the letter type doesn't offer", () => {
    expect(unknownFields("{{recipient}} {{salary}} {{monthlyGross}}", "OFFER")).toEqual(["salary"]);
    expect(unknownFields("{{monthlyGross}}", "EMPLOYMENT_CONFIRMATION")).toEqual(["monthlyGross"]); // pay isn't in a verification letter
  });
  it("every default template uses only fields its own type offers", () => {
    for (const t of LETTER_TYPES) {
      expect(unknownFields(DEFAULT_TEMPLATES[t].subject, t)).toEqual([]);
      expect(unknownFields(DEFAULT_TEMPLATES[t].body, t)).toEqual([]);
      expect(fieldsUsed(DEFAULT_TEMPLATES[t].body).length).toBeGreaterThan(2);
    }
  });
  it("offers each field once per type", () => {
    for (const t of LETTER_TYPES) {
      const keys = LETTER_FIELDS[t].map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("serviceLength", () => {
  it("counts whole months with the last day as worked", () => {
    expect(serviceLength(d("2020-01-01"), d("2024-12-31"))).toBe("5 years");
    expect(serviceLength(d("2021-03-01"), d("2026-08-31"))).toBe("5 years, 6 months");
    expect(serviceLength(d("2026-01-15"), d("2026-04-14"))).toBe("3 months");
    expect(serviceLength(d("2025-06-01"), d("2026-06-30"))).toBe("1 year, 1 month");
  });
  it("copes with a very short stay", () => {
    expect(serviceLength(d("2026-05-01"), d("2026-05-10"))).toBe("less than a month");
  });
});
