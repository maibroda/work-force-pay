import { describe, expect, it } from "vitest";
import { canEnrol, canMarkAttendance, certificateExpiry, monthRange, needStatusAfter, sameCourse, seatsLeft, SESSION_STATUS_LABELS } from "@/lib/training-plan";

// Learning and development, step 1: training needs and a training calendar (the founder's go of 2026-11-10, plan docs/plans/learning-development-plan.md).
// Dates are plain "YYYY-MM-DD" days; no clock is read here.

describe("seats", () => {
  it("are what is left of the limit after everyone enrolled", () => {
    expect(seatsLeft(15, 12)).toBe(3);
    expect(seatsLeft(15, 15)).toBe(0);
    expect(seatsLeft(15, 0)).toBe(15);
  });
  it("never go below zero", () => {
    expect(seatsLeft(10, 12)).toBe(0);
  });
});

describe("the expiry of the certificate that attending creates", () => {
  it("is the session date plus the programme's validity in months", () => {
    expect(certificateExpiry("2026-11-20", 24)).toBe("2028-11-20");
    expect(certificateExpiry("2026-11-20", 12)).toBe("2027-11-20");
    expect(certificateExpiry("2026-11-20", 6)).toBe("2027-05-20");
  });
  it("clamps to the end of a shorter month", () => {
    expect(certificateExpiry("2026-08-31", 6)).toBe("2027-02-28");
    expect(certificateExpiry("2027-08-31", 6)).toBe("2028-02-29"); // a leap year
  });
  it("is none when the certificate does not expire", () => {
    expect(certificateExpiry("2026-11-20", null)).toBeNull();
  });
});

describe("matching a course", () => {
  it("is the same as the compliance check: not case-sensitive, spaces squeezed", () => {
    expect(sameCourse("First aid", "  first   AID ")).toBe(true);
    expect(sameCourse("First aid", "First aid refresher")).toBe(false);
    expect(sameCourse("", "")).toBe(true);
  });
});

describe("who may be enrolled in a session", () => {
  const open = { status: "SCHEDULED" as const, sessionDate: "2026-11-20", seats: 15, taken: 12 };
  it("anyone, while the session is scheduled, not in the past, and has seats left", () => {
    expect(canEnrol(open, "2026-11-10")).toBeNull();
    expect(canEnrol(open, "2026-11-20")).toBeNull(); // on the day
  });
  it("not when the session is full", () => {
    expect(canEnrol({ ...open, taken: 15 }, "2026-11-10")).toMatch(/full/i);
  });
  it("not when the session is cancelled, completed or already past", () => {
    expect(canEnrol({ ...open, status: "CANCELLED" }, "2026-11-10")).toMatch(/cancelled/i);
    expect(canEnrol({ ...open, status: "COMPLETED" }, "2026-11-10")).toMatch(/completed/i);
    expect(canEnrol(open, "2026-11-21")).toMatch(/already/i);
  });
});

describe("when attendance may be recorded", () => {
  it("on or after the day of a scheduled or completed session", () => {
    expect(canMarkAttendance({ status: "SCHEDULED", sessionDate: "2026-11-20" }, "2026-11-20")).toBeNull();
    expect(canMarkAttendance({ status: "SCHEDULED", sessionDate: "2026-11-20" }, "2026-11-25")).toBeNull();
    expect(canMarkAttendance({ status: "COMPLETED", sessionDate: "2026-11-20" }, "2026-11-25")).toBeNull(); // a correction after completing
  });
  it("not before the session, and never for a cancelled one", () => {
    expect(canMarkAttendance({ status: "SCHEDULED", sessionDate: "2026-11-20" }, "2026-11-19")).toMatch(/before/i);
    expect(canMarkAttendance({ status: "CANCELLED", sessionDate: "2026-11-20" }, "2026-11-25")).toMatch(/cancelled/i);
  });
});

describe("the life of a training need", () => {
  it("is planned when its person is enrolled, back to open when they are taken off, and met when they attend", () => {
    expect(needStatusAfter("OPEN", "ENROLLED")).toBe("PLANNED");
    expect(needStatusAfter("PLANNED", "UNENROLLED")).toBe("OPEN");
    expect(needStatusAfter("OPEN", "ATTENDED")).toBe("MET");
    expect(needStatusAfter("PLANNED", "ATTENDED")).toBe("MET");
  });
  it("can be dropped while open or planned, and nothing leaves Met or Dropped", () => {
    expect(needStatusAfter("OPEN", "DROPPED")).toBe("DROPPED");
    expect(needStatusAfter("PLANNED", "DROPPED")).toBe("DROPPED");
    for (const s of ["MET", "DROPPED"] as const) for (const e of ["ENROLLED", "UNENROLLED", "ATTENDED", "DROPPED"] as const) expect(needStatusAfter(s, e), `${s} ${e}`).toBeNull();
  });
  it("is not moved by an event that does not apply", () => {
    expect(needStatusAfter("PLANNED", "ENROLLED")).toBeNull();
    expect(needStatusAfter("OPEN", "UNENROLLED")).toBeNull();
  });
});

describe("a month of the calendar", () => {
  it("runs from its first to its last day", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("labels", () => {
  it("each session status has a plain label", () => {
    expect(Object.keys(SESSION_STATUS_LABELS).sort()).toEqual(["CANCELLED", "COMPLETED", "SCHEDULED"]);
  });
});
