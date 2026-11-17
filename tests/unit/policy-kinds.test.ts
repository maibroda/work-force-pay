import { describe, expect, it } from "vitest";
import { ACK_LABELS, POLICY_KINDS, POLICY_KIND_LABELS, ackState, ackStateFor, matchesQuery } from "@/lib/policies";

// Handbook and procedures (slice 4B): the pure rules. A policy created the old way is unchanged; an item that needs no acknowledgement is simply "not required".

const due = new Date("2026-03-01T00:00:00Z");
const before = new Date("2026-02-01T00:00:00Z");
const after = new Date("2026-04-01T00:00:00Z");

describe("the state of an item for an employee", () => {
  it("is exactly the old rule when acknowledgement is required", () => {
    for (const ack of [true, false]) for (const today of [before, due, after]) expect(ackStateFor(true, ack, due, today)).toBe(ackState(ack, due, today));
    expect(ackStateFor(true, false, due, after)).toBe("OVERDUE");
    expect(ackStateFor(true, true, due, after)).toBe("ACKNOWLEDGED");
  });
  it("is 'not required' when it needs no acknowledgement, whatever the date and whether or not it was read", () => {
    for (const ack of [true, false]) for (const today of [before, due, after]) expect(ackStateFor(false, ack, due, today)).toBe("NOT_REQUIRED");
  });
  it("has a plain label for every state, including the new one", () => {
    expect(ACK_LABELS.NOT_REQUIRED).toMatch(/no acknowledgement/i);
    expect(Object.keys(ACK_LABELS).sort()).toEqual(["ACKNOWLEDGED", "NOT_REQUIRED", "OVERDUE", "PENDING"]);
  });
});

describe("the kinds", () => {
  it("are policy, handbook and procedure, each with a plain label", () => {
    expect([...POLICY_KINDS]).toEqual(["POLICY", "HANDBOOK", "SOP"]);
    expect(POLICY_KIND_LABELS).toEqual({ POLICY: "Policy", HANDBOOK: "Handbook", SOP: "Procedure (SOP)" });
  });
});

describe("searching by title", () => {
  const items = [
    { title: "Staff handbook", summary: "Everything about working here" },
    { title: "Cash handling", summary: "Counting and banking" },
    { title: "Opening the site", summary: null },
  ];
  it("matches the title or the summary, ignoring case and spaces at the ends, and everything when empty", () => {
    expect(items.filter((i) => matchesQuery(i, "CASH")).map((i) => i.title)).toEqual(["Cash handling"]);
    expect(items.filter((i) => matchesQuery(i, "  banking ")).map((i) => i.title)).toEqual(["Cash handling"]);
    expect(items.filter((i) => matchesQuery(i, "working")).map((i) => i.title)).toEqual(["Staff handbook"]);
    expect(items.filter((i) => matchesQuery(i, "")).length).toBe(3);
    expect(items.filter((i) => matchesQuery(i, undefined)).length).toBe(3);
    expect(items.filter((i) => matchesQuery(i, "zzz")).length).toBe(0);
  });
  it("does not treat the search as a pattern", () => {
    expect(items.filter((i) => matchesQuery(i, ".*")).length).toBe(0);
  });
});
