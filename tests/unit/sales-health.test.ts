import { describe, expect, it } from "vitest";
import { bandOf, DEFAULT_WEIGHTS, scoreAccount, validateWeights, type HealthInputs } from "@/lib/sales/health";

const fine: HealthInputs = { slaBreaches90: 0, openCritical: 0, openHigh: 0, absencePct: 0, maxDaysOverdue: 0, daysToContractEnd: null, renewalInProgress: false, daysSinceClientContact: 5 };
const part = (r: ReturnType<typeof scoreAccount>, key: string) => r.components.find((c) => c.key === key)!;

describe("the weights", () => {
  it("start at 100 in all, and must always add up to 100, as whole numbers, for the six components", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(validateWeights(DEFAULT_WEIGHTS)).toBeNull();
    expect(validateWeights({ ...DEFAULT_WEIGHTS, SLA_BREACHES: 25 })).toMatch(/add up to 100/i);
    expect(validateWeights({ ...DEFAULT_WEIGHTS, SLA_BREACHES: -5, CLIENT_CONTACT: 40 })).toMatch(/whole number/i);
    expect(validateWeights({ ...DEFAULT_WEIGHTS, SLA_BREACHES: 20.5, CLIENT_CONTACT: 14.5 })).toMatch(/whole number/i);
    const { CLIENT_CONTACT: _gone, ...missing } = DEFAULT_WEIGHTS;
    void _gone;
    expect(validateWeights(missing as never)).toMatch(/all six/i);
  });
});

describe("the bands", () => {
  it("are healthy from 70, watch from 40, at risk below", () => {
    expect([100, 70, 69, 40, 39, 0].map(bandOf)).toEqual(["HEALTHY", "HEALTHY", "WATCH", "WATCH", "AT_RISK", "AT_RISK"]);
  });
});

describe("each component's sub-score", () => {
  it("falls 25 for each SLA breach in 90 days, to nothing at four", () => {
    expect([0, 1, 2, 4, 9].map((n) => part(scoreAccount({ ...fine, slaBreaches90: n }), "SLA_BREACHES").subScore)).toEqual([100, 75, 50, 0, 0]);
  });
  it("falls 40 for each open critical case and 25 for each open high one", () => {
    expect(part(scoreAccount({ ...fine, openCritical: 1 }), "OPEN_SEVERE_CASES").subScore).toBe(60);
    expect(part(scoreAccount({ ...fine, openHigh: 2 }), "OPEN_SEVERE_CASES").subScore).toBe(50);
    expect(part(scoreAccount({ ...fine, openCritical: 1, openHigh: 1 }), "OPEN_SEVERE_CASES").subScore).toBe(35);
    expect(part(scoreAccount({ ...fine, openCritical: 3 }), "OPEN_SEVERE_CASES").subScore).toBe(0);
  });
  it("falls 5 for each percent of guard absence, to nothing at 20%, and is left out when there are no attendance records", () => {
    expect([0, 2.5, 10, 20, 35].map((p) => part(scoreAccount({ ...fine, absencePct: p }), "GUARD_ABSENCE").subScore)).toEqual([100, 88, 50, 0, 0]); // 2.5% is 87.5, rounded half up
    expect(part(scoreAccount({ ...fine, absencePct: null }), "GUARD_ABSENCE").subScore).toBeNull();
  });
  it("is 100 until an invoice is past due, then falls to nothing at 60 days", () => {
    expect([-10, 0, 1, 30, 45, 60, 200].map((d) => part(scoreAccount({ ...fine, maxDaysOverdue: d }), "INVOICES_OVERDUE").subScore)).toEqual([100, 100, 98, 50, 25, 0, 0]);
  });
  it("is 100 when no contract ends within 90 days or a renewal is in progress, otherwise falls as the end nears", () => {
    expect(part(scoreAccount({ ...fine, daysToContractEnd: null }), "CONTRACT_END").subScore).toBe(100);
    expect(part(scoreAccount({ ...fine, daysToContractEnd: 10, renewalInProgress: true }), "CONTRACT_END").subScore).toBe(100);
    expect([90, 45, 10, 0].map((d) => part(scoreAccount({ ...fine, daysToContractEnd: d }), "CONTRACT_END").subScore)).toEqual([100, 50, 11, 0]);
  });
  it("is 100 for a month since the last client-facing contact, then falls to nothing at 120 days", () => {
    expect([0, 30, 31, 75, 120, 400].map((d) => part(scoreAccount({ ...fine, daysSinceClientContact: d }), "CLIENT_CONTACT").subScore)).toEqual([100, 100, 99, 50, 0, 0]);
  });
});

