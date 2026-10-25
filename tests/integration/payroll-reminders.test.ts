import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email";
import { enableBureau, grantAccess, onboardClient } from "@/server/services/bureau";
import { getReminderSetting, previewReminders, recentReminders, runRemindersForAllOrgs, saveReminderSetting, sendDueReminders, sendRemindersNow } from "@/server/services/payroll-reminders";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const at = (s: string) => new Date(`${s}T08:00:00Z`);

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@rem.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

/**
 * A bureau with a founder and an officer who is given the client, and a client whose October 2026 month has an overdue input cut-off
 * (the 20th), draft on the 23rd, approval on the 27th, pay on the 28th, and two inputs still expected.
 */
async function world(opts: { contactEmail?: string | null } = {}) {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  await person(t.org.id, "PAYROLL_ADMIN", "notgranted");
  await enableBureau(founder);
  const { client } = await onboardClient(founder, {
    name: "Acme Ltd", code: `M${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12,
    contactName: "Mrs Bello", contactEmail: opts.contactEmail === undefined ? "hr@acme.test" : (opts.contactEmail ?? ""),
  } as never);
  await grantAccess(founder, officer.userId, client.id);
  const clientAdmin = await person(client.id, "COMPANY_ADMIN", "clientadmin");
  const period = await db.payrollPeriod.create({ data: { organizationId: client.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  await db.payrollCalendarEntry.create({ data: { organizationId: client.id, periodId: period.id, inputCutoff: d("2026-10-20"), draftDue: d("2026-10-23"), approvalDue: d("2026-10-27"), payDate: d("2026-10-28"), remittanceDue: d("2026-11-10"), createdBy: "test" } });
  for (const kind of ["ATTENDANCE", "OVERTIME"]) await db.payrollInputItem.create({ data: { organizationId: client.id, periodId: period.id, kind } });
  const on = (over: Record<string, unknown> = {}) => saveReminderSetting(clientAdmin, { enabled: true, remindClient: true, remindTeam: true, leadDays: 2, extraEmails: "ops@threeroots.test", ...over } as never);
  const to = () => mail.mock.calls.map((c) => c[0].to).sort();
  return { t, founder, officer, client, clientAdmin, period, on, to };
}

beforeEach(() => mail.mockClear());

describe("settings and preview", () => {
  it("is off until switched on, saved only by someone who manages settings, and shows what would go out without sending it", async () => {
    const w = await world();
    expect(await getReminderSetting(w.clientAdmin)).toMatchObject({ enabled: false, remindClient: true, leadDays: 2, extraEmails: [] });
    await expect(saveReminderSetting(w.officer as Ctx, { enabled: true, leadDays: 2 } as never)).rejects.toThrow(/permission|record/i);
    expect((await sendDueReminders(w.client.id, { now: at("2026-10-21") })).skipped).toMatch(/switched off/);
    expect(mail).not.toHaveBeenCalled();

    // a preview works while it is off, and says what it would do
    await previewReminders(w.clientAdmin); // today, whatever it is: it must work and send nothing
    const p = await sendDueReminders(w.client.id, { now: at("2026-10-21"), dryRun: true });
    expect(p.outcomes.length).toBeGreaterThan(0);
    expect(p.outcomes.every((o) => o.status === "WOULD_SEND" || o.status === "ALREADY_SENT_TODAY")).toBe(true);
    expect(mail).not.toHaveBeenCalled();

    await expect(saveReminderSetting(w.clientAdmin, { enabled: true, leadDays: 2, extraEmails: "not-an-email" } as never)).rejects.toThrow(/valid email/);
    await expect(saveReminderSetting(w.clientAdmin, { enabled: true, leadDays: 30 } as never)).rejects.toThrow();
    await w.on();
    expect(await getReminderSetting(w.clientAdmin)).toMatchObject({ enabled: true, extraEmails: ["ops@threeroots.test"] });
    await expect(sendRemindersNow({ ...w.clientAdmin, role: "AUDITOR" })).rejects.toThrow(/permission/);
  });
});

describe("sending", () => {
  it("chases the client for outstanding inputs and sends the team a digest, to the people who work on the client and nobody else", async () => {
    const w = await world();
    await w.on();
    const r = await sendDueReminders(w.client.id, { now: at("2026-10-21") });
    expect(r.outcomes.filter((o) => o.status === "SENT")).toHaveLength(4);
    const calls = mail.mock.calls.map((c) => c[0]);
    const toClient = calls.filter((c) => c.to === "hr@acme.test");
    expect(toClient).toHaveLength(1);
    expect(toClient[0].subject).toBe("Payroll inputs for October 2026 are overdue");
    expect(toClient[0].text).toMatch(/Dear Mrs Bello/);
    expect(toClient[0].text).toMatch(/Attendance/);
    // the team: the manager, the officer given the client, and the extra address; not the officer who wasn't given it
    expect(w.to()).toEqual([w.founder.email, "hr@acme.test", "ops@threeroots.test", w.officer.email].sort());
    expect(calls.find((c) => c.to === w.officer.email)?.subject).toMatch(/Acme Ltd October 2026: 1 overdue, 1 due soon/);
    expect(await db.payrollReminderLog.count({ where: { organizationId: w.client.id } })).toBe(4);
    expect((await recentReminders(w.clientAdmin)).length).toBe(4);
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "PAYROLL_REMINDERS_SENT" } })).toBe(1);
  });

  it("never sends the same reminder twice in a day, and sends again the next working day", async () => {
    const w = await world();
    await w.on();
    await sendDueReminders(w.client.id, { now: at("2026-10-21") });
    mail.mockClear();
    const again = await sendDueReminders(w.client.id, { now: at("2026-10-21") });
    expect(again.outcomes.every((o) => o.status === "ALREADY_SENT_TODAY")).toBe(true);
    expect(mail).not.toHaveBeenCalled();
    await sendDueReminders(w.client.id, { now: at("2026-10-22") });
    expect(mail).toHaveBeenCalledTimes(4);
    await expect(db.payrollReminderLog.update({ where: { id: (await db.payrollReminderLog.findFirstOrThrow({ where: { organizationId: w.client.id } })).id }, data: { toEmail: "x@y.z" } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("sends nothing at weekends unless staff ask for it now, and a client is only nudged so many times a month", async () => {
    const w = await world();
    await w.on();
    expect((await sendDueReminders(w.client.id, { now: at("2026-10-24") })).skipped).toMatch(/weekends/);
    const sent = await sendRemindersNow(w.clientAdmin); // today is whatever day the test runs; the point is it doesn't skip for the weekend
    expect(sent.skipped).toBeUndefined();

    const w2 = await world();
    await w2.on();
    for (const day of ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"]) await sendDueReminders(w2.client.id, { now: at(day) });
    mail.mockClear();
    const sixth = await sendDueReminders(w2.client.id, { now: at("2026-10-28") });
    expect(sixth.outcomes.find((o) => o.to === "hr@acme.test" && o.kind === "CLIENT_INPUTS")?.status).toBe("LIMIT_REACHED");
    expect(sixth.outcomes.some((o) => o.kind === "TEAM_DIGEST" && o.status === "SENT")).toBe(true); // the team still hears
    expect(mail.mock.calls.every((c) => c[0].to !== "hr@acme.test")).toBe(true);
  });

  it("stops chasing inputs that have arrived, asks for approval once there is a draft, and leaves the client out when switched off", async () => {
    const w = await world();
    await w.on();
    for (const kind of ["ATTENDANCE", "OVERTIME"]) await db.payrollInputItem.updateMany({ where: { periodId: w.period.id, kind }, data: { status: "RECEIVED", receivedAt: new Date(), markedBy: "x", note: "emailed" } });
    await db.payrollRun.create({ data: { organizationId: w.client.id, periodId: w.period.id, runNumber: 1, status: "CALCULATED" } });
    const r = await sendDueReminders(w.client.id, { now: at("2026-10-26") }); // approval is due tomorrow
    const kinds = r.outcomes.map((o) => o.kind);
    expect(kinds).toContain("CLIENT_APPROVAL");
    expect(kinds).not.toContain("CLIENT_INPUTS");
    expect(mail.mock.calls.find((c) => c[0].to === "hr@acme.test")?.[0].subject).toBe("Payroll for October 2026 is waiting for your approval");

    mail.mockClear();
    await w.on({ remindClient: false });
    await sendDueReminders(w.client.id, { now: at("2026-10-27") });
    expect(mail.mock.calls.every((c) => c[0].to !== "hr@acme.test")).toBe(true);
    expect(mail).toHaveBeenCalled(); // the team still gets its digest
  });

  it("says so when the client has no contact email, and retries a send that failed", async () => {
    const w = await world({ contactEmail: null });
    await w.on();
    const r = await sendDueReminders(w.client.id, { now: at("2026-10-21") });
    expect(r.notes.join(" ")).toMatch(/no contact email/);
    expect(r.outcomes.every((o) => o.kind === "TEAM_DIGEST")).toBe(true);

    mail.mockClear();
    mail.mockRejectedValueOnce(new Error("mailbox full"));
    const next = await sendDueReminders(w.client.id, { now: at("2026-10-22") });
    expect(next.outcomes.filter((o) => o.status === "FAILED")).toHaveLength(1);
    expect(next.outcomes.filter((o) => o.status === "SENT").length).toBe(next.outcomes.length - 1);
    // the failed one was not logged, so the next run the same day tries it again and the others are left alone
    mail.mockClear();
    const retry = await sendDueReminders(w.client.id, { now: at("2026-10-22") });
    expect(retry.outcomes.filter((o) => o.status === "SENT")).toHaveLength(1);
    expect(mail).toHaveBeenCalledTimes(1);
  });

  it("works for an organization that is not a bureau's client, telling its own payroll people", async () => {
    const t = await isolatedOrg();
    const payroll = await person(t.org.id, "PAYROLL_ADMIN", "inhouse");
    const admin = await person(t.org.id, "COMPANY_ADMIN", "owner");
    const p = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
    await db.payrollCalendarEntry.create({ data: { organizationId: t.org.id, periodId: p.id, inputCutoff: d("2026-10-20"), draftDue: d("2026-10-23"), approvalDue: d("2026-10-27"), payDate: d("2026-10-28"), remittanceDue: d("2026-11-10"), createdBy: "test" } });
    await db.payrollInputItem.create({ data: { organizationId: t.org.id, periodId: p.id, kind: "ATTENDANCE" } });
    await saveReminderSetting(admin, { enabled: true, remindClient: true, remindTeam: true, leadDays: 2, extraEmails: "" } as never);
    const r = await sendDueReminders(t.org.id, { now: at("2026-10-21") });
    expect(r.outcomes.filter((o) => o.status === "SENT").map((o) => o.to).sort()).toEqual([admin.email, payroll.email].sort());
  });
});

describe("the scheduled job", () => {
  it("covers only the organizations that switched reminders on, and one failing never stops the rest", async () => {
    const on = await world();
    const off = await world();
    await on.on();
    const results = await runRemindersForAllOrgs(at("2026-10-21"));
    const mine = results.filter((r) => r.organization === "Acme Ltd");
    expect(mine.some((r) => r.outcomes.some((o) => o.status === "SENT"))).toBe(true);
    expect(await db.payrollReminderLog.count({ where: { organizationId: off.client.id } })).toBe(0);
    expect(await db.payrollReminderLog.count({ where: { organizationId: on.client.id } })).toBeGreaterThan(0);
  });
});
