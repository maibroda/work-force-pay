import { describe, expect, it } from "vitest";
import { ACCESS_BANK_LAYOUT, FIRST_BANK_LAYOUT, narrationFor } from "@/lib/paying-bank";

describe("the narration on a bank file", () => {
  it("names the pay month in capitals, with no limit", () => {
    expect(narrationFor("October 2026", false, null)).toEqual({ text: "PAYMENT FOR OCTOBER 2026" });
    expect(narrationFor("September 2026", true, null)).toEqual({ text: "PAYMENT FOR SEPTEMBER 2026 (ADJUSTMENT)" });
  });

  it("keeps the full month while it fits the bank's 25 characters (October is 24, November 25)", () => {
    expect(narrationFor("October 2026", false, 25)).toEqual({ text: "PAYMENT FOR OCTOBER 2026" });
    expect(narrationFor("November 2026", false, 25)).toEqual({ text: "PAYMENT FOR NOVEMBER 2026" });
  });

  it("shortens the month to three letters when the full name is over the limit (September is 26)", () => {
    const n = narrationFor("September 2026", false, 25);
    expect(n).toEqual({ text: "PAYMENT FOR SEP 2026" });
  });

  it("shortens an adjustment too, and never goes over the limit", () => {
    for (const month of ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])
      for (const adjustment of [false, true]) {
        const n = narrationFor(`${month} 2026`, adjustment, 25);
        expect("text" in n && n.text.length <= 25, `${month} ${adjustment}`).toBe(true);
        if ("text" in n && adjustment) expect(n.text).toMatch(/ADJ/);
        if ("text" in n) expect(n.text).toMatch(/^PAYMENT FOR /);
      }
    expect(narrationFor("October 2026", true, 25)).toEqual({ text: "PAYMENT FOR OCT 2026 ADJ" });
  });

  it("says so, rather than cutting the text off, when nothing fits", () => {
    const n = narrationFor("October 2026", false, 10);
    expect(n).toMatchObject({ problem: expect.stringMatching(/10 characters/) });
    const w = narrationFor("Special Bonus Run 2026", false, 25);
    expect(w).toMatchObject({ problem: expect.stringMatching(/25 characters/) });
  });

  it("both banks' templates carry the limits the founder gave: narration 25 characters, 1,000 rows", () => {
    for (const l of [FIRST_BANK_LAYOUT, ACCESS_BANK_LAYOUT]) expect([l.narrationMax, l.maxRows]).toEqual([25, 1000]);
  });
});
