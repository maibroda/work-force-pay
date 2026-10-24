import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau, grantAccess, onboardClient } from "@/server/services/bureau";
import {
  adjustCalendar,
  bureauDeadlines,
  calendarOverview,
  generateCalendar,
  generateMissingCalendars,
  getCalendarSetting,
  markInput,
  periodTracker,
  raiseInputIssue,
  resolveInputIssue,
  saveCalendarSetting,
} from "@/server/services/payroll-calendar";
import { isolatedOrg, uid } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

async function period(orgId: string, year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return db.payrollPeriod.create({ data: { organizationId: orgId, name: `${year}-${mm}`, year, month, startDate: d(`${year}-${mm}-01`), endDate: d(`${year}-${mm}-${last}`) } });
}
async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@cal.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

describe("the agreed rhythm", () => {
  it("defaults sensibly, is saved only by someone who manages settings, and rejects a rhythm that cannot work", async () => {
    const t = await isolatedOrg();
    const officer = t.ctx("PAYROLL_ADMIN", null, 1);
    const admin = t.ctx("COMPANY_ADMIN", null, 1);
    expect(await getCalendarSetting(officer)).toMatchObject({ saved: false, rule: { inputCutoffDay: 20, draftWorkingDays: 3, payDayOfMonth: 28 } });
    const body = { inputCutoffDay: 18, draftWorkingDays: 4, approvalWorkingDays: 2, payDayOfMonth: 30, remittanceDueDay: 10, expectedInputs: ["ATTENDANCE", "OVERTIME"] } as never;
    await expect(saveCalendarSetting(officer, body)).rejects.toThrow(/permission/);
    await expect(saveCalendarSetting(admin, { ...(body as object), inputCutoffDay: 31 } as never)).rejects.toThrow(/between 1 and 28/);
    await saveCalendarSetting(admin, body);
    expect(await getCalendarSetting(officer)).toMatchObject({ saved: true, rule: { inputCutoffDay: 18, draftWorkingDays: 4 }, expectedInputs: ["ATTENDANCE", "OVERTIME"] });
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "PAYROLL_CALENDAR_SETTING_SAVE" } })).toBe(1);
  });
});

describe("a month's dates", () => {
  it("are worked out from the rhythm with the expected inputs listed, once per month, and adjusted only with a reason", async () => {
    const t = await isolatedOrg();
    const officer = t.ctx("PAYROLL_ADMIN", null, 1);
    const admin = t.ctx("COMPANY_ADMIN", null, 1);
    await saveCalendarSetting(admin, { inputCutoffDay: 20, draftWorkingDays: 3, approvalWorkingDays: 2, payDayOfMonth: 28, remittanceDueDay: 10, expectedInputs: ["ATTENDANCE", "OVERTIME", "LOANS"] } as never);
    const oct = await period(t.org.id, 2026, 10);
    await expect(generateCalendar(t.ctx("AUDITOR", null, 1), oct.id)).rejects.toThrow(/permission/);
    const { entry, problems } = await generateCalendar(officer, oct.id);
    expect(problems).toEqual([]);
    expect([entry.inputCutoff, entry.draftDue, entry.approvalDue, entry.payDate, entry.remittanceDue].map(day)).toEqual(["2026-10-20", "2026-10-23", "2026-10-27", "2026-10-28", "2026-11-10"]);
    expect((await db.payrollInputItem.findMany({ where: { periodId: oct.id } })).map((i) => i.kind).sort()).toEqual(["ATTENDANCE", "LOANS", "OVERTIME"]);
    await expect(generateCalendar(officer, oct.id)).rejects.toThrow(/already has its dates/);

    const adj = { inputCutoff: "2026-10-22", draftDue: "2026-10-27", approvalDue: "2026-10-28", payDate: "2026-10-29", remittanceDue: "2026-11-10" };
    await expect(adjustCalendar(officer, oct.id, { ...adj, reason: "short" })).rejects.toThrow(/at least 10/);
    await expect(adjustCalendar(officer, oct.id, { ...adj, draftDue: "2026-10-21", reason: "Public holiday on the 20th" })).rejects.toThrow(/in order/);
    await adjustCalendar(officer, oct.id, { ...adj, reason: "Public holiday; client agreed to the 22nd" });
    const after = await db.payrollCalendarEntry.findUniqueOrThrow({ where: { periodId: oct.id } });
    expect(after).toMatchObject({ adjusted: true, adjustedBy: officer.name });
    expect(day(after.inputCutoff)).toBe("2026-10-22");
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "PAYROLL_CALENDAR_ADJUST" } })).toBe(1);
  });

  it("can be generated for every month that lacks them, and warn when the rhythm cannot meet the pay date", async () => {
    const t = await isolatedOrg();
    const officer = t.ctx("PAYROLL_ADMIN", null, 1);
    await saveCalendarSetting(t.ctx("COMPANY_ADMIN", null, 1), { inputCutoffDay: 27, draftWorkingDays: 5, approvalWorkingDays: 3, payDayOfMonth: 28, remittanceDueDay: 10 } as never);
    const a = await period(t.org.id, 2026, 8);
    await period(t.org.id, 2026, 9);
    await period(t.org.id, 2026, 10);
    expect(await generateMissingCalendars(officer)).toBe(3);
    expect(await generateMissingCalendars(officer)).toBe(0);
    expect((await periodTracker(officer, a.id)).problems.join(" ")).toMatch(/after the pay date/);
    expect((await calendarOverview(officer)).map((r) => r.period.name)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });
});

