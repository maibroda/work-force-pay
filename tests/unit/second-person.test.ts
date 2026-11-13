import { describe, expect, it } from "vitest";
import { SINGLE_HOLDER_REASON_MIN, checkSingleHolderReason, secondPerson } from "@/lib/second-person";

// Governance step 2b (docs/plans/hr-governance-step2-plan.md): the person who did the work does not also sign it off. Where nobody else could (the actor is the only holder of the
// right), they may, with a written reason, and the record is flagged. Pure rules: who counts as a holder is worked out by the service from the database.

const did = { did: "resolved this case", does: "closes it" };

describe("a different person signs it off", () => {
  it("is allowed, unflagged, with no reason needed, whoever else holds the right", () => {
    expect(secondPerson({ samePerson: false, otherHolders: 0, reason: undefined, ...did })).toEqual({ ok: true, singleHolder: false });
    expect(secondPerson({ samePerson: false, otherHolders: 5, reason: "", ...did })).toEqual({ ok: true, singleHolder: false });
  });
});

describe("the same person", () => {
  it("is refused while another holder of the right exists, however good the reason", () => {
    const r = secondPerson({ samePerson: true, otherHolders: 1, reason: "x".repeat(200), ...did });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/resolved this case.*different person.*closes it/i);
  });
  it("may only where they are the only holder, and then with a written reason of at least 20 characters, and the record is flagged", () => {
    expect(SINGLE_HOLDER_REASON_MIN).toBe(20);
    const none = secondPerson({ samePerson: true, otherHolders: 0, reason: undefined, ...did });
    expect(none).toMatchObject({ ok: false });
    expect((none as { error: string }).error).toMatch(/only person|20 characters/i);
    expect(secondPerson({ samePerson: true, otherHolders: 0, reason: "too short", ...did })).toMatchObject({ ok: false });
    expect(secondPerson({ samePerson: true, otherHolders: 0, reason: "   " + "x".repeat(19) + "   ", ...did })).toMatchObject({ ok: false }); // spaces do not count
    expect(secondPerson({ samePerson: true, otherHolders: 0, reason: "The only HR administrator in the company.", ...did })).toEqual({ ok: true, singleHolder: true });
  });
});

describe("the reason", () => {
  it("is checked on its own as well", () => {
    expect(checkSingleHolderReason("short")).not.toBeNull();
    expect(checkSingleHolderReason("x".repeat(20))).toBeNull();
    expect(checkSingleHolderReason(null)).not.toBeNull();
  });
});
