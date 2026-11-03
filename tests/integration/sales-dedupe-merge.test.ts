import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canSendMarketing, consentStatus, recordConsent } from "@/server/services/sales/consent";
import { findAccountDuplicates, findPersonDuplicates } from "@/server/services/sales/duplicates";
import { mergeAccounts, mergeContacts } from "@/server/services/sales/merge";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { createAccount, createContact, createLead, getAccount } from "@/server/services/sales/records";
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

describe("finding duplicates without leaking other people's records", () => {
  it("tells a sales person that a match exists and who owns it, but not what it is; a manager sees it", async () => {
    const w = await world();
    await createAccount(w.repB, { name: "ABC Security Ltd", rcNumber: "RC123456" });
    const mine = await createAccount(w.repA, { name: "Ikoyi Towers" });
    const r = await findAccountDuplicates(w.repA, { name: "A.B.C. Security Limited" });
    expect(r.visible).toEqual([]);
    expect(r.hidden).toEqual([{ ownerName: w.repB.name, reason: "Same company name" }]);
    expect(JSON.stringify(r)).not.toMatch(/ABC|RC123456/);
    const m = await findAccountDuplicates(w.admin, { name: "A.B.C. Security Limited" });
    expect(m.visible).toMatchObject([{ label: "ABC Security Ltd", reason: "Same company name" }]);
    expect(m.hidden).toEqual([]);
    // a record of one's own is shown in full, and the record being edited is not a duplicate of itself
    expect((await findAccountDuplicates(w.repA, { name: "Ikoyi Towers" })).visible).toMatchObject([{ id: mine.id }]);
    expect((await findAccountDuplicates(w.repA, { name: "Ikoyi Towers" }, mine.id)).visible).toEqual([]);
  });

  it("finds a person by phone or email across leads and contacts, ignoring converted and voided leads, and never across organizations", async () => {
    const w = await world();
    const other = await world();
    await createLead(w.repB, { companyName: "B Lead", phone: "0803 123 4567", email: "n@lekkigardens.test" });
    await createContact(w.repA, { firstName: "Ada", lastName: "Obi", email: "ada@acme.test" });
    await createLead(other.repA, { companyName: "Other org", phone: "0803 123 4567" });
    const r = await findPersonDuplicates(w.repA, { phone: "+234 803 123 4567" });
    expect(r.visible).toEqual([]);
    expect(r.hidden).toEqual([{ ownerName: w.repB.name, reason: "Same phone number" }]);
    expect((await findPersonDuplicates(w.repA, { email: "ADA@acme.test" })).visible).toMatchObject([{ kind: "CONTACT", reason: "Same email address" }]);
    expect((await findPersonDuplicates(w.admin, { phone: "0803 123 4567" })).visible).toHaveLength(1); // only this organization's
    await db.crmLead.updateMany({ where: { organizationId: w.t.org.id }, data: { status: "CONVERTED" } });
    expect((await findPersonDuplicates(w.admin, { phone: "0803 123 4567" })).visible).toEqual([]);
    expect((await findPersonDuplicates(w.admin, {})).visible).toEqual([]);
  });
});

