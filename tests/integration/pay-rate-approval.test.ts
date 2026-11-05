import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { can, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { approvePayRate, cancelPayRateProposal, listPayRateProposals, proposePayRate, rejectPayRate } from "@/server/services/pay-rate-proposals";
import { isolatedOrg } from "../helpers";

/**
 * The founder's decisions of 2026-11-05 on entering a gross salary by hand (for staff who do not come through the lead, contract, client route): HR may PROPOSE a monthly gross and a
 * payroll manager must APPROVE it, a second person, before it counts; the amount is the MONTHLY gross; a personal gross still takes precedence over a contract rate (unchanged).
 * Until approval nothing is a pay rate, so the pay run cannot see a proposal.
 */
const person = (orgId: string, role: Role, n = 1, employeeId: string | null = null): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId });
const emp = (categoryId: string, n: string) => ({ firstName: "A", lastName: n, employmentDate: "2026-01-01", categoryId });
const ask = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, monthlyGross: "250000", reason: "Office staff on a personal gross", effectiveFrom: "2026-11-01", ...over });

describe("who may propose and who may approve", () => {
  it("HR and the payroll people may propose; everyone else may not", async () => {
    const t = await isolatedOrg();
    const e = await createEmployee(person(t.org.id, "HR_ADMIN"), emp(t.officeId, "One"));
    await expect(proposePayRate(person(t.org.id, "HR_ADMIN"), ask(e.id))).resolves.toMatchObject({ status: "PENDING" });
    const e2 = await createEmployee(person(t.org.id, "HR_ADMIN"), emp(t.officeId, "Two"));
    await expect(proposePayRate(person(t.org.id, "PAYROLL_ADMIN"), ask(e2.id))).resolves.toMatchObject({ status: "PENDING" });
    for (const r of ["AUDITOR", "SUPERVISOR", "EMPLOYEE", "OPERATIONS"] as Role[]) await expect(proposePayRate(person(t.org.id, r), ask(e.id)), r).rejects.toThrow(/permission/);
  });

  it("only the payroll manager (payrate.approve: the payroll role and the company administrator) may approve; HR who proposed, and others, may not", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const holders = (["SUPER_ADMIN", "COMPANY_ADMIN", "PAYROLL_ADMIN"] as Role[]).filter((r) => can(r, "payrate.approve"));
    expect(holders.sort()).toEqual(["COMPANY_ADMIN", "PAYROLL_ADMIN", "SUPER_ADMIN"]);
    for (const r of ["HR_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE"] as Role[]) expect(can(r, "payrate.approve"), r).toBe(false);
    const e = await createEmployee(hr, emp(t.officeId, "Three"));
    const p = await proposePayRate(hr, ask(e.id));
    await expect(approvePayRate(person(t.org.id, "HR_ADMIN", 2), p.id)).rejects.toThrow(/permission/); // another HR person: no
    await expect(approvePayRate(person(t.org.id, "AUDITOR"), p.id)).rejects.toThrow(/permission/);
    await expect(approvePayRate(person(t.org.id, "PAYROLL_ADMIN"), p.id)).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("a person cannot approve their own proposal, even if they hold the approval permission, nor a rate for themselves", async () => {
    const t = await isolatedOrg();
    const e = await createEmployee(person(t.org.id, "HR_ADMIN"), emp(t.officeId, "Four"));
    const mgr = person(t.org.id, "PAYROLL_ADMIN", 1);
    const p = await proposePayRate(mgr, ask(e.id)); // payroll proposes (it holds the override permission)
    await expect(approvePayRate(mgr, p.id)).rejects.toThrow(/someone else/i);
    // an employee who is also a payroll user cannot approve a rate for their own record
    const own = person(t.org.id, "PAYROLL_ADMIN", 2, e.id);
    await expect(approvePayRate(own, p.id)).rejects.toThrow(/your own/i);
    await expect(approvePayRate(person(t.org.id, "COMPANY_ADMIN", 3), p.id)).resolves.toMatchObject({ status: "APPROVED" });
  });
});

describe("a proposal is not a pay rate", () => {
  it("creates nothing the pay run reads until it is approved; approval then makes the rate, closes the previous one the day before, and records the approver, not a typed name", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, emp(t.officeId, "Five"));
    await db.employeePayRate.create({ data: { organizationId: t.org.id, employeeId: e.id, monthlyGross: "200000", reason: "Starting rate", approvedBy: "Someone", effectiveFrom: new Date("2026-01-01") } });
    const p = await proposePayRate(hr, ask(e.id, { monthlyGross: "250000.50", effectiveFrom: "2026-11-01" }));
    expect(await db.employeePayRate.count({ where: { employeeId: e.id } })).toBe(1); // only the old one
    const approver = person(t.org.id, "PAYROLL_ADMIN");
    const done = await approvePayRate(approver, p.id, "Checked against the offer letter");
    expect(done).toMatchObject({ status: "APPROVED", decidedBy: approver.name, decidedByUserId: approver.userId });
    const rates = await db.employeePayRate.findMany({ where: { employeeId: e.id }, orderBy: { effectiveFrom: "asc" } });
    expect(rates).toHaveLength(2);
    expect(rates[0].effectiveTo?.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(rates[1].monthlyGross.toString()).toBe("250000.5");
    expect(rates[1].approvedBy).toBe(approver.name);
    expect(done.appliedRateId).toBe(rates[1].id);
    await expect(approvePayRate(approver, p.id)).rejects.toThrow(/already approved/i);
  });

  it("stays pending (and the rate is not made) if the approval cannot be applied, for instance a rate already starts on or after that date", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, emp(t.officeId, "Six"));
    await db.employeePayRate.create({ data: { organizationId: t.org.id, employeeId: e.id, monthlyGross: "100000", reason: "x", approvedBy: "y", effectiveFrom: new Date("2026-12-01") } });
    const p = await proposePayRate(hr, ask(e.id, { effectiveFrom: "2026-11-01" }));
    await expect(approvePayRate(person(t.org.id, "PAYROLL_ADMIN"), p.id)).rejects.toThrow(/already starts/i);
    expect((await db.payRateProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING");
    expect(await db.employeePayRate.count({ where: { employeeId: e.id } })).toBe(1);
  });

  it("rejecting needs a reason and makes no rate; the proposer may withdraw their own, others may not; a decided proposal cannot be decided again", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, emp(t.officeId, "Seven"));
    const p = await proposePayRate(hr, ask(e.id));
    const mgr = person(t.org.id, "PAYROLL_ADMIN");
    await expect(rejectPayRate(mgr, p.id, "  ")).rejects.toThrow(/reason/i);
    await expect(rejectPayRate(person(t.org.id, "HR_ADMIN", 2), p.id, "no")).rejects.toThrow(/permission/);
    await rejectPayRate(mgr, p.id, "Amount does not match the offer letter");
    expect(await db.employeePayRate.count({ where: { employeeId: e.id } })).toBe(0);
    await expect(rejectPayRate(mgr, p.id, "again")).rejects.toThrow(/already rejected/i);
    const q = await proposePayRate(hr, ask(e.id));
    await expect(cancelPayRateProposal(person(t.org.id, "HR_ADMIN", 2), q.id)).rejects.toThrow(/your own/i);
    await expect(cancelPayRateProposal(hr, q.id)).resolves.toMatchObject({ status: "CANCELLED" });
  });
});

