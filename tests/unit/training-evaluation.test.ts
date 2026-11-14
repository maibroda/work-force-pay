import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { COMMENT_MAX, checkRating, managerEvaluationDue, requestStatusAfter, requesterConflict, summariseRatings, TRAINING_REQUEST_STATUS_LABELS, type TrainingRequestStatus, EFFECTIVENESS_LABELS, EFFECTIVENESS_OUTCOMES, checkOptionalRating, effectivenessDue, effectivenessRefusal, skillEvidence, summariseEffectiveness } from "@/lib/training-evaluation";

describe("a rating", () => {
  it("is a whole number from 1 to 5", () => {
    for (const ok of [1, 2, 3, 4, 5]) expect(checkRating(ok)).toBeNull();
    for (const bad of [0, 6, -1, 2.5, Number.NaN]) expect(checkRating(bad), String(bad)).toMatch(/1 to 5/);
  });
  it("allows a comment of up to 300 characters", () => {
    expect(COMMENT_MAX).toBe(300);
  });
});

describe("when the manager is asked", () => {
  it("is once the company's number of days has passed since the session, and never when the company sets 0", () => {
    expect(managerEvaluationDue("2026-11-01", "2026-12-30", 60)).toBe(false);
    expect(managerEvaluationDue("2026-11-01", "2026-12-31", 60)).toBe(true);
    expect(managerEvaluationDue("2020-01-01", "2026-12-31", 0)).toBe(false);
  });
});

describe("results without picking a person out", () => {
  it("shows nothing for no answers, and hides a count and an average below five answers", () => {
    expect(summariseRatings([])).toEqual({ shown: false, count: 0, average: null });
    for (const n of [1, 2, 3, 4]) expect(summariseRatings(Array(n).fill(5)), String(n)).toEqual({ shown: false, count: null, average: null });
  });
  it("shows the count and the average to one decimal from five answers, rounding half up", () => {
    expect(summariseRatings([5, 5, 5, 5, 5])).toEqual({ shown: true, count: 5, average: 5 });
    expect(summariseRatings([4, 4, 4, 4, 5])).toEqual({ shown: true, count: 5, average: 4.2 });
    expect(summariseRatings([3, 3, 3, 3, 4, 4, 4, 4])).toEqual({ shown: true, count: 8, average: 3.5 });
    expect(summariseRatings([4, 4, 4, 4, 4, 4, 4, 5])).toEqual({ shown: true, count: 8, average: 4.1 });
    // 51 over 12 answers is exactly 4.25, which rounds half up to 4.3
    expect(summariseRatings([4, 4, 4, 4, 5, 5, 4, 4, 4, 4, 4, 5])).toEqual({ shown: true, count: 12, average: 4.3 });
  });
});

describe("the life of a training request", () => {
  it("has a plain label for every status", () => {
    expect((Object.keys(TRAINING_REQUEST_STATUS_LABELS) as TrainingRequestStatus[]).sort()).toEqual(["ACCEPTED", "DECLINED", "REQUESTED", "WITHDRAWN"]);
  });
  it("an undecided request can be accepted, declined or withdrawn; everything else is final", () => {
    expect(requestStatusAfter("REQUESTED", "ACCEPT")).toBe("ACCEPTED");
    expect(requestStatusAfter("REQUESTED", "DECLINE")).toBe("DECLINED");
    expect(requestStatusAfter("REQUESTED", "WITHDRAW")).toBe("WITHDRAWN");
    for (const s of ["ACCEPTED", "DECLINED", "WITHDRAWN"] as const) for (const a of ["ACCEPT", "DECLINE", "WITHDRAW"] as const) expect(requestStatusAfter(s, a), `${s} ${a}`).toBeNull();
  });
  it("the person who requested it never decides it", () => {
    expect(requesterConflict("u1", "u1")).toMatch(/someone else/i);
    expect(requesterConflict("u2", "u1")).toBeNull();
  });
});

