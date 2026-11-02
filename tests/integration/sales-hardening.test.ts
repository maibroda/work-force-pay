import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { emailSendLimiter } from "@/lib/rate-limit";
import { MAX_PAGE_SIZE } from "@/lib/sales/paging";
import { sendEmailTo } from "@/server/services/sales/activities";
import { systemCtx } from "@/server/services/sales/automation";
import { exportCsv, EXPORT_CAP } from "@/server/services/sales/export";
import { countAccounts, countContacts, countLeads, createAccount, createContact, listAccounts, listContacts, listLeads } from "@/server/services/sales/records";
import { countOpportunities, listOpportunities, listPipelines } from "@/server/services/sales/pipelines";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const mail = vi.mocked(sendEmail);
const original = emailSendLimiter.limit;
afterEach(() => {
  emailSendLimiter.limit = original;
  emailSendLimiter.reset();
  mail.mockClear();
});

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  return { t, admin, repA, repB };
}
type W = Awaited<ReturnType<typeof world>>;

/** n leads for one owner, written straight in (the numbers are what the list sorts out by, so they are made to be unique). */
async function leads(w: W, owner: { userId: string; name: string }, n: number, prefix: string) {
  await db.crmLead.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      organizationId: w.t.org.id, number: `${prefix}-${String(i + 1).padStart(4, "0")}`, companyName: `${prefix} Company ${i + 1}`, ownerUserId: owner.userId, ownerName: owner.name, createdBy: owner.name,
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    })),
  });
}

describe("paged lists", () => {
  it("gives each page its own rows, newest first, with no gap and no overlap, and a total that matches", async () => {
    const w = await world();
    await leads(w, w.repA, 130, "L");
    const p1 = await listLeads(w.repA, { page: 1, pageSize: 50 });
    const p2 = await listLeads(w.repA, { page: 2, pageSize: 50 });
    const p3 = await listLeads(w.repA, { page: 3, pageSize: 50 });
    expect([p1.length, p2.length, p3.length]).toEqual([50, 50, 30]);
    const all = [...p1, ...p2, ...p3].map((l) => l.number);
    expect(new Set(all).size).toBe(130); // no overlap
    expect(all[0]).toBe("L-0130"); // newest first
    expect(all[129]).toBe("L-0001");
    expect(await listLeads(w.repA, { page: 4, pageSize: 50 })).toEqual([]);
    expect(await countLeads(w.repA)).toBe(130);
  });

  it("never returns more than the largest page, however much is asked for, and treats a nonsense page as the first", async () => {
    const w = await world();
    await leads(w, w.repA, 130, "M");
    expect((await listLeads(w.repA, { page: 1, pageSize: 100_000 })).length).toBe(MAX_PAGE_SIZE);
    for (const bad of ["0", "-3", "x", "1.5", "999999999999"]) {
      const rows = await listLeads(w.repA, { page: bad, pageSize: bad });
      expect(rows.length, bad).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    }
    expect((await listLeads(w.repA, { page: "x", pageSize: "x" })).map((l) => l.number)).toEqual((await listLeads(w.repA, { page: 1, pageSize: 50 })).map((l) => l.number));
  });

  it("keeps the old behaviour for a caller that asks for no page (the first 500, which pickers use)", async () => {
    const w = await world();
    await leads(w, w.repA, 120, "N");
    expect((await listLeads(w.repA)).length).toBe(120);
  });

  it("applies the viewer's own-records limit to the page and to the total alike", async () => {
    const w = await world();
    await leads(w, w.repA, 60, "A");
    await leads(w, w.repB, 40, "B");
    expect(await countLeads(w.repA)).toBe(60);
    expect(await countLeads(w.repB)).toBe(40);
    expect(await countLeads(w.admin)).toBe(100);
    expect((await listLeads(w.repB, { page: 1, pageSize: 100 })).every((l) => l.ownerUserId === w.repB.userId)).toBe(true);
    expect((await listLeads(w.admin, { page: 1, pageSize: 100 })).length).toBe(100);
  });

  it("pages accounts, contacts and deals in the same way", async () => {
    const w = await world();
    const accounts = await db.crmAccount.createMany({
      data: Array.from({ length: 70 }, (_, i) => ({ organizationId: w.t.org.id, name: `Account ${String(i).padStart(3, "0")}`, normalizedName: `account ${i}`, ownerUserId: w.repA.userId, ownerName: w.repA.name, createdBy: w.repA.name })),
    });
    expect(accounts.count).toBe(70);
    expect(await countAccounts(w.repA)).toBe(70);
    const a1 = await listAccounts(w.repA, { page: 1, pageSize: 50 });
    const a2 = await listAccounts(w.repA, { page: 2, pageSize: 50 });
    expect([a1.length, a2.length]).toEqual([50, 20]);
    expect(a1[0].name).toBe("Account 000");

    const acct = await createAccount(w.repA, { name: "Zed Holdings" });
    for (let i = 0; i < 3; i++) await createContact(w.repA, { accountId: acct.id, firstName: `F${i}`, lastName: `L${i}` });
    expect(await countContacts(w.repA)).toBe(3);
    expect((await listContacts(w.repA, { page: 1, pageSize: 2 })).length).toBe(2);
    expect((await listContacts(w.repA, { page: 2, pageSize: 2 })).length).toBe(1);

    const stage = (await listPipelines(w.admin))[0].stages[0];
    const pipelineId = (await listPipelines(w.admin))[0].id;
    await db.crmOpportunity.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({ organizationId: w.t.org.id, accountId: acct.id, pipelineId, stageId: stage.id, name: `Deal ${i}`, probability: 10, ownerUserId: w.repA.userId, ownerName: w.repA.name, createdBy: w.repA.name, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000) })),
    });
    expect(await countOpportunities(w.repA)).toBe(55);
    expect((await listOpportunities(w.repA, { page: 2, pageSize: 50 })).length).toBe(5);
    expect(await countOpportunities(w.repB)).toBe(0);
  });
});

