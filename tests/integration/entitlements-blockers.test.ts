import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { MODULE_KEYS, type ModuleKey } from "@/lib/entitlements/catalogue";
import { changeBlockers } from "@/server/services/subscription-blockers";
import { periodFor } from "@/server/services/periods";
import { changePlan, ensureSubscription, getSubscription, modulesOn, removeModule } from "@/server/services/subscriptions";
import { isolatedOrg } from "../helpers";

/**
 * Step E5a of docs/plans/module-entitlements-e5.md: before a module is removed (or a plan changed so that one ends), look for work in progress in it. Hard blockers refuse the
 * change; soft ones are reported and need an acknowledgement. The lists are the ones proposed in the plan, built on the founder's instruction to continue on those
 * recommendations (2026-11-03): they are for the founder to confirm. Nothing here changes any data of the module being removed.
 */
const platform = (orgId: string): Ctx => ({ userId: `${orgId}-su`, orgId, role: "SUPER_ADMIN", name: "Platform", email: "p@x.test", employeeId: null });

/** A stand-in for the database that records every count it is asked for and answers from a table, so each query's tenancy and status list can be checked without building the rows. */
function fake(answers: Record<string, number> = {}) {
  const calls: Array<{ model: string; where: Record<string, unknown> }> = [];
  const delegate = (model: string) => ({
    count: async (args: { where: Record<string, unknown> }) => {
      calls.push({ model, where: args.where });
      return answers[model] ?? 0;
    },
  });
  const models = ["payrollRun", "paymentBatch", "journalDocument", "accountingPeriod", "purchaseOrder", "purchaseInvoice", "clientInvoice", "crmOpportunity", "crmAutomationRun", "leaveRequest", "onboardingTask", "exitTask"];
  const client = Object.fromEntries(models.map((m) => [m, delegate(m)]));
  return { client: client as never, calls };
}
const where = (calls: ReturnType<typeof fake>["calls"], model: string) => calls.filter((c) => c.model === model).map((c) => c.where);

