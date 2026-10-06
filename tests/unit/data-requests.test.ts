import { describe, expect, it } from "vitest";
import { daysLeft, dueDateFor, dueState, DUE_SOON_DAYS, WITHHELD_NOTES } from "@/lib/data-requests";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = utc("2026-10-06");

describe("dueDateFor", () => {
  it("counts the policy's days from the day it was received", () => {
    expect(dueDateFor(utc("2026-09-06"), 30)).toEqual(utc("2026-10-06"));
    expect(dueDateFor(utc("2026-10-06"), 1)).toEqual(utc("2026-10-07"));
    expect(dueDateFor(utc("2026-12-20"), 30)).toEqual(utc("2027-01-19")); // across a year end
  });
});

describe("dueState", () => {
  it("is on time on the due day itself, overdue the day after", () => {
    expect(dueState("OPEN", today, today)).toBe("DUE_SOON");
    expect(dueState("OPEN", utc("2026-10-05"), today)).toBe("OVERDUE");
  });
  it("flags a request as due soon inside the last week, on track before that", () => {
    expect(dueState("OPEN", utc(`2026-10-${6 + DUE_SOON_DAYS}`), today)).toBe("DUE_SOON");
    expect(dueState("OPEN", utc(`2026-10-${6 + DUE_SOON_DAYS + 1}`), today)).toBe("ON_TRACK");
  });
  it("is done once answered or refused, however late", () => {
    expect(dueState("FULFILLED", utc("2020-01-01"), today)).toBe("DONE");
    expect(dueState("REFUSED", utc("2020-01-01"), today)).toBe("DONE");
  });
});

describe("daysLeft", () => {
  it("is negative once overdue", () => {
    expect(daysLeft(utc("2026-10-11"), today)).toBe(5);
    expect(daysLeft(today, today)).toBe(0);
    expect(daysLeft(utc("2026-10-01"), today)).toBe(-5);
  });
});

describe("WITHHELD_NOTES", () => {
  it("explains what an export leaves out", () => {
    expect(WITHHELD_NOTES.length).toBeGreaterThanOrEqual(4);
    expect(WITHHELD_NOTES.join(" ")).toMatch(/interview/i);
    expect(WITHHELD_NOTES.join(" ")).toMatch(/confidential/i);
    expect(WITHHELD_NOTES.join(" ")).toMatch(/guarantors/i);
  });
});
