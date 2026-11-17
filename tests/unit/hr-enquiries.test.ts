import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESPONSE_DAYS,
  ENQUIRY_CATEGORIES,
  ENQUIRY_CATEGORY_LABELS,
  MOVABLE_CASE_TYPES,
  isEnquiryWorkingDay,
  isFirstResponseOverdue,
  responseDueDay,
  watDay,
  workingDaysWaiting,
} from "@/lib/hr-enquiries";

// HR enquiries (slice 5A, approved by the founder on 2026-11-17: plan docs/plans/hr-phases-4-5-plan.md, section 6, rules E1 to E6 as recommended). The pure rules: the categories (E1),
// what counts as a working day, the first-response target in working days (E4) and when an enquiry is overdue. Dates are plain "YYYY-MM-DD" days; no clock and no database here.
// In November 2026: Monday the 16th, Tuesday the 17th, Friday the 20th, Saturday the 21st, Sunday the 22nd, Monday the 23rd.

const NONE = new Set<string>();

describe("categories and the sensitive route (E1, E2)", () => {
  it("offers exactly the approved categories, each with a plain label", () => {
    expect([...ENQUIRY_CATEGORIES]).toEqual(["PAY", "LEAVE", "LETTER", "POLICY", "BENEFITS", "OTHER"]);
    for (const c of ENQUIRY_CATEGORIES) expect(ENQUIRY_CATEGORY_LABELS[c].length).toBeGreaterThan(3);
  });

  it("a question that is really a grievance, harassment, whistleblowing or welfare concern can be moved into a case, and nothing else can", () => {
    expect([...MOVABLE_CASE_TYPES]).toEqual(["GRIEVANCE", "HARASSMENT", "WHISTLEBLOWING", "WELFARE"]);
  });

  it("the default first-response target is three working days (E4), a starting point the company can change", () => {
    expect(DEFAULT_RESPONSE_DAYS).toBe(3);
  });
});

describe("what counts as a working day", () => {
  it("is Monday to Friday", () => {
    for (const d of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]) expect(isEnquiryWorkingDay(d, NONE)).toBe(true);
    for (const d of ["2026-11-21", "2026-11-22"]) expect(isEnquiryWorkingDay(d, NONE)).toBe(false);
  });

  it("is not a public holiday the company has entered", () => {
    expect(isEnquiryWorkingDay("2026-11-18", new Set(["2026-11-18"]))).toBe(false);
    expect(isEnquiryWorkingDay("2026-11-19", new Set(["2026-11-18"]))).toBe(true);
  });
});

describe("the day by which a first reply is due", () => {
  it("is the target in working days AFTER the day it was raised (raised Monday, three working days: Thursday)", () => {
    expect(responseDueDay("2026-11-16", 3, NONE)).toBe("2026-11-19");
  });

  it("skips the weekend (raised Friday: Monday, Tuesday, Wednesday)", () => {
    expect(responseDueDay("2026-11-20", 3, NONE)).toBe("2026-11-25");
  });

  it("an enquiry raised on a Saturday or Sunday counts from the next working day", () => {
    expect(responseDueDay("2026-11-21", 3, NONE)).toBe("2026-11-25");
    expect(responseDueDay("2026-11-22", 3, NONE)).toBe("2026-11-25");
  });

  it("skips a public holiday (raised Friday, Monday the 23rd a holiday: Tuesday, Wednesday, Thursday)", () => {
    expect(responseDueDay("2026-11-20", 3, new Set(["2026-11-23"]))).toBe("2026-11-26");
  });

  it("follows the company's own target", () => {
    expect(responseDueDay("2026-11-16", 1, NONE)).toBe("2026-11-17");
    expect(responseDueDay("2026-11-16", 5, NONE)).toBe("2026-11-23");
  });
});

describe("when an enquiry is overdue", () => {
  const base = { status: "OPEN" as const, firstResponseAt: null as Date | null, raisedDay: "2026-11-16", targetDays: 3, holidays: NONE };

  it("is not overdue on the due day itself, only once it has passed (as an acknowledgement is overdue only after its due day)", () => {
    expect(isFirstResponseOverdue({ ...base, today: "2026-11-19" })).toBe(false);
    expect(isFirstResponseOverdue({ ...base, today: "2026-11-20" })).toBe(true);
  });

  it("is never overdue once HR has replied, even if the reply was late", () => {
    expect(isFirstResponseOverdue({ ...base, firstResponseAt: new Date("2026-11-25T10:00:00Z"), today: "2026-12-30" })).toBe(false);
  });

  it("is never overdue once closed or answered", () => {
    expect(isFirstResponseOverdue({ ...base, status: "CLOSED", today: "2026-12-30" })).toBe(false);
    expect(isFirstResponseOverdue({ ...base, status: "ANSWERED", firstResponseAt: new Date("2026-11-17T10:00:00Z"), today: "2026-12-30" })).toBe(false);
  });

  it("a weekend does not make an enquiry overdue (raised Friday, still on time on Tuesday, overdue on Thursday)", () => {
    const fri = { ...base, raisedDay: "2026-11-20" };
    expect(isFirstResponseOverdue({ ...fri, today: "2026-11-24" })).toBe(false);
    expect(isFirstResponseOverdue({ ...fri, today: "2026-11-25" })).toBe(false);
    expect(isFirstResponseOverdue({ ...fri, today: "2026-11-26" })).toBe(true);
  });
});

describe("how long it has waited", () => {
  it("counts the working days since the day it was raised (not the day itself)", () => {
    expect(workingDaysWaiting("2026-11-16", "2026-11-16", NONE)).toBe(0);
    expect(workingDaysWaiting("2026-11-16", "2026-11-19", NONE)).toBe(3);
    expect(workingDaysWaiting("2026-11-20", "2026-11-24", NONE)).toBe(2);
    expect(workingDaysWaiting("2026-11-20", "2026-11-24", new Set(["2026-11-23"]))).toBe(1);
  });

  it("is zero for a day before it was raised", () => {
    expect(workingDaysWaiting("2026-11-20", "2026-11-16", NONE)).toBe(0);
  });
});

describe("the day in West Africa Time (the company's clock)", () => {
  it("an enquiry raised at 23:30 UTC is already the next day in Lagos; at 22:59 UTC it is still the same day", () => {
    expect(watDay(new Date("2026-11-16T23:30:00Z"))).toBe("2026-11-17");
    expect(watDay(new Date("2026-11-16T22:59:00Z"))).toBe("2026-11-16");
  });
});