describe("what is looked for, per module (the lists proposed in the plan)", () => {
  it("Payroll: a pay run not yet locked or paid, and a payment batch still pending, both for this company only", async () => {
    const f = fake();
    await changeBlockers("org1", ["payroll"], f.client);
    expect(where(f.calls, "payrollRun")).toEqual([{ organizationId: "org1", status: { in: ["DRAFT", "CALCULATED", "PENDING_APPROVAL", "APPROVED"] } }]);
    expect(where(f.calls, "paymentBatch")).toEqual([{ organizationId: "org1", status: "PENDING" }]);
  });

  it("Accounting: a manual journal waiting for approval or posting, and a period still being closed", async () => {
    const f = fake();
    await changeBlockers("org1", ["accounting"], f.client);
    expect(where(f.calls, "journalDocument")).toEqual([{ organizationId: "org1", status: { in: ["SUBMITTED", "APPROVED"] } }]);
    expect(where(f.calls, "accountingPeriod")).toEqual([{ organizationId: "org1", status: "SOFT_CLOSED" }]);
  });

  it("Payables and procurement: a purchase order waiting for approval, and a supplier bill that failed its match", async () => {
    const f = fake();
    await changeBlockers("org1", ["payables_procurement"], f.client);
    expect(where(f.calls, "purchaseOrder")).toEqual([{ organizationId: "org1", status: "PENDING_APPROVAL" }]);
    expect(where(f.calls, "purchaseInvoice")).toEqual([{ organizationId: "org1", matchStatus: "EXCEPTION" }]);
  });

  it("Client billing: an invoice waiting for approval is hard; an issued invoice not yet fully paid is soft", async () => {
    const f = fake({ clientInvoice: 2 });
    const r = await changeBlockers("org1", ["client_billing"], f.client);
    expect(where(f.calls, "clientInvoice")).toEqual([{ organizationId: "org1", status: "SUBMITTED" }, { organizationId: "org1", status: { in: ["ISSUED", "PARTIALLY_PAID"] } }]);
    expect(r.hard.map((b) => b.count)).toEqual([2]);
    expect(r.soft.map((b) => b.count)).toEqual([2]);
  });

  it("CRM and HR have no hard blockers, only soft ones: open deals and queued automation; pending leave and open onboarding and exit tasks", async () => {
    const crm = fake({ crmOpportunity: 3, crmAutomationRun: 1 });
    const c = await changeBlockers("org1", ["crm"], crm.client);
    expect(c.hard).toEqual([]);
    expect(c.soft.map((b) => b.message)).toEqual([
      "CRM: 3 deals are still open. They stay readable but can no longer be worked.",
      "CRM: 1 automation step is still queued. It will be cancelled when it falls due.",
    ]);
    expect(where(crm.calls, "crmOpportunity")).toEqual([{ organizationId: "org1", status: "ACTIVE" }]);
    expect(where(crm.calls, "crmAutomationRun")).toEqual([{ organizationId: "org1", status: "PENDING" }]);
    const hr = fake({ leaveRequest: 1, onboardingTask: 2, exitTask: 4 });
    const h = await changeBlockers("org1", ["hr"], hr.client);
    expect(h.hard).toEqual([]);
    expect(h.soft.map((b) => b.count)).toEqual([1, 2, 4]);
    for (const m of ["leaveRequest", "onboardingTask", "exitTask"]) expect(where(hr.calls, m), m).toEqual([{ organizationId: "org1", status: "PENDING" }]);
  });

  it("looks at nothing for a module with no work to strand, and only at the modules being removed", async () => {
    const f = fake({ payrollRun: 9, journalDocument: 9 });
    const r = await changeBlockers("org1", ["analytics", "self_service", "inventory", "contracts_deployment", "time_attendance", "client_portal"], f.client);
    expect(f.calls).toEqual([]);
    expect(r).toEqual({ hard: [], soft: [] });
    const only = fake({ payrollRun: 1 });
    await changeBlockers("org1", ["payroll"], only.client);
    expect(only.calls.every((c) => ["payrollRun", "paymentBatch"].includes(c.model))).toBe(true);
  });
});

describe("what is said", () => {
  it("says in plain words how many, of what, and what to do, with the right plural, and marks hard and soft", async () => {
    const one = await changeBlockers("org1", ["payroll"], fake({ payrollRun: 1, paymentBatch: 1 }).client);
    expect(one.hard.map((b) => b.message)).toEqual([
      "Payroll: 1 pay run is still in progress (not yet locked or paid). Finish or cancel it first.",
      "Payroll: 1 payment batch is still awaiting confirmation. Confirm or cancel it first.",
    ]);
    const many = await changeBlockers("org1", ["payroll"], fake({ payrollRun: 3, paymentBatch: 2 }).client);
    expect(many.hard.map((b) => b.message)).toEqual([
      "Payroll: 3 pay runs are still in progress (not yet locked or paid). Finish or cancel them first.",
      "Payroll: 2 payment batches are still awaiting confirmation. Confirm or cancel them first.",
    ]);
    expect(many.hard.every((b) => b.kind === "HARD" && b.module === "payroll")).toBe(true);
  });

  it("reports nothing when there is nothing in progress", async () => {
    expect(await changeBlockers("org1", [...MODULE_KEYS] as ModuleKey[], fake().client)).toEqual({ hard: [], soft: [] });
  });
});

