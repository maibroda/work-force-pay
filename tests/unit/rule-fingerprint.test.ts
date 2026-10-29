import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprintOf, type Master } from "@/server/services/rule-library";

/**
 * The fingerprint is how "this PAYE rule was signed by HR and Finance" is recognised (rule 3). Adding the PAYE filing dates to a rule must NOT change the
 * fingerprint of any rule that has none, or every rule already signed would suddenly count as unverified and block payroll.
 */
const dec = (n: number) => ({ toString: () => String(n), valueOf: () => n, toNumber: () => n }) as never;

function taxRow(over: Record<string, unknown> = {}) {
  return {
    id: "r1", organizationId: "o", code: "NG-PAYE", name: "PAYE", version: "2026.1", legalBasis: null, active: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, createdAt: new Date(),
    payeDueDay: null, annualReturnMonth: null, annualReturnDay: null, latePenaltyPct: null,
    bands: [
      { id: "b1", taxRuleId: "r1", sortOrder: 1, lowerBound: dec(0), upperBound: dec(800000), rate: dec(0) },
      { id: "b2", taxRuleId: "r1", sortOrder: 2, lowerBound: dec(800000), upperBound: null, rate: dec(15) },
    ],
    reliefs: [{ id: "x1", taxRuleId: "r1", code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", rate: null, amount: null, cap: null, active: true }],
    exemptions: [{ id: "e1", taxRuleId: "r1", code: "MIN", description: "Minimum wage", annualGrossCeiling: dec(840000), active: true }],
    ...over,
  };
}
const master = (over: Record<string, unknown> = {}) => ({ kind: "TAX", row: taxRow(over) }) as unknown as Master;

/** The fingerprint exactly as it was computed before the filing dates existed. */
function fingerprintBeforeFilingDates() {
  const body = {
    code: "NG-PAYE", name: "PAYE", version: "2026.1", from: "2026-01-01",
    bands: [[1, 0, 800000, 0], [2, 800000, null, 15]],
    reliefs: [["PENSION", "Pension", "EMPLOYEE_PENSION", null, null, null, true]],
    exemptions: [["MIN", "Minimum wage", 840000, true]],
  };
  return createHash("sha256").update(JSON.stringify(["TAX", body])).digest("hex");
}

describe("the rule fingerprint and the PAYE filing dates", () => {
  it("is unchanged for a rule with no filing dates, so rules signed before they existed stay verified", () => {
    expect(fingerprintOf(master())).toBe(fingerprintBeforeFilingDates());
  });

  it("changes when any filing date or the penalty is set, so the dates are part of what is signed", () => {
    const plain = fingerprintOf(master());
    const withDay = fingerprintOf(master({ payeDueDay: 10 }));
    expect(withDay).not.toBe(plain);
    expect(fingerprintOf(master({ payeDueDay: 11 }))).not.toBe(withDay);
    expect(fingerprintOf(master({ payeDueDay: 10, latePenaltyPct: dec(10) }))).not.toBe(withDay);
    expect(fingerprintOf(master({ annualReturnMonth: 1, annualReturnDay: 31 }))).not.toBe(plain);
  });

  it("is the same for the same dates however often it is computed, and ignores when the rule ends", () => {
    const a = fingerprintOf(master({ payeDueDay: 10, latePenaltyPct: dec(10) }));
    expect(fingerprintOf(master({ payeDueDay: 10, latePenaltyPct: dec(10) }))).toBe(a);
    expect(fingerprintOf(master({ payeDueDay: 10, latePenaltyPct: dec(10), effectiveTo: new Date("2026-12-31T00:00:00Z") }))).toBe(a);
  });
});
