import { describe, expect, it } from "vitest";
import { appliesTo, assess, isGap, type Cert } from "@/lib/training-compliance";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = utc("2026-10-06");
const req = { courseName: "First Aid", graceDays: 30 };
const cert = (over: Partial<Cert> = {}): Cert => ({ courseName: "First Aid", expiryDate: utc("2028-01-01"), status: "VALID", ...over });
const joined = utc("2024-01-01");

describe("assess", () => {
  it("is valid with a certificate well within date", () => {
    expect(assess(req, [cert()], joined, today, 60)).toMatchObject({ state: "VALID", expiryDate: utc("2028-01-01") });
  });

  it("flags a certificate inside the alert window, counting the boundary day", () => {
    expect(assess(req, [cert({ expiryDate: utc("2026-12-05") })], joined, today, 60)).toMatchObject({ state: "EXPIRING", daysLeft: 60 });
    expect(assess(req, [cert({ expiryDate: utc("2026-12-06") })], joined, today, 60).state).toBe("VALID");
    expect(assess(req, [cert({ expiryDate: today })], joined, today, 60)).toMatchObject({ state: "EXPIRING", daysLeft: 0 });
  });

  it("is expired the day after expiry", () => {
    expect(assess(req, [cert({ expiryDate: utc("2026-10-05") })], joined, today, 60)).toMatchObject({ state: "EXPIRED", daysLeft: -1 });
  });

  it("never alerts when the alert window is 0", () => {
    expect(assess(req, [cert({ expiryDate: utc("2026-10-07") })], joined, today, 0).state).toBe("VALID");
  });

  it("treats no expiry date as never lapsing, even beside an old expired certificate", () => {
    expect(assess(req, [cert({ expiryDate: null })], joined, today, 60)).toMatchObject({ state: "VALID", expiryDate: null, daysLeft: null });
    expect(assess(req, [cert({ expiryDate: utc("2020-01-01") }), cert({ expiryDate: null })], joined, today, 60).state).toBe("VALID");
  });

  it("lets the longest-lasting certificate decide (a renewal covers an older, expired one)", () => {
    const old = cert({ expiryDate: utc("2025-01-01"), status: "EXPIRED" });
    const renewed = cert({ expiryDate: utc("2027-06-01") });
    expect(assess(req, [old, renewed], joined, today, 60)).toMatchObject({ state: "VALID", expiryDate: utc("2027-06-01") });
    expect(assess(req, [renewed, old], joined, today, 60).state).toBe("VALID");
  });

  it("ignores revoked certificates", () => {
    expect(assess(req, [cert({ status: "REVOKED" })], joined, today, 60).state).toBe("MISSING");
    expect(assess(req, [cert({ status: "REVOKED", expiryDate: null }), cert({ expiryDate: utc("2026-10-01") })], joined, today, 60).state).toBe("EXPIRED");
  });

  it("matches the course name loosely — case, spaces — but not a different course", () => {
    expect(assess(req, [cert({ courseName: "  first   AID " })], joined, today, 60).state).toBe("VALID");
    expect(assess(req, [cert({ courseName: "First Aid Advanced" })], joined, today, 60).state).toBe("MISSING");
    expect(assess(req, [cert({ courseName: "Fire Safety" })], joined, today, 60).state).toBe("MISSING");
  });

  it("gives a new joiner their grace period before a missing certificate counts", () => {
    expect(assess(req, [], utc("2026-09-20"), today, 60).state).toBe("GRACE"); // 16 days in
    expect(assess(req, [], utc("2026-09-06"), today, 60).state).toBe("MISSING"); // exactly 30 days in
    expect(assess(req, [], utc("2026-09-07"), today, 60).state).toBe("GRACE"); // 29 days in
    expect(assess({ ...req, graceDays: 0 }, [], today, today, 60).state).toBe("MISSING");
  });

  it("does not excuse an expired certificate because the person is new", () => {
    expect(assess(req, [cert({ expiryDate: utc("2026-09-01") })], utc("2026-09-20"), today, 60).state).toBe("EXPIRED");
  });
});

describe("isGap", () => {
  it("counts only missing and expired against an employee", () => {
    expect((["VALID", "EXPIRING", "EXPIRED", "MISSING", "GRACE"] as const).map(isGap)).toEqual([false, false, true, true, false]);
  });
});

describe("appliesTo", () => {
  it("applies to everyone when there is no category, else only that category", () => {
    expect(appliesTo({ categoryId: null }, "guard")).toBe(true);
    expect(appliesTo({ categoryId: "guard" }, "guard")).toBe(true);
    expect(appliesTo({ categoryId: "guard" }, "office")).toBe(false);
  });
});
