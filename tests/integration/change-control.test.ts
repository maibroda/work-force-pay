import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { isolatedOrg, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee, updateEmployee, type EmployeeInput } from "@/server/services/employees";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import {
  approveChange,
  cancelChange,
  currentDetails,
  employeeChanges,
  listChanges,
  myChanges,
  pendingChanges,
  recentBankChanges,
  rejectChange,
  requestChange,
} from "@/server/services/change-requests";
import { buildHrDigest } from "@/server/services/reminders";

type Org = Awaited<ReturnType<typeof isolatedOrg>>;

let n = 0;
const acct = () => {
  n += 1;
  return `22${String(Date.now()).slice(-6)}${String(n).padStart(2, "0")}`;
};
const bank = (name: string, over: Record<string, unknown> = {}) => ({ bankName: "GTBank", accountNumber: acct(), accountName: name, ...over });

async function worker(t: Org, first: string, last = "Staff", extra: Record<string, unknown> = {}) {
  return createEmployee(t.ctx("HR_ADMIN"), { firstName: first, lastName: last, employmentDate: "2024-01-01", categoryId: t.guardId, bankName: "Access Bank", accountNumber: acct(), accountName: `${first} ${last}`.toUpperCase(), ...extra });
}
const input = (e: { firstName: string; lastName: string; employmentDate: Date; categoryId: string }, extra: Record<string, unknown> = {}) =>
  ({ firstName: e.firstName, lastName: e.lastName, employmentDate: e.employmentDate.toISOString().slice(0, 10), categoryId: e.categoryId, ...extra }) as EmployeeInput;

describe("direct edits", () => {
  it("are refused for bank, tax and pension details while change control is on, and allowed when it is off", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await worker(t, "Direct");
    const base = { bankName: e.bankName ?? undefined, accountNumber: e.accountNumber ?? undefined, accountName: e.accountName ?? undefined };

    // changing something unrelated, with the sensitive fields as they were, is fine
    await updateEmployee(hr, e.id, input(e, { ...base, phone: "08031234567" }));
    await expect(updateEmployee(hr, e.id, input(e, { ...base, accountNumber: acct() }))).rejects.toThrow(/change request/);
    await expect(updateEmployee(hr, e.id, input(e, { ...base, taxId: "TIN-1" }))).rejects.toThrow(/change request/);
    await expect(updateEmployee(hr, e.id, input(e, { ...base, pensionPin: "PEN123" }))).rejects.toThrow(/change request/);
    // the refused edit left nothing behind
    const after = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ accountNumber: e.accountNumber, taxId: null, pensionPin: null, phone: "08031234567" });

    await updateHrPolicy(hr, { sensitiveChangeApproval: false });
    const fresh = acct();
    await updateEmployee(hr, e.id, input(e, { ...base, accountNumber: fresh }), "Policy is off");
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).accountNumber).toBe(fresh);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "BANK_INFORMATION_CHANGE" } })).toBe(1);
  });
});

