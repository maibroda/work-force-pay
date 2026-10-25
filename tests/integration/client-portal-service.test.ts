import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import JSZip from "jszip";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email";
import { enableBureau, grantAccess, onboardClient } from "@/server/services/bureau";
import { approveChange } from "@/server/services/change-requests";
import { bureauOpenQueries, closeQuery, getQuery, listQueries, raiseQuery, replyToQuery } from "@/server/services/client-queries";
import { inviteClientUser, portalChangeRequests, portalEmployees, portalRequestChange } from "@/server/services/portal";
import { portalPayslipsZip, portalRegisterCsv } from "@/server/services/payslips";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@svc.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const finance = await person(t.org.id, "FINANCE", "finance");
  await enableBureau(founder);
  const mk = async (name: string) => (await onboardClient(founder, { name, code: `S${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12 } as never)).client;
  const client = await mk("Acme Ltd");
  const other = await mk("Other Ltd");
  await grantAccess(founder, officer.userId, client.id);
  const acting = (c: Ctx, org = client.id): Ctx => ({ ...c, orgId: org, homeOrgId: t.org.id });
  const admin = acting(founder);
  const asClient = (u: { id: string; name: string; email: string; role: string }, org = client.id): Ctx => ({ userId: u.id, orgId: org, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: null });
  const approver = asClient(await inviteClientUser(admin, { name: "Mrs Bello", email: `b.${uid()}@acme.test`, role: "CLIENT_APPROVER" }));
  const hrContact = asClient(await inviteClientUser(admin, { name: "Mr Hr", email: `h.${uid()}@acme.test`, role: "CLIENT_HR" }));
  const otherApprover = asClient(await inviteClientUser(acting(founder, other.id), { name: "Other Approver", email: `o.${uid()}@other.test`, role: "CLIENT_APPROVER" }), other.id);
  const cat = await db.employeeCategory.create({ data: { organizationId: client.id, code: "STAFF", name: "Staff" } });
  const emp = await db.employee.create({ data: { organizationId: client.id, employeeNumber: "EMP-000001", firstName: "Ada", lastName: "Obi", employmentDate: d("2025-01-01"), categoryId: cat.id, bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OBI", taxId: "TIN12345678" } });
  const period = await db.payrollPeriod.create({ data: { organizationId: client.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  const run = await db.payrollRun.create({ data: { organizationId: client.id, periodId: period.id, runNumber: 1, status: "APPROVED", calculationCount: 1, employeeCount: 1, approvedBy: "Reviewer", approvedByUserId: "someone-else", preparedByUserIds: ["preparer"] } });
  const rec = await db.payrollRecord.create({
    data: {
      organizationId: client.id, runId: run.id, employeeId: emp.id, employeeNumber: emp.employeeNumber, employeeName: "=HYPERLINK(\"x\") Ada Obi", categoryName: "Staff", departmentName: "Lagos HQ",
      basisDays: 31, daysWorked: 31, monthlyGross: 120000, earnedGross: 120000, totalEarnings: 120000, pensionBase: 0, employeePension: 9600, employerPension: 12000,
      taxableIncome: 100000, paye: 10400, totalDeductions: 20000, netPay: 100000, employerCost: 132000, taxRuleVersion: "x", lines: [{ type: "EARNING", code: "BASIC", name: "Basic", amount: 120000 }], locations: [],
    },
  });
  return { t, founder, officer, finance, client, other, admin, staff: acting(officer), fin: acting(finance), approver, hrContact, otherApprover, emp, run, rec };
}

beforeEach(() => mail.mockClear());

describe("client queries", () => {
  it("are raised by the client, numbered, and tell the bureau's team and not another client's", async () => {
    const w = await world();
    mail.mockClear();
    const q = await raiseQuery(w.hrContact, { subject: "Two staff left in September", category: "EMPLOYEE_DETAILS", body: "Please check EMP-000004 and EMP-000007: both left on 15 September." });
    expect(q).toMatchObject({ number: "QRY-00001", status: "OPEN", raisedBy: w.hrContact.name, category: "EMPLOYEE_DETAILS" });
    const first = await db.clientQueryMessage.findFirstOrThrow({ where: { queryId: q.id } });
    expect(first).toMatchObject({ side: "CLIENT", authorUserId: w.hrContact.userId });
    const to = mail.mock.calls.map((c) => c[0].to).sort();
    expect(to).toEqual([w.founder.email, w.officer.email].sort()); // the manager and the officer given this client; not the finance person without access
    expect(mail.mock.calls[0][0].subject).toBe("New query from Acme Ltd: Two staff left in September");
    expect((await raiseQuery(w.approver, { subject: "Second question here", category: "OTHER", body: "Another thing to ask about." })).number).toBe("QRY-00002");
    await expect(raiseQuery(w.approver, { subject: "x", category: "OTHER", body: "short" } as never)).rejects.toThrow();
    await expect(raiseQuery(w.officer, { subject: "Staff cannot raise", category: "OTHER", body: "Staff are not clients." })).rejects.toThrow(/permission/);
    // another client sees none of it
    expect(await listQueries(w.otherApprover)).toEqual([]);
    await expect(getQuery(w.otherApprover, q.id)).rejects.toThrow(/Query not found/);
    await expect(replyToQuery(w.otherApprover, q.id, "Not mine to answer")).rejects.toThrow(/Query not found/);
  });

  it("are answered by the bureau, reopen when the client replies, and are closed by either side, after which nothing is added", async () => {
    const w = await world();
    const q = await raiseQuery(w.approver, { subject: "When is the draft?", category: "PAYROLL", body: "Can you tell us when to expect the draft?" });
    mail.mockClear();
    await expect(replyToQuery(w.fin, q.id, "x")).rejects.toThrow(/Write your message/);
    await replyToQuery(w.staff, q.id, "Tomorrow by noon.");
    let cur = await getQuery(w.approver, q.id);
    expect(cur.status).toBe("ANSWERED");
    expect(cur.firstResponseAt).not.toBeNull();
    expect(cur.messages.map((m) => m.side)).toEqual(["CLIENT", "BUREAU"]);
    expect(mail.mock.calls.map((c) => c[0].to)).toEqual([w.approver.email]); // the person who asked is told
    expect(mail.mock.calls[0][0].subject).toBe(`Your query ${q.number} has a reply: When is the draft?`);

    mail.mockClear();
    await replyToQuery(w.approver, q.id, "Thank you. One more thing: the two leavers.");
    expect((await getQuery(w.approver, q.id)).status).toBe("OPEN");
    expect(mail.mock.calls.map((c) => c[0].to).sort()).toEqual([w.founder.email, w.officer.email].sort());
    const firstAt = (await getQuery(w.approver, q.id)).firstResponseAt;
    await replyToQuery(w.staff, q.id, "Noted, we will take them off.");
    expect((await getQuery(w.approver, q.id)).firstResponseAt).toEqual(firstAt); // the first reply is what is measured

    await closeQuery(w.approver, q.id);
    cur = await getQuery(w.approver, q.id);
    expect(cur).toMatchObject({ status: "CLOSED", closedBy: w.approver.name });
    await expect(replyToQuery(w.staff, q.id, "Anything else?")).rejects.toThrow(/closed/);
    await expect(closeQuery(w.staff, q.id)).rejects.toThrow(/already closed/);
    await expect(db.clientQueryMessage.create({ data: { organizationId: w.client.id, queryId: q.id, side: "BUREAU", authorName: "x", authorUserId: "x", body: "sneaking in" } })).rejects.toThrow(/closed; raise a new one/);
    const msg = await db.clientQueryMessage.findFirstOrThrow({ where: { queryId: q.id } });
    await expect(db.clientQueryMessage.update({ where: { id: msg.id }, data: { body: "rewritten" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.clientQueryMessage.delete({ where: { id: msg.id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("measure how long the bureau took, flag a query waiting too long, and list every open one across the clients a person works on", async () => {
    const w = await world();
    const waited = await raiseQuery(w.approver, { subject: "Waiting a long time", category: "PAYROLL", body: "Nobody has answered this yet." });
    const quick = await raiseQuery(w.hrContact, { subject: "Answered quickly", category: "OTHER", body: "A simple question for you." });
    await db.clientQuery.update({ where: { id: waited.id }, data: { createdAt: new Date(Date.now() - 30 * 3_600_000) } });
    await db.clientQuery.update({ where: { id: quick.id }, data: { createdAt: new Date(Date.now() - 6 * 3_600_000) } });
    await replyToQuery(w.staff, quick.id, "Here you go.");

    const list = await listQueries(w.approver);
    const byNo = Object.fromEntries(list.map((x) => [x.number, x]));
    expect(byNo[waited.number]).toMatchObject({ overdue: true });
    expect(byNo[waited.number].waitingHours).toBeGreaterThanOrEqual(30);
    expect(byNo[quick.number]).toMatchObject({ overdue: false, status: "ANSWERED" });
    expect(byNo[quick.number].responseHours).toBeGreaterThanOrEqual(6);

    const all = await bureauOpenQueries(w.founder);
    expect(all.rows.map((r) => r.number)).toEqual([waited.number, quick.number]); // oldest first
    expect(all.rows[0]).toMatchObject({ clientName: "Acme Ltd", overdue: true });
    expect(all.averageResponseHours).toBeGreaterThanOrEqual(6);
    // an officer not given the other client sees only the clients they work on
    expect((await bureauOpenQueries(w.officer)).rows).toHaveLength(2);
    const stranger = await person(w.t.org.id, "PAYROLL_ADMIN", "stranger");
    expect((await bureauOpenQueries(stranger)).rows).toEqual([]);
  });
});

describe("downloads in the portal", () => {
  it("give the client their own register and payslips once the payroll is approved, and record each download", async () => {
    const w = await world();
    const reg = await portalRegisterCsv(w.hrContact, w.run.id);
    expect(reg.fileName).toBe("payroll-register-October-2026.csv");
    const lines = reg.csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Employee No.,Name,Department,Days worked,Days in month,Gross pay,PAYE,Employee pension,Other deductions,Net pay");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("EMP-000001");
    expect(lines[1]).toContain("'=HYPERLINK"); // a name that looks like a formula is made safe
    expect(lines[1].endsWith("120000,10400,9600,0,100000") || lines[1].includes("100000")).toBe(true);
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "PORTAL_REGISTER_DOWNLOAD", userName: w.hrContact.name } })).toBe(1);

    const z = await portalPayslipsZip(w.approver, w.run.id);
    expect(z.count).toBe(1);
    const zip = await JSZip.loadAsync(z.buffer);
    expect(Object.keys(zip.files)).toEqual(["payslip-EMP-000001-October-2026.pdf"]);
    expect(Buffer.from((await zip.files["payslip-EMP-000001-October-2026.pdf"].async("nodebuffer")).subarray(0, 5)).toString()).toBe("%PDF-");
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "PORTAL_PAYSLIPS_DOWNLOAD" } })).toBe(1);
  });

  it("are refused for another client's payroll and while the payroll is still being prepared", async () => {
    const w = await world();
    await expect(portalRegisterCsv(w.otherApprover, w.run.id)).rejects.toThrow(/Payroll run not found/);
    await expect(portalPayslipsZip(w.otherApprover, w.run.id)).rejects.toThrow(/Payroll run not found/);
    await db.payrollRun.update({ where: { id: w.run.id }, data: { status: "CALCULATED" } });
    await expect(portalRegisterCsv(w.approver, w.run.id)).rejects.toThrow(/once the payroll is approved/);
    await expect(portalPayslipsZip(w.approver, w.run.id)).rejects.toThrow(/once the payroll is approved/);
    await expect(portalRegisterCsv(w.staff, w.run.id)).rejects.toThrow(/permission|Payroll run not found/);
  });
});

describe("employee changes asked for in the portal", () => {
  it("come from the client's HR contact, wait for the bureau's approval, and change nothing until then", async () => {
    const w = await world();
    const list = await portalEmployees(w.hrContact);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ employeeNumber: "EMP-000001", bank: "GTBank ******6789", taxId: "*******5678", pending: [] });
    expect(JSON.stringify(list)).not.toContain("0123456789");

    await expect(portalRequestChange(w.approver, w.emp.id, "BANK", { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "ADA OBI" }, "She moved banks")).rejects.toThrow(/permission/); // the approver doesn't ask for these
    const req = await portalRequestChange(w.hrContact, w.emp.id, "BANK", { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "ADA OBI" }, "She moved banks");
    expect(req).toMatchObject({ status: "PENDING", requestedByUserId: w.hrContact.userId, requestedBy: w.hrContact.name });
    expect((await db.employee.findUniqueOrThrow({ where: { id: w.emp.id } })).accountNumber).toBe("0123456789"); // nothing has changed
    expect((await portalEmployees(w.hrContact))[0].pending).toEqual(["BANK"]);
    expect((await portalChangeRequests(w.hrContact))[0].status).toBe("PENDING");
    await expect(portalRequestChange(w.hrContact, w.emp.id, "BANK", { bankName: "UBA", accountNumber: "3011111111", accountName: "ADA OBI" }, "Another one")).rejects.toThrow(/already a pending request/);
    await expect(portalRequestChange(w.hrContact, w.emp.id, "TAX", { taxId: "TIN12345678" }, "No real change")).rejects.toThrow(/already on file/);

    // the bureau's finance person approves it; the client cannot approve their own request
    await approveChange(w.fin, req.id, "Confirmed with the employee");
    expect((await db.employee.findUniqueOrThrow({ where: { id: w.emp.id } })).accountNumber).toBe("2099999999");
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.client.id, action: "CHANGE_REQUEST", userName: w.hrContact.name } });
    expect(log.reason).toBe("She moved banks");
    await expect(approveChange(w.hrContact, req.id)).rejects.toThrow(/permission/);
  });

  it("can't reach another client's employees", async () => {
    const w = await world();
    const otherHr = { ...w.otherApprover, role: "CLIENT_HR" as const };
    await expect(portalRequestChange(otherHr, w.emp.id, "BANK", { bankName: "UBA", accountNumber: "3011111111", accountName: "X Y Z" }, "Trying another client's employee")).rejects.toThrow(/Employee not found/);
    expect(await portalEmployees(otherHr)).toEqual([]);
  });
});
