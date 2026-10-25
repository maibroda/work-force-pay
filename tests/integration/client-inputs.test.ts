import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email";
import { enableBureau, grantAccess, onboardClient } from "@/server/services/bureau";
import { acceptClientInputs, getClientInputs, listClientInputs, previewClientInputs, rejectClientInputs, submitClientInputs, uploadableMonths, waitingClientInputs, withdrawClientInputs } from "@/server/services/client-inputs";
import { inviteClientUser } from "@/server/services/portal";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const HEAD = "Employee Number,Type,Description,Amount,Taxable,Reference,Note";
const file = (...rows: string[]) => [HEAD, ...rows].join("\n");

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@inp.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const finance = await person(t.org.id, "FINANCE", "finance");
  await enableBureau(founder);
  const mk = async (name: string) => (await onboardClient(founder, { name, code: `I${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-01-01", termMonths: 12 } as never)).client;
  const client = await mk("Acme Ltd");
  const other = await mk("Other Ltd");
  await grantAccess(founder, officer.userId, client.id);
  await grantAccess(founder, finance.userId, client.id);
  const acting = (c: Ctx, org = client.id): Ctx => ({ ...c, orgId: org, homeOrgId: t.org.id });
  const asClient = (u: { id: string; name: string; email: string; role: string }, org = client.id): Ctx => ({ userId: u.id, orgId: org, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: null });
  const hr = asClient(await inviteClientUser(acting(founder), { name: "Mr Hr", email: `h.${uid()}@acme.test`, role: "CLIENT_HR" }));
  const approver = asClient(await inviteClientUser(acting(founder), { name: "Mrs Bello", email: `b.${uid()}@acme.test`, role: "CLIENT_APPROVER" }));
  const otherHr = asClient(await inviteClientUser(acting(founder, other.id), { name: "Other Hr", email: `o.${uid()}@other.test`, role: "CLIENT_HR" }), other.id);
  const cat = await db.employeeCategory.create({ data: { organizationId: client.id, code: "STAFF", name: "Staff" } });
  const emp = (n: number, first: string, status: "ACTIVE" | "RESIGNED" = "ACTIVE") =>
    db.employee.create({ data: { organizationId: client.id, employeeNumber: `EMP-00000${n}`, firstName: first, lastName: "Test", employmentDate: d("2025-01-01"), categoryId: cat.id, status } });
  const [ada, bola, chi] = [await emp(1, "Ada"), await emp(2, "Bola"), await emp(3, "Chi", "RESIGNED")];
  const period = await db.payrollPeriod.create({ data: { organizationId: client.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  for (const kind of ["OVERTIME", "ALLOWANCES", "DEDUCTIONS", "ATTENDANCE"]) await db.payrollInputItem.create({ data: { organizationId: client.id, periodId: period.id, kind } });
  return { t, founder, staff: acting(officer), fin: acting(finance), client, other, hr, approver, otherHr, ada, bola, chi, period };
}
type W = Awaited<ReturnType<typeof world>>;
const tracker = async (w: W) => Object.fromEntries((await db.payrollInputItem.findMany({ where: { periodId: w.period.id } })).map((i) => [i.kind, i.status]));
const send = (w: W, csv: string, name = "october.csv") => submitClientInputs(w.hr, { periodId: w.period.id, csv, fileName: name });
const GOOD = file("EMP-000001,Overtime,Weekend cover,45000,Yes,,", "EMP-000002,Allowance,Transport,15000,No,,", "EMP-000001,Penalty,Lateness,5000,,HR letter 14 Oct,");

beforeEach(() => mail.mockClear());

describe("sending a month's inputs", () => {
  it("checks the file first without writing anything", async () => {
    const w = await world();
    const c = await previewClientInputs(w.hr, w.period.id, file("EMP-000001,Bonus,,100,,,", "EMP-009999,Bonus,,100,,,"));
    expect(c.summary).toMatchObject({ total: 2, errors: 1 });
    expect(await db.clientInputBatch.count({ where: { organizationId: w.client.id } })).toBe(0);
  });

  it("keeps a numbered batch, marks the inputs it covers as received, and tells the bureau's team, but changes no payroll data yet", async () => {
    const w = await world();
    mail.mockClear();
    const b = await send(w, GOOD);
    expect(b).toMatchObject({ number: "INP-00001", status: "SUBMITTED", rowCount: 3, submittedBy: w.hr.name, late: false });
    expect(Number(b.earningsTotal)).toBe(60000);
    expect(Number(b.deductionsTotal)).toBe(5000);
    expect(await tracker(w)).toEqual({ OVERTIME: "RECEIVED", ALLOWANCES: "RECEIVED", DEDUCTIONS: "RECEIVED", ATTENDANCE: "EXPECTED" });
    expect(await db.clientInputRow.count({ where: { batchId: b.id } })).toBe(3);
    expect(await db.otherEarning.count({ where: { organizationId: w.client.id } })).toBe(0);
    expect(await db.deduction.count({ where: { organizationId: w.client.id } })).toBe(0);
    const to = mail.mock.calls.map((c) => c[0].to).sort();
    expect(to).toEqual([w.founder.email, w.staff.email, w.fin.email].sort()); // the people given this client, and the bureau's manager
    expect(mail.mock.calls[0][0].subject).toBe(`Acme Ltd sent inputs for October 2026 (INP-00001)`);
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "CLIENT_INPUTS_SUBMIT" } })).toBe(1);
  });

  it("refuses a file with any error, writing nothing, and the same file twice", async () => {
    const w = await world();
    await expect(send(w, file("EMP-000001,Bonus,,100,,,", "EMP-000003,Bonus,,100,,,"))).rejects.toThrow(/1 row\(s\) have errors, so nothing was sent/);
    expect(await db.clientInputBatch.count({ where: { organizationId: w.client.id } })).toBe(0);
    expect(await tracker(w)).toMatchObject({ OVERTIME: "EXPECTED" });
    await send(w, GOOD);
    await expect(send(w, GOOD)).rejects.toThrow(/already been sent for October 2026 as INP-00001/);
    const p = await previewClientInputs(w.hr, w.period.id, GOOD);
    expect(p.sameFile).toMatch(/INP-00001/);
  });

  it("warns when a second file repeats a row that is still waiting", async () => {
    const w = await world();
    await send(w, file("EMP-000001,Bonus,Diwali,500,,,"));
    const c = await previewClientInputs(w.hr, w.period.id, file("EMP-000001,Bonus,Diwali,500,,,", "EMP-000002,Bonus,Diwali,500,,,"));
    expect(c.rows[0].warnings[0]).toMatch(/already entered/);
    expect(c.rows[1].warnings).toEqual([]);
  });

  it("is only for the client's HR contact, only for that client's own months, and not once the month is approved", async () => {
    const w = await world();
    await expect(submitClientInputs(w.approver, { periodId: w.period.id, csv: GOOD, fileName: "a.csv" })).rejects.toThrow(/permission/);
    await expect(submitClientInputs(w.staff, { periodId: w.period.id, csv: GOOD, fileName: "a.csv" })).rejects.toThrow(/permission/);
    await expect(submitClientInputs(w.otherHr, { periodId: w.period.id, csv: GOOD, fileName: "a.csv" })).rejects.toThrow(/month was not found/);
    await db.payrollPeriod.update({ where: { id: w.period.id }, data: { status: "APPROVED" } });
    await expect(send(w, GOOD)).rejects.toThrow(/already been approved/);
    expect((await previewClientInputs(w.hr, w.period.id, GOOD)).closed).toMatch(/already been approved/);
    expect(await uploadableMonths(w.hr)).toEqual([]);
  });

  it("is marked late when it arrives after the month's cut-off", async () => {
    const w = await world();
    await db.payrollCalendarEntry.create({ data: { organizationId: w.client.id, periodId: w.period.id, inputCutoff: d("2026-10-01"), draftDue: d("2026-10-05"), approvalDue: d("2026-10-07"), payDate: d("2026-10-28"), remittanceDue: d("2026-11-10"), createdBy: "test" } });
    expect((await send(w, GOOD)).late).toBe(true);
    expect((await uploadableMonths(w.hr))[0]).toMatchObject({ name: "October 2026", cutoff: "2026-10-01" });
  });

  it("is seen only by the client's own people and the bureau's staff working in that client", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    expect((await listClientInputs(w.approver)).map((x) => x.id)).toEqual([b.id]);
    expect((await listClientInputs(w.staff)).map((x) => x.id)).toEqual([b.id]);
    expect(await listClientInputs(w.otherHr)).toEqual([]);
    await expect(getClientInputs(w.otherHr, b.id)).rejects.toThrow(/Upload not found/);
    expect(await waitingClientInputs(w.staff)).toBe(1);
  });
});

describe("the bureau's decision", () => {
  it("accepting turns each row into an approved earning or deduction, and records what each became", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    const r = await acceptClientInputs(w.staff, b.id);
    expect(r).toEqual({ rows: 3, recalculate: false });
    const earnings = await db.otherEarning.findMany({ where: { organizationId: w.client.id }, orderBy: { name: "asc" } });
    expect(earnings.map((e) => [e.name, Number(e.amount), e.taxable, e.status, e.approvedBy, e.periodId])).toEqual([
      ["Transport", 15000, false, "APPROVED", w.staff.name, w.period.id],
      ["Weekend cover", 45000, true, "APPROVED", w.staff.name, w.period.id],
    ]);
    expect(earnings[1].reason).toContain("INP-00001");
    const ded = await db.deduction.findFirstOrThrow({ where: { organizationId: w.client.id } });
    expect(ded).toMatchObject({ deductionType: "PENALTY", status: "APPROVED", authorityReference: "HR letter 14 Oct", requestedBy: w.hr.name, approvedBy: w.staff.name });
    expect(Number(ded.amount)).toBe(5000);
    const rows = await db.clientInputRow.findMany({ where: { batchId: b.id } });
    expect(rows.every((x) => x.appliedId)).toBe(true);
    expect(await db.clientInputBatch.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "ACCEPTED", decidedBy: w.staff.name });
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "CLIENT_INPUTS_ACCEPT" } })).toBe(1);
    expect(mail.mock.calls.some((c) => c[0].to === w.hr.email && /accepted/.test(c[0].subject))).toBe(true);
    await expect(acceptClientInputs(w.fin, b.id)).rejects.toThrow(/already accepted/);
  });

  it("says the payroll must be calculated again when it already has been", async () => {
    const w = await world();
    await db.payrollRun.create({ data: { organizationId: w.client.id, periodId: w.period.id, runNumber: 1, status: "CALCULATED", calculationCount: 1, employeeCount: 2 } });
    const b = await send(w, file("EMP-000001,Bonus,,100,,,"));
    expect(await acceptClientInputs(w.staff, b.id)).toEqual({ rows: 1, recalculate: true });
  });

  it("is for staff who may approve inputs, never the client, and never for another client's upload", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    await expect(acceptClientInputs(w.hr, b.id)).rejects.toThrow(/permission/);
    await expect(rejectClientInputs(w.hr, b.id, "I would like to change my mind")).rejects.toThrow(/permission/);
    await expect(acceptClientInputs({ ...w.fin, orgId: w.other.id }, b.id)).rejects.toThrow(/Upload not found/);
    expect(await db.otherEarning.count({ where: { organizationId: w.client.id } })).toBe(0);
  });

  it("can't be accepted once an employee has left or the month is approved, and says so", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    await db.employee.update({ where: { id: w.bola.id }, data: { status: "RESIGNED" } });
    expect((await getClientInputs(w.staff, b.id)).blockers[0]).toMatch(/EMP-000002 Bola Test has left the payroll since this was sent \(line 3\)/);
    await expect(acceptClientInputs(w.staff, b.id)).rejects.toThrow(/has left the payroll/);
    await db.employee.update({ where: { id: w.bola.id }, data: { status: "ACTIVE" } });
    await db.payrollPeriod.update({ where: { id: w.period.id }, data: { status: "APPROVED" } });
    await expect(acceptClientInputs(w.staff, b.id)).rejects.toThrow(/already been approved/);
    expect(await db.otherEarning.count({ where: { organizationId: w.client.id } })).toBe(0);
  });

  it("refusing needs a reason, puts the tracker back, tells the sender, and lets a corrected file be sent", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    await expect(rejectClientInputs(w.staff, b.id, "no")).rejects.toThrow(/Say what needs to change/);
    mail.mockClear();
    await rejectClientInputs(w.staff, b.id, "Bola's transport allowance is 12,000, not 15,000.");
    expect(await db.clientInputBatch.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "REJECTED", decisionNote: "Bola's transport allowance is 12,000, not 15,000." });
    expect(await tracker(w)).toEqual({ OVERTIME: "EXPECTED", ALLOWANCES: "EXPECTED", DEDUCTIONS: "EXPECTED", ATTENDANCE: "EXPECTED" });
    expect(mail.mock.calls.find((c) => c[0].to === w.hr.email)?.[0].text).toContain("12,000");
    await expect(acceptClientInputs(w.staff, b.id)).rejects.toThrow(/already rejected/);
    const again = await send(w, file("EMP-000002,Allowance,Transport,12000,No,,"));
    expect(again.number).toBe("INP-00002");
    // a refused file may be sent again unchanged once it is fixed elsewhere: only live files block a repeat
    await withdrawClientInputs(w.hr, again.id);
    expect((await send(w, file("EMP-000002,Allowance,Transport,12000,No,,"), "again.csv")).number).toBe("INP-00003");
  });

  it("withdrawing puts back only what this upload marked, and only while nobody has decided it", async () => {
    const w = await world();
    await db.payrollInputItem.updateMany({ where: { periodId: w.period.id, kind: "DEDUCTIONS" }, data: { status: "NOT_APPLICABLE", note: "None this month, per HR" } });
    const b = await send(w, GOOD);
    expect(await tracker(w)).toMatchObject({ OVERTIME: "RECEIVED", DEDUCTIONS: "NOT_APPLICABLE" });
    await withdrawClientInputs(w.hr, b.id);
    expect(await tracker(w)).toMatchObject({ OVERTIME: "EXPECTED", ALLOWANCES: "EXPECTED", DEDUCTIONS: "NOT_APPLICABLE" });
    await expect(withdrawClientInputs(w.hr, b.id)).rejects.toThrow(/already withdrawn/);
    await expect(acceptClientInputs(w.staff, b.id)).rejects.toThrow(/already withdrawn/);
    const c = await send(w, file("EMP-000001,Bonus,,100,,,"));
    await acceptClientInputs(w.staff, c.id);
    await expect(withdrawClientInputs(w.hr, c.id)).rejects.toThrow(/already accepted/);
  });
});

describe("what the database holds to", () => {
  it("never lets what a client sent be changed or removed", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    const row = await db.clientInputRow.findFirstOrThrow({ where: { batchId: b.id } });
    await expect(db.clientInputRow.update({ where: { id: row.id }, data: { amount: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(db.clientInputRow.delete({ where: { id: row.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.clientInputBatch.update({ where: { id: b.id }, data: { fileName: "other.csv" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.clientInputBatch.delete({ where: { id: b.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.clientInputBatch.update({ where: { id: b.id }, data: { decisionNote: "sneaky" } })).rejects.toThrow(/can only be decided/);
  });

  it("decides a batch once, with a reason when refusing, and never by the person who sent it", async () => {
    const w = await world();
    const b = await send(w, GOOD);
    await expect(db.clientInputBatch.update({ where: { id: b.id }, data: { status: "ACCEPTED", decidedBy: "Me", decidedByUserId: w.hr.userId, decidedAt: new Date() } })).rejects.toThrow(/cannot be the one to accept/);
    await expect(db.clientInputBatch.update({ where: { id: b.id }, data: { status: "REJECTED", decidedBy: "Me", decidedByUserId: "x", decidedAt: new Date(), decisionNote: "no" } })).rejects.toThrow(/needs a reason/);
    await rejectClientInputs(w.staff, b.id, "Please correct the amounts.");
    await expect(db.clientInputBatch.update({ where: { id: b.id }, data: { status: "ACCEPTED", decidedBy: "Me", decidedByUserId: "x", decidedAt: new Date() } })).rejects.toThrow(/already been decided/);
    await expect(db.clientInputRow.create({ data: { organizationId: w.client.id, batchId: b.id, line: 9, employeeId: w.ada.id, type: "BONUS", description: "Late addition", amount: 5 } })).rejects.toThrow(/has been decided/);
  });

  it("refuses a deduction row with no reference, a zero amount or an unknown type", async () => {
    const w = await world();
    const b = await send(w, file("EMP-000001,Bonus,,100,,,"));
    const base = { organizationId: w.client.id, batchId: b.id, line: 9, employeeId: w.ada.id, description: "x" };
    await expect(db.clientInputRow.create({ data: { ...base, type: "PENALTY", amount: 5 } })).rejects.toThrow();
    await expect(db.clientInputRow.create({ data: { ...base, type: "BONUS", amount: 0 } })).rejects.toThrow();
    await expect(db.clientInputRow.create({ data: { ...base, type: "GIFT", amount: 5 } })).rejects.toThrow();
  });
});
