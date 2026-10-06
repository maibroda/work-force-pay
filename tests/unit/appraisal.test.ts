import { describe, expect, it } from "vitest";
import { bandFor, commentRequired, DEFAULT_CRITERIA, selfGap, weightedScore } from "@/lib/appraisal";

describe("weightedScore", () => {
  it("weights each rating by its criterion", () => {
    // (5×20 + 3×20 + 1×10) / 50 = 3.4
    expect(weightedScore([{ rating: 5, weight: 20 }, { rating: 3, weight: 20 }, { rating: 1, weight: 10 }])).toEqual({ score: 3.4, complete: true });
  });
  it("is the plain average when the weights are equal", () => {
    expect(weightedScore([{ rating: 4, weight: 10 }, { rating: 2, weight: 10 }]).score).toBe(3);
  });
  it("rounds to two places", () => {
    expect(weightedScore([{ rating: 5, weight: 1 }, { rating: 4, weight: 1 }, { rating: 4, weight: 1 }]).score).toBe(4.33);
  });
  it("says when a criterion hasn't been rated, and scores only what has", () => {
    expect(weightedScore([{ rating: 4, weight: 10 }, { rating: null, weight: 10 }])).toEqual({ score: 4, complete: false });
    expect(weightedScore([{ rating: undefined, weight: 10 }])).toEqual({ score: null, complete: false });
    expect(weightedScore([])).toEqual({ score: null, complete: false });
  });
  it("doesn't let an empty weight divide by zero", () => {
    expect(weightedScore([{ rating: 4, weight: 0 }]).score).toBeNull();
  });
});

describe("bandFor", () => {
  it("puts scores in the right band at every boundary", () => {
    expect(bandFor(5)).toBe("Outstanding");
    expect(bandFor(4.5)).toBe("Outstanding");
    expect(bandFor(4.49)).toBe("Exceeds expectations");
    expect(bandFor(3.5)).toBe("Exceeds expectations");
    expect(bandFor(3.49)).toBe("Meets expectations");
    expect(bandFor(2.5)).toBe("Meets expectations");
    expect(bandFor(2.49)).toBe("Needs improvement");
    expect(bandFor(1.5)).toBe("Needs improvement");
    expect(bandFor(1.49)).toBe("Unsatisfactory");
    expect(bandFor(1)).toBe("Unsatisfactory");
  });
});

describe("commentRequired", () => {
  const p = { appraisalCommentAtOrBelow: 2, appraisalCommentAtOrAbove: 5 };
  it("asks for a reason at the extremes only", () => {
    expect([1, 2, 3, 4, 5].map((r) => commentRequired(r, p))).toEqual([true, true, false, false, true]);
  });
  it("can be switched off on either side with 0", () => {
    expect([1, 2, 3, 4, 5].map((r) => commentRequired(r, { ...p, appraisalCommentAtOrBelow: 0 }))).toEqual([false, false, false, false, true]);
    expect([1, 2, 3, 4, 5].map((r) => commentRequired(r, { ...p, appraisalCommentAtOrAbove: 0 }))).toEqual([true, true, false, false, false]);
    expect(commentRequired(1, { appraisalCommentAtOrBelow: 0, appraisalCommentAtOrAbove: 0 })).toBe(false);
  });
  it("follows a stricter setting", () => {
    expect([1, 2, 3, 4, 5].map((r) => commentRequired(r, { appraisalCommentAtOrBelow: 3, appraisalCommentAtOrAbove: 4 }))).toEqual([true, true, true, true, true]);
  });
});

describe("selfGap", () => {
  it("is the employee's average minus the reviewer's, over criteria both rated", () => {
    expect(selfGap([{ selfRating: 5, rating: 3 }, { selfRating: 4, rating: 4 }, { selfRating: 3, rating: 3 }])).toBe(0.67);
    expect(selfGap([{ selfRating: 2, rating: 4 }])).toBe(-2);
  });
  it("ignores criteria either side skipped, and is null with nothing to compare", () => {
    expect(selfGap([{ selfRating: 5, rating: null }, { selfRating: null, rating: 3 }])).toBeNull();
    expect(selfGap([{ selfRating: 4, rating: 3 }, { selfRating: null, rating: 1 }])).toBe(1);
  });
});

describe("default criteria", () => {
  it("are distinct and every weight is positive", () => {
    expect(new Set(DEFAULT_CRITERIA.map((c) => c.name.toLowerCase())).size).toBe(DEFAULT_CRITERIA.length);
    expect(DEFAULT_CRITERIA.every((c) => c.weight > 0)).toBe(true);
  });
});
