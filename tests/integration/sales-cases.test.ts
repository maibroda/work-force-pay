import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { can } from "@/lib/auth/permissions";
import { dueAt, warnAt } from "@/lib/sales/sla";
import { timeline } from "@/server/services/sales/activities";
import { addCaseNote, addHoliday, calendarOf, createCase, createStarterPolicies, getCalendarSettings, getCase, listCases, listSlaPolicies, reassignCase, removeHoliday, removeSlaPolicy, reopenCase, resolveCase, respondToCase, runCaseSlaJob, runRenewalsJob, saveBusinessHours, saveSlaPolicy, setRenewalWindow } from "@/server/services/sales/cases";
import { createAccount, createContact } from "@/server/services/sales/records";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const mail = vi.mocked(sendEmail);
beforeEach(() => mail.mockClear());

const MIN = 60_000;
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  const ops = t.ctx("OPERATIONS", null, 1);
  for (const c of [admin, repA, repB, ops]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const contact = await createContact(repA, { accountId: account.id, firstName: "Funmi", lastName: "Bello", email: "funmi@lekki.test", isPrimary: true });
  const deal = await createOpportunity(repA, { accountId: account.id, name: "24/7 guarding" });
  return { t, admin, repA, repB, ops, account, contact, deal };
}
type W = Awaited<ReturnType<typeof world>>;
const policy = (w: W, priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL", fr: number, res: number, bh = false, accountId?: string) => saveSlaPolicy(w.admin, { priority, firstResponseMinutes: fr, resolutionMinutes: res, businessHoursOnly: bh, accountId });
const open = (w: W, over: Record<string, unknown> = {}, who = w.repA) => createCase(who, { accountId: w.account.id, category: "SERVICE_QUALITY", priority: "NORMAL", subject: "Guard absent at the main gate", ...over } as never);

describe("business hours, holidays and policies", () => {
  it("are set only by someone who configures sales, with sensible checks", async () => {
    const w = await world();
    expect((await getCalendarSettings(w.repA)).isDefault).toBe(true);
    await expect(saveBusinessHours(w.repA, { openMinute: 480, closeMinute: 1020, workDays: [1, 2, 3] })).rejects.toThrow(/permission/i);
    await expect(saveBusinessHours(w.admin, { openMinute: 600, closeMinute: 500, workDays: [1] })).rejects.toThrow(/closing time must be after/i);
    await expect(saveBusinessHours(w.admin, { openMinute: 480, closeMinute: 1020, workDays: [] })).rejects.toThrow(/at least one working day/i);
    await saveBusinessHours(w.admin, { openMinute: 540, closeMinute: 1080, workDays: [6, 1, 1, 2] });
    expect(await calendarOf(w.t.org.id)).toMatchObject({ openMinute: 540, closeMinute: 1080, workDays: [1, 2, 6], holidays: [] });
    const h = await addHoliday(w.admin, { date: "2026-12-25", name: "Christmas Day" });
    await expect(addHoliday(w.admin, { date: "2026-12-25", name: "Again" })).rejects.toThrow(/already a holiday/i);
    await expect(addHoliday(w.admin, { date: "25/12/2026", name: "Bad" })).rejects.toThrow(/use a date/i);
    expect((await calendarOf(w.t.org.id)).holidays).toEqual(["2026-12-25"]);
    await removeHoliday(w.admin, h.id);
    expect((await calendarOf(w.t.org.id)).holidays).toEqual([]);
    const other = await world();
    await expect(removeHoliday(other.admin, h.id)).rejects.toThrow(/not found/i);
  });

  it("keeps one policy for each account and priority, lets an account's own win over the default, and offers starting figures once", async () => {
    const w = await world();
    await expect(saveSlaPolicy(w.repA, { priority: "HIGH", firstResponseMinutes: 60, resolutionMinutes: 240, businessHoursOnly: true })).rejects.toThrow(/permission/i);
    await expect(saveSlaPolicy(w.admin, { priority: "HIGH", firstResponseMinutes: 300, resolutionMinutes: 60, businessHoursOnly: true })).rejects.toThrow(/before the first response/i);
    await expect(saveSlaPolicy(w.admin, { priority: "HIGH", firstResponseMinutes: 60, resolutionMinutes: 240, businessHoursOnly: true, accountId: "nope" })).rejects.toThrow(/account not found/i);
    await policy(w, "HIGH", 60, 240, true);
    await policy(w, "HIGH", 30, 120, false); // the same priority again replaces it
    expect((await listSlaPolicies(w.repA)).filter((p) => !p.accountId)).toHaveLength(1);
    await policy(w, "HIGH", 15, 60, false, w.account.id);
    const own = await open(w, { priority: "HIGH" });
    expect(own).toMatchObject({ slaFirstResponseMinutes: 15, slaResolutionMinutes: 60, slaBusinessHoursOnly: false });
    const bAccount = await createAccount(w.repB, { name: "Ikoyi Towers" });
    const dflt = await createCase(w.repB, { accountId: bAccount.id, category: "STAFFING", priority: "HIGH", subject: "Short of guards" });
    expect(dflt).toMatchObject({ slaFirstResponseMinutes: 30, slaResolutionMinutes: 120 }); // another account gets the default
    const bare = await world();
    await expect(createStarterPolicies(bare.repA)).rejects.toThrow(/permission/i);
    await createStarterPolicies(bare.admin);
    expect((await listSlaPolicies(bare.admin)).map((p) => p.priority).sort()).toEqual(["CRITICAL", "HIGH", "LOW", "NORMAL"]);
    await expect(createStarterPolicies(bare.admin)).rejects.toThrow(/already default policies/i);
    const gone = (await listSlaPolicies(w.admin)).find((p) => p.accountId === w.account.id)!;
    await removeSlaPolicy(w.admin, gone.id);
    expect((await open(w, { priority: "HIGH" })).slaFirstResponseMinutes).toBe(30); // back to the default
  });
});

describe("opening a case", () => {
  it("works out the deadlines from the policy and the calendar, keeps them when the policy changes, and has no SLA when no policy applies", async () => {
    const w = await world();
    const none = await open(w);
    expect(none).toMatchObject({ slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null });
    expect(none.number).toMatch(/^CS-?\d{5}$/);
    await policy(w, "NORMAL", 100, 400, false);
    const c = await open(w);
    expect(c.firstResponseDueAt!.getTime() - c.openedAt.getTime()).toBe(100 * MIN);
    expect(c.resolutionDueAt!.getTime() - c.openedAt.getTime()).toBe(400 * MIN);
    expect(c.firstResponseWarnAt!.getTime() - c.openedAt.getTime()).toBe(75 * MIN);
    expect(c.resolutionWarnAt!.getTime() - c.openedAt.getTime()).toBe(300 * MIN);
    await policy(w, "NORMAL", 10, 20, false); // a later change
    const again = await db.crmCase.findUniqueOrThrow({ where: { id: c.id } });
    expect([again.firstResponseDueAt!.getTime(), again.resolutionDueAt!.getTime()]).toEqual([c.firstResponseDueAt!.getTime(), c.resolutionDueAt!.getTime()]);
    // in business hours: the deadline follows the calendar, with a holiday on top
    await addHoliday(w.admin, { date: new Date(Date.now() + DAY).toISOString().slice(0, 10), name: "A closed day" });
    await policy(w, "HIGH", 8 * 60, 40 * 60, true);
    const bh = await open(w, { priority: "HIGH" });
    const cal = await calendarOf(w.t.org.id);
    expect(iso(bh.firstResponseDueAt!)).toBe(iso(dueAt(bh.openedAt, 480, true, cal)));
    expect(iso(bh.resolutionDueAt!)).toBe(iso(dueAt(bh.openedAt, 2400, true, cal)));
    expect(iso(bh.resolutionWarnAt!)).toBe(iso(warnAt(bh.openedAt, 2400, true, cal)));
    expect(bh.resolutionDueAt!.getTime()).toBeGreaterThan(bh.openedAt.getTime() + 2400 * MIN); // never sooner than the same time around the clock
  });

  it("is opened by sales people on their own accounts and by Operations on any, defaults the owner to the account's owner, and tells an owner it was opened for", async () => {
    const w = await world();
    await expect(open(w, {}, w.repB)).rejects.toThrow(/account not found/i); // not B's account
    const byOps = await open(w, {}, w.ops);
    expect(byOps).toMatchObject({ ownerUserId: w.repA.userId, createdByUserId: w.ops.userId });
    expect((await db.crmNotification.findMany({ where: { organizationId: w.t.org.id, userId: w.repA.userId } })).map((n) => n.title)).toEqual([`Case ${byOps.number} was opened for you`]);
    expect(await db.crmNotification.count({ where: { organizationId: w.t.org.id, userId: w.ops.userId } })).toBe(0);
    await expect(open(w, { ownerUserId: w.repB.userId }, w.repA)).rejects.toThrow(/manager/i);
    expect((await open(w, { ownerUserId: w.repB.userId }, w.admin)).ownerUserId).toBe(w.repB.userId);
    await expect(open(w, {}, w.t.ctx("AUDITOR", null, 1))).rejects.toThrow(/permission/i);
    await expect(open(w, {}, w.t.ctx("FINANCE", null, 1))).rejects.toThrow(/permission/i);
    const other = await world();
    await expect(open(w, {}, other.admin)).rejects.toThrow(/account not found/i);
    await updateSalesSetting(w.admin, { enabled: false });
    await expect(open(w)).rejects.toThrow(/switched off/i);
  });

  it("checks the contact, deal and site belong to this account and client", async () => {
    const w = await world();
    const other = await createAccount(w.repA, { name: "Another Estate" });
    const stranger = await createContact(w.repA, { accountId: other.id, firstName: "Ada", lastName: "Obi" });
    const strangerDeal = await createOpportunity(w.repA, { accountId: other.id, name: "Other deal" });
    await expect(open(w, { contactId: stranger.id })).rejects.toThrow(/not at this account/i);
    await expect(open(w, { opportunityId: strangerDeal.id })).rejects.toThrow(/not this account/i);
    const client = await db.client.create({ data: { organizationId: w.t.org.id, code: "CLT-T1", name: "Lekki Gardens Estate" } });
    const otherClient = await db.client.create({ data: { organizationId: w.t.org.id, code: "CLT-T2", name: "Another Estate" } });
    const mk = (clientId: string, code: string) => db.contract.create({ data: { organizationId: w.t.org.id, clientId, contractNumber: code, name: code, startDate: new Date("2026-01-01") } });
    const beatOf = async (clientId: string, code: string) => db.beat.create({ data: { organizationId: w.t.org.id, clientId, contractId: (await mk(clientId, `C-${code}`)).id, code, name: `Site ${code}` } });
    const mine = await beatOf(client.id, "B1");
    const theirs = await beatOf(otherClient.id, "B2");
    await db.crmAccount.update({ where: { id: w.account.id }, data: { clientId: client.id } });
    expect((await open(w, { contactId: w.contact.id, opportunityId: w.deal.id, beatId: mine.id })).beatId).toBe(mine.id);
    await expect(open(w, { beatId: theirs.id })).rejects.toThrow(/not one of this client/i);
  });
});

describe("answering, resolving and reopening", () => {
  it("stops the first-response clock at the first answer only, keeps a history, and a resolved case must be reopened before it is answered", async () => {
    const w = await world();
    await policy(w, "NORMAL", 100, 400);
    const c = await open(w);
    await expect(respondToCase(w.repA, c.id, "")).rejects.toThrow(/what you told the client/i);
    await expect(respondToCase(w.repB, c.id, "x")).rejects.toThrow(/case not found/i);
    const first = await respondToCase(w.ops, c.id, "Guard replaced; supervisor on the way");
    const stamp = first.firstRespondedAt!.getTime();
    await respondToCase(w.repA, c.id, "Called the estate manager");
    expect((await db.crmCase.findUniqueOrThrow({ where: { id: c.id } })).firstRespondedAt!.getTime()).toBe(stamp);
    await addCaseNote(w.repA, c.id, "Guard was on leave");
    await expect(resolveCase(w.repA, c.id, "")).rejects.toThrow(/how the case was resolved/i);
    const done = await resolveCase(w.repA, c.id, "Permanent replacement posted");
    expect(done).toMatchObject({ status: "RESOLVED" });
    await expect(resolveCase(w.repA, c.id, "again")).rejects.toThrow(/already resolved/i);
    await expect(respondToCase(w.repA, c.id, "late answer")).rejects.toThrow(/reopened before it can be answered/i);
    const full = await getCase(w.repA, c.id);
    expect(full.events.map((e) => e.kind)).toEqual(["OPENED", "RESPONDED", "RESPONDED", "NOTE", "RESOLVED"]);
    expect(full.firstResponse).toBe("MET");
    expect(full.resolution).toBe("MET");
  });

  it("resolving answers an unanswered case; reopening restarts the resolution clock from now, not the first response, and is counted and reported separately", async () => {
    const w = await world();
    await policy(w, "NORMAL", 100, 400);
    const c = await open(w);
    await expect(reopenCase(w.repA, c.id, "x")).rejects.toThrow(/only a resolved case/i);
    const done = await resolveCase(w.repA, c.id, "Fixed");
    expect(done.firstRespondedAt).not.toBeNull();
    await expect(reopenCase(w.repA, c.id, "")).rejects.toThrow(/why the case is being reopened/i);
    await new Promise((r) => setTimeout(r, 20));
    const re = await reopenCase(w.repA, c.id, "Guard absent again");
    expect(re).toMatchObject({ status: "OPEN", reopenedCount: 1, resolvedAt: null, resolutionWarnedAt: null, resolutionBreachedAt: null });
    expect(re.firstRespondedAt!.getTime()).toBe(done.firstRespondedAt!.getTime()); // the first response is not asked for again
    expect(re.resolutionStartedAt.getTime()).toBeGreaterThan(c.openedAt.getTime());
    expect(re.resolutionDueAt!.getTime() - re.resolutionStartedAt.getTime()).toBe(400 * MIN); // a fresh window from the reopening
    expect(re.resolutionDueAt!.getTime()).toBeGreaterThan(c.resolutionDueAt!.getTime());
    await resolveCase(w.repA, c.id, "Fixed again");
    await reopenCase(w.repA, c.id, "And again");
    expect((await db.crmCase.findUniqueOrThrow({ where: { id: c.id } })).reopenedCount).toBe(2);
    const other = await open(w);
    expect((await listCases(w.repA, { reopened: true })).map((x) => x.id)).toEqual([c.id]);
    expect((await listCases(w.repA)).map((x) => x.id).sort()).toEqual([c.id, other.id].sort());
  });

  it("lets only a manager give a case to someone else, and tells them", async () => {
    const w = await world();
    const c = await open(w);
    await expect(reassignCase(w.repA, c.id, w.repB.userId)).rejects.toThrow(/manager/i);
    await reassignCase(w.admin, c.id, w.repB.userId);
    expect((await db.crmCase.findUniqueOrThrow({ where: { id: c.id } })).ownerUserId).toBe(w.repB.userId);
    expect(await db.crmNotification.count({ where: { organizationId: w.t.org.id, userId: w.repB.userId } })).toBe(1);
    expect((await getCase(w.admin, c.id)).events.map((e) => e.kind)).toEqual(["OPENED", "REASSIGNED"]);
  });
});

describe("the SLA clocks: warnings, breaches and escalation", () => {
  it("warns the owner at 75% once, flags a breach once and tells the sales managers, and does not repeat when the job runs again", async () => {
    const w = await world();
    await policy(w, "NORMAL", 100, 200);
    const c = await open(w);
    const t0 = c.openedAt.getTime();
    expect(await runCaseSlaJob(new Date(t0 + 74 * MIN), { orgId: w.t.org.id })).toEqual({ warned: 0, breached: 0, escalated: 0 });
    expect(await runCaseSlaJob(new Date(t0 + 76 * MIN), { orgId: w.t.org.id })).toMatchObject({ warned: 1, breached: 0 });
    expect(await runCaseSlaJob(new Date(t0 + 77 * MIN), { orgId: w.t.org.id })).toMatchObject({ warned: 0 }); // not again
    expect(mail.mock.calls.filter((m) => m[0].to === w.repA.email)).toHaveLength(1);
    const warned = await db.crmNotification.findMany({ where: { organizationId: w.t.org.id, userId: w.repA.userId } });
    expect(warned.map((n) => n.title)).toContain(`Case ${c.number}: 75% of the first response time has gone`);
    expect(await db.crmNotification.count({ where: { organizationId: w.t.org.id, userId: w.admin.userId } })).toBe(0); // a warning goes to the owner only
    expect(await runCaseSlaJob(new Date(t0 + 101 * MIN), { orgId: w.t.org.id })).toMatchObject({ warned: 0, breached: 1, escalated: 1 });
    expect(await runCaseSlaJob(new Date(t0 + 102 * MIN), { orgId: w.t.org.id })).toMatchObject({ breached: 0, escalated: 0 });
    expect((await db.crmNotification.findMany({ where: { organizationId: w.t.org.id, userId: w.admin.userId } })).map((n) => n.title)).toEqual([`Case ${c.number}: the first response time was missed`]); // the escalation
    // the resolution window: 75% at 150, missed after 200
    await runCaseSlaJob(new Date(t0 + 151 * MIN), { orgId: w.t.org.id });
    expect(await db.crmCase.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ resolutionWarnedAt: expect.any(Date), resolutionBreachedAt: null });
    await runCaseSlaJob(new Date(t0 + 201 * MIN), { orgId: w.t.org.id });
    expect((await db.crmCase.findUniqueOrThrow({ where: { id: c.id } })).resolutionBreachedAt).not.toBeNull();
    expect((await getCase(w.admin, c.id)).events.map((e) => e.kind)).toEqual(["OPENED", "WARNING", "BREACH", "ESCALATED", "WARNING", "BREACH", "ESCALATED"]);
  });

  it("does not warn or breach a clock that has been met, or a resolved case; a reopened case can warn again", async () => {
    const w = await world();
    await policy(w, "NORMAL", 100, 200);
    const a = await open(w);
    await respondToCase(w.repA, a.id, "Answered in time");
    await runCaseSlaJob(new Date(a.openedAt.getTime() + 150 * MIN), { orgId: w.t.org.id });
    const afterAnswer = await db.crmCase.findUniqueOrThrow({ where: { id: a.id } });
    expect([afterAnswer.firstResponseWarnedAt, afterAnswer.firstResponseBreachedAt]).toEqual([null, null]); // answered: its clock is done
    expect(afterAnswer.resolutionWarnedAt).not.toBeNull(); // the resolution window is still running
    await resolveCase(w.repA, a.id, "Done");
    const before = (await getCase(w.admin, a.id)).events.length;
    await runCaseSlaJob(new Date(a.openedAt.getTime() + 500 * MIN), { orgId: w.t.org.id });
    expect((await getCase(w.admin, a.id)).events).toHaveLength(before); // resolved: nothing more
    const re = await reopenCase(w.repA, a.id, "Back again");
    expect(re.resolutionWarnedAt).toBeNull();
    await runCaseSlaJob(new Date(re.resolutionStartedAt.getTime() + 151 * MIN), { orgId: w.t.org.id });
    expect((await db.crmCase.findUniqueOrThrow({ where: { id: a.id } })).resolutionWarnedAt).not.toBeNull(); // warned afresh
  });

  it("shows a missed deadline at once, without waiting for the job, and lists breached cases", async () => {
    const w = await world();
    await policy(w, "NORMAL", 100, 200);
    const c = await open(w);
    const fine = await open(w);
    expect((await getCase(w.repA, c.id)).firstResponse).toBe("OK");
    await db.crmCase.update({ where: { id: c.id }, data: { firstResponseDueAt: new Date(Date.now() - MIN), firstResponseWarnAt: new Date(Date.now() - 2 * MIN) } });
    expect((await getCase(w.repA, c.id)).firstResponse).toBe("BREACHED");
    expect((await listCases(w.repA, { breached: true })).map((x) => x.id)).toEqual([c.id]);
    expect(fine.id).not.toBe(c.id);
    await respondToCase(w.repA, c.id, "Late answer");
    expect((await getCase(w.repA, c.id)).firstResponse).toBe("LATE");
  });
});

