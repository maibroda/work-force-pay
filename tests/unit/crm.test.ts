import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { commissionEarned, DAILY_CONTACT_TARGET, datesBetween, isContact, presetRange, salesSummary, validateMove, workingDaysBetween, type ActivityFacts, type ChangeFacts, type LeadFacts } from "@/lib/crm";

describe("moving a lead", () => {
  const base = { from: "QUALIFIED", to: "DISCOVERY", expectedMrr: 0 } as const;
  it("moves forward freely, skipping stages if need be", () => {
    expect(validateMove(base)).toBeNull();
    expect(validateMove({ ...base, to: "PILOT" })).toBeNull();
  });
  it("refuses a move to the stage it is already in", () => {
    expect(validateMove({ ...base, to: "QUALIFIED" })).toMatch(/already qualified/);
  });
  it("needs a reason to go back a stage, or to reopen a lost lead", () => {
    expect(validateMove({ from: "PROPOSAL", to: "DISCOVERY", expectedMrr: 0 })).toMatch(/went back a stage/);
    expect(validateMove({ from: "PROPOSAL", to: "DISCOVERY", expectedMrr: 0, note: "Wants another demo" })).toBeNull();
    expect(validateMove({ from: "LOST", to: "QUALIFIED", expectedMrr: 0 })).toMatch(/reopening/);
    expect(validateMove({ from: "LOST", to: "QUALIFIED", expectedMrr: 0, note: "They came back to us" })).toBeNull();
  });
  it("needs a reason to lose a lead", () => {
    expect(validateMove({ ...base, to: "LOST" })).toMatch(/why it was lost/);
    expect(validateMove({ ...base, to: "LOST", lostReason: "abc" })).toMatch(/why it was lost/);
    expect(validateMove({ ...base, to: "LOST", lostReason: "Chose a competitor on price" })).toBeNull();
  });
  it("needs a monthly fee to win a lead, and not straight from lost", () => {
    expect(validateMove({ from: "PILOT", to: "WON", expectedMrr: 0 })).toMatch(/monthly fee/);
    expect(validateMove({ from: "PILOT", to: "WON", expectedMrr: 150000 })).toBeNull();
    expect(validateMove({ from: "LOST", to: "WON", expectedMrr: 150000 })).toMatch(/Reopen/);
  });
  it("treats a won lead as final", () => {
    expect(validateMove({ from: "WON", to: "LOST", expectedMrr: 1, lostReason: "Changed their mind later" })).toMatch(/final/);
    expect(validateMove({ from: "WON", to: "PILOT", expectedMrr: 1, note: "back to pilot" })).toMatch(/final/);
  });
});

describe("referral commission", () => {
  it("is the partner's percentage of the monthly fee for the agreed months", () => {
    expect(commissionEarned({ pct: 10, months: 12, mrr: 100_000 })).toBe(120_000);
    expect(commissionEarned({ pct: 7.5, months: 6, mrr: 250_000 })).toBe(112_500);
    expect(commissionEarned({ pct: 0, months: 12, mrr: 100_000 })).toBe(0);
    expect(commissionEarned({ pct: 12.5, months: 3, mrr: 33_333.33 })).toBe(12_500);
  });
});