describe("who holds the training request permission", () => {
  const holders = (p: Parameters<(typeof ROLE_PERMISSIONS)[Role]["includes"]>[0]) => (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(p));
  it("is HR and managers, never the employee, the auditor or finance", () => {
    const h = holders("training.request");
    for (const r of ["HR_ADMIN", "SUPERVISOR", "OPERATIONS"] as const) expect(h).toContain(r);
    for (const r of ["EMPLOYEE", "AUDITOR", "FINANCE"] as const) expect(h).not.toContain(r);
  });
});

// ───────────────────────────── Stage 1 (more questions) and stage 3 (effectiveness): training evaluation in three stages ─────────────────────────────

describe("an optional rating (content, facilitator, delivery)", () => {
  it("may be left out, and when given is a whole number from 1 to 5", () => {
    expect(checkOptionalRating(undefined)).toBeNull();
    expect(checkOptionalRating(null)).toBeNull();
    expect(checkOptionalRating(1)).toBeNull();
    expect(checkOptionalRating(5)).toBeNull();
    expect(checkOptionalRating(0)).not.toBeNull();
    expect(checkOptionalRating(6)).not.toBeNull();
    expect(checkOptionalRating(3.5)).not.toBeNull();
    expect(checkOptionalRating(Number.NaN)).not.toBeNull();
  });
});

describe("the four effectiveness outcomes", () => {
  it("are clearly improved, somewhat improved, no visible change and not yet visible, each with a plain label", () => {
    expect([...EFFECTIVENESS_OUTCOMES]).toEqual(["CLEARLY_IMPROVED", "SOMEWHAT_IMPROVED", "NO_VISIBLE_CHANGE", "NOT_YET_VISIBLE"]);
    expect(EFFECTIVENESS_LABELS).toEqual({ CLEARLY_IMPROVED: "Clearly improved", SOMEWHAT_IMPROVED: "Somewhat improved", NO_VISIBLE_CHANGE: "No visible change", NOT_YET_VISIBLE: "Not yet visible" });
  });
});

describe("when the effectiveness question is due", () => {
  it("is asked the company's number of days after the session (120 by default), never when the setting is 0", () => {
    expect(effectivenessDue("2026-01-01", "2026-05-01", 120)).toBe(true); // exactly 120 days later
    expect(effectivenessDue("2026-01-01", "2026-04-30", 120)).toBe(false); // 119 days
    expect(effectivenessDue("2026-01-01", "2030-01-01", 0)).toBe(false);
    expect(effectivenessDue("2026-01-01", "2026-04-01", 90)).toBe(true);
  });
});

describe("the effectiveness question is refused, in this order, when it should not be asked", () => {
  const ok = { attended: true, flagged: true, days: 120, sessionDay: "2026-01-01", today: "2026-06-01", alreadyAnswered: false };
  it("goes ahead for an attended course of a flagged programme, once the days have passed, once", () => {
    expect(effectivenessRefusal(ok)).toBeNull();
  });
  it("needs the course to have been attended", () => {
    expect(effectivenessRefusal({ ...ok, attended: false })).toMatch(/attended/i);
  });
  it("needs the programme to be marked for effectiveness evaluation", () => {
    expect(effectivenessRefusal({ ...ok, flagged: false })).toMatch(/not marked|evaluate/i);
  });
  it("is switched off by a setting of 0", () => {
    expect(effectivenessRefusal({ ...ok, days: 0 })).toMatch(/switched off/i);
  });
  it("is not asked before the days have passed, and says how many", () => {
    expect(effectivenessRefusal({ ...ok, today: "2026-03-01" })).toMatch(/120 days/);
  });
  it("is asked only once", () => {
    expect(effectivenessRefusal({ ...ok, alreadyAnswered: true })).toMatch(/already/i);
  });
});

