import { describe, expect, it } from "vitest";
import {
  achievementBp,
  blendOverall,
  DEFAULT_KPI_BANDS,
  formatBandLines,
  kpiScore,
  parseBandLines,
  parseKpiNumber,
  scoreFromBands,
  validateBands,
} from "@/lib/performance";

// Job descriptions and KPIs feed the appraisal (the founder's plan of 2026-11-06, docs/plans/performance-management-phase1.md).
// All whole-number arithmetic: achievement in basis points (10,000 = 100%), scores in hundredths, rounded half up once.

describe("a KPI figure is typed as an exact number", () => {
  it("accepts whole numbers and up to four decimals", () => {
    expect(parseKpiNumber("95")).toBe(950000n);
    expect(parseKpiNumber("95.5")).toBe(955000n);
    expect(parseKpiNumber("0.0001")).toBe(1n);
    expect(parseKpiNumber(" 12 ")).toBe(120000n);
  });
  it("refuses anything that is not an exact, non-negative number", () => {
    for (const bad of ["", "abc", "-1", "1,000", "1.00001", "1e3", "Infinity", "NaN", "1.2.3"]) expect(() => parseKpiNumber(bad), bad).toThrow();
  });
});

describe("achievement against the target", () => {
  it("higher is better: the actual as a share of the target, in basis points, rounded half up", () => {
    expect(achievementBp("90", "95", "HIGHER_IS_BETTER")).toBe(9474); // 94.7368...%
    expect(achievementBp("100", "100", "HIGHER_IS_BETTER")).toBe(10000);
    expect(achievementBp("120", "100", "HIGHER_IS_BETTER")).toBe(12000);
    expect(achievementBp("1", "32", "HIGHER_IS_BETTER")).toBe(313); // exactly 312.5 rounds up
    expect(achievementBp("0", "100", "HIGHER_IS_BETTER")).toBe(0);
  });
  it("lower is better: the target as a share of the actual", () => {
    expect(achievementBp("4", "5", "LOWER_IS_BETTER")).toBe(12500);
    expect(achievementBp("5", "5", "LOWER_IS_BETTER")).toBe(10000);
    expect(achievementBp("10", "5", "LOWER_IS_BETTER")).toBe(5000);
  });
  it("lower is better and nothing went wrong (an actual of zero) counts as the top of the scale, not a divide by zero", () => {
    expect(achievementBp("0", "5", "LOWER_IS_BETTER")).toBe(1_000_000);
  });
  it("is capped, so one wild figure cannot dominate", () => {
    expect(achievementBp("100000", "1", "HIGHER_IS_BETTER")).toBe(1_000_000);
  });
  it("needs a target above zero", () => {
    expect(() => achievementBp("5", "0", "HIGHER_IS_BETTER")).toThrow(/target/i);
  });
  it("uses exact decimals, not floating point", () => {
    expect(achievementBp("0.3", "0.1", "HIGHER_IS_BETTER")).toBe(30000); // 0.3 / 0.1 is 2.9999999999999996 in floating point
    expect(achievementBp("0.7", "0.1", "HIGHER_IS_BETTER")).toBe(70000);
  });
});

describe("the achievement bands turn a percentage into a score of 1 to 5", () => {
  it("the proposed defaults: under 50% = 1; 50 to under 75 = 2; 75 to under 100 = 3; 100 to under 120 = 4; 120 and over = 5", () => {
    const at = (bp: number) => scoreFromBands(bp, DEFAULT_KPI_BANDS);
    expect([0, 4999].map(at)).toEqual([1, 1]);
    expect([5000, 7499].map(at)).toEqual([2, 2]);
    expect([7500, 9999].map(at)).toEqual([3, 3]);
    expect([10000, 11999].map(at)).toEqual([4, 4]);
    expect([12000, 1_000_000].map(at)).toEqual([5, 5]);
  });
  it("works with a company's own bands", () => {
    const own = [{ fromBp: 0, score: 1 }, { fromBp: 9000, score: 3 }, { fromBp: 10000, score: 5 }];
    expect(scoreFromBands(8999, own)).toBe(1);
    expect(scoreFromBands(9000, own)).toBe(3);
    expect(scoreFromBands(10000, own)).toBe(5);
  });
  it("bands must start at 0, rise in order, and give whole scores from 1 to 5 that never fall", () => {
    expect(validateBands(DEFAULT_KPI_BANDS)).toEqual([]);
    expect(validateBands([])).not.toEqual([]);
    expect(validateBands([{ fromBp: 100, score: 1 }])).not.toEqual([]); // does not start at 0
    expect(validateBands([{ fromBp: 0, score: 1 }, { fromBp: 5000, score: 3 }, { fromBp: 5000, score: 4 }])).not.toEqual([]); // not rising
    expect(validateBands([{ fromBp: 0, score: 0 }])).not.toEqual([]); // score outside 1 to 5
    expect(validateBands([{ fromBp: 0, score: 2.5 }])).not.toEqual([]); // not whole
    expect(validateBands([{ fromBp: 0, score: 3 }, { fromBp: 5000, score: 2 }])).not.toEqual([]); // falls
  });
});

