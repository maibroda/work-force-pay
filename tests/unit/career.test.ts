import { describe, expect, it } from "vitest";
import { MAX_SUCCESSORS, PROMOTION_STATUS_LABELS, applyOverdue, monthsBetween, promotionStatusAfter, proposalWarnings, proposerConflict, readyNow, READINESS_LEVELS, type PromotionStatus } from "@/lib/career";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";

describe("whole months in a role", () => {
  it("counts only completed months", () => {
    expect(monthsBetween("2024-01-15", "2026-01-15")).toBe(24);
    expect(monthsBetween("2024-01-15", "2026-01-14")).toBe(23);
    // a start on the 31st completes its month on the last day of a shorter month
    expect(monthsBetween("2024-01-31", "2024-02-29")).toBe(1);
    expect(monthsBetween("2024-01-31", "2024-02-28")).toBe(0);
    expect(monthsBetween("2024-01-31", "2024-03-31")).toBe(2);
  });
  it("is never negative", () => {
    expect(monthsBetween("2026-05-01", "2026-01-01")).toBe(0);
  });
});

describe("the life of a promotion proposal", () => {
  const all = Object.keys(PROMOTION_STATUS_LABELS) as PromotionStatus[];
  it("has a plain label for every status", () => {
    expect(all.sort()).toEqual(["APPLIED", "APPROVED", "DECLINED", "PROPOSED", "WITHDRAWN"]);
  });
  it("an undecided proposal can be approved, declined or withdrawn, and cannot be applied", () => {
    expect(promotionStatusAfter("PROPOSED", "APPROVE")).toBe("APPROVED");
    expect(promotionStatusAfter("PROPOSED", "DECLINE")).toBe("DECLINED");
    expect(promotionStatusAfter("PROPOSED", "WITHDRAW")).toBe("WITHDRAWN");
    expect(promotionStatusAfter("PROPOSED", "APPLY")).toBeNull();
  });
  it("an approved proposal can be applied or withdrawn, and cannot be decided again", () => {
    expect(promotionStatusAfter("APPROVED", "APPLY")).toBe("APPLIED");
    expect(promotionStatusAfter("APPROVED", "WITHDRAW")).toBe("WITHDRAWN");
    expect(promotionStatusAfter("APPROVED", "APPROVE")).toBeNull();
    expect(promotionStatusAfter("APPROVED", "DECLINE")).toBeNull();
  });
  it("declined, withdrawn and applied are final", () => {
    for (const s of ["DECLINED", "WITHDRAWN", "APPLIED"] as const)
      for (const a of ["APPROVE", "DECLINE", "WITHDRAW", "APPLY"] as const) expect(promotionStatusAfter(s, a), `${s} ${a}`).toBeNull();
  });
});

describe("who decides", () => {
  it("never the person who proposed it", () => {
    expect(proposerConflict("u1", "u1")).toMatch(/someone else/i);
    expect(proposerConflict("u2", "u1")).toBeNull();
  });
});

describe("warnings on a proposal (guidance, never a block)", () => {
  const ok = { pathExists: true, minMonths: 24, monthsInRole: 31, courseRequired: "Supervisory skills", courseValid: true, openPlan: false, openDiscipline: false };
  it("has none when everything the company asked for is met", () => {
    expect(proposalWarnings(ok)).toEqual([]);
  });
  it("says so when no career path is set for the move", () => {
    expect(proposalWarnings({ ...ok, pathExists: false })).toEqual(["NO_PATH"]);
  });
  it("says so when the time in the role is short, and not when exactly met", () => {
    expect(proposalWarnings({ ...ok, monthsInRole: 23 })).toEqual(["BELOW_MIN_SERVICE"]);
    expect(proposalWarnings({ ...ok, monthsInRole: 24 })).toEqual([]);
  });
  it("asks nothing about service or a course the path does not require", () => {
    expect(proposalWarnings({ ...ok, minMonths: null, monthsInRole: 0, courseRequired: null, courseValid: null })).toEqual([]);
  });
  it("says so when a required course is not valid", () => {
    expect(proposalWarnings({ ...ok, courseValid: false })).toEqual(["COURSE_NOT_VALID"]);
  });
  it("says so for an open improvement plan or an open disciplinary case, and lists every warning in a fixed order", () => {
    expect(proposalWarnings({ ...ok, openPlan: true, openDiscipline: true, monthsInRole: 1, courseValid: false })).toEqual(["BELOW_MIN_SERVICE", "COURSE_NOT_VALID", "OPEN_PLAN", "OPEN_DISCIPLINE"]);
  });
});

describe("approved but not yet applied", () => {
  it("is overdue once the company's number of days has passed since the approval", () => {
    expect(applyOverdue("2026-11-01", "2026-11-14", 14)).toBe(false);
    expect(applyOverdue("2026-11-01", "2026-11-15", 14)).toBe(true);
  });
  it("is never overdue when the company sets 0 days", () => {
    expect(applyOverdue("2020-01-01", "2026-11-15", 0)).toBe(false);
  });
});

describe("succession cover", () => {
  it("allows five successors at most and three readiness levels", () => {
    expect(MAX_SUCCESSORS).toBe(5);
    expect([...READINESS_LEVELS]).toEqual(["READY_NOW", "READY_1_2_YEARS", "READY_3_PLUS"]);
  });
  it("a role has cover only when someone is ready now", () => {
    expect(readyNow([])).toBe(false);
    expect(readyNow([{ readiness: "READY_3_PLUS" }, { readiness: "READY_1_2_YEARS" }])).toBe(false);
    expect(readyNow([{ readiness: "READY_3_PLUS" }, { readiness: "READY_NOW" }])).toBe(true);
  });
});

describe("who holds the career permissions", () => {
  const holders = (p: Parameters<(typeof ROLE_PERMISSIONS)[Role]["includes"]>[0]) => (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(p));
  it("succession is the HR administrator's alone (the founder's decision for sensitive lists, as for welfare)", () => {
    expect(holders("succession.manage")).toEqual(["HR_ADMIN"]);
  });
  it("proposing is for HR and for managers, never the employee, the auditor or finance", () => {
    const h = holders("career.propose");
    expect(h).toContain("HR_ADMIN");
    expect(h).toContain("SUPERVISOR");
    for (const r of ["EMPLOYEE", "AUDITOR", "FINANCE"] as const) expect(h).not.toContain(r);
  });
});
