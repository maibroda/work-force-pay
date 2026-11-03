import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canSendMarketing, consentStatus, recordConsent } from "@/server/services/sales/consent";
import { convertLead } from "@/server/services/sales/conversion";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { createAccount, createContact, createLead, updateLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  return { t, admin, repA, repB };
}

const lead = { companyName: "Lekki Gardens Estate", contactName: "Ngozi Okoro", jobTitle: "Facility manager", phone: "0803 123 4567", email: "Ngozi.Okoro@lekkigardens.test", industry: "Real estate", state: "Lagos", address: "1 Admiralty Way", source: "WHATSAPP" as const, sourceDetail: "Referred by Mr Bello", serviceInterest: "GUARDING" as const, estimatedGuards: 18 };

describe("converting a lead", () => {
  it("creates an account, a contact and a deal from the lead, carries its source, and makes the lead read-only", async () => {
    const w = await world();
    const l = await createLead(w.repA, lead);
    const r = await convertLead(w.repA, l.id, { account: { create: true }, contact: { create: true }, opportunity: {} });
    const account = await db.crmAccount.findUniqueOrThrow({ where: { id: r.accountId } });
    const contact = await db.crmContact.findUniqueOrThrow({ where: { id: r.contactId } });
    const opp = await db.crmOpportunity.findUniqueOrThrow({ where: { id: r.opportunityId! }, include: { stage: true } });
    expect(account).toMatchObject({ name: "Lekki Gardens Estate", industry: "Real estate", state: "Lagos", address: "1 Admiralty Way", source: "WHATSAPP", sourceDetail: "Referred by Mr Bello", ownerUserId: w.repA.userId, accountType: "PROSPECT" });
    expect(contact).toMatchObject({ firstName: "Ngozi", lastName: "Okoro", jobTitle: "Facility manager", phoneE164: "+2348031234567", email: "ngozi.okoro@lekkigardens.test", accountId: account.id, ownerUserId: w.repA.userId });
    expect(opp).toMatchObject({ accountId: account.id, primaryContactId: contact.id, source: "WHATSAPP", sourceDetail: "Referred by Mr Bello", serviceType: "GUARDING", probability: 10, ownerUserId: w.repA.userId });
    expect(opp.name).toMatch(/^Lekki Gardens Estate - Guarding - [A-Z][a-z]+ \d{4}$/);
    expect(opp.stage.name).toBe("Lead in");
    expect(await db.crmStageHistory.count({ where: { opportunityId: opp.id, fromStageId: null, toStageId: opp.stageId } })).toBe(1);
    expect(await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: "CONVERTED", convertedAccountId: account.id, convertedContactId: contact.id, convertedOpportunityId: opp.id, convertedBy: w.repA.name });
    await expect(updateLead(w.repA, l.id, { companyName: "Edited" })).rejects.toThrow(/converted/i);
    await expect(convertLead(w.repA, l.id, { account: { create: true }, contact: { create: true } })).rejects.toThrow(/converted/i);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SALES_LEAD_CONVERT" } });
    expect(JSON.stringify(audit)).not.toMatch(/Lekki|Ngozi|8031234567|Admiralty/);
  });

  it("into an existing account and contact fills only what is empty, never overwrites a value, and never changes an owner", async () => {
    const w = await world();
    const acct = await createAccount(w.repB, { name: "Lekki Gardens Estate Ltd", industry: "Property" }); // owned by repB, no state yet
    const person = await createContact(w.repB, { accountId: acct.id, firstName: "Ngozi", lastName: "Okoro", phone: "0706 123 4567" }); // has a phone, no email
    const l = await createLead(w.repA, lead);
    const r = await convertLead(w.admin, l.id, { account: { id: acct.id }, contact: { id: person.id }, opportunity: false });
    expect(await db.crmAccount.findUniqueOrThrow({ where: { id: acct.id } })).toMatchObject({ industry: "Property", state: "Lagos", address: "1 Admiralty Way", source: "WHATSAPP", ownerUserId: w.repB.userId, name: "Lekki Gardens Estate Ltd" });
    expect(await db.crmContact.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ phoneE164: "+2347061234567", email: "ngozi.okoro@lekkigardens.test", jobTitle: "Facility manager", ownerUserId: w.repB.userId });
    expect(r).toMatchObject({ accountId: acct.id, contactId: person.id, opportunityId: null });
    expect(await db.crmOpportunity.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await db.crmAccount.count({ where: { organizationId: w.t.org.id } })).toBe(1);
  });

  it("is all or nothing: a failure partway leaves no account, contact or deal and the lead unconverted", async () => {
    const w = await world();
    const l = await createLead(w.repA, lead);
    await expect(convertLead(w.repA, l.id, { account: { create: true }, contact: { create: true }, opportunity: { pipelineId: "no-such-pipeline" } })).rejects.toThrow(/pipeline/i);
    expect(await db.crmAccount.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await db.crmContact.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await db.crmOpportunity.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await db.crmLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: "NEW", convertedAccountId: null });
  });

  it("carries a withdrawal to the contact always, and a grant only when the contact has no record of their own", async () => {
    const w = await world();
    // a new contact: the lead's grant carries over
    const l1 = await createLead(w.repA, lead);
    await recordConsent(w.repA, { leadId: l1.id, purpose: "MARKETING", status: "GRANTED", channel: "WHATSAPP", source: "asked on the call" });
    const r1 = await convertLead(w.repA, l1.id, { account: { create: true }, contact: { create: true } });
    expect(await consentStatus(w.repA, { contactId: r1.contactId, purpose: "MARKETING" })).toBe("GRANTED");
    // a contact who already withdrew: the lead's older grant must not undo it
    const withdrew = await createContact(w.repA, { firstName: "Ada", lastName: "Obi" });
    await recordConsent(w.repA, { contactId: withdrew.id, purpose: "MARKETING", status: "WITHDRAWN", channel: "EMAIL", source: "unsubscribe link" });
    const l2 = await createLead(w.repA, { ...lead, companyName: "Second Co", phone: "0706 111 2222", email: "second@co.test" });
    await recordConsent(w.repA, { leadId: l2.id, purpose: "MARKETING", status: "GRANTED", channel: "WHATSAPP", source: "asked on the call" });
    await convertLead(w.repA, l2.id, { account: { create: true }, contact: { id: withdrew.id }, opportunity: false });
    expect(await canSendMarketing(w.repA, { contactId: withdrew.id })).toBe(false);
    // a contact who had granted, and a lead that withdrew: the withdrawal wins
    const granted = await createContact(w.repA, { firstName: "Bayo", lastName: "Ade" });
    await recordConsent(w.repA, { contactId: granted.id, purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "website form" });
    const l3 = await createLead(w.repA, { ...lead, companyName: "Third Co", phone: "0706 333 4444", email: "third@co.test" });
    await recordConsent(w.repA, { leadId: l3.id, purpose: "MARKETING", status: "WITHDRAWN", channel: "PHONE", source: "said stop on the call" });
    await convertLead(w.repA, l3.id, { account: { create: true }, contact: { id: granted.id }, opportunity: false });
    expect(await canSendMarketing(w.repA, { contactId: granted.id })).toBe(false);
  });

  it("is refused for another sales person's lead, another organization's account, and a lead with no contact person", async () => {
    const w = await world();
    const other = await world();
    const l = await createLead(w.repA, lead);
    await expect(convertLead(w.repB, l.id, { account: { create: true }, contact: { create: true } })).rejects.toThrow(/not found/);
    const foreign = await createAccount(other.repA, { name: "Foreign" });
    await expect(convertLead(w.repA, l.id, { account: { id: foreign.id }, contact: { create: true } })).rejects.toThrow(/not found/);
    const noContact = await createLead(w.repA, { companyName: "No Contact Co" });
    await expect(convertLead(w.repA, noContact.id, { account: { create: true }, contact: { create: true } })).rejects.toThrow(/contact person/i);
    await expect(convertLead(w.t.ctx("AUDITOR", null, 1), l.id, { account: { create: true }, contact: { create: true } })).rejects.toThrow(/permission/);
    expect(await db.crmAccount.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
});

describe("simple mode and deals", () => {
  it("in simple mode a lead is refused and a deal is added straight onto an account, in the first stage with a history row", async () => {
    const w = await world();
    await updateSalesSetting(w.admin, { mode: "SIMPLE" });
    await expect(createLead(w.repA, lead)).rejects.toThrow(/simple mode/i);
    const a = await createAccount(w.repA, { name: "Direct Co" });
    const o = await createOpportunity(w.repA, { accountId: a.id, name: "Direct deal", monthlyContractValue: "1500000.50" });
    expect(await db.crmOpportunity.findUniqueOrThrow({ where: { id: o.id }, include: { stage: true } })).toMatchObject({ probability: 10, stage: { name: "Lead in" } });
    expect(Number((await db.crmOpportunity.findUniqueOrThrow({ where: { id: o.id } })).monthlyContractValue)).toBe(1500000.5);
    expect(await db.crmStageHistory.count({ where: { opportunityId: o.id } })).toBe(1);
  });

  it("accepts at most two decimals on a deal's value and refuses a negative one, instead of rounding quietly", async () => {
    const w = await world();
    const a = await createAccount(w.repA, { name: "Value Co" });
    await expect(createOpportunity(w.repA, { accountId: a.id, name: "Bad", monthlyContractValue: "1500000.505" })).rejects.toThrow(/two decimals/i);
    await expect(createOpportunity(w.repA, { accountId: a.id, name: "Bad", monthlyContractValue: "-5" })).rejects.toThrow(/negative/i);
    expect(await db.crmOpportunity.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
});
