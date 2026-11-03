import { describe, expect, it } from "vitest";
import { addBusinessMinutes, clockState, dueAt, warnAt, type Calendar } from "@/lib/sales/sla";

// 2026: Thursday 29 October, Friday 30 October, Saturday 31 October, Monday 2 November. Lagos time is UTC+1.
const cal: Calendar = { openMinute: 8 * 60, closeMinute: 17 * 60, workDays: [1, 2, 3, 4, 5], holidays: [] };
const at = (s: string) => new Date(s);
const iso = (d: Date) => d.toISOString();
const lagos = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+01:00`);

describe("business-hours arithmetic (Lagos time)", () => {
  it("adds within the working day", () => {
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "10:00"), 60, cal))).toBe(iso(lagos("2026-10-30", "11:00")));
  });

  it("carries over the close to the next working morning, and over the weekend", () => {
    expect(iso(addBusinessMinutes(lagos("2026-10-29", "16:30"), 60, cal))).toBe(iso(lagos("2026-10-30", "08:30")));
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "16:30"), 60, cal))).toBe(iso(lagos("2026-11-02", "08:30"))); // Friday evening to Monday morning
  });

  it("ends exactly at closing time when the window ends there, not the next morning", () => {
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "15:00"), 120, cal))).toBe(iso(lagos("2026-10-30", "17:00")));
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "15:00"), 121, cal))).toBe(iso(lagos("2026-11-02", "08:01")));
  });

  it("starts the clock when business opens if the case arrives outside hours", () => {
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "07:00"), 60, cal))).toBe(iso(lagos("2026-10-30", "09:00"))); // before opening
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "18:00"), 60, cal))).toBe(iso(lagos("2026-11-02", "09:00"))); // after closing on Friday
    expect(iso(addBusinessMinutes(lagos("2026-10-31", "10:00"), 30, cal))).toBe(iso(lagos("2026-11-02", "08:30"))); // on a Saturday
  });

  it("counts whole working days (a day here is 9 hours, 08:00 to 17:00)", () => {
    // Thursday 09:00 plus two working days (1,080 minutes): 480 left on Thursday, 540 on Friday, 60 on Monday
    expect(iso(addBusinessMinutes(lagos("2026-10-29", "09:00"), 1080, cal))).toBe(iso(lagos("2026-11-02", "09:00")));
  });

  it("skips a holiday as it skips a weekend", () => {
    const withHoliday: Calendar = { ...cal, holidays: ["2026-11-02"] };
    expect(iso(addBusinessMinutes(lagos("2026-10-30", "16:30"), 60, withHoliday))).toBe(iso(lagos("2026-11-03", "08:30")));
  });

  it("uses the Lagos day, not the UTC day, near midnight", () => {
    // 23:30 UTC on Thursday is 00:30 on Friday in Lagos: before opening
    expect(iso(addBusinessMinutes(at("2026-10-29T23:30:00Z"), 30, cal))).toBe("2026-10-30T07:30:00.000Z"); // 08:30 Lagos
  });

  it("refuses a calendar with no working days instead of looping", () => {
    expect(() => addBusinessMinutes(lagos("2026-10-30", "10:00"), 60, { ...cal, workDays: [] })).toThrow(/working day/i);
  });
});

describe("due and warning times", () => {
  it("runs around the clock when the policy says so, and in business hours when it says that", () => {
    const start = lagos("2026-10-30", "16:30");
    expect(iso(dueAt(start, 90, false, cal))).toBe(iso(lagos("2026-10-30", "18:00")));
    expect(iso(dueAt(start, 90, true, cal))).toBe(iso(lagos("2026-11-02", "09:00")));
  });

  it("warns at 75% of the window, counted the same way as the window", () => {
    const start = lagos("2026-10-30", "10:00");
    expect(iso(warnAt(start, 240, true, cal))).toBe(iso(lagos("2026-10-30", "13:00")));
    expect(iso(warnAt(start, 240, false, cal))).toBe(iso(lagos("2026-10-30", "13:00")));
    expect(iso(warnAt(lagos("2026-10-30", "15:00"), 240, true, cal))).toBe(iso(lagos("2026-11-02", "09:00"))); // 180 minutes: 120 on Friday, 60 on Monday
  });
});

describe("where a clock stands", () => {
  const due = lagos("2026-10-30", "12:00");
  const warn = lagos("2026-10-30", "11:00");
  it("is none without a deadline, ok, warning, breached, met, or met late", () => {
    expect(clockState({ dueAt: null, warnAt: null, doneAt: null }, lagos("2026-10-30", "10:00"))).toBe("NONE");
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: null }, lagos("2026-10-30", "10:59"))).toBe("OK");
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: null }, lagos("2026-10-30", "11:00"))).toBe("WARNING");
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: null }, lagos("2026-10-30", "12:00"))).toBe("WARNING"); // exactly on the deadline is not yet late
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: null }, lagos("2026-10-30", "12:01"))).toBe("BREACHED");
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: lagos("2026-10-30", "11:30") }, lagos("2026-11-05", "09:00"))).toBe("MET");
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: lagos("2026-10-30", "12:00") }, lagos("2026-11-05", "09:00"))).toBe("MET");
    expect(clockState({ dueAt: due, warnAt: warn, doneAt: lagos("2026-10-30", "12:01") }, lagos("2026-11-05", "09:00"))).toBe("LATE");
  });
});