describe("what a proposal may contain", () => {
  it("is a MONTHLY gross in naira with at most two decimals (kobo), stored exactly; anything else is refused", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, emp(t.officeId, "Eight"));
    for (const bad of ["0", "-5", "abc", "", "1000.555", "1e6", "12,000"]) await expect(proposePayRate(hr, ask(e.id, { monthlyGross: bad })), String(bad)).rejects.toThrow(/monthly gross/i);
    const a = await proposePayRate(hr, ask(e.id, { monthlyGross: 1234.56 })); // a number is accepted and kept exactly
    expect(a.monthlyGross.toString()).toBe("1234.56");
    await cancelPayRateProposal(hr, a.id);
    const b = await proposePayRate(hr, ask(e.id, { monthlyGross: "0.1" }));
    expect(b.monthlyGross.toString()).toBe("0.1");
  });

  it("needs a reason, a valid date, a known active salary structure (or none), a current employee of this company, and only one pending proposal per employee", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, emp(t.officeId, "Nine"));
    await db.salaryStructure.create({ data: { organizationId: t.org.id, code: "OFFICE", name: "Office staff", status: "ACTIVE", effectiveFrom: new Date("2026-01-01") } });
    await db.salaryStructure.create({ data: { organizationId: t.org.id, code: "OLD", name: "Old", status: "DRAFT", effectiveFrom: new Date("2026-01-01") } });
    await expect(proposePayRate(hr, ask(e.id, { reason: "x" }))).rejects.toThrow(/reason/i);
    await expect(proposePayRate(hr, ask(e.id, { effectiveFrom: "soon" }))).rejects.toThrow(/date/i);
    await expect(proposePayRate(hr, ask(e.id, { structureCode: "NOPE" }))).rejects.toThrow(/structure/i);
    await expect(proposePayRate(hr, ask(e.id, { structureCode: "OLD" }))).rejects.toThrow(/structure/i);
    const ok = await proposePayRate(hr, ask(e.id, { structureCode: "OFFICE" }));
    expect(ok.structureCode).toBe("OFFICE");
    await expect(proposePayRate(hr, ask(e.id))).rejects.toThrow(/already a pending/i);
    const other = await isolatedOrg();
    await expect(proposePayRate(person(other.org.id, "HR_ADMIN"), ask(e.id))).rejects.toThrow(/not found/i);
    const gone = await createEmployee(hr, { ...emp(t.officeId, "Ten"), status: "EXITED", exitDate: "2026-06-30" });
    await expect(proposePayRate(hr, ask(gone.id))).rejects.toThrow(/left/i);
  });
});

