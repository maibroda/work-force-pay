import { describe, expect, it } from "vitest";
import { describeHours, hoursLeft, needsIndividuals, needsRegulator, notificationSummary, notifyDeadline, notifyState } from "@/lib/breaches";

const at = (s: string) => new Date(`${s}Z`);
const found = at("2026-10-01T10:00:00");

const state = (over: Partial<Parameters<typeof notifyState>[0]>) => notifyState({ assessment: "RISK", discoveredAt: found, notifiedAt: null, hours: 72, now: at("2026-10-02T10:00:00"), ...over });

describe("notification deadline", () => {
  it("counts the policy's hours from the moment the company became aware", () => {
    expect(notifyDeadline(found, 72).toISOString()).toBe("2026-10-04T10:00:00.000Z");
    expect(notifyDeadline(found, 24).toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });

  it("reports hours left, negative once past", () => {
    expect(hoursLeft(found, 72, at("2026-10-02T10:00:00"))).toBe(48);
    expect(hoursLeft(found, 72, at("2026-10-04T12:00:00"))).toBe(-2);
  });
});

describe("who has to be told", () => {
  it("treats an unassessed breach as one that may need telling the regulator, and only high risk as needing the people told", () => {
    expect(needsRegulator("UNASSESSED")).toBe(true);
    expect(needsRegulator("RISK")).toBe(true);
    expect(needsRegulator("HIGH_RISK")).toBe(true);
    expect(needsRegulator("NO_RISK")).toBe(false);
    expect(needsIndividuals("HIGH_RISK")).toBe(true);
    expect(needsIndividuals("RISK")).toBe(false);
    expect(needsIndividuals("UNASSESSED")).toBe(false);
  });
});

describe("notifyState", () => {
  it("runs the clock while unassessed, then flags due soon and overdue", () => {
    expect(state({ assessment: "UNASSESSED" })).toBe("RUNNING");
    expect(state({ now: at("2026-10-03T09:00:00") })).toBe("RUNNING"); // 25h left is still running…
    expect(state({ now: at("2026-10-03T11:00:00") })).toBe("DUE_SOON"); // …23h left is due soon
    expect(state({ now: at("2026-10-04T10:00:00") })).toBe("DUE_SOON"); // the deadline moment itself is still in time
    expect(state({ now: at("2026-10-04T10:00:01") })).toBe("OVERDUE");
    expect(state({ assessment: "UNASSESSED", now: at("2026-10-09T00:00:00") })).toBe("OVERDUE");
  });

  it("says nothing is owed when assessed as no risk", () => {
    expect(state({ assessment: "NO_RISK", now: at("2026-12-01T00:00:00") })).toBe("NOT_REQUIRED");
  });

  it("judges a notification by when it was made, not by today", () => {
    expect(state({ notifiedAt: at("2026-10-04T10:00:00"), now: at("2026-12-01T00:00:00") })).toBe("ON_TIME");
    expect(state({ notifiedAt: at("2026-10-04T10:00:01"), now: at("2026-12-01T00:00:00") })).toBe("LATE");
  });
});

describe("describeHours", () => {
  it("reads naturally", () => {
    expect(describeHours(0)).toBe("0 hours");
    expect(describeHours(1)).toBe("1 hour");
    expect(describeHours(26)).toBe("1 day 2 hours");
    expect(describeHours(-48)).toBe("2 days");
  });
});

describe("notificationSummary", () => {
  const facts = { incidentNumber: "BRC-00001", title: "Payroll file emailed to the wrong person", description: "A spreadsheet went to an outside address.", discoveredAt: found, occurredOn: null, dataCategories: ["Bank account details"], individualsAffected: 12, containmentNote: null, remediation: null, contact: "HR Admin, hr@example.test", organization: "Acme" };

  it("lists the facts a regulator asks for and says plainly what is not known yet", () => {
    const text = notificationSummary(facts, "RISK", "Account numbers were included");
    expect(text).toContain("BRC-00001");
    expect(text).toContain("Bank account details");
    expect(text).toContain("12");
    expect(text).toContain("Likely to put people at risk — Account numbers were included");
    expect(text).toContain("containment is still under way");
    expect(text).toContain("not yet established");
    expect(text).toContain("hr@example.test");
  });
});
