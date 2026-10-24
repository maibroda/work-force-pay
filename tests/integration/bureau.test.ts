import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { mayWorkIn } from "@/lib/auth/bureau-access";
import type { Ctx } from "@/lib/auth/context";
import {
  bureauStaff,
  canSwitchTo,
  enableBureau,
  getClient,
  grantAccess,
  listClients,
  onboardClient,
  revokeAccess,
  updateEngagement,
} from "@/server/services/bureau";
import { logAudit } from "@/server/services/audit";
import { isolatedOrg, uid } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** A real user in an organization (access grants point at real users), as a request context. */
async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@bureau.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

/** A bureau with master statutory rules, a manager, and two staff; plus a second, unrelated bureau. */
async function world() {
  const t = await isolatedOrg();
  const admin = await person(t.org.id, "COMPANY_ADMIN", "founder");
  await enableBureau(admin);
  const rule = await db.taxRule.create({
    data: {
      organizationId: t.org.id, code: "NG-PAYE", name: "PAYE", version: "2026.1", effectiveFrom: d("2026-01-01"),
      bands: { create: [{ sortOrder: 1, lowerBound: 0, upperBound: 800000, rate: 0 }, { sortOrder: 2, lowerBound: 800000, upperBound: null, rate: 15 }] },
      reliefs: { create: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION" }] },
      exemptions: { create: [{ code: "MIN", description: "Minimum wage", annualGrossCeiling: 840000 }] },
    },
  });
  await db.pensionRule.create({ data: { organizationId: t.org.id, version: "v1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: d("2020-01-01") } });
  await db.payrollRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
  await db.employerCostRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const auditor = await person(t.org.id, "AUDITOR", "auditor");
  const hr = await person(t.org.id, "HR_ADMIN", "hr");
  const other = await isolatedOrg();
  const otherAdmin = await person(other.org.id, "COMPANY_ADMIN", "rival");
  await enableBureau(otherAdmin);
  const onboard = (name = `Client ${uid()}`, over: Record<string, unknown> = {}) =>
    onboardClient(admin, { name, code: `C${uid()}${uid()}`, package: "PAYROLL_COMPLIANCE", startDate: "2026-11-01", termMonths: 12, perEmployeeRate: 1500, monthlyMinimum: 50000, onboardingFee: 100000, ...over } as never);
  return { t, admin, officer, auditor, hr, rule, other, otherAdmin, onboard };
}

describe("bureau setup", () => {
  it("lets a manager make an organization a bureau, but not a client, and not twice", async () => {
    const t = await isolatedOrg();
    const hr = await person(t.org.id, "HR_ADMIN", "hr");
    const admin = await person(t.org.id, "COMPANY_ADMIN", "founder");
    await expect(enableBureau(hr)).rejects.toThrow(/permission/);
    await enableBureau(admin);
    expect((await db.organization.findUniqueOrThrow({ where: { id: t.org.id } })).isBureau).toBe(true);
    await expect(enableBureau(admin)).rejects.toThrow(/already a bureau/);

    const w = await world();
    const c = await w.onboard();
    const clientAdmin = await person(c.client.id, "COMPANY_ADMIN", "clientadmin");
    await expect(enableBureau(clientAdmin)).rejects.toThrow(/client organization cannot also be a bureau/);
  });

  it("won't onboard clients for an organization that is not a bureau, or for someone who can't manage it", async () => {
    const t = await isolatedOrg();
    const admin = await person(t.org.id, "COMPANY_ADMIN", "founder");
    const input = { name: "Acme Ltd", code: "ACME1", package: "ENTERPRISE", startDate: "2026-11-01", termMonths: 12 } as never;
    await expect(onboardClient(admin, input)).rejects.toThrow(/not set up as a payroll bureau/);
    const w = await world();
    await expect(onboardClient(w.officer, input)).rejects.toThrow(/permission/);
  });
});

describe("onboarding a client", () => {
  it("creates an isolated organization with the bureau's rules copied, a chart of accounts, and the terms recorded", async () => {
    const w = await world();
    const { client, engagement, rules } = await w.onboard("Acme Security Ltd", { dpaReference: "DPA-2026-001", dpaSignedAt: "2026-10-30", slaTerms: "Draft within 3 working days" });
    expect(client.bureauOrganizationId).toBe(w.t.org.id);
    expect(client.isBureau).toBe(false);
    expect(rules).toEqual({ tax: 1, pension: 1, payroll: 1, employerCost: 1 });

    const copied = await db.taxRule.findFirstOrThrow({ where: { organizationId: client.id }, include: { bands: true, reliefs: true, exemptions: true } });
    expect(copied.id).not.toBe(w.rule.id);
    expect(copied.bands.map((b) => Number(b.rate)).sort()).toEqual([0, 15]);
    expect(copied.reliefs).toHaveLength(1);
    expect(copied.exemptions).toHaveLength(1);
    expect(await db.glAccount.count({ where: { organizationId: client.id } })).toBeGreaterThan(10);
    expect(await db.employee.count({ where: { organizationId: client.id } })).toBe(0);

    expect(engagement).toMatchObject({ bureauOrganizationId: w.t.org.id, status: "ONBOARDING", termMonths: 12, package: "PAYROLL_COMPLIANCE", dpaReference: "DPA-2026-001", slaTerms: "Draft within 3 working days" });
    expect(Number(engagement.perEmployeeRate)).toBe(1500);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "CLIENT_ONBOARD" } })).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: client.id, action: "ORGANIZATION_CREATED" } })).toBe(1);
  });

  it("refuses a code already in use and terms that make no sense", async () => {
    const w = await world();
    const a = await w.onboard();
    await expect(onboardClient(w.admin, { name: "Another", code: a.client.code, package: "ENTERPRISE", startDate: "2026-11-01", termMonths: 12 } as never)).rejects.toThrow(/already in use/);
    await expect(w.onboard("Odd term", { termMonths: 9 })).rejects.toThrow(/6 or 12 months/);
    await expect(w.onboard("Bad code", { code: "x" })).rejects.toThrow(/2 to 12 letters or digits/);
    await expect(w.onboard("Negative fee", { onboardingFee: -5 })).rejects.toThrow();
  });
});