describe("company isolation and the audit trail", () => {
  it("another company cannot see, approve, reject or withdraw a proposal (it is not found)", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const e = await createEmployee(person(a.org.id, "HR_ADMIN"), emp(a.officeId, "Eleven"));
    const p = await proposePayRate(person(a.org.id, "HR_ADMIN"), ask(e.id));
    const theirs = person(b.org.id, "PAYROLL_ADMIN");
    await expect(approvePayRate(theirs, p.id)).rejects.toThrow(/not found/i);
    await expect(rejectPayRate(theirs, p.id, "no reason")).rejects.toThrow(/not found/i);
    await expect(cancelPayRateProposal(person(b.org.id, "HR_ADMIN"), p.id)).rejects.toThrow(/not found/i);
    expect(await listPayRateProposals(theirs, {})).toEqual([]);
    expect((await listPayRateProposals(person(a.org.id, "PAYROLL_ADMIN"), { status: "PENDING" })).map((x) => x.id)).toEqual([p.id]);
  });

  it("is audited by ids and the names of the fields, not the amount; approval is audited with the rate it made", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, emp(t.officeId, "Twelve"));
    const p = await proposePayRate(hr, ask(e.id, { monthlyGross: "777777" }));
    const done = await approvePayRate(person(t.org.id, "PAYROLL_ADMIN"), p.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: t.org.id, entityId: p.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["PAY_RATE_PROPOSED", "PAY_RATE_APPROVED"]);
    expect(JSON.stringify(rows)).not.toMatch(/777777/);
    expect(rows[0].newValue).toMatchObject({ employeeId: e.id, fields: expect.arrayContaining(["monthlyGross", "effectiveFrom"]) });
    expect(rows[1].newValue).toMatchObject({ appliedRateId: done.appliedRateId });
  });
});

describe("no way round the approval", () => {
  it("no server action sets a pay rate directly any more: the employee's pay-rate form proposes", () => {
    const actions = fs.readFileSync(path.join(process.cwd(), "src", "app", "actions", "workforce.ts"), "utf8");
    expect(actions).not.toMatch(/createPayRateAction/);
    expect(actions).not.toMatch(/emp\.createPayRate\(/);
    expect(fs.readFileSync(path.join(process.cwd(), "src", "app", "actions", "pay-rate-proposals.ts"), "utf8")).toMatch(/payrate\.approve/);
  });
});
