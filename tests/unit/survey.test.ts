import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { CODE_LENGTH, MAX_QUESTIONS, MIN_INVITED_FOR_GROUP, MIN_RESPONSES, breakdown, distribution, generateCode, hashCode, normaliseCode, retentionDue, summarise, surveyState } from "@/lib/survey";

describe("an access code", () => {
  it("is long, random, made of unambiguous characters and shown in groups of four", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(normaliseCode(c)).toHaveLength(CODE_LENGTH);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
  });
  it("is read the same however it is typed", () => {
    expect(normaliseCode(" abcd-efgh-jkmn ")).toBe("ABCDEFGHJKMN");
    expect(normaliseCode("abcd efgh jkmn")).toBe("ABCDEFGHJKMN");
    // the characters people confuse: O is 0, I and L are 1
    expect(normaliseCode("O1IL-0000-0000")).toBe("011100000000");
  });
  it("is stored only as a hash, the same for the same code and different for another", () => {
    const h = hashCode("ABCDEFGHJKMN");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode("ABCDEFGHJKMN")).toBe(h);
    expect(hashCode("ABCDEFGHJKMP")).not.toBe(h);
  });
});

describe("the limits of a survey", () => {
  it("allows 15 questions, five answers before anything is shown and ten invited before a group is shown", () => {
    expect(MAX_QUESTIONS).toBe(15);
    expect(MIN_RESPONSES).toBe(5);
    expect(MIN_INVITED_FOR_GROUP).toBe(10);
  });
});

describe("a distribution and its average", () => {
  it("counts each rating", () => {
    expect(distribution([5, 5, 4, 1])).toEqual({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 });
  });
  it("shows nothing below five answers, not even a count", () => {
    expect(summarise([])).toEqual({ shown: false, count: 0, average: null, distribution: null });
    for (const n of [1, 2, 3, 4]) expect(summarise(Array(n).fill(5)), String(n)).toEqual({ shown: false, count: null, average: null, distribution: null });
  });
  it("shows the count, the average to one decimal (half up) and the distribution from five", () => {
    expect(summarise([5, 5, 5, 5, 5])).toEqual({ shown: true, count: 5, average: 5, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 5 } });
    expect(summarise([4, 4, 4, 4, 5]).average).toBe(4.2);
    // 51 over 12 answers is exactly 4.25, which rounds half up to 4.3
    expect(summarise([4, 4, 4, 4, 5, 5, 4, 4, 4, 4, 4, 5]).average).toBe(4.3);
  });
});

describe("a breakdown by group", () => {
  const g = (key: string, invited: number, answers: number) => ({ key, label: key, invited, answers });
  it("shows a group only with at least ten invited and five answers", () => {
    const b = breakdown([g("Guards", 40, 20), g("Supervisors", 12, 6)]);
    expect(b.shown.map((x) => x.key)).toEqual(["Guards", "Supervisors"]);
    expect(b.other).toBeNull();
  });
  it("lets a small group take part but does not show it on its own: it is combined, and the combined row is shown only if it is large enough", () => {
    const b = breakdown([g("Guards", 40, 20), g("Supervisors", 12, 6), g("Office A", 4, 3), g("Office B", 8, 5)]);
    expect(b.shown.map((x) => x.key)).toEqual(["Guards", "Supervisors"]);
    expect(b.other).toEqual({ invited: 12, answers: 8, shown: true });
  });
  it("hides a second group when exactly one would be hidden, so it cannot be worked out by subtraction", () => {
    const b = breakdown([g("Guards", 40, 20), g("Supervisors", 12, 6), g("Office", 4, 3)]);
    // Office is too small; Supervisors (the smallest that could be shown) is hidden too, and the two are combined
    expect(b.shown.map((x) => x.key)).toEqual(["Guards"]);
    expect(b.other).toEqual({ invited: 16, answers: 9, shown: true });
  });
  it("shows nothing for the combined row when it is still too small", () => {
    const b = breakdown([g("Guards", 40, 20), g("Supervisors", 6, 5), g("Office", 3, 2)]);
    expect(b.shown.map((x) => x.key)).toEqual(["Guards"]);
    expect(b.other).toEqual({ invited: 9, answers: 7, shown: false });
  });
  it("shows everything when every group qualifies, and nothing is hidden for a single group", () => {
    expect(breakdown([g("Guards", 40, 20)]).shown).toHaveLength(1);
    expect(breakdown([])).toEqual({ shown: [], other: null });
  });
});

describe("the state of a survey", () => {
  it("is Draft until opened, Open between its dates, and Closed once closed or past its closing day", () => {
    expect(surveyState("DRAFT", "2026-11-10", "2026-11-24", "2026-11-12")).toBe("DRAFT");
    expect(surveyState("OPEN", "2026-11-10", "2026-11-24", "2026-11-09")).toBe("SCHEDULED");
    expect(surveyState("OPEN", "2026-11-10", "2026-11-24", "2026-11-24")).toBe("OPEN");
    expect(surveyState("OPEN", "2026-11-10", "2026-11-24", "2026-11-25")).toBe("CLOSED");
    expect(surveyState("CLOSED", "2026-11-10", "2026-11-24", "2026-11-12")).toBe("CLOSED");
  });
});

describe("when raw answers expire", () => {
  it("is the stated number of months after the survey closed", () => {
    expect(retentionDue("2024-11-10", "2026-11-09", 24)).toBe(false);
    expect(retentionDue("2024-11-10", "2026-11-10", 24)).toBe(true);
    expect(retentionDue("2020-01-01", "2026-11-10", 0)).toBe(false); // 0 = never deleted automatically
  });
});

describe("who holds the survey permissions", () => {
  const holders = (p: Parameters<(typeof ROLE_PERMISSIONS)[Role]["includes"]>[0]) => (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(p));
  it("is the HR administrator alone for running and assisting a survey: the administrators, managers, the auditor and finance do not hold them", () => {
    expect(holders("survey.manage")).toEqual(["HR_ADMIN"]);
    expect(holders("survey.assist")).toEqual(["HR_ADMIN"]);
  });
});
