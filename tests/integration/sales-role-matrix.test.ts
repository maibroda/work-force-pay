import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { can, ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { createTask, logActivity, myTasks } from "@/server/services/sales/activities";
import { listRuns, listRules, unreadNotificationCount } from "@/server/services/sales/automation";
import { createCase, listCases } from "@/server/services/sales/cases";
import { recordConsent } from "@/server/services/sales/consent";
import { exportCsv } from "@/server/services/sales/export";
import { designateAcceptor, listHandovers } from "@/server/services/sales/handover";
import { listHealth } from "@/server/services/sales/health";
import { listOpportunities } from "@/server/services/sales/pipelines";
import { listRequests, openRequest, setRetention } from "@/server/services/sales/privacy";
import { countLeads, createAccount, createContact, createLead, getLead, listAccounts, listContacts, listLeads } from "@/server/services/sales/records";
import { dashboard } from "@/server/services/sales/reports";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const salesOf = (r: Role) => ROLE_PERMISSIONS[r].filter((p) => p.startsWith("sales.")).sort();

/** Pinned on purpose: a change to who holds a sales permission must be a decision, so this fails until the table below is changed with it. */
const EXPECTED: Record<string, string[]> = {
  COMPANY_ADMIN: ["sales.case.manage", "sales.configure", "sales.handover.accept", "sales.manage", "sales.privacy.manage", "sales.view", "sales.view.all"],
  SUPER_ADMIN: ["sales.case.manage", "sales.configure", "sales.handover.accept", "sales.manage", "sales.privacy.manage", "sales.view", "sales.view.all"],
  BUSINESS_DEV: ["sales.case.manage", "sales.manage", "sales.view"],
  SALES_REP: ["sales.case.manage", "sales.manage", "sales.view"],
  SALES_MANAGER: ["sales.case.manage", "sales.manage", "sales.view"],
  ACCOUNT_MANAGER: ["sales.case.manage", "sales.manage", "sales.view"],
  OPERATIONS: ["sales.case.manage", "sales.handover.accept", "sales.view", "sales.view.all"],
  FINANCE: ["sales.view", "sales.view.all"],
};

describe("who holds which sales permission", () => {
  it("is exactly the table below, and every other role holds none (so a role added later starts with no access to sales)", () => {
    for (const r of ROLES) expect(salesOf(r), r).toEqual(EXPECTED[r] ?? []);
  });

  it("gives the people who only read sales records no way to change them, and keeps data-request and configuration powers to the administrator", () => {
    for (const r of ["OPERATIONS", "FINANCE"] as Role[]) {
      expect(can(r, "sales.manage"), r).toBe(false);
      expect(can(r, "sales.configure"), r).toBe(false);
      expect(can(r, "sales.privacy.manage"), r).toBe(false);
    }
    expect(can("BUSINESS_DEV", "sales.view.all")).toBe(false); // a salesperson sees their own records
    expect(can("BUSINESS_DEV", "sales.configure")).toBe(false);
    expect(can("FINANCE", "sales.case.manage")).toBe(false); // Finance reads, it does not act on cases
    expect(can("OPERATIONS", "sales.handover.accept")).toBe(true);
  });
});

/** An organization with the sales module on, one user for every role, and a lead, account and contact owned by the first salesperson. */
async function world() {
  const t = await isolatedOrg();
  const ctxs = Object.fromEntries(ROLES.map((r) => [r, t.ctx(r, null, 1)])) as Record<Role, ReturnType<typeof t.ctx>>;
  for (const r of ROLES) await db.user.create({ data: { id: ctxs[r].userId, organizationId: t.org.id, email: ctxs[r].email, name: ctxs[r].name, passwordHash: "not-a-real-hash", role: r } });
  await updateSalesSetting(ctxs.COMPANY_ADMIN, { enabled: true });
  const owner = ctxs.BUSINESS_DEV;
  const account = await createAccount(owner, { name: "Lekki Gardens Estate" });
  const contact = await createContact(owner, { accountId: account.id, firstName: "Funmi", lastName: "Bello", email: "funmi@lekki.test" });
  const lead = await createLead(owner, { companyName: "Ikeja Mall", contactName: "Tunde Ola" });
  return { t, ctxs, account, contact, lead };
}
type W = Awaited<ReturnType<typeof world>>;

/** The permission each operation needs, and the call. An allowed role may still be turned away for another reason (not found); a refused role must be turned away for the permission. */
const OPS: { name: string; perm: Permission; run: (c: Awaited<ReturnType<typeof world>>["ctxs"][Role], w: W) => Promise<unknown> }[] = [
  { name: "list leads", perm: "sales.view", run: (c) => listLeads(c) },
  { name: "count leads", perm: "sales.view", run: (c) => countLeads(c) },
  { name: "list accounts", perm: "sales.view", run: (c) => listAccounts(c) },
  { name: "list contacts", perm: "sales.view", run: (c) => listContacts(c) },
  { name: "list deals", perm: "sales.view", run: (c) => listOpportunities(c) },
  { name: "list cases", perm: "sales.view", run: (c) => listCases(c) },
  { name: "list handovers", perm: "sales.view", run: (c) => listHandovers(c) },
  { name: "list account health", perm: "sales.view", run: (c) => listHealth(c) },
  { name: "read one lead", perm: "sales.view", run: (c, w) => getLead(c, w.lead.id) },
  { name: "see my tasks", perm: "sales.view", run: (c) => myTasks(c) },
  { name: "count notifications", perm: "sales.view", run: (c) => unreadNotificationCount(c) },
  { name: "open a dashboard", perm: "sales.view", run: (c) => dashboard(c, "SALES" as never) },
  { name: "export leads to CSV", perm: "sales.view", run: (c) => exportCsv(c, "LEADS") },
  { name: "create a lead", perm: "sales.manage", run: (c) => createLead(c, { companyName: "New Ltd" }) },
  { name: "create an account", perm: "sales.manage", run: (c) => createAccount(c, { name: "New Account Ltd" }) },
  { name: "create a contact", perm: "sales.manage", run: (c) => createContact(c, { firstName: "A", lastName: "B" }) },
  { name: "log an activity", perm: "sales.manage", run: (c, w) => logActivity(c, { kind: "NOTE", leadId: w.lead.id, body: "Rang them" }) },
  { name: "record a consent", perm: "sales.manage", run: (c, w) => recordConsent(c, { contactId: w.contact.id, purpose: "MARKETING", status: "GRANTED", channel: "WEB_FORM", source: "Enquiry form" }) },
  { name: "add a task", perm: "sales.manage", run: (c) => createTask(c, { title: "Call back", dueAt: new Date(Date.now() + 86_400_000).toISOString() }) },
  { name: "open a case", perm: "sales.case.manage", run: (c, w) => createCase(c, { accountId: w.account.id, category: "OTHER", priority: "LOW", subject: "Gate light is out" }) },
  { name: "change the module settings", perm: "sales.configure", run: (c) => updateSalesSetting(c, { enabled: true }) },
  { name: "read automation rules", perm: "sales.configure", run: (c) => listRules(c) },
  { name: "read automation runs", perm: "sales.configure", run: (c) => listRuns(c) },
  { name: "designate who accepts handovers", perm: "sales.configure", run: (c, w) => designateAcceptor(c, w.ctxs.OPERATIONS.userId) },
  { name: "read data requests", perm: "sales.privacy.manage", run: (c) => listRequests(c) },
  { name: "open a data request", perm: "sales.privacy.manage", run: (c, w) => openRequest(c, { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Someone" }) },
  { name: "set the retention period", perm: "sales.privacy.manage", run: (c) => setRetention(c, 24) },
];

describe("every role against every operation, on the server", () => {
  it("lets through exactly the roles that hold the permission, and refuses all the others for the permission, not for some other reason", async () => {
    const w = await world();
    const wrong: string[] = [];
    for (const op of OPS) {
      for (const role of ROLES) {
        const allowed = can(role, op.perm);
        let error = "";
        try {
          await op.run(w.ctxs[role], w);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        const refusedForPermission = /permission/i.test(error);
        if (allowed && refusedForPermission) wrong.push(`${role} should be able to ${op.name} but was refused: ${error}`);
        if (!allowed && !refusedForPermission) wrong.push(`${role} should be refused ${op.name} (needs ${op.perm}) but got: ${error || "success"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("changes nothing when it refuses: a refused role leaves no new record behind", async () => {
    const w = await world();
    const before = await Promise.all([db.crmLead.count({ where: { organizationId: w.t.org.id } }), db.crmAccount.count({ where: { organizationId: w.t.org.id } }), db.crmContact.count({ where: { organizationId: w.t.org.id } }), db.crmConsent.count({ where: { organizationId: w.t.org.id } }), db.crmCase.count({ where: { organizationId: w.t.org.id } }), db.crmDataRequest.count({ where: { organizationId: w.t.org.id } })]);
    for (const role of ROLES.filter((r) => !can(r, "sales.manage") && !can(r, "sales.case.manage") && !can(r, "sales.privacy.manage"))) {
      for (const op of OPS.filter((o) => o.perm !== "sales.view")) await op.run(w.ctxs[role], w).catch(() => undefined);
    }
    const after = await Promise.all([db.crmLead.count({ where: { organizationId: w.t.org.id } }), db.crmAccount.count({ where: { organizationId: w.t.org.id } }), db.crmContact.count({ where: { organizationId: w.t.org.id } }), db.crmConsent.count({ where: { organizationId: w.t.org.id } }), db.crmCase.count({ where: { organizationId: w.t.org.id } }), db.crmDataRequest.count({ where: { organizationId: w.t.org.id } })]);
    expect(after).toEqual(before);
  });
});

describe("which records each role sees", () => {
  it("shows a salesperson only their own leads, and shows the people with view-all everyone's", async () => {
    const w = await world();
    const other = w.t.ctx("BUSINESS_DEV", null, 2);
    await db.user.create({ data: { id: other.userId, organizationId: w.t.org.id, email: other.email, name: other.name, passwordHash: "not-a-real-hash", role: "BUSINESS_DEV" } });
    const theirs = await createLead(other, { companyName: "Other Rep Ltd" });
    expect((await listLeads(other)).map((l) => l.id)).toEqual([theirs.id]);
    expect((await listLeads(w.ctxs.BUSINESS_DEV)).map((l) => l.id)).toEqual([w.lead.id]);
    await expect(getLead(other, w.lead.id)).rejects.toThrow(/not found/i);
    for (const r of ["COMPANY_ADMIN", "OPERATIONS", "FINANCE"] as Role[]) expect((await listLeads(w.ctxs[r])).map((l) => l.id).sort(), r).toEqual([theirs.id, w.lead.id].sort());
  });

  it("shows nothing to a role outside the module, and nothing of one organization to another", async () => {
    const a = await world();
    const b = await world();
    expect((await listLeads(b.ctxs.COMPANY_ADMIN)).map((l) => l.id)).not.toContain(a.lead.id);
    expect((await listAccounts(b.ctxs.OPERATIONS)).map((x) => x.id)).not.toContain(a.account.id);
    await expect(getLead(b.ctxs.COMPANY_ADMIN, a.lead.id)).rejects.toThrow(/not found/i);
    await expect(listLeads(a.ctxs.EMPLOYEE)).rejects.toThrow(/permission/i);
    await expect(listLeads(a.ctxs.CLIENT_APPROVER)).rejects.toThrow(/permission/i);
  });
});