describe("the input tracker", () => {
  it("marks inputs received or not applicable with a note, undoes them, and stops once the payroll is approved", async () => {
    const t = await isolatedOrg();
    const officer = t.ctx("PAYROLL_ADMIN", null, 1);
    const p = await period(t.org.id, 2026, 10);
    await generateCalendar(officer, p.id);
    await expect(markInput(officer, p.id, "ATTENDANCE", "RECEIVED", "")).rejects.toThrow(/how it arrived/);
    await expect(markInput(officer, p.id, "ATTENDANCE", "NOT_APPLICABLE", "no")).rejects.toThrow(/why this input does not apply/);
    await expect(markInput(officer, p.id, "NONSENSE", "RECEIVED", "email from HR")).rejects.toThrow(/Unknown input/);
    await markInput(officer, p.id, "ATTENDANCE", "RECEIVED", "Email from HR, 19 Oct");
    await markInput(officer, p.id, "LOANS", "NOT_APPLICABLE", "No staff loans this month");
    let t1 = await periodTracker(officer, p.id);
    const att = t1.items.find((i) => i.kind === "ATTENDANCE")!;
    expect(att).toMatchObject({ status: "RECEIVED", markedBy: officer.name, note: "Email from HR, 19 Oct" });
    expect(att.receivedAt).not.toBeNull();
    expect(t1.items.find((i) => i.kind === "LOANS")?.status).toBe("NOT_APPLICABLE");
    expect(t1.milestones.find((m) => m.key === "inputCutoff")?.done).toBe(false); // overtime etc. still expected
    await markInput(officer, p.id, "ATTENDANCE", "EXPECTED");
    expect((await periodTracker(officer, p.id)).items.find((i) => i.kind === "ATTENDANCE")).toMatchObject({ status: "EXPECTED", receivedAt: null, markedBy: null });

    for (const k of ["ATTENDANCE", "OVERTIME", "ALLOWANCES", "DEDUCTIONS", "JOINERS_LEAVERS"]) await markInput(officer, p.id, k, "RECEIVED", "Sent by the client");
    t1 = await periodTracker(officer, p.id);
    expect(t1.milestones.find((m) => m.key === "inputCutoff")?.done).toBe(true);
    await db.payrollPeriod.update({ where: { id: p.id }, data: { status: "APPROVED" } });
    await expect(markInput(officer, p.id, "OVERTIME", "EXPECTED")).rejects.toThrow(/already approved/);
  });

  it("logs missing or inconsistent items and how they were settled", async () => {
    const t = await isolatedOrg();
    const officer = t.ctx("PAYROLL_ADMIN", null, 1);
    const p = await period(t.org.id, 2026, 10);
    await generateCalendar(officer, p.id);
    await expect(raiseInputIssue(officer, p.id, "OVERTIME", "short")).rejects.toThrow(/at least 10/);
    const issue = await raiseInputIssue(officer, p.id, "OVERTIME", "Overtime sheet has hours for an employee not on the staff list");
    await expect(resolveInputIssue(officer, issue.id, "ok")).rejects.toThrow(/how it was settled/);
    await resolveInputIssue(officer, issue.id, "Client confirmed a transfer from another site");
    await expect(resolveInputIssue(officer, issue.id, "Resolving it again")).rejects.toThrow(/already resolved/);
    const log = (await periodTracker(officer, p.id)).issues;
    expect(log[0]).toMatchObject({ status: "RESOLVED", resolvedBy: officer.name, kind: "OVERTIME" });
    // another organization's person can't touch it
    const other = await isolatedOrg();
    await expect(resolveInputIssue(other.ctx("PAYROLL_ADMIN", null, 1), issue.id, "Not mine to resolve")).rejects.toThrow(/Issue not found/);
  });

  it("reads where the work really is from the payroll, never from a tick", async () => {
    const t = await isolatedOrg();
    const officer = t.ctx("PAYROLL_ADMIN", null, 1);
    const p = await period(t.org.id, 2026, 10);
    await generateCalendar(officer, p.id);
    const state = async () => Object.fromEntries((await periodTracker(officer, p.id)).milestones.map((m) => [m.key, m.done]));
    expect(await state()).toMatchObject({ draftDue: false, approvalDue: false, payDate: false, remittanceDue: false });
    const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: p.id, runNumber: 1, status: "CALCULATED" } });
    expect(await state()).toMatchObject({ draftDue: true, approvalDue: false });
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedByUserId: "someone-else" } });
    expect(await state()).toMatchObject({ approvalDue: true, payDate: false });
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "PAID" } });
    expect(await state()).toMatchObject({ payDate: true, remittanceDue: false });
    await db.statutoryRemittance.create({ data: { organizationId: t.org.id, runId: run.id, type: "PAYE", payee: "Tax authority", employeeAmount: 1, employerAmount: 0, totalAmount: 1, headcount: 1, status: "PENDING" } });
    expect((await state()).remittanceDue).toBe(false);
    await db.statutoryRemittance.updateMany({ where: { runId: run.id }, data: { status: "PAID" } });
    expect((await state()).remittanceDue).toBe(true);
  });
});