describe("what a salesperson, Operations and another organization can see", () => {
  it("keeps a salesperson to the cases of their own accounts, lets Operations and managers see all, and keeps organizations apart", async () => {
    const w = await world();
    const other = await world();
    const c = await open(w);
    await expect(getCase(w.repB, c.id)).rejects.toThrow(/not found/i);
    expect(await listCases(w.repB)).toEqual([]);
    expect((await getCase(w.ops, c.id)).id).toBe(c.id);
    expect((await listCases(w.admin)).map((x) => x.id)).toEqual([c.id]);
    await expect(getCase(other.admin, c.id)).rejects.toThrow(/not found/i);
    expect(await listCases(other.admin)).toEqual([]);
    await expect(getCase(w.t.ctx("AUDITOR", null, 1), c.id)).rejects.toThrow(/permission/i);
    expect(["BUSINESS_DEV", "OPERATIONS", "COMPANY_ADMIN"].map((r) => can(r as never, "sales.case.manage"))).toEqual([true, true, true]);
    expect(["AUDITOR", "FINANCE", "HR_ADMIN", "PAYROLL_ADMIN", "SUPERVISOR"].map((r) => can(r as never, "sales.case.manage"))).toEqual([false, false, false, false, false]);
  });

  it("shows its history on the account and contact timelines", async () => {
    const w = await world();
    const c = await open(w, { contactId: w.contact.id, priority: "HIGH" });
    await respondToCase(w.repA, c.id, "Spoke to the manager");
    await resolveCase(w.repA, c.id, "Fixed");
    const acc = await timeline(w.repA, { accountId: w.account.id });
    const cases = acc.filter((i) => i.type === "CASE");
    expect(cases.map((i) => i.title).sort()).toEqual([`Case ${c.number}: answered`, `Case ${c.number}: opened (high)`, `Case ${c.number}: resolved`].sort());
    expect((await timeline(w.repA, { contactId: w.contact.id })).filter((i) => i.type === "CASE")).toHaveLength(3);
    expect((await timeline(w.repA, { opportunityId: w.deal.id })).filter((i) => i.type === "CASE")).toHaveLength(0);
    await expect(timeline(w.repB, { accountId: w.account.id })).rejects.toThrow(/not found/i);
  });
});