describe("requesting and approving", () => {
  it("applies a change only when someone else approves it, and records the whole trail", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const fin = t.ctx("FINANCE");
    const e = await worker(t, "Ada", "Okafor");
    const before = { bankName: e.bankName, accountNumber: e.accountNumber, accountName: e.accountName };
    const next = bank("ADA OKAFOR");
    const r = await requestChange(hr, e.id, "BANK", next, "Employee moved to GTBank");
    expect(r).toMatchObject({ status: "PENDING", kind: "BANK", requestedBy: hr.name });
    expect(r.previous).toMatchObject(before);
    // nothing changes while it's pending
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).accountNumber).toBe(e.accountNumber);

    // the requester, a user without the permission, and the employee themselves can't decide
    await expect(approveChange(hr, r.id)).rejects.toThrow(/someone else/);
    await expect(approveChange(t.ctx("PAYROLL_ADMIN"), r.id)).rejects.toThrow(); // no approval permission
    await expect(approveChange(t.ctx("FINANCE", e.id), r.id)).rejects.toThrow(/your own details/);
    await expect(rejectChange(hr, r.id, "no thanks")).rejects.toThrow(/someone else/);

    const done = await approveChange(fin, r.id, "Checked with the employee");
    expect(done).toMatchObject({ status: "APPROVED", decidedBy: fin.name, decisionNote: "Checked with the employee" });
    expect(done.appliedAt).not.toBeNull();
    expect(await db.employee.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ bankName: next.bankName, accountNumber: next.accountNumber, accountName: next.accountName });
    await expect(approveChange(fin, r.id)).rejects.toThrow(/already approved/);

    const actions = (await db.auditLog.findMany({ where: { organizationId: t.org.id, entityId: e.id, action: { in: ["CHANGE_REQUEST", "BANK_INFORMATION_CHANGE", "CHANGE_REQUEST_APPROVE"] } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["CHANGE_REQUEST", "BANK_INFORMATION_CHANGE", "CHANGE_REQUEST_APPROVE"]);
    expect((await employeeChanges(hr, e.id)).map((x) => x.status)).toEqual(["APPROVED"]);
  });

  it("covers tax and pension details too, and lets a value be cleared", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const fin = t.ctx("FINANCE");
    const e = await worker(t, "Tax", "Payer");
    const tax = await requestChange(hr, e.id, "TAX", { taxId: "TIN-77", annualRent: "240000" }, "Employee supplied a TIN");
    await approveChange(fin, tax.id);
    expect(await db.employee.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ taxId: "TIN-77" });
    expect(Number((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).annualRent)).toBe(240000);

    const pen = await requestChange(hr, e.id, "PENSION", { pensionPin: "PEN100200", pfa: "Stanbic IBTC" }, "New PFA details received");
    await approveChange(fin, pen.id);
    expect(await db.employee.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ pensionPin: "PEN100200", pfa: "Stanbic IBTC" });

    const clear = await requestChange(hr, e.id, "TAX", { taxId: "", annualRent: "" }, "Entered against the wrong person");
    expect(clear.proposed).toMatchObject({ taxId: null, annualRent: null });
    await approveChange(fin, clear.id);
    expect(await db.employee.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ taxId: null, annualRent: null });
  });

  it("validates the request and allows only one pending per kind", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await worker(t, "Valid", "Ator");
    await expect(requestChange(hr, e.id, "BANK", bank("VALID ATOR", { accountNumber: "12345" }), "Moved banks")).rejects.toThrow(/10 digits/);
    await expect(requestChange(hr, e.id, "BANK", bank("VALID ATOR", { bankName: "" }), "Moved banks")).rejects.toThrow();
    await expect(requestChange(hr, e.id, "BANK", bank("VALID ATOR"), "")).rejects.toThrow(/Say why/);
    await expect(requestChange(hr, e.id, "BANK", bank("VALID ATOR"), "ok")).rejects.toThrow(/Say why/);
    await expect(requestChange(hr, e.id, "BANK", { bankName: e.bankName, accountNumber: e.accountNumber, accountName: e.accountName }, "Nothing changes")).rejects.toThrow(/already on file/);
    await expect(requestChange(hr, e.id, "TAX", { taxId: "", annualRent: "-5" }, "Negative rent")).rejects.toThrow();
    await expect(requestChange(hr, "ghost", "BANK", bank("X Y"), "Moved banks")).rejects.toThrow(/not found/);
    await expect(requestChange(t.ctx("AUDITOR"), e.id, "BANK", bank("VALID ATOR"), "Moved banks")).rejects.toThrow();

    await requestChange(hr, e.id, "BANK", bank("VALID ATOR"), "Moved banks");
    await expect(requestChange(hr, e.id, "BANK", bank("VALID ATOR"), "Moved banks again")).rejects.toThrow(/already a pending request/);
    await requestChange(hr, e.id, "PENSION", { pensionPin: "PEN1", pfa: "ARM" }, "A different kind is fine"); // different kind
    await db.employee.update({ where: { id: e.id }, data: { status: "RESIGNED" } });
    await expect(requestChange(hr, e.id, "TAX", { taxId: "T9" }, "Too late for this")).rejects.toThrow(/has left/);
  });

  it("refuses to approve a number already held by someone else, or a request gone stale", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const fin = t.ctx("FINANCE");
    const a = await worker(t, "Alpha", "One");
    const b = await worker(t, "Bravo", "Two");

    const clash = await requestChange(hr, b.id, "BANK", { bankName: "GTBank", accountNumber: a.accountNumber, accountName: "BRAVO TWO" }, "Employee's new account");
    const listed = (await listChanges(fin, { status: "PENDING" })).find((x) => x.id === clash.id)!;
    expect(listed.clash).toMatch(/Alpha One/);
    await expect(approveChange(fin, clash.id)).rejects.toThrow(/already on .*Alpha One/);
    expect((await db.employee.findUniqueOrThrow({ where: { id: b.id } })).accountNumber).toBe(b.accountNumber);
    await rejectChange(fin, clash.id, "That is Alpha's account");

    const tin = await requestChange(hr, b.id, "TAX", { taxId: "SAME-TIN" }, "Supplied by employee");
    await db.employee.update({ where: { id: a.id }, data: { taxId: "SAME-TIN" } });
    await expect(approveChange(fin, tin.id)).rejects.toThrow(/tax id is already on/i);
    await rejectChange(fin, tin.id, "Duplicate TIN");

    // stale: the employee's details changed after the request was made
    const stale = await requestChange(hr, b.id, "BANK", bank("BRAVO TWO"), "Moved banks");
    await db.employee.update({ where: { id: b.id }, data: { accountNumber: acct() } });
    await expect(approveChange(fin, stale.id)).rejects.toThrow(/changed since this was requested/);
    // a leaver can't have details changed
    const gone = await requestChange(hr, a.id, "PENSION", { pensionPin: "PEN-Z" }, "Pension update");
    await db.employee.update({ where: { id: a.id }, data: { status: "TERMINATED" } });
    await expect(approveChange(fin, gone.id)).rejects.toThrow(/has left/);
  });

  it("flags an account name that doesn't look like the employee's", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await worker(t, "Ngozi", "Eze");
    await requestChange(hr, e.id, "BANK", bank("SOMEONE ELSE ENTIRELY"), "New account");
    const [r] = await listChanges(hr, { status: "PENDING" });
    expect(r.nameMatches).toBe(false);
    await cancelChange(hr, r.id);
    await requestChange(hr, e.id, "BANK", bank("EZE NGOZI CHIOMA"), "Corrected account name");
    expect((await listChanges(hr, { status: "PENDING" }))[0].nameMatches).toBe(true);
    await requestChange(hr, e.id, "PENSION", { pensionPin: "P1", pfa: "ARM" }, "Pension");
    expect((await listChanges(hr, { status: "PENDING" })).find((x) => x.kind === "PENSION")!.nameMatches).toBeNull(); // only bank requests are name-checked
  });

  it("can be rejected or cancelled, but only by the right people", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const fin = t.ctx("FINANCE");
    const e = await worker(t, "Maybe", "Later");
    const r = await requestChange(hr, e.id, "BANK", bank("MAYBE LATER"), "Moved banks");
    await expect(rejectChange(fin, r.id, "")).rejects.toThrow(/reason/);
    await expect(cancelChange(fin, r.id)).rejects.toThrow(/Only the person who made/);
    expect(await rejectChange(fin, r.id, "Please bring a bank statement")).toMatchObject({ status: "REJECTED", decisionNote: "Please bring a bank statement" });
    await expect(approveChange(fin, r.id)).rejects.toThrow(/already rejected/);
    await expect(cancelChange(hr, r.id)).rejects.toThrow(/already rejected/);

    const again = await requestChange(hr, e.id, "BANK", bank("MAYBE LATER"), "Statement provided");
    expect((await cancelChange(hr, again.id)).status).toBe("CANCELLED");
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).accountNumber).toBe(e.accountNumber);
  });
});

