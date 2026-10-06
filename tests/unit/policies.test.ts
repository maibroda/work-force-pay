import { describe, expect, it } from "vitest";
import { ackDueDate, ackState, appliesTo, currentVersion, scheduledVersion } from "@/lib/policies";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = utc("2026-10-06");

describe("ackDueDate", () => {
  it("counts the grace period from the version when the employee was already here", () => {
    expect(ackDueDate(utc("2026-09-20"), utc("2020-01-01"), 14)).toEqual(utc("2026-10-04"));
  });
  it("counts it from joining when the employee is newer than the version", () => {
    expect(ackDueDate(utc("2024-01-01"), utc("2026-10-01"), 14)).toEqual(utc("2026-10-15"));
  });
  it("is the effective date itself with no grace", () => {
    expect(ackDueDate(utc("2026-10-06"), utc("2020-01-01"), 0)).toEqual(utc("2026-10-06"));
  });
});

describe("ackState", () => {
  it("is acknowledged whatever the date", () => {
    expect(ackState(true, utc("2020-01-01"), today)).toBe("ACKNOWLEDGED");
  });
  it("is pending up to and including the due day, overdue the day after", () => {
    expect(ackState(false, utc("2026-10-07"), today)).toBe("PENDING");
    expect(ackState(false, today, today)).toBe("PENDING");
    expect(ackState(false, utc("2026-10-05"), today)).toBe("OVERDUE");
  });
});

describe("currentVersion / scheduledVersion", () => {
  const v = (version: number, eff: string) => ({ version, effectiveDate: utc(eff) });
  it("is the highest version whose date has arrived", () => {
    expect(currentVersion([v(1, "2025-01-01"), v(2, "2026-10-06"), v(3, "2026-11-01")], today)?.version).toBe(2);
    expect(currentVersion([v(1, "2025-01-01"), v(2, "2026-01-01")], today)?.version).toBe(2);
  });
  it("is null when nothing has taken effect", () => {
    expect(currentVersion([v(1, "2026-11-01")], today)).toBeNull();
    expect(currentVersion([], today)).toBeNull();
  });
  it("finds the earliest version still to come", () => {
    expect(scheduledVersion([v(1, "2025-01-01"), v(3, "2026-12-01"), v(2, "2026-11-01")], today)?.version).toBe(2);
    expect(scheduledVersion([v(1, "2025-01-01")], today)).toBeNull();
  });
});

describe("appliesTo", () => {
  it("applies to everyone with no category, else only that category", () => {
    expect(appliesTo({ categoryId: null }, "guard")).toBe(true);
    expect(appliesTo({ categoryId: "guard" }, "guard")).toBe(true);
    expect(appliesTo({ categoryId: "guard" }, "office")).toBe(false);
  });
});
