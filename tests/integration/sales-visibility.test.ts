import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createAccount, createContact, createLead, listAccounts, listContacts, listLeads } from "@/server/services/sales/records";
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

describe("a sales person's own-records limit cannot be widened by a filter", () => {
  it("asking for someone else's owner id still shows only the caller's own records (leads, accounts and contacts)", async () => {
    const w = await world();
    await createLead(w.repA, { companyName: "A Lead" });
    await createLead(w.repB, { companyName: "B Lead" });
    await createAccount(w.repA, { name: "A Account" });
    await createAccount(w.repB, { name: "B Account" });
    await createContact(w.repA, { firstName: "A", lastName: "Contact" });
    await createContact(w.repB, { firstName: "B", lastName: "Contact" });

    // repA asks for repB's records by owner: the owner limit still applies, so nothing of repB's is returned
    expect((await listLeads(w.repA, { ownerUserId: w.repB.userId })).map((l) => l.companyName)).toEqual([]);
    expect((await listAccounts(w.repA, { ownerUserId: w.repB.userId })).map((a) => a.name)).toEqual([]);
    // asking for their own is fine
    expect((await listLeads(w.repA, { ownerUserId: w.repA.userId })).map((l) => l.companyName)).toEqual(["A Lead"]);
    expect((await listAccounts(w.repA, { ownerUserId: w.repA.userId })).map((a) => a.name)).toEqual(["A Account"]);
    expect((await listContacts(w.repA)).map((c) => c.lastName)).toEqual(["Contact"]);
    expect((await listContacts(w.repA)).map((c) => c.firstName)).toEqual(["A"]);
  });

  it("lets a manager, who sees everything, narrow the list to one person", async () => {
    const w = await world();
    await createLead(w.repA, { companyName: "A Lead" });
    await createLead(w.repB, { companyName: "B Lead" });
    await createAccount(w.repA, { name: "A Account" });
    await createAccount(w.repB, { name: "B Account" });
    expect((await listLeads(w.admin, { ownerUserId: w.repB.userId })).map((l) => l.companyName)).toEqual(["B Lead"]);
    expect((await listAccounts(w.admin, { ownerUserId: w.repA.userId })).map((a) => a.name)).toEqual(["A Account"]);
    expect((await listLeads(w.admin)).length).toBe(2);
  });
});
