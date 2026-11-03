import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { checkImport } from "@/lib/sales/import";
import { setAssignmentMethod } from "@/server/services/sales/assignment";
import { exportCsv } from "@/server/services/sales/export";
import { commitImport, previewImport } from "@/server/services/sales/import";
import { createAccount, createContact, createLead, voidLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

async function world(enabled = true) {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  if (enabled) await updateSalesSetting(admin, { enabled: true });
  return { t, admin, repA, repB };
}

const HEAD = "Company,Contact Person,Phone,Email,State,Source,Service Wanted,Marketing Consent,Consent Source";

describe("previewing a lead file", () => {
  it("saves nothing, reports row errors, and flags a match owned by someone else without saying what it is", async () => {
    const w = await world();
    await createLead(w.repB, { companyName: "Held By B Ltd", phone: "0803 123 4567" });
    const csv = [HEAD, "Fresh Co,Ada Obi,0706 111 2222,ada@fresh.test,Lagos,Referral,Guarding,,", ",,12345,,,,,,", "Dup Co,Bayo Ade,+234 803 123 4567,,,,,,"].join("\r\n");
    const p = await previewImport(w.repA, "LEADS", csv);
    expect(p.check.summary).toMatchObject({ total: 3, errors: 1 });
    expect(p.duplicates[2]).toBeUndefined();
    expect(p.duplicates[4]).toEqual({ visible: [], hidden: 1 });
    expect(JSON.stringify(p.duplicates)).not.toMatch(/Held By B/);
    expect(await db.crmLead.count({ where: { organizationId: w.t.org.id } })).toBe(1); // nothing was saved
    const m = await previewImport(w.admin, "LEADS", csv);
    expect(m.duplicates[4].visible[0]).toMatch(/Held By B Ltd.*same phone number.*owner BUSINESS_DEV 2/i);
  });

  it("is for people who manage sales only, and only while the module is on", async () => {
    const off = await world(false);
    await expect(previewImport(off.repA, "LEADS", `${HEAD}\r\nA Co,,,,,,,,`)).rejects.toThrow(/switched off/);
    const w = await world();
    for (const role of ["AUDITOR", "OPERATIONS", "FINANCE", "EMPLOYEE"] as const) await expect(previewImport(w.t.ctx(role, null, 1), "LEADS", `${HEAD}\r\nA Co,,,,,,,,`), role).rejects.toThrow(/permission/);
  });
});

describe("importing leads", () => {
  it("refuses a file with errors unless told to leave them out, and leaves out rows that look already held unless told to bring them in", async () => {
    const w = await world();
    await createLead(w.repA, { companyName: "Already Here Ltd", phone: "0803 123 4567" });
    const csv = [HEAD, "New One Co,Ada Obi,0706 111 2222,,Lagos,Referral,Guarding,,", ",,12345,,,,,,", "Same Phone Co,Bayo Ade,0803 123 4567,,,,,,"].join("\r\n");
    await expect(commitImport(w.repA, "LEADS", csv)).rejects.toThrow(/1 row\(s\) have errors/);
    expect(await db.crmLead.count({ where: { organizationId: w.t.org.id } })).toBe(1);

    const r = await commitImport(w.repA, "LEADS", csv, { skipErrors: true });
    expect(r).toEqual({ created: 1, skippedErrors: 1, skippedDuplicates: 1 });
    const leads = await db.crmLead.findMany({ where: { organizationId: w.t.org.id }, orderBy: { number: "asc" } });
    expect(leads.map((l) => l.companyName)).toEqual(["Already Here Ltd", "New One Co"]);
    expect(leads[1]).toMatchObject({ phoneE164: "+2347061112222", source: "REFERRAL", serviceInterest: "GUARDING", ownerUserId: w.repA.userId, state: "Lagos" });

    const again = await commitImport(w.repA, "LEADS", csv, { skipErrors: true, importDuplicates: true });
    expect(again.created).toBe(2); // both rows look already held (one matches a lead from the first import), and both are brought in on request
    expect(await db.crmLead.count({ where: { organizationId: w.t.org.id } })).toBe(4);
    await expect(commitImport(w.repA, "LEADS", `${HEAD}\r\n`, {})).rejects.toThrow(/no rows/);
  });

  it("records consent only where the file states it with its source, as a new record the person can see in the history", async () => {
    const w = await world();
    const csv = [HEAD, "Consenting Co,Ada Obi,0706 111 2222,,,,,Yes,Web form 12 Oct", "Silent Co,Bayo Ade,0706 333 4444,,,,,,", "Opted Out Co,Chi Eze,0706 555 6666,,,,,No,Said stop on the call"].join("\r\n");
    await commitImport(w.repA, "LEADS", csv);
    const rows = await db.crmConsent.findMany({ where: { organizationId: w.t.org.id }, include: { lead: { select: { companyName: true } } }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => [r.lead?.companyName, r.status, r.source])).toEqual([["Consenting Co", "GRANTED", "Import: Web form 12 Oct"], ["Opted Out Co", "WITHDRAWN", "Import: Said stop on the call"]]);
  });

  it("gives a manager's leads an owner by the organization's method, but a sales person owns what they import", async () => {
    const w = await world();
    await setAssignmentMethod(w.admin, "ROUND_ROBIN");
    const csv = [HEAD, "One Co,,,,,,,,", "Two Co,,,,,,,,", "Three Co,,,,,,,,"].join("\r\n");
    await commitImport(w.admin, "LEADS", csv);
    const owners = (await db.crmLead.findMany({ where: { organizationId: w.t.org.id }, orderBy: { number: "asc" } })).map((l) => l.ownerUserId);
    expect(owners).toEqual([w.repA.userId, w.repB.userId, w.repA.userId]);
    await commitImport(w.repB, "LEADS", `${HEAD}\r\nFour Co,,,,,,,,`);
    expect((await db.crmLead.findFirstOrThrow({ where: { companyName: "Four Co", organizationId: w.t.org.id } })).ownerUserId).toBe(w.repB.userId);
  });

  it("is audited as a summary with no personal data, and never touches another organization", async () => {
    const w = await world();
    const other = await world();
    await createLead(other.repA, { companyName: "Other Org Co", phone: "0706 111 2222" });
    await commitImport(w.repA, "LEADS", `${HEAD}\r\nSecret Name Ltd,Ngozi Okoro,0706 111 2222,ngozi@secret.test,,,,,`); // same phone as another organization's lead: not a duplicate here
    expect(await db.crmLead.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SALES_IMPORT" } });
    expect(audit.newValue).toMatchObject({ kind: "LEADS", imported: 1 });
    expect(JSON.stringify(audit)).not.toMatch(/Secret|Ngozi|7061112222|secret\.test/);
  });
});

describe("importing accounts and contacts", () => {
  it("creates accounts as prospects owned by the importer and flags a company already held under another spelling", async () => {
    const w = await world();
    await createAccount(w.repA, { name: "ABC Security Ltd" });
    const csv = "Company,Industry,Type,RC Number\r\nA.B.C. Security Limited,Security,,\r\nNew Estate Ltd,Real estate,,RC77";
    const p = await previewImport(w.repA, "ACCOUNTS", csv);
    expect(p.duplicates[2].visible[0]).toMatch(/same company name/i);
    const r = await commitImport(w.repA, "ACCOUNTS", csv);
    expect(r).toMatchObject({ created: 1, skippedDuplicates: 1 });
    expect(await db.crmAccount.findFirstOrThrow({ where: { organizationId: w.t.org.id, name: "New Estate Ltd" } })).toMatchObject({ accountType: "PROSPECT", rcNumber: "RC77", ownerUserId: w.repA.userId, normalizedName: "newestate" });
  });

  it("attaches a contact to the account of that name, and refuses one whose account is missing, unseen or ambiguous", async () => {
    const w = await world();
    const acme = await createAccount(w.repA, { name: "Acme Ltd" });
    await createAccount(w.repB, { name: "Hidden Co" }); // repA cannot see it
    await createAccount(w.admin, { name: "Twin Ltd" });
    await createAccount(w.admin, { name: "Twin Limited" });
    const csv = ["First Name,Last Name,Account,Phone", "Ada,Obi,Acme Ltd,0706 111 2222", "Bayo,Ade,Hidden Co,0706 333 4444", "Chi,Eze,No Such Co,0706 555 6666", "Dayo,Ola,,0706 777 8888"].join("\r\n");
    const p = await previewImport(w.repA, "CONTACTS", csv);
    expect(p.check.rows.map((r) => r.errors.length)).toEqual([0, 1, 1, 0]);
    expect(p.check.rows[1].errors[0]).toMatch(/No account called "Hidden Co" that you can see/);
    const r = await commitImport(w.repA, "CONTACTS", csv, { skipErrors: true });
    expect(r.created).toBe(2);
    expect((await db.crmContact.findFirstOrThrow({ where: { organizationId: w.t.org.id, firstName: "Ada" } })).accountId).toBe(acme.id);
    expect((await db.crmContact.findFirstOrThrow({ where: { organizationId: w.t.org.id, firstName: "Dayo" } })).accountId).toBeNull();
    const amb = await previewImport(w.admin, "CONTACTS", "First Name,Last Name,Account\r\nE,F,Twin Ltd");
    expect(amb.check.rows[0].errors[0]).toMatch(/More than one account/);
  });
});

describe("exporting", () => {
  it("gives a sales person their own records and a manager everyone's, leaving out voided ones, and counts the export in the audit", async () => {
    const w = await world();
    await createLead(w.repA, { companyName: "A Lead", phone: "0706 111 2222" });
    await createLead(w.repB, { companyName: "B Lead" });
    const gone = await createLead(w.repA, { companyName: "Voided Lead" });
    await voidLead(w.repA, gone.id, "entered twice");
    const mine = await exportCsv(w.repA, "LEADS");
    expect(mine.rows).toBe(1);
    expect(mine.csv).toMatch(/A Lead/);
    expect(mine.csv).not.toMatch(/B Lead|Voided/);
    expect(mine.csv.split("\r\n")[0]).toMatch(/^Company,Contact Person,.*,Number,Owner,Status$/);
    expect(mine.csv).toMatch(/\+2347061112222/); // a plain phone number is not altered
    expect((await exportCsv(w.admin, "LEADS")).rows).toBe(2);
    expect(mine.fileName).toBe("sales-leads.csv");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SALES_EXPORT" } })).toBe(2);
    await expect(exportCsv(w.t.ctx("AUDITOR", null, 1), "LEADS")).rejects.toThrow(/permission/);
  });

  it("makes a value a spreadsheet would run as a formula harmless, and what it writes can be read back by the import", async () => {
    const w = await world();
    await createLead(w.repA, { companyName: "=HYPERLINK(\"http://evil.test\",\"click\")", contactName: "@SUM(1+1)", state: "Lagos" });
    const lead = await exportCsv(w.repA, "LEADS");
    expect(lead.csv).toContain("'=HYPERLINK");
    expect(lead.csv).toContain("'@SUM");
    expect(lead.csv).not.toMatch(/(^|,|")=HYPERLINK/m);
    const acct = await createAccount(w.repA, { name: "Acme Ltd", industry: "Security", state: "Lagos", source: "REFERRAL" });
    await createContact(w.repA, { accountId: acct.id, firstName: "Ngozi", lastName: "Okoro", phone: "0803 123 4567", roleInDecision: "DECISION_MAKER" });
    for (const kind of ["ACCOUNTS", "CONTACTS"] as const) {
      const out = await exportCsv(w.repA, kind);
      const back = checkImport(kind, out.csv);
      expect(back.fatal, kind).toBeUndefined();
      expect(back.summary.errors, kind).toBe(0);
    }
    const contacts = await exportCsv(w.repA, "CONTACTS");
    expect(contacts.csv).toMatch(/Ngozi,Okoro,Acme Ltd,,DECISION_MAKER,\+2348031234567/);
  });
});