describe("self-service", () => {
  it("lets an employee request changes to their own details, and no one else's, and never approve them", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE");
    const me = await worker(t, "Mine", "Own");
    const other = await worker(t, "Theirs", "Other");
    const self: Ctx = t.ctx("EMPLOYEE", me.id);

    const cur = await currentDetails(self, me.id);
    expect(cur.BANK.accountNumber).toBe(me.accountNumber);
    await expect(currentDetails(self, other.id)).rejects.toThrow();

    const r = await requestChange(self, me.id, "BANK", bank("MINE OWN"), "I changed banks");
    expect(r.requestedBy).toBe(self.name);
    await expect(requestChange(self, other.id, "BANK", bank("THEIRS OTHER"), "Not mine")).rejects.toThrow();
    await expect(requestChange(t.ctx("EMPLOYEE"), me.id, "BANK", bank("MINE OWN"), "Unlinked login")).rejects.toThrow();
    await expect(approveChange(self, r.id)).rejects.toThrow();
    expect((await myChanges(self)).map((x) => x.id)).toEqual([r.id]);
    expect((await employeeChanges(self, me.id)).map((x) => x.id)).toEqual([r.id]);
    await expect(employeeChanges(self, other.id)).rejects.toThrow();
    expect(await myChanges(t.ctx("EMPLOYEE"))).toEqual([]);

    // HR (not the requester) approves it; the employee can cancel their own while pending
    const second = await requestChange(self, me.id, "PENSION", { pensionPin: "PEN9", pfa: "ARM" }, "Got my PIN");
    expect((await cancelChange(self, second.id)).status).toBe("CANCELLED");
    await approveChange(fin, r.id, "Verified with the bank letter");
    expect((await db.employee.findUniqueOrThrow({ where: { id: me.id } })).accountName).toBe("MINE OWN");
  });
});