describe("sending email is rate limited per person", () => {
  async function client(w: W) {
    const a = await createAccount(w.repA, { name: "Lekki Gardens Estate" });
    await db.crmAccount.update({ where: { id: a.id }, data: { accountType: "CLIENT" } });
    return createContact(w.repA, { accountId: a.id, firstName: "Funmi", lastName: "Bello", email: "funmi@lekki.test" });
  }

  it("lets a person send up to the limit in the hour and then asks them to wait, sending nothing more", async () => {
    const w = await world();
    const c = await client(w);
    emailSendLimiter.limit = 2;
    const send = (ctx = w.repA) => sendEmailTo(ctx, { contactId: c.id, subject: "Your guards", body: "On site Monday", purpose: "SERVICE" });
    await send();
    await send();
    await expect(send()).rejects.toThrow(/sent a lot of email/i);
    expect(mail).toHaveBeenCalledTimes(2);
    // another person has their own allowance
    await db.crmAccount.update({ where: { id: c.accountId! }, data: { ownerUserId: w.admin.userId, ownerName: w.admin.name } });
    await db.crmContact.update({ where: { id: c.id }, data: { ownerUserId: w.admin.userId, ownerName: w.admin.name } });
    await send(w.admin);
    expect(mail).toHaveBeenCalledTimes(3);
  });

  it("does not count a refused message (a marketing email to someone who has not agreed) against the person", async () => {
    const w = await world();
    const c = await client(w);
    emailSendLimiter.limit = 1;
    for (let i = 0; i < 3; i++) await expect(sendEmailTo(w.repA, { contactId: c.id, subject: "Our patrol service", body: "Hello", purpose: "MARKETING" })).rejects.toThrow(/agreed/i);
    await sendEmailTo(w.repA, { contactId: c.id, subject: "Your guards", body: "On site Monday", purpose: "SERVICE" });
    expect(mail).toHaveBeenCalledTimes(1);
  });

  it("does not apply to the automation rules, which are not a person", async () => {
    const w = await world();
    const c = await client(w);
    emailSendLimiter.limit = 1;
    const sys = systemCtx(w.t.org.id, "Welcome mail");
    for (let i = 0; i < 3; i++) await sendEmailTo(sys, { contactId: c.id, subject: "Your guards", body: "On site Monday", purpose: "SERVICE" });
    expect(mail).toHaveBeenCalledTimes(3);
  });
});

describe("downloads", () => {
  it("say in the audit log that the cap was not reached, and the cap is a fixed, large number", async () => {
    const w = await world();
    await leads(w, w.repA, 5, "E");
    const out = await exportCsv(w.repA, "LEADS");
    expect(out.rows).toBe(5);
    expect(out.capped).toBe(false);
    expect(EXPORT_CAP).toBe(20_000);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SALES_EXPORT" } });
    expect(audit.newValue).toMatchObject({ kind: "LEADS", rows: 5, capped: false });
  });
});