describe("the KPI score of an appraisal", () => {
  it("is the weighted average of the KPI scores, in hundredths, rounded half up", () => {
    expect(kpiScore([{ score: 3, weight: 60 }, { score: 4, weight: 40 }])).toBe(340);
    expect(kpiScore([{ score: 5, weight: 1 }, { score: 4, weight: 1 }])).toBe(450);
    expect(kpiScore([{ score: 3, weight: 1 }, { score: 3, weight: 1 }, { score: 4, weight: 1 }])).toBe(333); // 3.333...
    expect(kpiScore([{ score: 4, weight: 1 }, { score: 4, weight: 1 }, { score: 3, weight: 1 }])).toBe(367); // 3.666... rounds up
  });
  it("leaves out a KPI that has no score yet, and is null when none has", () => {
    expect(kpiScore([{ score: 3, weight: 60 }, { score: null, weight: 40 }])).toBe(300);
    expect(kpiScore([{ score: null, weight: 40 }])).toBeNull();
    expect(kpiScore([])).toBeNull();
  });
});

describe("one overall score from the criteria and the KPIs", () => {
  it("the worked example: criteria 4.00, KPIs 3.40, a 40% share = 3.76", () => {
    expect(blendOverall(4.0, 340, 40)).toBe(3.76);
  });
  it("a 0% share changes nothing: the score is exactly the criteria score, as before KPIs existed", () => {
    for (const s of [1, 2.34, 3.67, 4.99, 5]) expect(blendOverall(s, 340, 0)).toBe(s);
    expect(blendOverall(3.67, null, 0)).toBe(3.67);
  });
  it("a 100% share is the KPI score alone", () => {
    expect(blendOverall(4.0, 340, 100)).toBe(3.4);
  });
  it("rounds half up to the hundredth", () => {
    expect(blendOverall(3.01, 300, 50)).toBe(3.01); // exactly 3.005
  });
  it("with a share above 0 but no KPI result yet, there is no overall score (the review is incomplete)", () => {
    expect(blendOverall(4.0, null, 40)).toBeNull();
  });
  it("refuses a share outside 0 to 100", () => {
    expect(() => blendOverall(4, 340, -1)).toThrow();
    expect(() => blendOverall(4, 340, 101)).toThrow();
    expect(() => blendOverall(4, 340, 12.5)).toThrow();
  });
});

describe("the bands as a person types them", () => {
  it("one band per line: the percentage it starts at, then the score", () => {
    expect(parseBandLines("0 = 1\n50 = 2\n75 = 3\n100 = 4\n120 = 5")).toEqual(DEFAULT_KPI_BANDS);
    expect(parseBandLines("0% : 1\r\n  87.5 = 3 \n\n95.25%=5\n")).toEqual([{ fromBp: 0, score: 1 }, { fromBp: 8750, score: 3 }, { fromBp: 9525, score: 5 }]);
  });
  it("is exact: a percentage has at most two decimals, so basis points are whole", () => {
    expect(() => parseBandLines("0 = 1\n87.555 = 3")).toThrow(/two decimal/i);
  });
  it("refuses a line that is not a percentage and a score", () => {
    for (const bad of ["abc", "50 -> 2", "= 3", "50 =", "-5 = 1", "50 = x", "1,000 = 3"]) expect(() => parseBandLines(`0 = 1\n${bad}`), bad).toThrow();
    expect(() => parseBandLines("")).toThrow();
  });
  it("is the same text coming back out", () => {
    expect(formatBandLines(DEFAULT_KPI_BANDS)).toBe("0 = 1\n50 = 2\n75 = 3\n100 = 4\n120 = 5");
    expect(parseBandLines(formatBandLines([{ fromBp: 0, score: 1 }, { fromBp: 8750, score: 3 }, { fromBp: 9525, score: 5 }]))).toEqual([{ fromBp: 0, score: 1 }, { fromBp: 8750, score: 3 }, { fromBp: 9525, score: 5 }]);
    expect(formatBandLines([{ fromBp: 8750, score: 3 }])).toBe("87.5 = 3");
  });
});
