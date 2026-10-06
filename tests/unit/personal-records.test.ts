import { describe, expect, it } from "vitest";
import { ageOn, assessRecords, benefitShares, guarantorsNeeded, phoneKey, sameId, samePhone } from "@/lib/personal-records";

const policy = { nextOfKinRequired: 1, emergencyContactsRequired: 1, guarantorsRequired: 2, guarantorCategoryIds: [] as string[] };
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("phone and ID matching", () => {
  it("matches the same number written differently", () => {
    expect(phoneKey("+234 803 111 2222")).toBe("8031112222");
    expect(phoneKey("0803-111-2222")).toBe("8031112222");
    expect(samePhone("08031112222", "+2348031112222")).toBe(true);
    expect(samePhone("08031112222", "08031112223")).toBe(false);
  });
  it("never treats blanks or tiny numbers as a match", () => {
    expect(samePhone(null, undefined)).toBe(false);
    expect(samePhone("", "")).toBe(false);
    expect(samePhone("123", "123")).toBe(false);
  });
  it("compares IDs ignoring spaces and case", () => {
    expect(sameId("ab 123 456", "AB123456")).toBe(true);
    expect(sameId("AB123456", "AB123457")).toBe(false);
    expect(sameId(undefined, "AB123456")).toBe(false);
    expect(sameId("12", "12")).toBe(false);
  });
});

describe("ageOn", () => {
  it("counts whole years, not yet reaching the birthday", () => {
    expect(ageOn(utc("2010-06-15"), utc("2026-06-14"))).toBe(15);
    expect(ageOn(utc("2010-06-15"), utc("2026-06-15"))).toBe(16);
    expect(ageOn(utc("2010-12-31"), utc("2026-01-01"))).toBe(15);
  });
});

describe("benefitShares", () => {
  it("totals only beneficiaries, and says when the split is complete or over", () => {
    expect(benefitShares([])).toMatchObject({ count: 0, total: 0, complete: false });
    expect(benefitShares([{ isBeneficiary: true, benefitSharePct: 60 }, { isBeneficiary: true, benefitSharePct: 40 }, { isBeneficiary: false, benefitSharePct: 99 }])).toMatchObject({ count: 2, total: 100, complete: true, over: false });
    expect(benefitShares([{ isBeneficiary: true, benefitSharePct: 60 }])).toMatchObject({ total: 60, complete: false });
    expect(benefitShares([{ isBeneficiary: true, benefitSharePct: 70 }, { isBeneficiary: true, benefitSharePct: 50 }])).toMatchObject({ over: true, complete: false });
  });
});

describe("guarantorsNeeded", () => {
  it("applies to every category when none are chosen, else only the chosen ones", () => {
    expect(guarantorsNeeded(policy, "guard")).toBe(2);
    expect(guarantorsNeeded({ ...policy, guarantorCategoryIds: ["guard"] }, "guard")).toBe(2);
    expect(guarantorsNeeded({ ...policy, guarantorCategoryIds: ["guard"] }, "office")).toBe(0);
    expect(guarantorsNeeded({ ...policy, guarantorsRequired: 0 }, "guard")).toBe(0);
  });
});

describe("assessRecords", () => {
  it("reports what's missing against the policy", () => {
    const none = assessRecords(policy, "guard", [], []);
    expect(none).toMatchObject({ nextOfKinMissing: 1, emergencyMissing: 1, guarantorsNeeded: 2, guarantorsMissing: 2, complete: false });
  });
  it("only verified guarantors count; pending ones are shown but don't satisfy the rule", () => {
    const g = assessRecords(policy, "guard", [{ kind: "NEXT_OF_KIN" }, { kind: "EMERGENCY_CONTACT" }], [{ status: "VERIFIED" }, { status: "PENDING" }, { status: "REJECTED" }]);
    expect(g).toMatchObject({ guarantorsVerified: 1, guarantorsPending: 1, guarantorsMissing: 1, complete: false });
    const done = assessRecords(policy, "guard", [{ kind: "NEXT_OF_KIN" }, { kind: "EMERGENCY_CONTACT" }], [{ status: "VERIFIED" }, { status: "VERIFIED" }]);
    expect(done.complete).toBe(true);
  });
  it("needs nothing when the policy asks for nothing", () => {
    const off = { nextOfKinRequired: 0, emergencyContactsRequired: 0, guarantorsRequired: 0, guarantorCategoryIds: [] as string[] };
    expect(assessRecords(off, "guard", [], []).complete).toBe(true);
  });
  it("counts extra contacts without going negative", () => {
    const g = assessRecords(policy, "guard", [{ kind: "NEXT_OF_KIN" }, { kind: "NEXT_OF_KIN" }, { kind: "DEPENDANT" }], []);
    expect(g.nextOfKinMissing).toBe(0);
    expect(g.emergencyMissing).toBe(1);
  });
});
