import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { consentStatus, canSendMarketing, recordConsent } from "@/server/services/sales/consent";
import { createAccount, createContact, createLead, getLead, listAccounts, listContacts, listLeads, updateAccount, updateLead, voidAccount, voidLead } from "@/server/services/sales/records";
import { getSalesSetting, updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

/** A throw-away organization with the sales module switched on, and the people who work in it. */
async function world(enabled = true) {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  // real users, so an owner can be reassigned to them
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  if (enabled) await updateSalesSetting(admin, { enabled: true });
  return { t, admin, repA, repB };
}

const lead = { companyName: "Lekki Gardens Estate", contactName: "Ngozi Okoro", phone: "0803 123 4567", email: "Ngozi.Okoro@lekkigardens.test", source: "WHATSAPP" as const, estimatedGuards: 18, serviceInterest: "GUARDING" as const };

describe("the sales module switch", () => {
  it("is off by default, can be turned on only by someone who configures it, and while off nothing can be created or read", async () => {
    const w = await world(false);
    expect(await getSalesSetting(w.admin)).toMatchObject({ enabled: false, mode: "CLASSIC" });
    await expect(createLead(w.repA, lead)).rejects.toThrow(/switched off/);
    await expect(listLeads(w.repA)).rejects.toThrow(/switched off/);
    await expect(createAccount(w.admin, { name: "Acme Ltd" })).rejects.toThrow(/switched off/);
    expect(await db.crmLead.count({ where: { organizationId: w.t.org.id } })).toBe(0);

    await expect(updateSalesSetting(w.repA, { enabled: true })).rejects.toThrow(/permission/);
    await updateSalesSetting(w.admin, { enabled: true, mode: "SIMPLE" });
    expect(await getSalesSetting(w.admin)).toMatchObject({ enabled: true, mode: "SIMPLE" });
    await createLead(w.repA, lead); // now it works
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SALES_SETTING_UPDATE" } })).toBe(1);
    // switching it off again stops everything, and keeps what was entered
    await updateSalesSetting(w.admin, { enabled: false });
    await expect(listLeads(w.admin)).rejects.toThrow(/switched off/);
    expect(await db.crmLead.count({ where: { organizationId: w.t.org.id } })).toBe(1);
  });
});

describe("who may do what", () => {
  it("lets only the sales roles in: others, including read-only roles, are refused by the server", async () => {
    const w = await world();
    for (const role of ["AUDITOR", "EMPLOYEE", "CLIENT_APPROVER", "CLIENT_HR", "HR_ADMIN", "PAYROLL_ADMIN", "SUPERVISOR"] as const) {
      const c = w.t.ctx(role, null, 1);
      await expect(listLeads(c), role).rejects.toThrow(/permission/);
      await expect(createLead(c, lead), role).rejects.toThrow(/permission/);
    }
    // operations and finance may read everything but change nothing
    await createLead(w.repA, lead);
    for (const role of ["OPERATIONS", "FINANCE"] as const) {
      const c = w.t.ctx(role, null, 1);
      expect((await listLeads(c)).length, role).toBe(1);
      await expect(createLead(c, lead), role).rejects.toThrow(/permission/);
      await expect(createAccount(c, { name: "Nope Ltd" }), role).rejects.toThrow(/permission/);
    }
  });

  it("shows a sales person only their own records, shows managers everything, and lets only a manager reassign an owner", async () => {
    const w = await world();
    const mine = await createLead(w.repA, lead);
    const theirs = await createLead(w.repB, { ...lead, companyName: "Ikoyi Towers" });
    expect(mine.ownerUserId).toBe(w.repA.userId);
    expect((await listLeads(w.repA)).map((l) => l.id)).toEqual([mine.id]);
    expect((await listLeads(w.repB)).map((l) => l.id)).toEqual([theirs.id]);
    expect((await listLeads(w.admin)).map((l) => l.id).sort()).toEqual([mine.id, theirs.id].sort());
    await expect(getLead(w.repB, mine.id)).rejects.toThrow(/not found/);
    await expect(updateLead(w.repB, mine.id, { status: "CONTACTED" })).rejects.toThrow(/not found/);
    await expect(voidLead(w.repB, mine.id, "not theirs")).rejects.toThrow(/not found/);

    await updateLead(w.repA, mine.id, { status: "CONTACTED" });
    await expect(updateLead(w.repA, mine.id, { ownerUserId: w.repB.userId })).rejects.toThrow(/permission|reassign/i);
    await updateLead(w.admin, mine.id, { ownerUserId: w.repB.userId });
    expect((await listLeads(w.repB)).map((l) => l.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(await listLeads(w.repA)).toEqual([]);
  });
});

describe("accounts, contacts and leads", () => {
  it("stores phones in one international form and emails in lower case, and refuses a phone it cannot read", async () => {
    const w = await world();
    const l = await createLead(w.repA, lead);
    expect(l).toMatchObject({ phoneE164: "+2348031234567", email: "ngozi.okoro@lekkigardens.test", status: "NEW" });
    const a = await createAccount(w.repA, { name: "Lekki Gardens Estate Ltd", industry: "Real estate", accountType: "PROSPECT" });
    const c = await createContact(w.repA, { accountId: a.id, firstName: "Ngozi", lastName: "Okoro", phone: "+234 803 123 4567", whatsapp: "08031234567", roleInDecision: "DECISION_MAKER", isPrimary: true });
    expect(c).toMatchObject({ phoneE164: "+2348031234567", whatsappE164: "+2348031234567", accountId: a.id });
    await expect(createLead(w.repA, { ...lead, phone: "12345" })).rejects.toThrow(/phone/i);
    await expect(createContact(w.repA, { firstName: "A", lastName: "B", phone: "+44 7700 900123" })).rejects.toThrow(/phone/i);
    expect((await listContacts(w.repA, { accountId: a.id })).map((x) => x.id)).toEqual([c.id]);
  });

  it("numbers leads without gaps, hides a voided record from lists but keeps it, and treats a converted lead as read-only", async () => {
    const w = await world();
    const l1 = await createLead(w.repA, lead);
    const l2 = await createLead(w.repA, { ...lead, companyName: "Two" });
    const l3 = await createLead(w.repA, { ...lead, companyName: "Three" });
    const n = [l1, l2, l3].map((l) => Number(l.number.replace(/\D/g, "")));
    expect([n[1] - n[0], n[2] - n[1]]).toEqual([1, 1]);
    await voidLead(w.repA, l2.id, "entered twice");
    expect((await listLeads(w.repA)).map((l) => l.id).sort()).toEqual([l1.id, l3.id].sort());
    expect(await db.crmLead.findUniqueOrThrow({ where: { id: l2.id } })).toMatchObject({ status: "VOID", voidedBy: w.repA.name });
    const a = await createAccount(w.repA, { name: "To void Ltd" });
    await voidAccount(w.repA, a.id, "test");
    expect((await listAccounts(w.repA)).map((x) => x.id)).not.toContain(a.id);
    await expect(updateAccount(w.repA, a.id, { name: "Changed" })).rejects.toThrow(/voided/i);

    await db.crmLead.update({ where: { id: l1.id }, data: { status: "CONVERTED" } }); // what Phase 2's conversion will do
    await expect(updateLead(w.repA, l1.id, { companyName: "Edited" })).rejects.toThrow(/converted/i);
    await expect(voidLead(w.repA, l1.id, "no")).rejects.toThrow(/converted/i);
  });

  it("will not link a contact to another organization's account, or let one organization see another's records", async () => {
    const a = await world();
    const b = await world();
    const accA = await createAccount(a.repA, { name: "A's prospect" });
    const leadA = await createLead(a.repA, lead);
    const conA = await createContact(a.repA, { accountId: accA.id, firstName: "A", lastName: "Contact" });
    expect(await listAccounts(b.admin)).toEqual([]);
    expect(await listLeads(b.admin)).toEqual([]);
    expect(await listContacts(b.admin)).toEqual([]);
    await expect(getLead(b.admin, leadA.id)).rejects.toThrow(/not found/);
    await expect(updateAccount(b.admin, accA.id, { name: "hijack" })).rejects.toThrow(/not found/);
    await expect(voidLead(b.admin, leadA.id, "x")).rejects.toThrow(/not found/);
    await expect(createContact(b.admin, { accountId: accA.id, firstName: "B", lastName: "Contact" })).rejects.toThrow(/not found/);
    await expect(recordConsent(b.admin, { contactId: conA.id, purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "web form" })).rejects.toThrow(/not found/);
    expect(await db.crmAccount.findUniqueOrThrow({ where: { id: accA.id } })).toMatchObject({ name: "A's prospect" });
  });
});

describe("the audit trail", () => {
  it("records every action with ids and the names of the fields, never the person's name, phone or email", async () => {
    const w = await world();
    const l = await createLead(w.repA, lead);
    await updateLead(w.repA, l.id, { status: "QUALIFIED", jobTitle: "Facility manager" });
    const a = await createAccount(w.repA, { name: "Lekki Gardens Estate Ltd" });
    const c = await createContact(w.repA, { accountId: a.id, firstName: "Ngozi", lastName: "Okoro", phone: "0803 123 4567", email: "Ngozi.Okoro@lekkigardens.test" });
    await recordConsent(w.repA, { contactId: c.id, purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "website form", evidenceRef: "FORM-77" });
    await voidLead(w.repA, l.id, "Ngozi Okoro asked us to remove her details");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_" } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["SALES_ACCOUNT_CREATE", "SALES_CONSENT_RECORD", "SALES_CONTACT_CREATE", "SALES_LEAD_CREATE", "SALES_LEAD_UPDATE", "SALES_LEAD_VOID", "SALES_SETTING_UPDATE"]);
    const text = JSON.stringify(rows);
    for (const secret of ["Lekki", "Ngozi", "Okoro", "8031234567", "lekkigardens", "Facility manager", "FORM-77"]) expect(text, secret).not.toContain(secret);
    expect(text).toContain("status"); // the field names are there
    expect(rows.find((r) => r.action === "SALES_LEAD_UPDATE")?.entityId).toBe(l.id);
  });
});

describe("marketing consent", () => {
  it("is append-only, the latest record decides, no record means unknown, and only 'granted' allows marketing", async () => {
    const w = await world();
    const c = await createContact(w.repA, { firstName: "Ngozi", lastName: "Okoro", email: "n@example.test" });
    expect(await consentStatus(w.repA, { contactId: c.id, purpose: "MARKETING" })).toBe("UNKNOWN");
    expect(await canSendMarketing(w.repA, { contactId: c.id })).toBe(false);

    await recordConsent(w.repA, { contactId: c.id, purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "website form", evidenceRef: "FORM-77" });
    expect(await consentStatus(w.repA, { contactId: c.id, purpose: "MARKETING" })).toBe("GRANTED");
    expect(await canSendMarketing(w.repA, { contactId: c.id })).toBe(true);
    await recordConsent(w.repA, { contactId: c.id, purpose: "MARKETING", status: "WITHDRAWN", channel: "EMAIL", source: "unsubscribe link" });
    expect(await consentStatus(w.repA, { contactId: c.id, purpose: "MARKETING" })).toBe("WITHDRAWN");
    expect(await canSendMarketing(w.repA, { contactId: c.id })).toBe(false);
    // a service-message record never opens marketing
    await recordConsent(w.repA, { contactId: c.id, purpose: "SERVICE", status: "GRANTED", channel: "EMAIL", source: "contract" });
    expect(await consentStatus(w.repA, { contactId: c.id, purpose: "SERVICE" })).toBe("GRANTED");
    expect(await canSendMarketing(w.repA, { contactId: c.id })).toBe(false);
    // a person who withdrew can opt in again, and the history keeps all of it
    await recordConsent(w.repA, { contactId: c.id, purpose: "MARKETING", status: "GRANTED", channel: "WHATSAPP", source: "replied YES" });
    expect(await canSendMarketing(w.repA, { contactId: c.id })).toBe(true);
    const all = await db.crmConsent.findMany({ where: { contactId: c.id }, orderBy: { seq: "asc" } });
    expect(all.map((r) => `${r.purpose}:${r.status}`)).toEqual(["MARKETING:GRANTED", "MARKETING:WITHDRAWN", "SERVICE:GRANTED", "MARKETING:GRANTED"]);

    await expect(db.crmConsent.update({ where: { id: all[0].id }, data: { status: "WITHDRAWN" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.crmConsent.delete({ where: { id: all[0].id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("works for a lead too, needs a stated source, and refuses a record with no target or two", async () => {
    const w = await world();
    const l = await createLead(w.repA, lead);
    await recordConsent(w.repA, { leadId: l.id, purpose: "MARKETING", status: "GRANTED", channel: "WHATSAPP", source: "asked on the call" });
    expect(await canSendMarketing(w.repA, { leadId: l.id })).toBe(true);
    await expect(recordConsent(w.repA, { leadId: l.id, purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "" })).rejects.toThrow(/source/i);
    await expect(recordConsent(w.repA, { purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "x form" } as never)).rejects.toThrow(/contact or a lead/i);
    // another sales person cannot see or change consent on someone else's lead
    await expect(recordConsent(w.repB, { leadId: l.id, purpose: "MARKETING", status: "WITHDRAWN", channel: "EMAIL", source: "pretend" })).rejects.toThrow(/not found/);
  });
});
