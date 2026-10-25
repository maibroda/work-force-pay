import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { mayWorkIn } from "@/lib/auth/bureau-access";
import { can } from "@/lib/auth/permissions";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { sendEmail } from "@/lib/email";
import { enableBureau, onboardClient } from "@/server/services/bureau";
import { lockRun } from "@/server/services/payroll";
import { clientApprovalStatus, clientApproveRun, clientRejectRun, inviteClientUser, listClientUsers, portalOverview, portalRun, setClientApprovalRequired } from "@/server/services/portal";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@portal.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

/** A bureau, a client of it, the bureau's founder and finance person working in the client, and the client's approver and HR contact. */
async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const finance = await person(t.org.id, "FINANCE", "finance");
  await enableBureau(founder);
  const { client } = await onboardClient(founder, { name: "Acme Ltd", code: `P${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12 } as never);
  const inClient = (c: Ctx): Ctx => ({ ...c, orgId: client.id, homeOrgId: t.org.id });
  const admin = inClient(founder);
  const fin = inClient(finance);
  const approverUser = await inviteClientUser(admin, { name: "Mrs Bello", email: `bello.${uid()}@acme.test`, role: "CLIENT_APPROVER" });
  const hrUser = await inviteClientUser(admin, { name: "Mr Hr", email: `hr.${uid()}@acme.test`, role: "CLIENT_HR" });
  const asClient = (u: { id: string; name: string; email: string; role: string }): Ctx => ({ userId: u.id, orgId: client.id, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: null });
  const approver = asClient(approverUser);
  const hrContact = asClient(hrUser);
  const cat = await db.employeeCategory.create({ data: { organizationId: client.id, code: "STAFF", name: "Staff" } });
  const period = await db.payrollPeriod.create({ data: { organizationId: client.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  /** An October payroll approved by the bureau, awaiting the client. */
  const run = await db.payrollRun.create({ data: { organizationId: client.id, periodId: period.id, runNumber: 1, status: "APPROVED", calculationCount: 1, employeeCount: 1, totalNet: 100000, totalGross: 120000, approvedBy: "Reviewer", approvedByUserId: "someone-else", preparedByUserIds: ["preparer"] } });
  const emp = await db.employee.create({ data: { organizationId: client.id, employeeNumber: "EMP-000001", firstName: "Ada", lastName: "Obi", employmentDate: d("2025-01-01"), categoryId: cat.id } });
  await db.payrollRecord.create({
    data: {
      organizationId: client.id, runId: run.id, employeeId: emp.id, employeeNumber: emp.employeeNumber, employeeName: "Ada Obi", categoryName: "Staff", departmentName: "Lagos HQ",
      basisDays: 31, daysWorked: 31, monthlyGross: 120000, earnedGross: 120000, totalEarnings: 120000, pensionBase: 0, employeePension: 9600, employerPension: 12000,
      taxableIncome: 100000, paye: 10400, totalDeductions: 20000, netPay: 100000, employerCost: 132000, taxRuleVersion: "x", lines: [], locations: [],
    },
  });
  return { t, founder, admin, fin, client, approver, hrContact, approverUser, period, run };
}

beforeEach(() => mail.mockClear());

describe("inviting the client's people", () => {
  it("emails a link to choose a password, creates no known password, and only for the clients of a bureau", async () => {
    const w = await world();
    expect(mail).toHaveBeenCalledTimes(2);
    const first = mail.mock.calls[0][0];
    expect(first.to).toBe(w.approverUser.email);
    expect(first.subject).toBe("You have been invited to the Acme Ltd payroll portal");
    expect(first.text).toMatch(/\/reset-password\?token=[\w-]{20,}/);
    expect(first.text).toMatch(/two-factor/);
    const user = await db.user.findUniqueOrThrow({ where: { id: w.approverUser.id } });
    expect(user).toMatchObject({ role: "CLIENT_APPROVER", organizationId: w.client.id, active: true, totpEnabled: false });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    const token = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(token.tokenHash).toHaveLength(64); // only a hash of the link's token is kept
    expect(token.expiresAt.getTime() - Date.now()).toBeGreaterThan(48 * 3_600_000);
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "CLIENT_USER_INVITE" } })).toBe(2);
    expect((await listClientUsers(w.admin)).map((u) => u.role).sort()).toEqual(["CLIENT_APPROVER", "CLIENT_HR"]);

    await expect(inviteClientUser(w.admin, { name: "Dup", email: w.approverUser.email, role: "CLIENT_HR" })).rejects.toThrow(/already exists/);
    await expect(inviteClientUser(w.admin, { name: "Sneaky", email: `s.${uid()}@acme.test`, role: "COMPANY_ADMIN" as never })).rejects.toThrow();
    await expect(inviteClientUser(w.fin, { name: "Nope", email: `n.${uid()}@acme.test`, role: "CLIENT_HR" })).rejects.toThrow(/permission/);
    const standalone = await isolatedOrg();
    await expect(inviteClientUser(await person(standalone.org.id, "COMPANY_ADMIN", "owner"), { name: "Xavier", email: `x.${uid()}@acme.test`, role: "CLIENT_HR" })).rejects.toThrow(/clients of a payroll bureau/);
  });

  it("makes the client's approval required only once there is an approver to give it", async () => {
    const t = await isolatedOrg();
    const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
    await enableBureau(founder);
    const { client } = await onboardClient(founder, { name: "Beta", code: `Q${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12 } as never);
    const admin: Ctx = { ...founder, orgId: client.id, homeOrgId: t.org.id };
    await expect(setClientApprovalRequired(admin, true)).rejects.toThrow(/Invite the client's approver first/);
    await inviteClientUser(admin, { name: "Approver", email: `a.${uid()}@beta.test`, role: "CLIENT_APPROVER" });
    await setClientApprovalRequired(admin, true);
    expect((await db.organization.findUniqueOrThrow({ where: { id: client.id } })).clientApprovalRequired).toBe(true);
    await expect(setClientApprovalRequired(await person(client.id, "FINANCE", "f"), false)).rejects.toThrow(/permission/);
    await expect(setClientApprovalRequired(await person(t.org.id, "COMPANY_ADMIN", "other"), true)).rejects.toThrow(/clients of a payroll bureau/);
  });
});

