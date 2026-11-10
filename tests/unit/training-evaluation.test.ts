import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { COMMENT_MAX, checkRating, managerEvaluationDue, requestStatusAfter, requesterConflict, summariseRatings, TRAINING_REQUEST_STATUS_LABELS, type TrainingRequestStatus } from "@/lib/training-evaluation";

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