describe("what is due across clients", () => {
  it("lists overdue and imminent deadlines for the clients a person works on, and no others", async () => {
    const t = await isolatedOrg();
    const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
    const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
    await enableBureau(founder);
    const mk = async (name: string) => (await onboardClient(founder, { name, code: `D${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12 } as never)).client;
    const a = await mk("Alpha");
    const b = await mk("Beta");
    const fmt = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    for (const c of [a, b]) {
      const p = await period(c.id, 2026, 10);
      await db.payrollCalendarEntry.create({
        data: { organizationId: c.id, periodId: p.id, inputCutoff: d(fmt(-2)), draftDue: d(fmt(1)), approvalDue: d(fmt(3)), payDate: d(fmt(20)), remittanceDue: d(fmt(30)), createdBy: "test" },
      });
      await db.payrollInputItem.create({ data: { organizationId: c.id, periodId: p.id, kind: "ATTENDANCE" } });
    }
    const all = await bureauDeadlines(founder);
    expect(all.map((r) => [r.clientName, r.label, r.state])).toEqual([
      ["Alpha", "Inputs due from the client", "OVERDUE"],
      ["Beta", "Inputs due from the client", "OVERDUE"],
      ["Alpha", "Draft payroll due", "DUE_SOON"],
      ["Beta", "Draft payroll due", "DUE_SOON"],
      ["Alpha", "Client approval due", "DUE_SOON"],
      ["Beta", "Client approval due", "DUE_SOON"],
    ]); // pay date and remittances are weeks away
    expect(await bureauDeadlines(officer)).toEqual([]);
    await grantAccess(founder, officer.userId, b.id);
    expect((await bureauDeadlines(officer)).every((r) => r.clientName === "Beta")).toBe(true);
    expect((await bureauDeadlines(officer)).length).toBe(3);
    // a client of nobody's bureau has nothing to show
    expect(await bureauDeadlines(t.ctx("PAYROLL_ADMIN", null, 9))).toEqual([]);
  });
});