describe("merging accounts", () => {
  it("keeps the survivor's values, fills its empty ones, takes the other's where a manager says so, re-points everything and voids the loser", async () => {
    const w = await world();
    const survivor = await createAccount(w.repA, { name: "Lekki Gardens Estate", state: "Abuja", accountType: "PROSPECT" });
    const loser = await createAccount(w.repA, { name: "LEKKI GARDENS ESTATE LTD", industry: "Real estate", state: "Lagos", address: "1 Admiralty Way", rcNumber: "RC555" });
    const c = await createContact(w.repA, { accountId: loser.id, firstName: "Ngozi", lastName: "Okoro" });
    const opp = await createOpportunity(w.repA, { accountId: loser.id, name: "24/7 guarding" });
    const child = await createAccount(w.repA, { name: "Lekki Gardens Phase 2", parentAccountId: loser.id });

    const merged = await mergeAccounts(w.admin, { survivorId: survivor.id, loserId: loser.id, take: { address: "LOSER", state: "LOSER" } });
    expect(merged).toMatchObject({ industry: "Real estate", state: "Lagos", address: "1 Admiralty Way", rcNumber: "RC555", name: "Lekki Gardens Estate" });
    expect(await db.crmContact.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ accountId: survivor.id });
    expect(await db.crmOpportunity.findUniqueOrThrow({ where: { id: opp.id } })).toMatchObject({ accountId: survivor.id });
    expect(await db.crmAccount.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ parentAccountId: survivor.id });
    expect(await db.crmAccount.findUniqueOrThrow({ where: { id: loser.id } })).toMatchObject({ status: "VOID", mergedIntoId: survivor.id });
    expect((await getAccount(w.admin, loser.id)).voidReason).toMatch(/merged/i);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SALES_ACCOUNT_MERGE" } });
    expect(audit.entityId).toBe(survivor.id);
    expect(JSON.stringify(audit)).not.toMatch(/Lekki|Ngozi|Admiralty|RC555/);
  });

  it("is for managers only, refuses merging a record with itself or a voided one, and never reaches another organization", async () => {
    const w = await world();
    const other = await world();
    const a = await createAccount(w.repA, { name: "One" });
    const b = await createAccount(w.repA, { name: "Two" });
    const foreign = await createAccount(other.repA, { name: "Foreign" });
    await expect(mergeAccounts(w.repA, { survivorId: a.id, loserId: b.id })).rejects.toThrow(/manager/i);
    await expect(mergeAccounts(w.admin, { survivorId: a.id, loserId: a.id })).rejects.toThrow(/itself/i);
    await expect(mergeAccounts(w.admin, { survivorId: a.id, loserId: foreign.id })).rejects.toThrow(/not found/);
    await db.crmAccount.update({ where: { id: b.id }, data: { status: "VOID" } });
    await expect(mergeAccounts(w.admin, { survivorId: a.id, loserId: b.id })).rejects.toThrow(/voided/i);
    expect(await db.crmAccount.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ status: "ACTIVE", mergedIntoId: null });
  });
});

describe("merging contacts", () => {
  it("re-points deals, fills empty fields, and keeps the consent history of both so a withdrawal is never lost", async () => {
    const w = await world();
    const acct = await createAccount(w.repA, { name: "Acme" });
    const survivor = await createContact(w.repA, { firstName: "Ngozi", lastName: "Okoro", accountId: acct.id });
    const loser = await createContact(w.repA, { firstName: "N.", lastName: "Okoro", phone: "0803 123 4567", email: "n@acme.test", jobTitle: "Facility manager" });
    const opp = await createOpportunity(w.repA, { accountId: acct.id, primaryContactId: loser.id, name: "Deal" });
    // the survivor granted marketing earlier; the other record withdrew it later
    await recordConsent(w.repA, { contactId: survivor.id, purpose: "MARKETING", status: "GRANTED", channel: "EMAIL", source: "website form" });
    await recordConsent(w.repA, { contactId: loser.id, purpose: "MARKETING", status: "WITHDRAWN", channel: "EMAIL", source: "unsubscribe link" });

    const merged = await mergeContacts(w.admin, { survivorId: survivor.id, loserId: loser.id });
    expect(merged).toMatchObject({ phoneE164: "+2348031234567", email: "n@acme.test", jobTitle: "Facility manager", firstName: "Ngozi", accountId: acct.id });
    expect(await db.crmOpportunity.findUniqueOrThrow({ where: { id: opp.id } })).toMatchObject({ primaryContactId: survivor.id });
    expect(await db.crmContact.findUniqueOrThrow({ where: { id: loser.id } })).toMatchObject({ status: "VOID", mergedIntoId: survivor.id });
    expect(await consentStatus(w.repA, { contactId: survivor.id, purpose: "MARKETING" })).toBe("WITHDRAWN");
    expect(await canSendMarketing(w.repA, { contactId: survivor.id })).toBe(false);
    // consent rows were not touched (they cannot be)
    expect(await db.crmConsent.count({ where: { contactId: loser.id } })).toBe(1);
    // a later grant on the survivor wins again
    await recordConsent(w.repA, { contactId: survivor.id, purpose: "MARKETING", status: "GRANTED", channel: "WHATSAPP", source: "replied YES" });
    expect(await canSendMarketing(w.repA, { contactId: survivor.id })).toBe(true);
  });

  it("is for managers only", async () => {
    const w = await world();
    const a = await createContact(w.repA, { firstName: "A", lastName: "One" });
    const b = await createContact(w.repA, { firstName: "B", lastName: "Two" });
    await expect(mergeContacts(w.repA, { survivorId: a.id, loserId: b.id })).rejects.toThrow(/manager/i);
  });
});