describe("what the client's people can reach", () => {
  it("is their own payroll and nothing else: no staff permissions, no other organization, a second factor always", async () => {
    const w = await world();
    for (const role of ["CLIENT_APPROVER", "CLIENT_HR"] as const)
      for (const p of ["payroll.view", "employee.view", "gl.view", "bureau.view", "users.manage", "payment.manage", "dashboard.view", "payslip.distribute"] as const) expect(can(role, p), `${role} ${p}`).toBe(false);
    expect(can("CLIENT_APPROVER", "portal.approve")).toBe(true);
    expect(can("CLIENT_HR", "portal.approve")).toBe(false);
    expect(can("CLIENT_HR", "portal.view")).toBe(true);
    // not into the bureau, not into another client
    const other = await onboardClient(w.founder, { name: "Other", code: `O${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12 } as never);
    const me = { id: w.approver.userId, organizationId: w.client.id, role: w.approver.role };
    expect(await mayWorkIn(me, w.client.id)).toBe(true);
    expect(await mayWorkIn(me, w.t.org.id)).toBe(false);
    expect(await mayWorkIn(me, other.client.id)).toBe(false);
    // another client's payroll can't be read even by id
    await expect(portalRun({ ...w.approver, orgId: other.client.id }, w.run.id)).rejects.toThrow(/Payroll not found/);
    const intruder = await person(other.client.id, "CLIENT_APPROVER", "intruder");
    await expect(portalRun(intruder, w.run.id)).rejects.toThrow(/Payroll not found/);
    await expect(clientApproveRun(intruder, w.run.id)).rejects.toThrow(/Payroll not found/);
  });

  it("is blocked from everything but setting up two-factor until it is on, with no grace period and no policy to switch it off", async () => {
    const w = await world();
    expect((await twoFactorStateFor({ userId: w.approver.userId, orgId: w.client.id, role: "CLIENT_APPROVER" })).state).toBe("BLOCKED");
    expect((await twoFactorStateFor({ userId: w.hrContact.userId, orgId: w.client.id, role: "CLIENT_HR" })).state).toBe("BLOCKED");
    await db.user.update({ where: { id: w.approver.userId }, data: { totpEnabled: true } });
    expect((await twoFactorStateFor({ userId: w.approver.userId, orgId: w.client.id, role: "CLIENT_APPROVER" })).state).toBe("ENROLLED");
    // the bureau's own staff are covered by the bureau's rule, with notice before it applies (see bureau-staff-two-factor.test.ts)
    expect((await twoFactorStateFor({ userId: w.founder.userId, orgId: w.t.org.id, role: "COMPANY_ADMIN" })).state).toBe("GRACE");
  });

  it("sees the month's dates and inputs, and a payroll only once the bureau has approved it", async () => {
    const w = await world();
    const o = await portalOverview(w.hrContact);
    expect(o.organization).toBe("Acme Ltd");
    expect(o.bureau).toBeTruthy();
    expect(o.months[0].period.name).toBe("October 2026");
    const p = await portalRun(w.hrContact, w.run.id);
    expect(p.records).toHaveLength(1);
    expect(p.records[0]).toMatchObject({ employeeName: "Ada Obi" });
    await db.payrollRun.update({ where: { id: w.run.id }, data: { status: "CALCULATED" } });
    await expect(portalRun(w.hrContact, w.run.id)).rejects.toThrow(/still being prepared/);
  });
});

describe("the client's approval", () => {
  it("is needed before the payroll can be locked, only the approver can give it, and it is recorded with who and when", async () => {
    const w = await world();
    await setClientApprovalRequired(w.admin, true);
    const finLocker = { ...w.fin, role: "FINANCE" as const };
    await expect(lockRun(finLocker, w.run.id)).rejects.toThrow(/waiting for the client's own approval/);
    // the database refuses it too
    await expect(db.payrollRun.update({ where: { id: w.run.id }, data: { status: "LOCKED" } })).rejects.toThrow(/needs the client's approval/);

    expect((await clientApprovalStatus(w.fin, w.run.id)).awaiting).toBe(true);
    await expect(clientApproveRun(w.hrContact, w.run.id)).rejects.toThrow(/permission/);
    await clientApproveRun(w.approver, w.run.id, "Checked against our attendance");
    await expect(clientApproveRun(w.approver, w.run.id)).rejects.toThrow(/already approved/);
    const rec = await db.payrollClientApproval.findFirstOrThrow({ where: { runId: w.run.id } });
    expect(rec).toMatchObject({ decision: "APPROVED", byName: w.approver.name, byUserId: w.approver.userId, calculationCount: 1, comment: "Checked against our attendance" });
    const st = await clientApprovalStatus(w.fin, w.run.id);
    expect(st).toMatchObject({ approvedNow: true, awaiting: false });
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "PAYROLL_CLIENT_APPROVED" } })).toBe(1);
    await expect(db.payrollClientApproval.update({ where: { id: rec.id }, data: { comment: "rewritten" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.payrollClientApproval.delete({ where: { id: rec.id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("doesn't count once the payroll has been calculated again", async () => {
    const w = await world();
    await setClientApprovalRequired(w.admin, true);
    await clientApproveRun(w.approver, w.run.id);
    await db.payrollRun.update({ where: { id: w.run.id }, data: { calculationCount: 2 } }); // recalculated since
    const st = await clientApprovalStatus(w.fin, w.run.id);
    expect(st).toMatchObject({ approvedNow: false, awaiting: true });
    await expect(lockRun(w.fin, w.run.id)).rejects.toThrow(/current figures/);
    await expect(db.payrollRun.update({ where: { id: w.run.id }, data: { status: "LOCKED" } })).rejects.toThrow(/current figures/);
    await clientApproveRun(w.approver, w.run.id); // a fresh approval for the new figures
    expect((await clientApprovalStatus(w.fin, w.run.id)).approvedNow).toBe(true);
  });

  it("can be refused with a reason, which sends the payroll back to the bureau's preparer", async () => {
    const w = await world();
    await setClientApprovalRequired(w.admin, true);
    await expect(clientRejectRun(w.approver, w.run.id, "no")).rejects.toThrow(/what needs to change/);
    await clientRejectRun(w.approver, w.run.id, "Two people left in September and are still on this payroll");
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: w.run.id } });
    expect(run).toMatchObject({ status: "CALCULATED", approvedBy: null, approvedByUserId: null });
    expect((await db.payrollPeriod.findUniqueOrThrow({ where: { id: w.period.id } })).status).toBe("OPEN");
    const last = await db.payrollClientApproval.findFirstOrThrow({ where: { runId: w.run.id }, orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ decision: "REJECTED", comment: "Two people left in September and are still on this payroll" });
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.client.id, action: "PAYROLL_CLIENT_REJECTED" } });
    expect(log.userName).toBe(w.approver.name);
    expect(log.reason).toMatch(/The client sent it back: Two people left/);
    const st = await clientApprovalStatus(w.fin, w.run.id);
    expect(st.last?.decision).toBe("REJECTED");
    // it is no longer with the client until the bureau has approved it again
    await expect(clientApproveRun(w.approver, w.run.id)).rejects.toThrow(/isn't ready for your approval/);
    await expect(db.payrollClientApproval.create({ data: { organizationId: w.client.id, runId: w.run.id, calculationCount: 1, decision: "REJECTED", byName: "x", byUserId: "x" } })).rejects.toThrow(/refusal_explained|violates check/);
  });

  it("is not asked for where the organization doesn't require it, and locking works as before", async () => {
    const w = await world();
    await expect(clientApproveRun(w.approver, w.run.id)).rejects.toThrow(/doesn't need the client's approval/);
    expect((await clientApprovalStatus(w.fin, w.run.id)).required).toBe(false);
    // the database lets a payroll be locked where approval is not required (the application's own lock also posts to the ledger, which a bare run can't)
    await db.payrollRun.update({ where: { id: w.run.id }, data: { status: "LOCKED" } });
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: w.run.id } })).status).toBe("LOCKED");
  });
});