describe("renewals", () => {
  async function contractFor(w: W, over: { name: string; endInDays: number; status?: "ACTIVE" | "DRAFT"; linkAccount?: boolean; handoverValue?: string }) {
    const client = await db.client.create({ data: { organizationId: w.t.org.id, code: `CLT-${over.name}`, name: over.name } });
    const contract = await db.contract.create({ data: { organizationId: w.t.org.id, clientId: client.id, contractNumber: `CON-${over.name}`, name: over.name, startDate: new Date("2026-01-01"), endDate: new Date(Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z") + over.endInDays * DAY), status: over.status ?? "ACTIVE" } });
    let account = w.account;
    if (over.linkAccount !== false) {
      account = over.name === "main" ? w.account : await createAccount(w.repA, { name: `Account of ${over.name}` });
      await db.crmAccount.update({ where: { id: account.id }, data: { clientId: client.id } });
    }
    if (over.handoverValue) {
      const deal = await createOpportunity(w.repA, { accountId: account.id, name: `Won ${over.name}`, monthlyContractValue: over.handoverValue });
      const quote = await db.crmQuote.create({ data: { organizationId: w.t.org.id, opportunityId: deal.id, number: `SQ-${over.name}`, versionNo: 1, status: "ACCEPTED", createdBy: "x", createdByUserId: w.repA.userId } });
      await db.crmHandover.create({ data: { organizationId: w.t.org.id, number: `HO-${over.name}`, opportunityId: deal.id, quoteId: quote.id, accountId: account.id, quoteNumber: quote.number, quoteVersion: 1, monthlyBill: over.handoverValue, preparedBy: "x", preparedByUserId: w.repA.userId, contractId: contract.id, clientId: client.id } });
    }
    return { client, contract, account };
  }

  it("opens one renewal deal for each contract ending within the window, once, pre-filled, and tells the account's owner", async () => {
    const w = await world();
    const k = await contractFor(w, { name: "main", endInDays: 30, handoverValue: "1440000.00" });
    const res = await runRenewalsJob(new Date(), { orgId: w.t.org.id });
    expect(res).toMatchObject({ created: 1, alreadyOpen: 0, noAccount: 0 });
    const link = await db.crmRenewalLink.findUniqueOrThrow({ where: { contractId: k.contract.id } });
    const opp = await db.crmOpportunity.findUniqueOrThrow({ where: { id: link.opportunityId }, include: { pipeline: true, stage: true } });
    expect(opp).toMatchObject({ name: "Renewal: main", accountId: w.account.id, ownerUserId: w.repA.userId, primaryContactId: w.contact.id, source: "EXISTING_CLIENT" });
    expect(Number(opp.monthlyContractValue)).toBe(1440000);
    expect(opp.pipeline).toMatchObject({ kind: "RENEWAL", name: "Renewals" });
    expect(opp.stage.name).toBe("Review due");
    expect(opp.expectedCloseDate!.getTime()).toBe(k.contract.endDate!.getTime());
    expect((await db.crmNotification.findMany({ where: { organizationId: w.t.org.id, userId: w.repA.userId } })).map((n) => n.title)).toEqual(["Renewal due: main"]);
    expect(await runRenewalsJob(new Date(), { orgId: w.t.org.id })).toMatchObject({ created: 0, alreadyOpen: 1 }); // never a second one
    expect(await db.crmOpportunity.count({ where: { organizationId: w.t.org.id, pipeline: { kind: "RENEWAL" } } })).toBe(1);
  });

  it("leaves out contracts outside the window or not active, counts those whose client has no sales account, and opens a renewal with no known value at zero", async () => {
    const w = await world();
    await contractFor(w, { name: "far", endInDays: 200 });
    await contractFor(w, { name: "draft", endInDays: 20, status: "DRAFT" });
    await contractFor(w, { name: "orphan", endInDays: 20, linkAccount: false });
    await contractFor(w, { name: "legacy", endInDays: 45 }); // no handover: its value is not known
    const res = await runRenewalsJob(new Date(), { orgId: w.t.org.id });
    expect(res).toMatchObject({ created: 1, noAccount: 1 });
    const opp = await db.crmOpportunity.findFirstOrThrow({ where: { organizationId: w.t.org.id, pipeline: { kind: "RENEWAL" } } });
    expect(opp.name).toBe("Renewal: legacy");
    expect(Number(opp.monthlyContractValue)).toBe(0);
    expect((await db.crmNotification.findFirstOrThrow({ where: { organizationId: w.t.org.id, title: "Renewal due: legacy" } })).body).toMatch(/not known: set it/);
    await expect(setRenewalWindow(w.repA, 250)).rejects.toThrow(/permission/i);
    await expect(setRenewalWindow(w.admin, 0)).rejects.toThrow(/between 1 and 365/i);
    await setRenewalWindow(w.admin, 250); // a wider window now takes in the far contract
    expect(await runRenewalsJob(new Date(), { orgId: w.t.org.id })).toMatchObject({ created: 1, alreadyOpen: 1 });
  });

  it("is refused a second renewal for a contract by the database itself, and does not run for an organization with the module off", async () => {
    const w = await world();
    const k = await contractFor(w, { name: "main", endInDays: 10, handoverValue: "500000.00" });
    await runRenewalsJob(new Date(), { orgId: w.t.org.id });
    const link = await db.crmRenewalLink.findUniqueOrThrow({ where: { contractId: k.contract.id } });
    await expect(db.crmRenewalLink.create({ data: { organizationId: w.t.org.id, contractId: k.contract.id, opportunityId: link.opportunityId } })).rejects.toThrow(/unique/i);
    const off = await world();
    await contractFor(off, { name: "main", endInDays: 10 });
    await updateSalesSetting(off.admin, { enabled: false });
    expect(await runRenewalsJob(new Date(), { orgId: off.t.org.id })).toEqual({ created: 0, alreadyOpen: 0, noAccount: 0 });
  });
});

describe("the history and the audit log", () => {
  it("cannot be changed or deleted, and the audit log holds ids, numbers and priorities but not what was written", async () => {
    const w = await world();
    await policy(w, "NORMAL", 100, 400);
    const c = await createCase(w.repA, { accountId: w.account.id, category: "COMPLAINT", priority: "NORMAL", subject: "Secret subject line", description: "Secret description", contactId: w.contact.id });
    await respondToCase(w.repA, c.id, "Secret answer");
    await addCaseNote(w.repA, c.id, "Secret note");
    await resolveCase(w.repA, c.id, "Secret resolution");
    await reopenCase(w.repA, c.id, "Secret reason");
    const events = await db.crmCaseEvent.findMany({ where: { caseId: c.id } });
    await expect(db.crmCaseEvent.update({ where: { id: events[0].id }, data: { note: "edited" } })).rejects.toThrow(/cannot be changed or deleted/i);
    await expect(db.crmCaseEvent.delete({ where: { id: events[0].id } })).rejects.toThrow(/cannot be changed or deleted/i);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_CASE" } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["SALES_CASE_NOTE", "SALES_CASE_OPEN", "SALES_CASE_REOPEN", "SALES_CASE_RESOLVE", "SALES_CASE_RESPOND"]);
    const text = JSON.stringify(rows.map((r) => [r.oldValue, r.newValue, r.reason]));
    for (const secret of ["Secret", "Funmi", "Bello", "funmi@lekki.test", "Lekki Gardens"]) expect(text).not.toContain(secret);
    expect(rows.find((r) => r.action === "SALES_CASE_OPEN")!.newValue).toMatchObject({ priority: "NORMAL", category: "COMPLAINT", hasSla: true });
  });
});