describe("the spread of effectiveness answers", () => {
  const spread = (xs: Array<(typeof EFFECTIVENESS_OUTCOMES)[number]>) => summariseEffectiveness(xs);
  it("shows nothing below five answers, not even a count, and says nothing was given when there are none", () => {
    expect(spread([])).toEqual({ shown: false, count: 0, counts: null, judged: null });
    for (let n = 1; n <= 4; n++) expect(spread(Array(n).fill("CLEARLY_IMPROVED"))).toEqual({ shown: false, count: null, counts: null, judged: null });
  });
  it("from five answers counts each choice, with the four choices always present", () => {
    const r = spread(["CLEARLY_IMPROVED", "CLEARLY_IMPROVED", "SOMEWHAT_IMPROVED", "NO_VISIBLE_CHANGE", "NO_VISIBLE_CHANGE"]);
    expect(r).toEqual({ shown: true, count: 5, counts: { CLEARLY_IMPROVED: 2, SOMEWHAT_IMPROVED: 1, NO_VISIBLE_CHANGE: 2, NOT_YET_VISIBLE: 0 }, judged: 5 });
  });
  it("counts 'not yet visible' apart: it is in the total, never in the number judged, and never an improvement or a failure", () => {
    const r = spread(["NOT_YET_VISIBLE", "NOT_YET_VISIBLE", "NOT_YET_VISIBLE", "CLEARLY_IMPROVED", "NO_VISIBLE_CHANGE"]);
    expect(r).toMatchObject({ shown: true, count: 5, judged: 2 });
    expect(r.counts).toEqual({ CLEARLY_IMPROVED: 1, SOMEWHAT_IMPROVED: 0, NO_VISIBLE_CHANGE: 1, NOT_YET_VISIBLE: 3 });
  });
  it("counts the answers that are all 'not yet visible' as five answers (so the minimum is about how many answered, not how many judged)", () => {
    expect(spread(Array(5).fill("NOT_YET_VISIBLE"))).toMatchObject({ shown: true, count: 5, judged: 0 });
  });
});

describe("the skill evidence beside an effectiveness answer", () => {
  const a = (skillId: string, skillName: string, level: number, assessedOn: string) => ({ skillId, skillName, level, assessedOn });
  it("shows, for each skill the course builds, the latest assessment on or before the session and the latest after it, and 'not assessed' as nothing", () => {
    const rows = skillEvidence(
      [a("s1", "First aid", 2, "2025-06-01"), a("s1", "First aid", 3, "2026-01-01"), a("s1", "First aid", 4, "2026-05-01"), a("s1", "First aid", 5, "2026-06-01")],
      [{ id: "s1", name: "First aid" }],
      "2026-01-01",
    );
    expect(rows).toEqual([{ skillId: "s1", skillName: "First aid", before: { level: 3, on: "2026-01-01" }, after: { level: 5, on: "2026-06-01" } }]);
  });
  it("shows a skill nobody assessed as not assessed on both sides, and a skill assessed on one side only as the other side not assessed", () => {
    const rows = skillEvidence([a("s2", "Radio", 3, "2026-05-01")], [{ id: "s1", name: "First aid" }, { id: "s2", name: "Radio" }], "2026-01-01");
    expect(rows).toEqual([
      { skillId: "s1", skillName: "First aid", before: null, after: null },
      { skillId: "s2", skillName: "Radio", before: null, after: { level: 3, on: "2026-05-01" } },
    ]);
  });
  it("lists the skills by name and ignores an assessment of a skill the course does not build", () => {
    const rows = skillEvidence([a("s9", "Other", 5, "2026-05-01")], [{ id: "s2", name: "Radio" }, { id: "s1", name: "First aid" }], "2026-01-01");
    expect(rows.map((r) => r.skillName)).toEqual(["First aid", "Radio"]);
    expect(rows.every((r) => r.before === null && r.after === null)).toBe(true);
  });
  it("never changes a level: it only reads what was assessed", () => {
    const input = [a("s1", "First aid", 3, "2026-01-01")];
    const copy = JSON.parse(JSON.stringify(input));
    skillEvidence(input, [{ id: "s1", name: "First aid" }], "2026-01-01");
    expect(input).toEqual(copy);
  });
});