describe("visibility", () => {
  it("is limited to those who see sensitive data, and to the organization", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const e = await worker(a, "Private", "Person");
    const r = await requestChange(a.ctx("HR_ADMIN"), e.id, "BANK", bank("PRIVATE PERSON"), "Moved banks");
    expect((await listChanges(a.ctx("AUDITOR"))).map((x) => x.id)).toEqual([r.id]);
    await expect(listChanges(a.ctx("OPERATIONS"))).rejects.toThrow();
    await expect(listChanges(a.ctx("SUPERVISOR"))).rejects.toThrow();
    expect(await listChanges(b.ctx("HR_ADMIN"))).toEqual([]);
    await expect(approveChange(b.ctx("FINANCE"), r.id)).rejects.toThrow(/not found/);
    await expect(approveChange(a.ctx("AUDITOR"), r.id)).rejects.toThrow();
    await expect(currentDetails(b.ctx("HR_ADMIN"), e.id)).rejects.toThrow(/not found/);
  });
});

describe("recent bank changes (for payroll validation)", () => {
  it("returns approved bank changes inside the watch window, one per change, for the employees asked about", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const fin = t.ctx("FINANCE");
    const recent = await worker(t, "Recent", "Mover");
    const old = await worker(t, "Old", "Mover");
    const quiet = await worker(t, "Quiet", "Staff");
    const r1 = await requestChange(hr, recent.id, "BANK", bank("RECENT MOVER"), "Moved banks");
    await approveChange(fin, r1.id);
    const r2 = await requestChange(hr, old.id, "BANK", bank("OLD MOVER"), "Moved banks");
    await approveChange(fin, r2.id);
    await db.employeeChangeRequest.update({ where: { id: r2.id }, data: { appliedAt: addDays(todayUtc(), -45) } });
    const taxOnly = await requestChange(hr, quiet.id, "TAX", { taxId: "TIN-5" }, "Supplied");
    await approveChange(fin, taxOnly.id);
    await requestChange(hr, quiet.id, "BANK", bank("QUIET STAFF"), "Pending, not yet approved");

    const ids = [recent.id, old.id, quiet.id];
    expect((await recentBankChanges(t.org.id, ids)).map((c) => c.employeeId)).toEqual([recent.id]); // not old (45 days), not tax, not pending
    expect(await recentBankChanges(t.org.id, [old.id, quiet.id])).toEqual([]);
    expect(await recentBankChanges(t.org.id, [])).toEqual([]);

    await updateHrPolicy(hr, { bankChangeWatchDays: 60 });
    expect((await recentBankChanges(t.org.id, ids)).map((c) => c.employeeId).sort()).toEqual([old.id, recent.id].sort());
    await updateHrPolicy(hr, { bankChangeWatchDays: 0 });
    expect(await recentBankChanges(t.org.id, ids)).toEqual([]); // 0 = off
    await expect(updateHrPolicy(hr, { bankChangeWatchDays: 400 })).rejects.toThrow();
  });
});

describe("HR digest", () => {
  it("lists changes waiting for approval", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await db.user.create({ data: { organizationId: t.org.id, email: `hr-${uid()}@chg.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const e = await worker(t, "Waiting", "Approval");
    const r = await requestChange(hr, e.id, "BANK", bank("WAITING APPROVAL"), "Moved banks");
    expect((await pendingChanges(t.org.id)).map((x) => x.id)).toEqual([r.id]);
    const d = await buildHrDigest(t.org.id);
    const items = d.sections.find((s) => s.key === "approvals")!.items.map((i) => i.text);
    expect(items.some((x) => /bank details change — EMP-\d+ Waiting Approval/.test(x))).toBe(true);
    await rejectChange(t.ctx("FINANCE"), r.id, "Not now");
    expect((await buildHrDigest(t.org.id)).sections.find((s) => s.key === "approvals")).toBeUndefined();
  });
});