describe("the score", () => {
  it("is 100 and healthy for an account with nothing wrong", () => {
    expect(scoreAccount(fine)).toMatchObject({ score: 100, band: "HEALTHY" });
  });

  it("is the weighted average of the sub-scores, rounded half up", () => {
    const r = scoreAccount({ slaBreaches90: 2, openCritical: 1, openHigh: 0, absencePct: 10, maxDaysOverdue: 30, daysToContractEnd: 45, renewalInProgress: false, daysSinceClientContact: 75 });
    expect(r.components.map((c) => c.subScore)).toEqual([50, 60, 50, 50, 50, 50]);
    expect(r.score).toBe(52); // (1,000 + 900 + 1,000 + 1,000 + 500 + 750) / 100 = 51.5, rounded half up to 52
    expect(r.band).toBe("WATCH");
  });

  it("falls by the weight of one component when only that one is at nothing: a 60-day-old unpaid invoice costs 20 points", () => {
    expect(scoreAccount({ ...fine, maxDaysOverdue: 60 })).toMatchObject({ score: 80, band: "HEALTHY" });
  });

  it("is at risk for an account with everything going wrong", () => {
    const r = scoreAccount({ slaBreaches90: 4, openCritical: 2, openHigh: 0, absencePct: 20, maxDaysOverdue: 90, daysToContractEnd: 10, renewalInProgress: false, daysSinceClientContact: 120 });
    expect(r.components.map((c) => c.subScore)).toEqual([0, 20, 0, 0, 11, 0]);
    expect(r).toMatchObject({ score: 4, band: "AT_RISK" }); // (15 x 20 + 10 x 11) / 100 = 4.1
  });

  it("leaves out a component with no data and scales the other weights to fill its place, so a missing feed changes nothing by itself", () => {
    const r = scoreAccount({ ...fine, absencePct: null });
    expect(r.score).toBe(100);
    expect(part(r, "GUARD_ABSENCE")).toMatchObject({ subScore: null, weight: 20 });
    expect(part(r, "GUARD_ABSENCE").detail).toMatch(/no attendance/i);
    // the same account with 60 days overdue: 20 points of 80 present weight are lost, 25 of 100
    expect(scoreAccount({ ...fine, absencePct: null, maxDaysOverdue: 60 }).score).toBe(75);
  });

  it("rounds a half up, and honours changed weights", () => {
    const i: HealthInputs = { ...fine, slaBreaches90: 2, daysSinceClientContact: 5 }; // only the SLA component is 50
    expect(scoreAccount(i, { SLA_BREACHES: 1, OPEN_SEVERE_CASES: 99, GUARD_ABSENCE: 0, INVOICES_OVERDUE: 0, CONTRACT_END: 0, CLIENT_CONTACT: 0 }).score).toBe(100); // (50 + 9,900) / 100 = 99.5, up
    expect(scoreAccount(i, { SLA_BREACHES: 100, OPEN_SEVERE_CASES: 0, GUARD_ABSENCE: 0, INVOICES_OVERDUE: 0, CONTRACT_END: 0, CLIENT_CONTACT: 0 }).score).toBe(50);
  });

  it("says in plain words what each component found", () => {
    const r = scoreAccount({ ...fine, slaBreaches90: 2, openCritical: 1, openHigh: 1, absencePct: 12.5, maxDaysOverdue: 14, daysToContractEnd: 30, renewalInProgress: true, daysSinceClientContact: 40 });
    expect(r.components.map((c) => c.detail)).toEqual([
      "2 missed deadline(s) in the last 90 days",
      "1 critical and 1 high case(s) open",
      "12.5% of expected guard days were absences in the last 30 days",
      "The oldest unpaid invoice is 14 day(s) past due",
      "A contract ends in 30 day(s); a renewal is in progress",
      "40 day(s) since the last call, meeting, visit or message",
    ]);
  });
});
