import { describe, expect, it } from "vitest";
import { normalizeNgPhone } from "@/lib/sales/phone";

describe("Nigerian phone numbers are stored in one international form (+234...)", () => {
  it("turns every usual way of writing a mobile number into the same E.164 number", () => {
    for (const s of ["08031234567", "0803 123 4567", "0803-123-4567", "(0803) 123-4567", "2348031234567", "234 803 123 4567", "+234 803 123 4567", "+2348031234567", "  +234-803-123-4567  "])
      expect(normalizeNgPhone(s), s).toEqual({ ok: true, e164: "+2348031234567" });
    expect(normalizeNgPhone("07061234567")).toEqual({ ok: true, e164: "+2347061234567" });
    expect(normalizeNgPhone("09012345678")).toEqual({ ok: true, e164: "+2349012345678" });
  });
  it("accepts a Lagos-style landline (area code then 7 digits)", () => {
    expect(normalizeNgPhone("01 234 5678")).toEqual({ ok: true, e164: "+23412345678" });
    expect(normalizeNgPhone("+234 1 234 5678")).toEqual({ ok: true, e164: "+23412345678" });
  });
  it("refuses what it cannot be sure of, with a reason, and never guesses a digit", () => {
    for (const s of ["", "   ", "12345", "0803 123 456", "080312345678", "803123456", "abcdefghijk", "+44 7700 900123", "+1 202 555 0100", "00 234 803 123 4567x"])
      expect(normalizeNgPhone(s), s).toMatchObject({ ok: false, reason: expect.stringMatching(/\S/) });
  });
  it("keeps the same number when it is normalised twice", () => {
    const once = normalizeNgPhone("08031234567");
    expect(once.ok && normalizeNgPhone(once.e164)).toEqual(once);
  });
});