describe("who can work in which client", () => {
  it("lets a manager into every client of the bureau, and staff only into the ones they are given", async () => {
    const w = await world();
    const a = (await w.onboard()).client;
    const b = (await w.onboard()).client;
    const adminUser = { id: w.admin.userId, organizationId: w.t.org.id, role: w.admin.role };
    const officerUser = { id: w.officer.userId, organizationId: w.t.org.id, role: w.officer.role };

    expect(await mayWorkIn(adminUser, a.id)).toBe(true);
    expect(await mayWorkIn(adminUser, b.id)).toBe(true);
    expect(await mayWorkIn(officerUser, a.id)).toBe(false);
    expect(await canSwitchTo(w.officer, a.id)).toBe(false);

    await grantAccess(w.admin, w.officer.userId, a.id);
    expect(await mayWorkIn(officerUser, a.id)).toBe(true);
    expect(await mayWorkIn(officerUser, b.id)).toBe(false);
    expect(await canSwitchTo(w.officer, a.id)).toBe(true);
    expect(await canSwitchTo(w.officer, w.t.org.id)).toBe(true); // back to the bureau itself

    await revokeAccess(w.admin, w.officer.userId, a.id);
    expect(await mayWorkIn(officerUser, a.id)).toBe(false);
  });

  it("keeps one bureau's people out of another bureau's clients, and clients' own users out of everything else", async () => {
    const w = await world();
    const a = (await w.onboard()).client;
    const rivalUser = { id: w.otherAdmin.userId, organizationId: w.other.org.id, role: w.otherAdmin.role };
    expect(await mayWorkIn(rivalUser, a.id)).toBe(false); // even a rival's manager
    expect(await mayWorkIn(rivalUser, w.t.org.id)).toBe(false);

    const clientUser = await person(a.id, "COMPANY_ADMIN", "inclient");
    const cu = { id: clientUser.userId, organizationId: a.id, role: clientUser.role };
    expect(await mayWorkIn(cu, a.id)).toBe(true); // its own organization
    expect(await mayWorkIn(cu, w.t.org.id)).toBe(false);
    const b = (await w.onboard()).client;
    expect(await mayWorkIn(cu, b.id)).toBe(false);
  });

  it("only lets managers give and take away access, and only to the bureau's own staff in roles that can use it", async () => {
    const w = await world();
    const a = (await w.onboard()).client;
    await expect(grantAccess(w.officer, w.officer.userId, a.id)).rejects.toThrow(/permission/);
    await expect(grantAccess(w.admin, w.otherAdmin.userId, a.id)).rejects.toThrow(/Staff member not found/);
    const clientEmployee = await person(w.t.org.id, "EMPLOYEE", "plain");
    await expect(grantAccess(w.admin, clientEmployee.userId, a.id)).rejects.toThrow(/does not include working in clients/);
    await grantAccess(w.admin, w.hr.userId, a.id);
    await expect(grantAccess(w.admin, w.hr.userId, a.id)).rejects.toThrow(/already has access/);
    await expect(revokeAccess(w.officer, w.hr.userId, a.id)).rejects.toThrow(/permission/);
    await expect(revokeAccess(w.admin, w.auditor.userId, a.id)).rejects.toThrow(/not in place/);
    await revokeAccess(w.admin, w.hr.userId, a.id);

    // the grant and the revoke are in both audit logs
    for (const orgId of [w.t.org.id, a.id]) {
      expect(await db.auditLog.count({ where: { organizationId: orgId, action: "CLIENT_ACCESS_GRANT" } })).toBe(1);
      expect(await db.auditLog.count({ where: { organizationId: orgId, action: "CLIENT_ACCESS_REVOKE" } })).toBe(1);
    }
    expect((await bureauStaff(w.admin)).map((s) => s.id)).toEqual(expect.arrayContaining([w.admin.userId, w.officer.userId]));
  });

  it("is backed by the database, which refuses links that cross bureaus or move a client", async () => {
    const w = await world();
    const a = (await w.onboard()).client;
    // access for someone from another bureau
    await expect(
      db.staffClientAccess.create({ data: { bureauOrganizationId: w.t.org.id, userId: w.otherAdmin.userId, clientOrganizationId: a.id, grantedBy: "x", grantedByUserId: "x" } }),
    ).rejects.toThrow(/own staff/);
    // access to something that is not this bureau's client
    await expect(
      db.staffClientAccess.create({ data: { bureauOrganizationId: w.t.org.id, userId: w.officer.userId, clientOrganizationId: w.other.org.id, grantedBy: "x", grantedByUserId: "x" } }),
    ).rejects.toThrow(/not a client of this bureau/);
    // moving a client to the rival, or detaching it
    await expect(db.organization.update({ where: { id: a.id }, data: { bureauOrganizationId: w.other.org.id } })).rejects.toThrow(/cannot be moved/);
    await expect(db.organization.update({ where: { id: a.id }, data: { bureauOrganizationId: null } })).rejects.toThrow(/cannot be moved/);
    // a bureau cannot be a client, a client cannot be a bureau, and a bureau with clients cannot stop being one
    await expect(db.organization.update({ where: { id: w.other.org.id }, data: { bureauOrganizationId: w.t.org.id } })).rejects.toThrow(/cannot itself be a client/);
    await expect(db.organization.update({ where: { id: a.id }, data: { isBureau: true } })).rejects.toThrow(/cannot itself be a client/);
    await expect(db.organization.update({ where: { id: w.t.org.id }, data: { isBureau: false } })).rejects.toThrow(/cannot stop being a bureau/);
    // a client must be pointed at a real bureau
    const plain = await isolatedOrg();
    await expect(db.organization.update({ where: { id: plain.org.id }, data: { bureauOrganizationId: w.admin.orgId === plain.org.id ? w.other.org.id : plain.org.id } })).rejects.toThrow(/own bureau|marked as a bureau/);
  });
});

