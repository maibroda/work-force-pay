import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { COMMENT_MAX, SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS, checkLevel, currentLevel, gapOf, isStale, pathSkills, summariseGaps } from "@/lib/skills";

describe("a skill level", () => {
  it("is a whole number from 1 to 4, with a plain label each", () => {
    for (const ok of [1, 2, 3, 4]) expect(checkLevel(ok)).toBeNull();
    for (const bad of [0, 5, -1, 2.5, Number.NaN]) expect(checkLevel(bad), String(bad)).toMatch(/1 to 4/);
    expect(SKILL_LEVEL_LABELS).toEqual({ 1: "Basic", 2: "Developing", 3: "Proficient", 4: "Advanced" });
    // the founder's definitions of 2026-11-10
    expect(SKILL_LEVEL_DESCRIPTIONS[1]).toMatch(/requires supervision/);
    expect(SKILL_LEVEL_DESCRIPTIONS[2]).toMatch(/limited supervision/);
    expect(SKILL_LEVEL_DESCRIPTIONS[3]).toMatch(/Independently/);
    expect(SKILL_LEVEL_DESCRIPTIONS[4]).toMatch(/coach or guide/);
    expect(COMMENT_MAX).toBe(300);
  });
});

describe("the current level of a skill", () => {
  it("is the latest assessment, by the day assessed and then by when it was recorded", () => {
    expect(currentLevel([])).toBeNull();
    expect(currentLevel([{ level: 2, assessedOn: "2026-01-10", recordedAt: 1 }, { level: 3, assessedOn: "2026-06-10", recordedAt: 2 }])).toBe(3);
    // a later correction on the same day wins
    expect(currentLevel([{ level: 2, assessedOn: "2026-06-10", recordedAt: 1 }, { level: 1, assessedOn: "2026-06-10", recordedAt: 2 }])).toBe(1);
    // the order the rows arrive in does not matter
    expect(currentLevel([{ level: 3, assessedOn: "2026-06-10", recordedAt: 2 }, { level: 2, assessedOn: "2026-01-10", recordedAt: 1 }])).toBe(3);
  });
});

describe("a gap", () => {
  it("is Not assessed when nobody has assessed it, which is never read as a gap", () => {
    expect(gapOf(3, null)).toEqual({ status: "NOT_ASSESSED", gap: 0 });
  });
  it("is Met at or above the required level and Below under it, with the difference", () => {
    expect(gapOf(3, 3)).toEqual({ status: "MET", gap: 0 });
    expect(gapOf(3, 4)).toEqual({ status: "MET", gap: 0 });
    expect(gapOf(3, 2)).toEqual({ status: "BELOW", gap: 1 });
    expect(gapOf(4, 1)).toEqual({ status: "BELOW", gap: 3 });
  });
});

describe("counting a role's skill across its people", () => {
  it("counts at or above, below and not assessed apart", () => {
    expect(summariseGaps([null, 1, 2, 3, 4, null], 3)).toEqual({ met: 2, below: 2, notAssessed: 2, total: 6 });
    expect(summariseGaps([], 2)).toEqual({ met: 0, below: 0, notAssessed: 0, total: 0 });
  });
});

describe("the learning path to a role", () => {
  const target = [
    { skillId: "a", name: "Shift supervision", requiredLevel: 3, courses: ["Supervisory skills"] },
    { skillId: "b", name: "Report writing", requiredLevel: 2, courses: [] },
    { skillId: "c", name: "First aid response", requiredLevel: 2, courses: ["First Aid"] },
  ];
  it("lists the skills the person is below and the ones not yet assessed, never the ones they meet", () => {
    const p = pathSkills(target, new Map([["a", 2], ["c", 3]]));
    expect(p.map((x) => [x.skillId, x.status, x.current, x.gap])).toEqual([
      ["a", "BELOW", 2, 1],
      ["b", "NOT_ASSESSED", null, 0],
    ]);
    expect(p[0].courses).toEqual(["Supervisory skills"]);
  });
  it("is empty when every skill is met", () => {
    expect(pathSkills(target, new Map([["a", 3], ["b", 4], ["c", 2]]))).toEqual([]);
  });
});

describe("a stale assessment", () => {
  it("is one older than the company's number of days, and none is stale when the company sets 0", () => {
    expect(isStale("2025-11-09", "2026-11-10", 365)).toBe(true);
    expect(isStale("2025-11-10", "2026-11-10", 365)).toBe(false);
    expect(isStale("2020-01-01", "2026-11-10", 0)).toBe(false);
  });
});

describe("who holds the skills permission", () => {
  const holders = (p: Parameters<(typeof ROLE_PERMISSIONS)[Role]["includes"]>[0]) => (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(p));
  it("is HR and managers, never the employee, the auditor or finance", () => {
    const h = holders("skills.assess");
    for (const r of ["HR_ADMIN", "SUPERVISOR", "OPERATIONS"] as const) expect(h).toContain(r);
    for (const r of ["EMPLOYEE", "AUDITOR", "FINANCE"] as const) expect(h).not.toContain(r);
  });
});