describe("working days and ranges", () => {
  it("counts weekdays only", () => {
    expect(workingDaysBetween("2026-10-19", "2026-10-25")).toBe(5); // Monday to Sunday
    expect(workingDaysBetween("2026-10-24", "2026-10-25")).toBe(0); // a weekend
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  it("makes the preset ranges", () => {
    expect(presetRange("week", "2026-10-28")).toEqual({ from: "2026-10-26", to: "2026-10-28" }); // a Wednesday
    expect(presetRange("week", "2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // a Sunday belongs to the week before it
    expect(presetRange("month", "2026-10-28")).toEqual({ from: "2026-10-01", to: "2026-10-28" });
    expect(presetRange("30d", "2026-10-28")).toEqual({ from: "2026-09-29", to: "2026-10-28" });
  });
  it("counts reaching a decision-maker as a contact, and nothing less", () => {
    expect(isContact("CONNECTED")).toBe(true);
    expect(isContact("MEETING_BOOKED")).toBe(true);
    expect(isContact("QUALIFIED")).toBe(true);
    expect(isContact("NO_ANSWER")).toBe(false);
    expect(isContact("NOT_INTERESTED")).toBe(false);
  });
});

describe("the sales summary", () => {
  const at = (s: string) => new Date(`${s}T10:00:00Z`);
  const lead = (id: string, stage: LeadFacts["stage"], mrr: number, createdAt: string, wonAt?: string, lostAt?: string): LeadFacts => ({ id, stage, expectedMrr: mrr, createdAt: at(createdAt), wonAt: wonAt ? at(wonAt) : null, lostAt: lostAt ? at(lostAt) : null });
  const leads: LeadFacts[] = [
    lead("a", "WON", 200_000, "2026-09-01", "2026-10-21"),
    lead("b", "WON", 100_000, "2026-08-01", "2026-09-10"), // won before the range
    lead("c", "LOST", 50_000, "2026-10-01", undefined, "2026-10-22"),
    lead("d", "PROPOSAL", 80_000, "2026-10-20"),
    lead("e", "DISCOVERY", 40_000, "2026-10-19"),
  ];
  const changes: ChangeFacts[] = [
    { leadId: "d", toStage: "DISCOVERY", at: at("2026-10-20") },
    { leadId: "e", toStage: "DISCOVERY", at: at("2026-10-21") },
    { leadId: "d", toStage: "PROPOSAL", at: at("2026-10-23") },
    { leadId: "d", toStage: "PROPOSAL", at: at("2026-10-24") }, // reached twice, counted once
    { leadId: "a", toStage: "PROPOSAL", at: at("2026-09-20") }, // before the range
  ];
  const contactsOn = (date: string, n: number): ActivityFacts[] => Array.from({ length: n }, () => ({ date, outcome: "QUALIFIED" as const }));
  const activities: ActivityFacts[] = [
    ...contactsOn("2026-10-19", DAILY_CONTACT_TARGET), // a Monday on target
    ...contactsOn("2026-10-20", DAILY_CONTACT_TARGET - 1),
    { date: "2026-10-20", outcome: "NO_ANSWER" },
    { date: "2026-10-21", outcome: "CONNECTED" },
    { date: "2026-10-25", outcome: "MEETING_BOOKED" }, // a Sunday still counts as a contact, not as a working day
    { date: "2026-10-12", outcome: "QUALIFIED" }, // outside the range
  ];
  const s = salesSummary({ leads, changes, activities, from: "2026-10-19", to: "2026-10-25" });

  it("counts what the log says happened in the range", () => {
    expect(s.attempts).toBe(DAILY_CONTACT_TARGET + DAILY_CONTACT_TARGET - 1 + 1 + 1 + 1);
    expect(s.contacts).toBe(DAILY_CONTACT_TARGET + DAILY_CONTACT_TARGET - 1 + 1 + 1);
    expect(s.discoveryMeetings).toBe(2);
    expect(s.proposals).toBe(1);
    expect(s.newLeads).toBe(2);
    expect(s.won).toBe(1);
    expect(s.lost).toBe(1);
  });
  it("measures against the daily target over working days", () => {
    expect(s.workingDays).toBe(5);
    expect(s.daysOnTarget).toBe(1);
    expect(s.contactsPerWorkingDay).toBe(Math.round((s.contacts / 5) * 100) / 100);
  });
  it("gives conversion as won over answered, and MRR won, total and in the pipeline", () => {
    expect(s.conversion).toBe(50);
    expect(s.mrrWon).toBe(200_000);
    expect(s.mrrTotal).toBe(300_000);
    expect(s.pipelineMrr).toBe(120_000);
    expect(s.byStage.find((x) => x.stage === "PROPOSAL")).toEqual({ stage: "PROPOSAL", count: 1, mrr: 80_000 });
  });
  it("has no conversion until a lead has been won or lost in the range", () => {
    expect(salesSummary({ leads, changes, activities, from: "2026-10-01", to: "2026-10-18" }).conversion).toBeNull();
  });
});

describe("what a sales person can reach", () => {
  it("is the pipeline and their own security, and nothing else", () => {
    // the company's own sales module (sales.*, own records only, off until switched on) is a separate module from the bureau pipeline (crm.*)
    expect([...ROLE_PERMISSIONS.BUSINESS_DEV].sort()).toEqual(["crm.manage", "crm.view", "healthcheck.view", "sales.manage", "sales.view", "self.security"]);
  });
  it("is never given payroll, employee, client or finance permissions", () => {
    const other = PERMISSIONS.filter((p) => !["crm.view", "crm.manage", "sales.view", "sales.manage", "healthcheck.view", "self.security"].includes(p));
    for (const p of other) expect(ROLE_PERMISSIONS.BUSINESS_DEV.includes(p), p).toBe(false);
  });
  it("is held only by the founder (everything) and the sales role among the staff roles", () => {
    const holders = Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes("crm.manage")).map(([r]) => r).sort();
    expect(holders).toEqual(["BUSINESS_DEV", "COMPANY_ADMIN", "SUPER_ADMIN"]);
  });
  it("can make and send proposals but never set prices or approve a price below the target margin: that is the founder's", () => {
    const owners = Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes("pricing.manage")).map(([r]) => r).sort();
    expect(owners).toEqual(["COMPANY_ADMIN", "SUPER_ADMIN"]);
    expect(ROLE_PERMISSIONS.BUSINESS_DEV.includes("pricing.manage")).toBe(false);
  });
});
