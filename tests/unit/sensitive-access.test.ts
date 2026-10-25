import { describe, expect, it } from "vitest";
import { isSensitiveReport, summariseAccess, UNUSUAL_EMPLOYEES_PER_DAY, type AccessRow } from "@/lib/sensitive-access";

const at = (s: string) => new Date(`${s}Z`);
const row = (userId: string, employeeId: string | null, when = "2026-10-20T09:00:00"): AccessRow => ({ userId, userName: userId.toUpperCase(), employeeId, kind: employeeId ? "IDENTIFIERS" : "BANK", at: at(when) });

describe("isSensitiveReport", () => {
  it("is true when any column carries a bank, tax or pension identifier", () => {
    expect(isSensitiveReport([{ key: "name" }, { key: "accountNumber" }])).toBe(true);
    expect(isSensitiveReport([{ key: "pensionPin" }])).toBe(true);
    expect(isSensitiveReport([{ key: "taxId" }])).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isSensitiveReport([{ key: "name" }, { key: "net" }])).toBe(false);
    expect(isSensitiveReport([])).toBe(false);
  });
});

describe("summariseAccess", () => {
  it("counts different employees opened one by one, and lists separately", () => {
    const [s] = summariseAccess([row("ada", "e1"), row("ada", "e1"), row("ada", "e2"), row("ada", null), row("ada", null, "2026-10-21T10:00:00")]);
    expect(s.employees).toBe(2);
    expect(s.lists).toBe(2);
    expect(s.lastAt).toEqual(at("2026-10-21T10:00:00"));
    expect(s.unusualDays).toEqual([]);
  });

  it("flags a day on which someone opened many different employees, but not the same few again and again", () => {
    const many = Array.from({ length: UNUSUAL_EMPLOYEES_PER_DAY }, (_, i) => row("bola", `e${i}`, "2026-10-20T09:00:00"));
    const few = Array.from({ length: UNUSUAL_EMPLOYEES_PER_DAY * 2 }, (_, i) => row("chi", `e${i % 3}`, "2026-10-20T09:00:00"));
    const out = summariseAccess([...many, ...few]);
    expect(out.find((s) => s.userId === "bola")?.unusualDays).toEqual(["2026-10-20"]);
    expect(out.find((s) => s.userId === "chi")?.unusualDays).toEqual([]);
  });

  it("doesn't add up different days", () => {
    const spread = Array.from({ length: UNUSUAL_EMPLOYEES_PER_DAY }, (_, i) => row("dayo", `e${i}`, `2026-10-${String(1 + (i % 2)).padStart(2, "0")}T09:00:00`));
    expect(summariseAccess(spread)[0].unusualDays).toEqual([]);
  });

  it("puts the people with something unusual first, then the busiest", () => {
    const busy = Array.from({ length: 5 }, (_, i) => row("busy", `e${i}`));
    const odd = Array.from({ length: UNUSUAL_EMPLOYEES_PER_DAY }, (_, i) => row("odd", `x${i}`));
    expect(summariseAccess([...busy, ...odd, row("quiet", "q1")]).map((s) => s.userId)).toEqual(["odd", "busy", "quiet"]);
  });

  it("keeps people apart by user, falling back to the name", () => {
    const out = summariseAccess([row("a", "e1"), { ...row("b", "e1"), userId: null, userName: "System" }]);
    expect(out).toHaveLength(2);
  });
});
