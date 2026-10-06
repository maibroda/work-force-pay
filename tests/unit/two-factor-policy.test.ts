import { describe, expect, it } from "vitest";
import { daysUntilEnforced, twoFactorReminder, twoFactorState } from "@/lib/two-factor-policy";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const base = { roles: ["HR_ADMIN", "PAYROLL_ADMIN"], enforceFrom: day("2026-11-01"), role: "HR_ADMIN", enrolled: false, today: day("2026-10-06") };

describe("twoFactorState", () => {
  it("only reminds before the start day, and blocks from it", () => {
    expect(twoFactorState(base)).toBe("GRACE");
    expect(twoFactorState({ ...base, today: day("2026-10-31") })).toBe("GRACE");
    expect(twoFactorState({ ...base, today: day("2026-11-01") })).toBe("BLOCKED");
    expect(twoFactorState({ ...base, today: day("2027-01-01") })).toBe("BLOCKED");
  });

  it("lets anyone who has set it up through, at any time", () => {
    expect(twoFactorState({ ...base, enrolled: true })).toBe("ENROLLED");
    expect(twoFactorState({ ...base, enrolled: true, today: day("2027-01-01") })).toBe("ENROLLED");
  });

  it("leaves other roles alone", () => {
    expect(twoFactorState({ ...base, role: "EMPLOYEE", today: day("2027-01-01") })).toBe("NOT_REQUIRED");
  });

  it("is off with no start day or no roles, however many roles are listed", () => {
    expect(twoFactorState({ ...base, enforceFrom: null })).toBe("NOT_REQUIRED");
    expect(twoFactorState({ ...base, roles: [], today: day("2027-01-01") })).toBe("NOT_REQUIRED");
  });
});

describe("daysUntilEnforced", () => {
  it("counts whole days, zero on the day", () => {
    expect(daysUntilEnforced(day("2026-11-01"), day("2026-10-06"))).toBe(26);
    expect(daysUntilEnforced(day("2026-11-01"), day("2026-11-01"))).toBe(0);
  });
});

describe("twoFactorReminder", () => {
  const from = day("2026-11-01");

  it("counts down in plain words, only to people who still have time", () => {
    expect(twoFactorReminder("GRACE", from, day("2026-10-06"))).toMatch(/in 26 days \(2026-11-01\)/);
    expect(twoFactorReminder("GRACE", from, day("2026-10-31"))).toMatch(/tomorrow/);
    expect(twoFactorReminder("GRACE", from, day("2026-11-01"))).toMatch(/today/);
  });

  it("says nothing to anyone else", () => {
    for (const state of ["NOT_REQUIRED", "ENROLLED", "BLOCKED"] as const) expect(twoFactorReminder(state, from, day("2026-10-06"))).toBeNull();
    expect(twoFactorReminder("GRACE", null, day("2026-10-06"))).toBeNull();
  });
});