describe("the client list and details", () => {
  it("shows managers every client and staff only theirs, with headcount and the latest payroll", async () => {
    const w = await world();
    const a = (await w.onboard("Alpha Ltd")).client;
    const b = (await w.onboard("Beta Ltd")).client;
    const cat = await db.employeeCategory.create({ data: { organizationId: a.id, code: "G", name: "Guard" } });
    for (const n of [1, 2])
      await db.employee.create({ data: { organizationId: a.id, employeeNumber: `EMP-00000${n}`, firstName: "A", lastName: `G${n}`, employmentDate: d("2025-01-01"), categoryId: cat.id } });
    await db.employee.create({ data: { organizationId: a.id, employeeNumber: "EMP-000009", firstName: "Gone", lastName: "Away", employmentDate: d("2025-01-01"), categoryId: cat.id, status: "RESIGNED", exitDate: d("2026-01-31") } });
    const period = await db.payrollPeriod.create({ data: { organizationId: a.id, name: "2026-10", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
    await db.payrollRun.create({ data: { organizationId: a.id, periodId: period.id, runNumber: 1, status: "CALCULATED" } });

    const all = await listClients(w.admin);
    expect(all.clients.map((c) => c.org.name)).toEqual(["Alpha Ltd", "Beta Ltd"]);
    expect(all.clients[0]).toMatchObject({ headcount: 2, latestRun: { period: "2026-10", status: "CALCULATED" } });
    expect(all.clients[1]).toMatchObject({ headcount: 0, latestRun: null });

    expect((await listClients(w.officer)).clients).toEqual([]);
    await grantAccess(w.admin, w.officer.userId, b.id);
    expect((await listClients(w.officer)).clients.map((c) => c.org.name)).toEqual(["Beta Ltd"]);
    await expect(getClient(w.officer, a.id)).rejects.toThrow(/not been given access/);
    expect((await getClient(w.officer, b.id)).engagement?.status).toBe("ONBOARDING");
    // working inside a client, the list is still the bureau's
    expect((await listClients({ ...w.officer, orgId: b.id, homeOrgId: w.t.org.id })).clients).toHaveLength(1);
  });

  it("updates terms and status, and never reopens an ended engagement", async () => {
    const w = await world();
    const a = (await w.onboard()).client;
    const base = { package: "ENTERPRISE", startDate: "2026-11-01", termMonths: 6, perEmployeeRate: 2000, status: "ACTIVE" } as never;
    const u = await updateEngagement(w.admin, a.id, base);
    expect(u).toMatchObject({ status: "ACTIVE", package: "ENTERPRISE", termMonths: 6 });
    await expect(updateEngagement(w.officer, a.id, base)).rejects.toThrow(/permission/);
    await updateEngagement(w.admin, a.id, { ...(base as object), status: "ENDED" } as never);
    await expect(updateEngagement(w.admin, a.id, base)).rejects.toThrow(/ended engagement is not reopened/);
    await expect(updateEngagement(w.admin, w.other.org.id, base)).rejects.toThrow(/Client not found/);
  });
});

describe("audit while working in a client", () => {
  it("records the bureau the work came from, under the person's own name, in the client's log", async () => {
    const w = await world();
    const a = (await w.onboard()).client;
    await logAudit({ ...w.officer, orgId: a.id, homeOrgId: w.t.org.id }, { action: "TEST_ACTION", entity: "Thing" });
    await logAudit({ ...w.officer, orgId: w.t.org.id }, { action: "TEST_OWN", entity: "Thing" });
    const inClient = await db.auditLog.findFirstOrThrow({ where: { organizationId: a.id, action: "TEST_ACTION" } });
    expect(inClient.userName).toBe(w.officer.name);
    expect((inClient.metadata as { bureau?: string }).bureau).toBe(w.t.org.id);
    const own = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "TEST_OWN" } });
    expect((own.metadata as { bureau?: string }).bureau).toBeUndefined();
  });
});