describe("against the real database", () => {
  it("runs every query without error (so every field and status named above exists) and finds nothing for a new company", async () => {
    const t = await isolatedOrg();
    expect(await changeBlockers(t.org.id, [...MODULE_KEYS] as ModuleKey[])).toEqual({ hard: [], soft: [] });
  });

  it("refuses removing Accounting while a period is still being closed, says why, changes nothing, and allows it once the period is reopened", async () => {
    const t = await isolatedOrg();
    const by = platform(t.org.id);
    await ensureSubscription(db, by, t.org.id, { planKey: "payroll_essentials", addOns: ["accounting"], reason: "test" });
    const period = await periodFor(db, t.org.id, new Date());
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: "SOFT_CLOSED" } });
    await expect(removeModule(by, t.org.id, "accounting", "Cancelled")).rejects.toThrow(/Accounting: 1 accounting period is still being closed/);
    expect(await modulesOn(t.org.id)).toContain("accounting");
    expect((await getSubscription(by, t.org.id))!.events.map((e) => e.kind)).toEqual(["CREATED"]); // a refusal leaves no history
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } });
    await expect(removeModule(by, t.org.id, "accounting", "Cancelled")).resolves.toBeUndefined();
    expect(await modulesOn(t.org.id)).not.toContain("accounting");
  });

  it("asks for an acknowledgement before removing HR with work pending, then removes it, and the pending work is still there afterwards", async () => {
    const t = await isolatedOrg();
    const by = platform(t.org.id);
    await ensureSubscription(db, by, t.org.id, { planKey: "hr_payroll", reason: "test" });
    const emp = await db.employee.create({ data: { organizationId: t.org.id, employeeNumber: "EMP-000001", firstName: "A", lastName: "Test", employmentDate: new Date("2025-01-01T00:00:00Z"), categoryId: t.guardId } });
    const task = await db.onboardingTask.create({ data: { organizationId: t.org.id, employeeId: emp.id, taskName: "Collect documents" } });
    await expect(removeModule(by, t.org.id, "hr", "Cancelled")).rejects.toThrow(/HR management: 1 onboarding task.*acknowledge/is);
    expect(await modulesOn(t.org.id)).toContain("hr");
    await expect(removeModule(by, t.org.id, "hr", "Cancelled", { acknowledgeSoft: true })).resolves.toBeUndefined();
    expect(await modulesOn(t.org.id)).not.toContain("hr");
    expect(await db.onboardingTask.findUnique({ where: { id: task.id } })).toMatchObject({ status: "PENDING", taskName: "Collect documents" }); // never deleted or changed
  });

  it("refuses a change of plan that would end a module with work in progress, and changes nothing", async () => {
    const t = await isolatedOrg();
    const by = platform(t.org.id);
    await ensureSubscription(db, by, t.org.id, { planKey: "payroll_essentials", addOns: ["accounting"], reason: "test" });
    const period = await periodFor(db, t.org.id, new Date());
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: "SOFT_CLOSED" } });
    await expect(changePlan(by, t.org.id, { planKey: "payroll_essentials" })).rejects.toThrow(/Accounting: 1 accounting period/); // the plan has no Accounting, so it would end
    const s = (await getSubscription(by, t.org.id))!;
    expect(s.planKey).toBe("payroll_essentials");
    expect(await modulesOn(t.org.id)).toContain("accounting");
    expect(s.events.map((e) => e.kind)).toEqual(["CREATED"]);
    // moving to a plan that keeps Accounting is not held up by it
    await expect(changePlan(by, t.org.id, { planKey: "payroll_essentials", addOns: ["accounting", "analytics"] })).resolves.toBeUndefined();
  });

  it("is not held up by another company's work in progress", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const by = platform(a.org.id);
    await ensureSubscription(db, by, a.org.id, { planKey: "payroll_essentials", addOns: ["accounting"], reason: "test" });
    await ensureSubscription(db, by, b.org.id, { planKey: "payroll_essentials", addOns: ["accounting"], reason: "test" });
    const period = await periodFor(db, b.org.id, new Date());
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: "SOFT_CLOSED" } });
    await expect(removeModule(by, a.org.id, "accounting", "Cancelled")).resolves.toBeUndefined();
    await expect(removeModule(by, b.org.id, "accounting", "Cancelled")).rejects.toThrow(/still being closed/);
  });
});
