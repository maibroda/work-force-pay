/**
 * The demo company's own sales module (accounts, contacts, leads, deals, a quote that the client accepted and so a draft handover, a case, tasks, activities and consent),
 * a sales manager and two salespeople in one team, built through the same services the screens use. It exists so every sales page has something to show, and so the smoke
 * test, which opens every page as every role, exercises the sales detail pages and not only the "switched off" message.
 *
 * Sign in as salesmgr@, salesrep@ or acctmgr@ demosecurity.test (the demo password) to see what each of the new sales roles sees.
 */
import type { Ctx } from "../src/lib/auth/context";
import { db } from "../src/lib/db";
import { createTask, logActivity } from "../src/server/services/sales/activities";
import { createCase } from "../src/server/services/sales/cases";
import { recordConsent } from "../src/server/services/sales/consent";
import { moveOpportunity } from "../src/server/services/sales/deals";
import { createOpportunity, listPipelines } from "../src/server/services/sales/pipelines";
import { createQuote, decideQuote, sendQuote, setMinimumMargin } from "../src/server/services/sales/quotes";
import { createAccount, createContact, createLead } from "../src/server/services/sales/records";
import { updateSalesSetting } from "../src/server/services/sales/setting";
import { addTeamMember, createTeam } from "../src/server/services/sales/teams";

type Role = "SALES_MANAGER" | "SALES_REP" | "ACCOUNT_MANAGER";

export async function buildSalesDemo(o: { orgId: string; admin: Ctx; passwordHash: string; structureId: string }) {
  const { orgId, admin } = o;
  const person = async (role: Role, email: string, name: string): Promise<Ctx> => {
    const u = await db.user.create({ data: { organizationId: orgId, email, name, role, passwordHash: o.passwordHash } });
    return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
  };
  const mgr = await person("SALES_MANAGER", "salesmgr@demosecurity.test", "Sade Sales Manager");
  const rep = await person("SALES_REP", "salesrep@demosecurity.test", "Segun Sales Rep");
  const acct = await person("ACCOUNT_MANAGER", "acctmgr@demosecurity.test", "Amina Account Manager");

  await updateSalesSetting(admin, { enabled: true });
  await setMinimumMargin(admin, 0); // a demo quote should go out without waiting for an approver
  const lagos = await createTeam(admin, { name: "Lagos", managerUserId: mgr.userId });
  await addTeamMember(admin, lagos.id, rep.userId);
  await addTeamMember(admin, lagos.id, acct.userId);

  // accounts, contacts and a lead for each person (all synthetic)
  const estate = await createAccount(rep, { name: "Lekki Gardens Estate", industry: "Residential estate", state: "Lagos", source: "REFERRAL" });
  const estateContact = await createContact(rep, { accountId: estate.id, firstName: "Funmi", lastName: "Bello", jobTitle: "Estate manager", phone: "0803 555 0101", email: "funmi.bello@lekki-gardens.test", roleInDecision: "DECISION_MAKER" });
  const mall = await createAccount(acct, { name: "Ikeja City Mall", industry: "Retail", state: "Lagos", source: "WALK_IN" });
  await createContact(acct, { accountId: mall.id, firstName: "Tunde", lastName: "Ola", jobTitle: "Facilities manager", phone: "0805 555 0102", email: "tunde.ola@ikeja-mall.test" });
  await createLead(rep, { companyName: "Victoria Island Towers", contactName: "Ngozi Eze", phone: "0807 555 0103", email: "ngozi.eze@vi-towers.test", state: "Lagos", serviceInterest: "GUARDING", source: "WEBSITE" });
  await createLead(mgr, { companyName: "Abuja Business Park", contactName: "Musa Danjuma", phone: "0809 555 0104", state: "FCT", serviceInterest: "FACILITY", source: "TENDER" });

  // consent, the way a form on the site would give it
  await recordConsent(rep, { contactId: estateContact.id, purpose: "MARKETING", status: "GRANTED", channel: "WEB_FORM", source: "Enquiry form on the website", evidenceRef: "Form 001" });

  // a deal that was quoted and accepted, so there is a quote and a draft handover to look at
  const pipeline = (await listPipelines(admin))[0];
  const stage = (n: string) => pipeline.stages.find((s) => s.name === n)!.id;
  const won = await createOpportunity(rep, { accountId: estate.id, name: "24/7 guarding, Lekki Gardens", primaryContactId: estateContact.id });
  await moveOpportunity(rep, won.id, { stageId: stage("Qualified"), nextStep: "Walk the estate with the manager" });
  const guard = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: orgId, code: "GUARD" } });
  void guard;
  const quote = await createQuote(rep, {
    opportunityId: won.id,
    validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    lines: [{ siteName: "Lekki Gardens Phase 1", siteAddress: "1 Admiralty Way, Lekki", postLabel: "Main gate", shiftPattern: "24/7", salaryStructureId: o.structureId, headcount: 6, requiredPersonnel: 7, billRatePerHead: "250000.00" }],
  });
  await sendQuote(rep, quote.id);
  await decideQuote(rep, quote.id, "ACCEPTED", "Accepted by email");

  // a second deal still being worked, activities, a task and a case
  const open = await createOpportunity(acct, { accountId: mall.id, name: "Day guards, Ikeja City Mall" });
  await moveOpportunity(acct, open.id, { stageId: stage("Qualified"), nextStep: "Send the proposal" });
  await logActivity(rep, { kind: "CALL", contactId: estateContact.id, callOutcome: "REACHED", body: "Wants a site survey next week" });
  await logActivity(acct, { kind: "NOTE", opportunityId: open.id, body: "Met the facilities manager at the mall office" });
  await createTask(rep, { title: "Send the signed proposal back", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), opportunityId: won.id });
  await createCase(acct, { accountId: mall.id, category: "SERVICE_QUALITY", priority: "NORMAL", subject: "Gate light is out at the north entrance" });
}
