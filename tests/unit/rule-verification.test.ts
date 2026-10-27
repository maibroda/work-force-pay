import { describe, expect, it } from "vitest";
import { assessRules, REQUIRED_RULE_KINDS, type InForceRule, type ReleaseFact, type RuleKind } from "@/lib/rule-verification";

/**
 * Which of the statutory rules a payroll is about to use have been verified by HR and by Finance. A rule is verified when its CONTENT (its fingerprint)
 * is the content HR and Finance both signed, in a release that has not been withdrawn. How the rule got into the client's tables does not matter.
 */
const at = new Date("2026-10-20T09:00:00Z");
const sign = (slot: "HR" | "FINANCE", name: string, checksum: string) => ({ slot, name, at, checksum });
const rule = (kind: RuleKind, fp: string, version = "2026.1"): InForceRule => ({ kind, label: `${kind} v${version}`, version, fingerprint: fp });
const release = (kind: RuleKind, checksum: string, status: ReleaseFact["status"], signatures: ReleaseFact["signatures"], version = "2026.1"): ReleaseFact => ({ kind, version, checksum, status, signatures });
const both = (checksum: string) => [sign("HR", "Hauwa HR", checksum), sign("FINANCE", "Femi Finance", checksum)];

const inForce = { TAX: rule("TAX", "t1"), PENSION: rule("PENSION", "p1"), EMPLOYER_COST: rule("EMPLOYER_COST", "e1") };
const allVerified = [release("TAX", "t1", "PUBLISHED", both("t1")), release("PENSION", "p1", "PUBLISHED", both("p1")), release("EMPLOYER_COST", "e1", "VERIFIED", both("e1"))];
const verdict = (kind: RuleKind, v: ReturnType<typeof assessRules>) => v.find((x) => x.kind === kind)!;

describe("the required statutory rules", () => {
  it("are PAYE, pension and employer contributions, in that order", () => {
    expect(REQUIRED_RULE_KINDS).toEqual(["TAX", "PENSION", "EMPLOYER_COST"]);
  });
});

describe("a rule is verified when HR and Finance signed exactly this content", () => {
  it("all three verified: published or verified-but-not-yet-published both count, and who signed is reported", () => {
    const v = assessRules(inForce, allVerified);
    expect(v.map((x) => x.verified)).toEqual([true, true, true]);
    expect(verdict("TAX", v).signedBy.map((s) => [s.slot, s.name])).toEqual([["HR", "Hauwa HR"], ["FINANCE", "Femi Finance"]]);
    expect(verdict("TAX", v).reason).toMatch(/Verified by HR \(Hauwa HR\) and Finance \(Femi Finance\)/);
  });
  it("does not depend on a publication record: a client that took the rule by copy is verified all the same", () => {
    expect(assessRules(inForce, allVerified).every((x) => x.verified)).toBe(true);
  });
  it("picks the right release when the bureau has several versions of the same kind", () => {
    const v = assessRules(
      { ...inForce, TAX: rule("TAX", "t2", "2026.2") },
      [release("TAX", "t1", "PUBLISHED", both("t1")), release("TAX", "t2", "PUBLISHED", both("t2"), "2026.2"), ...allVerified.slice(1)],
    );
    expect(verdict("TAX", v).verified).toBe(true);
  });
});

describe("a rule is NOT verified, and the reason says why", () => {
  it("never put through verification (no release at all)", () => {
    const v = assessRules(inForce, allVerified.slice(1));
    expect(verdict("TAX", v)).toMatchObject({ verified: false, signedBy: [] });
    expect(verdict("TAX", v).reason).toMatch(/never put through verification/i);
  });
  it("proposed with one signature: waiting for the other, and says how many are in", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "PROPOSED", [sign("HR", "Hauwa HR", "t1")]), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).verified).toBe(false);
    expect(verdict("TAX", v).reason).toMatch(/waiting for HR and Finance \(1 of 2 signed\)/i);
  });
  it("proposed with no signatures", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "PROPOSED", []), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).reason).toMatch(/0 of 2 signed/);
  });
  it("withdrawn, even if both had signed before", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "WITHDRAWN", both("t1")), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).verified).toBe(false);
    expect(verdict("TAX", v).reason).toMatch(/withdrawn/i);
  });
  it("changed since it was verified: the rule held has different content from what was signed", () => {
    const v = assessRules({ ...inForce, TAX: rule("TAX", "t1-edited") }, allVerified);
    expect(verdict("TAX", v).verified).toBe(false);
    expect(verdict("TAX", v).reason).toMatch(/changed since it was verified/i);
  });
  it("a signature that is for different content does not count, even on a verified release", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "PUBLISHED", [sign("HR", "Hauwa HR", "t1"), sign("FINANCE", "Femi Finance", "OLD")]), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).verified).toBe(false);
  });
  it("a release marked verified with only one slot signed is not enough", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "VERIFIED", [sign("HR", "Hauwa HR", "t1"), sign("HR", "Another HR", "t1")]), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).verified).toBe(false);
    expect(verdict("TAX", v).reason).toMatch(/both HR and Finance/i);
  });
  it("a release for another kind with the same content does not verify this one", () => {
    const v = assessRules(inForce, [release("PENSION", "t1", "PUBLISHED", both("t1")), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).verified).toBe(false);
  });
  it("no rule in force at all on the date", () => {
    const v = assessRules({ TAX: inForce.TAX, PENSION: inForce.PENSION }, allVerified);
    expect(verdict("EMPLOYER_COST", v)).toMatchObject({ verified: false });
    expect(verdict("EMPLOYER_COST", v).reason).toMatch(/no employer contribution rule in force/i);
  });
  it("a baseline rule (in force, never released) is unverified", () => {
    const v = assessRules(inForce, []);
    expect(v.map((x) => x.verified)).toEqual([false, false, false]);
  });
});

describe("when more than one release matches, the best one decides", () => {
  it("a withdrawn release and a verified one for the same content: verified wins", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "WITHDRAWN", both("t1")), release("TAX", "t1", "PUBLISHED", both("t1")), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).verified).toBe(true);
  });
  it("a proposed release and a withdrawn one: the reason is the proposed one's (it can still be completed)", () => {
    const v = assessRules(inForce, [release("TAX", "t1", "WITHDRAWN", []), release("TAX", "t1", "PROPOSED", [sign("HR", "Hauwa HR", "t1")]), ...allVerified.slice(1)]);
    expect(verdict("TAX", v).reason).toMatch(/1 of 2 signed/);
  });
});
