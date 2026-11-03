import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { can, ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { createUser } from "@/server/services/users";
import { logActivity, myTasks, createTask } from "@/server/services/sales/activities";
import { createCase, listCases, reassignCase } from "@/server/services/sales/cases";
import { board } from "@/server/services/sales/deals";
import { exportCsv } from "@/server/services/sales/export";
import { createOpportunity, listOpportunities } from "@/server/services/sales/pipelines";
import { designateApprover } from "@/server/services/sales/quotes";
import { createAccount, createContact, createLead, getLead, listAccounts, listContacts, listLeads, updateLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { addTeamMember, createTeam, deactivateTeam, listTeams, removeTeamMember } from "@/server/services/sales/teams";
import { isolatedOrg } from "../helpers";

const NEW_ROLES = ["SALES_REP", "SALES_MANAGER", "ACCOUNT_MANAGER"] as const;

describe("the three new roles", () => {
  it("hold the sales permissions of a salesperson (view, manage, cases) and nothing from the bureau's pipeline, payroll or HR; none of them sees everything", () => {
    for (const r of NEW_ROLES) {
      const perms = (ROLE_PERMISSIONS as Record<string, string[]>)[r];
      expect(perms.filter((p) => p.startsWith("sales.")).sort(), r).toEqual(["sales.case.manage", "sales.manage", "sales.view"]);
      expect(can(r, "sales.view.all"), r).toBe(false);
      expect(can(r, "sales.configure"), r).toBe(false);
      expect(can(r, "sales.privacy.manage"), r).toBe(false);
      expect(can(r, "crm.view"), r).toBe(false); // the bureau's own pipeline is not theirs
      expect(can(r, "payroll.view"), r).toBe(false);
      expect(can(r, "employee.view"), r).toBe(false);
    }
  });
});

/**
 * An organization with the sales module on and: an administrator; Lagos team (manager Mgr, members RepA and Acct); Abuja team (manager Mgr2, member RepB); RepC in no team;
 * Mgr3, a manager of no team. Every person owns one lead, one account with a contact and a deal, and a case on the account.
 */
async function world() {
  const t = await isolatedOrg();
  const mk = (role: string, n: number) => t.ctx(role as never, null, n);
  const c = {
    admin: mk("COMPANY_ADMIN", 1), mgr: mk("SALES_MANAGER", 1), mgr2: mk("SALES_MANAGER", 2), mgr3: mk("SALES_MANAGER", 3),
    repA: mk("SALES_REP", 1), repB: mk("SALES_REP", 2), repC: mk("SALES_REP", 3), acct: mk("ACCOUNT_MANAGER", 1), ops: mk("OPERATIONS", 1),
  };
  for (const x of Object.values(c)) await db.user.create({ data: { id: x.userId, organizationId: t.org.id, email: x.email, name: x.name, passwordHash: "not-a-real-hash", role: x.role as never } });
  await updateSalesSetting(c.admin, { enabled: true });
  const lagos = await createTeam(c.admin, { name: "Lagos", managerUserId: c.mgr.userId });
  const abuja = await createTeam(c.admin, { name: "Abuja", managerUserId: c.mgr2.userId });
  await addTeamMember(c.admin, lagos.id, c.repA.userId);
  await addTeamMember(c.admin, lagos.id, c.acct.userId);
  await addTeamMember(c.admin, abuja.id, c.repB.userId);

  const made: Record<string, { lead: string; account: string; contact: string; deal: string; kase: string }> = {};
  for (const [name, ctx] of Object.entries({ mgr: c.mgr, mgr2: c.mgr2, mgr3: c.mgr3, repA: c.repA, repB: c.repB, repC: c.repC, acct: c.acct })) {
    const lead = await createLead(ctx, { companyName: `${name} lead` });
    const account = await createAccount(ctx, { name: `${name} account` });
    const contact = await createContact(ctx, { accountId: account.id, firstName: name, lastName: "Contact" });
    const deal = await createOpportunity(ctx, { accountId: account.id, name: `${name} deal` });
    const kase = await createCase(ctx, { accountId: account.id, category: "OTHER", priority: "LOW", subject: `${name} case` });
    await createTask(ctx, { title: `${name} task`, dueAt: new Date(Date.now() + 86_400_000).toISOString(), accountId: account.id });
    made[name] = { lead: lead.id, account: account.id, contact: contact.id, deal: deal.id, kase: kase.id };
  }
  return { t, c, lagos, abuja, made };
}
type W = Awaited<ReturnType<typeof world>>;
const names = (rows: { companyName?: string; name?: string }[]) => rows.map((r) => (r.companyName ?? r.name ?? "").split(" ")[0]).sort();

describe("setting up teams", () => {
  it("is for the company administrator only", async () => {
    const w = await world();
    for (const who of [w.c.mgr, w.c.repA, w.c.acct, w.c.ops]) {
      await expect(createTeam(who, { name: "Kano", managerUserId: w.c.mgr3.userId })).rejects.toThrow(/permission/i);
      await expect(listTeams(who)).rejects.toThrow(/permission/i);
      await expect(addTeamMember(who, w.lagos.id, w.c.repC.userId)).rejects.toThrow(/permission/i);
    }
    expect((await listTeams(w.c.admin)).map((t) => t.name).sort()).toEqual(["Abuja", "Lagos"]);
  });

  it("makes a team's manager a sales manager and its members salespeople, each in one team only, from this organization only", async () => {
    const w = await world();
    const other = await world(); // another organization
    await expect(createTeam(w.c.admin, { name: "Kano", managerUserId: w.c.repC.userId })).rejects.toThrow(/sales manager/i);
    await expect(createTeam(w.c.admin, { name: "Kano", managerUserId: other.c.mgr.userId })).rejects.toThrow(/not an active user/i);
    await expect(createTeam(w.c.admin, { name: "Lagos", managerUserId: w.c.mgr3.userId })).rejects.toThrow(/already/i);
    await expect(createTeam(w.c.admin, { name: "K", managerUserId: w.c.mgr3.userId })).rejects.toThrow(/name/i);
    const kano = await createTeam(w.c.admin, { name: "Kano", managerUserId: w.c.mgr3.userId });
    await expect(addTeamMember(w.c.admin, kano.id, w.c.repA.userId)).rejects.toThrow(/already in a team/i); // one team each
    await expect(addTeamMember(w.c.admin, kano.id, w.c.mgr2.userId)).rejects.toThrow(/sales person|salesperson/i); // a manager is not a member
    await expect(addTeamMember(w.c.admin, kano.id, w.c.ops.userId)).rejects.toThrow(/sales person|salesperson/i);
    await expect(addTeamMember(w.c.admin, kano.id, other.c.repA.userId)).rejects.toThrow(/not an active user/i);
    await expect(addTeamMember(other.c.admin, kano.id, other.c.repC.userId)).rejects.toThrow(/team not found/i);
    await addTeamMember(w.c.admin, kano.id, w.c.repC.userId);
    expect((await listTeams(w.c.admin)).find((t) => t.id === kano.id)!.members.map((m) => m.userId)).toEqual([w.c.repC.userId]);
  });

  it("records every change in the audit log by ids, never by name", async () => {
    const w = await world();
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_TEAM" } } });
    expect(rows.length).toBe(5); // two teams, three members
    for (const r of rows) {
      expect(r.entity).toMatch(/^CrmTeam/);
      const text = JSON.stringify(r.newValue);
      for (const secret of ["Lagos", "Abuja", ...Object.values(w.c).map((x) => x.name)]) expect(text, secret).not.toContain(secret); // team names and people's names stay out
    }
  });
});

describe("who sees what", () => {
  it("shows a manager their own records and their team's, a salesperson only their own, and the administrator everything", async () => {
    const w = await world();
    const lists = {
      leads: (c: W["c"]["mgr"]) => listLeads(c),
      accounts: (c: W["c"]["mgr"]) => listAccounts(c),
      deals: (c: W["c"]["mgr"]) => listOpportunities(c),
    };
    for (const [kind, list] of Object.entries(lists)) {
      expect(names(await list(w.c.mgr) as never), `${kind} mgr`).toEqual(["acct", "mgr", "repA"]);
      expect(names(await list(w.c.mgr2) as never), `${kind} mgr2`).toEqual(["mgr2", "repB"]);
      expect(names(await list(w.c.mgr3) as never), `${kind} mgr3 (no team)`).toEqual(["mgr3"]);
      expect(names(await list(w.c.repA) as never), `${kind} repA`).toEqual(["repA"]);
      expect(names(await list(w.c.acct) as never), `${kind} acct`).toEqual(["acct"]);
      expect(names(await list(w.c.repC) as never), `${kind} repC (no team)`).toEqual(["repC"]);
      expect((await list(w.c.admin)).length, `${kind} admin`).toBe(7);
    }
    expect((await listContacts(w.c.mgr)).map((x) => x.firstName).sort()).toEqual(["acct", "mgr", "repA"]);
    expect((await listContacts(w.c.repB)).map((x) => x.firstName)).toEqual(["repB"]);
  });

  it("opens a team member's record for a manager and refuses anyone outside the team, by the record's id", async () => {
    const w = await world();
    expect((await getLead(w.c.mgr, w.made.repA.lead)).id).toBe(w.made.repA.lead);
    await expect(getLead(w.c.mgr, w.made.repB.lead)).rejects.toThrow(/not found/i);
    await expect(getLead(w.c.mgr, w.made.repC.lead)).rejects.toThrow(/not found/i);
    await expect(getLead(w.c.repA, w.made.acct.lead)).rejects.toThrow(/not found/i); // a teammate's
    await expect(getLead(w.c.repA, w.made.mgr.lead)).rejects.toThrow(/not found/i); // their manager's
    await expect(getLead(w.c.mgr3, w.made.repA.lead)).rejects.toThrow(/not found/i); // a manager of no team
  });

  it("follows the team as it changes, at once: a person moved out stops being visible, one moved in becomes visible, a closed team shows nothing", async () => {
    const w = await world();
    await removeTeamMember(w.c.admin, w.lagos.id, w.c.repA.userId);
    expect(names(await listLeads(w.c.mgr) as never)).toEqual(["acct", "mgr"]);
    await addTeamMember(w.c.admin, w.abuja.id, w.c.repA.userId);
    expect(names(await listLeads(w.c.mgr2) as never)).toEqual(["mgr2", "repA", "repB"]);
    await deactivateTeam(w.c.admin, w.abuja.id);
    expect(names(await listLeads(w.c.mgr2) as never)).toEqual(["mgr2"]);
  });

  it("applies to cases, the deal board, tasks, the CSV export and the other organization", async () => {
    const w = await world();
    expect((await listCases(w.c.mgr)).map((k) => k.subject.split(" ")[0]).sort()).toEqual(["acct", "mgr", "repA"]);
    expect((await listCases(w.c.repA)).map((k) => k.subject.split(" ")[0])).toEqual(["repA"]);
    const onBoard = (await board(w.c.mgr)).columns.flatMap((c: { deals: { name: string }[] }) => c.deals.map((d) => d.name.split(" ")[0])).sort();
    expect(onBoard).toEqual(["acct", "mgr", "repA"]);
    expect((await exportCsv(w.c.mgr, "LEADS")).rows).toBe(3);
    expect((await exportCsv(w.c.repB, "LEADS")).rows).toBe(1);
    expect(Object.values(await myTasks(w.c.mgr, { scope: "all" })).flat().map((x) => x.title.split(" ")[0]).sort()).toEqual(["acct", "mgr", "repA"]);
    await expect(myTasks(w.c.repA, { scope: "all" })).rejects.toThrow(/manager/i);
    const other = await world();
    expect(names(await listLeads(other.c.mgr) as never)).toEqual(["acct", "mgr", "repA"]); // their own organization's, not this one's
    expect((await listLeads(other.c.mgr)).some((l) => l.organizationId === w.t.org.id)).toBe(false);
  });
});

describe("what a manager may change", () => {
  it("lets a manager change and log on a team member's records, and refuses it outside the team", async () => {
    const w = await world();
    await updateLead(w.c.mgr, w.made.repA.lead, { jobTitle: "Estate manager" });
    expect((await getLead(w.c.mgr, w.made.repA.lead)).jobTitle).toBe("Estate manager");
    await logActivity(w.c.mgr, { kind: "NOTE", leadId: w.made.repA.lead, body: "Spoke to the team" });
    await expect(updateLead(w.c.mgr, w.made.repB.lead, { jobTitle: "x" })).rejects.toThrow(/not found/i);
    await expect(logActivity(w.c.mgr, { kind: "NOTE", leadId: w.made.repB.lead, body: "x" })).rejects.toThrow(/not found/i);
    await expect(updateLead(w.c.repA, w.made.acct.lead, { jobTitle: "x" })).rejects.toThrow(/not found/i);
  });

  it("lets a manager hand a record to someone in their own teams, refuses anyone outside, and keeps a salesperson from handing records over at all; the administrator may give it to anyone", async () => {
    const w = await world();
    await updateLead(w.c.mgr, w.made.repA.lead, { ownerUserId: w.c.acct.userId });
    expect((await getLead(w.c.admin, w.made.repA.lead)).ownerUserId).toBe(w.c.acct.userId);
    await expect(updateLead(w.c.mgr, w.made.acct.lead, { ownerUserId: w.c.repB.userId })).rejects.toThrow(/team/i); // repB is in another team
    await expect(updateLead(w.c.mgr, w.made.acct.lead, { ownerUserId: w.c.repC.userId })).rejects.toThrow(/team/i); // in no team
    await expect(updateLead(w.c.repA, w.made.mgr.lead, { ownerUserId: w.c.repA.userId })).rejects.toThrow(/not found|manager/i);
    await expect(updateLead(w.c.acct, w.made.acct.lead, { ownerUserId: w.c.repC.userId })).rejects.toThrow(/manager/i);
    await updateLead(w.c.admin, w.made.acct.lead, { ownerUserId: w.c.repC.userId });
    expect((await getLead(w.c.repC, w.made.acct.lead)).id).toBe(w.made.acct.lead);
    // a case follows the same rule
    await reassignCase(w.c.mgr, w.made.repA.kase, w.c.acct.userId);
    await expect(reassignCase(w.c.mgr, w.made.repA.kase, w.c.repB.userId)).rejects.toThrow(/team/i);
  });

  it("lets the administrator designate a sales manager as a quote approver", async () => {
    const w = await world();
    await designateApprover(w.c.admin, w.c.mgr.userId);
    expect(await db.crmQuoteApprover.count({ where: { organizationId: w.t.org.id, userId: w.c.mgr.userId, active: true } })).toBe(1);
    await expect(designateApprover(w.c.admin, w.c.repA.userId)).rejects.toThrow(/sales manager/i); // a salesperson is not one
  });
});

describe("making people with the new roles", () => {
  it("lets a company administrator create them in an ordinary company (the bureau-only rule stays for the bureau's sales role)", async () => {
    const w = await world();
    for (const role of NEW_ROLES) {
      const u = await createUser(w.c.admin, { name: `New ${role}`, email: `new-${role.toLowerCase()}@${w.t.org.code.toLowerCase()}.test`, role, password: "a-long-test-password" } as never);
      expect(u.role).toBe(role);
    }
    await expect(createUser(w.c.admin, { name: "Bureau rep", email: `bureau@${w.t.org.code.toLowerCase()}.test`, role: "BUSINESS_DEV", password: "a-long-test-password" } as never)).rejects.toThrow(/payroll bureau/i);
  });
});
