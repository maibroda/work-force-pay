import { describe, expect, it } from "vitest";
import { sopReviewLimit } from "@/lib/policies";

// A procedure (SOP) needs a review date (founder, 2026-11-17: "approved as recommended"). The latest it may be is the company's number of months (12 unless changed) after the procedure takes
// effect; a procedure that took effect long ago is counted from today, so marking one reviewed always allows a full period ahead. Plain "YYYY-MM-DD" days; no clock here.

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("the latest review date for a procedure", () => {
  it("is the number of months after it takes effect, when it takes effect today or later", () => {
    expect(sopReviewLimit(d("2026-11-17"), d("2026-11-17"), 12)).toBe("2027-11-17");
    expect(sopReviewLimit(d("2027-03-01"), d("2026-11-17"), 12)).toBe("2028-03-01");
  });

  it("is counted from today when it took effect in the past, so a review always allows a full period ahead", () => {
    expect(sopReviewLimit(d("2024-01-15"), d("2026-11-17"), 12)).toBe("2027-11-17");
  });

  it("follows the company's own number of months", () => {
    expect(sopReviewLimit(d("2026-11-17"), d("2026-11-17"), 6)).toBe("2027-05-17");
    expect(sopReviewLimit(d("2026-11-17"), d("2026-11-17"), 24)).toBe("2028-11-17");
  });

  it("copes with a month that is shorter (31 August plus six months is the end of February)", () => {
    expect(sopReviewLimit(d("2026-08-31"), d("2026-08-31"), 6)).toBe("2027-02-28");
  });
});
