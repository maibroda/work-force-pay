import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { scoreAccount, DEFAULT_WEIGHTS } from "@/lib/sales/health";
import { generateInvoices } from "@/server/services/billing";
import { logActivity } from "@/server/services/sales/activities";
import { createCase, resolveCase, saveSlaPolicy } from "@/server/services/sales/cases";
import { getAccountHealth, getHealthWeights, healthInputs, listHealth, refreshAccountHealth, runHealthJob, saveHealthWeights } from "@/server/services/sales/health";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { createAccount } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { billingWorld } from "../billing-fixture";

const NOW = new Date("2026-08-14T10:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * A client billed 4,000,000 for June 2026 (invoice dated 30 June, due 30 July: 15 days past due on 14 August), with an account of the sales side linked to it,
 * a sales rep who owns the account, an administrator, and a site with a guard on it.
 */
async function world() {
  const w = await billingWorld();
  const t = w.t;
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  const ops = t.ctx("OPERATIONS", null, 1);
  for (const c of [admin, repA, repB, ops]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const charge = await w.addCharge(await w.newRun(2026, 6), 4_000_000);
  await generateInvoices(t.ctx("FINANCE", null, 1), (await db.payrollRun.findFirstOrThrow({ where: { organizationId: t.org.id } })).id, { vatPct: 0, whtPct: 0 });
  await db.clientInvoice.updateMany({ where: { organizationId: t.org.id }, data: { status: "ISSUED" } });
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  await db.crmAccount.update({ where: { id: account.id }, data: { clientId: charge.clientId } });
  const beat = await db.beat.create({ data: { organizationId: t.org.id, clientId: charge.clientId, contractId: charge.contractId, code: "BT1", name: "Main gate" } });
  const emp = await db.employee.findFirstOrThrow({ where: { organizationId: t.org.id } });
  const register = (date: string, attendanceStatus: "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "OFF") => db.workRegister.create({ data: { organizationId: t.org.id, date: d(date), employeeId: emp.id, clientId: charge.clientId, contractId: charge.contractId, beatId: beat.id, categoryId: t.guardId, attendanceStatus, recordedBy: "test" } });
  const inputs = () => healthInputs(t.org.id, { id: account.id, clientId: charge.clientId, createdAt: account.createdAt }, NOW);
  return { ...w, admin, repA, repB, ops, account, charge, beat, register, inputs };
}
type W = Awaited<ReturnType<typeof world>>;
const openCase = (w: W, priority: "NORMAL" | "HIGH" | "CRITICAL" = "NORMAL") => createCase(w.repA, { accountId: w.account.id, category: "SERVICE_QUALITY", priority, subject: "Guard absent" });

describe("the facts about a client account", () => {
  it("counts missed SLA deadlines in the last 90 days only, and open critical and high cases (resolved ones do not count)", async () => {
    const w = await world();
    const a = await openCase(w, "NORMAL");
    const b = await openCase(w, "CRITICAL");
    const c = await openCase(w, "HIGH");
    await db.crmCase.update({ where: { id: a.id }, data: { firstResponseBreachedAt: d("2026-08-01"), resolutionBreachedAt: d("2026-08-05") } }); // two missed deadlines inside 90 days
    await db.crmCase.update({ where: { id: b.id }, data: { firstResponseBreachedAt: d("2026-04-01") } }); // older than 90 days
    expect(await w.inputs()).toMatchObject({ slaBreaches90: 2, openCritical: 1, openHigh: 1 });
    await resolveCase(w.repA, c.id, "Fixed");
    expect(await w.inputs()).toMatchObject({ openCritical: 1, openHigh: 0 });
  });

  it("measures guard absence from the attendance register: leave and days off are planned, so they are not counted", async () => {
    const w = await world();
    expect((await w.inputs()).absencePct).toBeNull(); // no attendance records: no figure
    for (let day = 1; day <= 8; day++) await w.register(`2026-08-0${day}`, "PRESENT");
    await w.register("2026-08-09", "LATE");
    await w.register("2026-08-10", "ABSENT");
    await w.register("2026-08-11", "LEAVE");
    await w.register("2026-08-12", "OFF");
    await w.register("2026-06-01", "ABSENT"); // outside the last 30 days
    expect((await w.inputs()).absencePct).toBe(10); // 1 of 10 expected days
  });

  it("takes the days past due of the oldest unpaid invoice, from the same open-invoice function the receivables screens use: paid and not-yet-due ones do not count", async () => {
    const w = await world();
    expect((await w.inputs()).maxDaysOverdue).toBe(15); // due 30 July, 14 August
    const invoice = await db.clientInvoice.findFirstOrThrow({ where: { organizationId: w.t.org.id } });
    expect(await healthInputs(w.t.org.id, { id: w.account.id, clientId: w.charge.clientId, createdAt: w.account.createdAt }, d("2026-07-01"))).toMatchObject({ maxDaysOverdue: 0 }); // not yet due
    await db.clientInvoice.update({ where: { id: invoice.id }, data: { status: "PAID", amountPaid: invoice.totalAmount } });
    expect((await w.inputs()).maxDaysOverdue).toBe(0);
  });

  it("finds a contract ending within 90 days, and whether a renewal deal has been opened for it and not lost", async () => {
    const w = await world();
    expect((await w.inputs())).toMatchObject({ daysToContractEnd: null, renewalInProgress: false });
    await db.contract.update({ where: { id: w.charge.contractId }, data: { status: "ACTIVE", endDate: d("2026-09-13") } });
    expect(await w.inputs()).toMatchObject({ daysToContractEnd: 30, renewalInProgress: false });
    await db.contract.update({ where: { id: w.charge.contractId }, data: { endDate: d("2026-12-31") } });
    expect((await w.inputs()).daysToContractEnd).toBeNull(); // beyond 90 days
    await db.contract.update({ where: { id: w.charge.contractId }, data: { endDate: d("2026-09-13") } });
    const deal = await createOpportunity(w.repA, { accountId: w.account.id, name: "Renewal" });
    await db.crmRenewalLink.create({ data: { organizationId: w.t.org.id, contractId: w.charge.contractId, opportunityId: deal.id } });
    expect((await w.inputs()).renewalInProgress).toBe(true);
    const lost = await db.crmStage.findFirstOrThrow({ where: { pipeline: { organizationId: w.t.org.id }, stageType: "LOST" } });
    await db.crmOpportunity.update({ where: { id: deal.id }, data: { stageId: lost.id } });
    expect((await w.inputs()).renewalInProgress).toBe(false); // a lost renewal is not in progress
  });

  it("measures days since the last client-facing activity (a note does not count), starting from the account's creation when there is none", async () => {
    const w = await world();
    const fresh = await w.inputs();
    expect(fresh.daysSinceClientContact).toBe(0); // made after "now" in this test: not negative
    await logActivity(w.repA, { kind: "CALL", accountId: w.account.id, callOutcome: "REACHED", occurredAt: "2026-07-10T09:00:00Z" });
    await logActivity(w.repA, { kind: "NOTE", accountId: w.account.id, body: "A private note", occurredAt: "2026-08-12T09:00:00Z" });
    expect((await w.inputs()).daysSinceClientContact).toBe(35); // the call, 10 July to 14 August
  });
});

describe("storing the score", () => {
  it("scores a client account from its facts with the standard weights, and keeps what each measure found", async () => {
    const w = await world();
    for (let day = 1; day <= 9; day++) await w.register(`2026-08-0${day}`, "PRESENT");
    await w.register("2026-08-10", "ABSENT"); // 10% absence
    await logActivity(w.repA, { kind: "CALL", accountId: w.account.id, callOutcome: "REACHED", occurredAt: "2026-07-10T09:00:00Z" });
    const row = (await refreshAccountHealth(w.t.org.id, w.account.id, NOW))!;
    const expected = scoreAccount(await w.inputs(), DEFAULT_WEIGHTS);
    expect(row).toMatchObject({ score: expected.score, band: expected.band });
    expect(expected.components.map((c) => c.subScore)).toEqual([100, 100, 50, 75, 100, 94]);
    expect(expected.score).toBe(84); // (2,000 + 1,500 + 1,000 + 1,500 + 1,000 + 1,410) / 100 = 84.1
    const stored = await getAccountHealth(w.repA, w.account.id);
    expect(stored!.components.map((c) => [c.key, c.weight, c.subScore])).toEqual(expected.components.map((c) => [c.key, c.weight, c.subScore]));
    expect(stored!.components[3].detail).toBe("The oldest unpaid invoice is 15 day(s) past due");
  });

  it("scales the other weights when a feed has no data, and says so", async () => {
    const w = await world(); // no attendance records at all
    const row = (await refreshAccountHealth(w.t.org.id, w.account.id, NOW))!;
    const comp = (row.components as unknown as Array<{ key: string; subScore: number | null; detail: string }>).find((c) => c.key === "GUARD_ABSENCE")!;
    expect(comp.subScore).toBeNull();
    expect(comp.detail).toMatch(/no attendance records/i);
  });

  it("is only for client accounts: a prospect is not scored", async () => {
    const w = await world();
    const prospect = await createAccount(w.repA, { name: "A prospect" });
    expect(await refreshAccountHealth(w.t.org.id, prospect.id, NOW)).toBeNull();
    expect(await getAccountHealth(w.repA, prospect.id)).toBeNull();
  });

  it("records a change of band, and gives an at-risk account's owner one task, however many times it is scored", async () => {
    const w = await world();
    await saveHealthWeights(w.admin, { SLA_BREACHES: 100, OPEN_SEVERE_CASES: 0, GUARD_ABSENCE: 0, INVOICES_OVERDUE: 0, CONTRACT_END: 0, CLIENT_CONTACT: 0 }); // only missed deadlines count
    const first = (await refreshAccountHealth(w.t.org.id, w.account.id, NOW))!;
    expect(first).toMatchObject({ score: 100, band: "HEALTHY", previousBand: null });
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    for (let n = 0; n < 4; n++) {
      const c = await openCase(w);
      await db.crmCase.update({ where: { id: c.id }, data: { firstResponseBreachedAt: d("2026-08-01") } });
    }
    const worse = (await refreshAccountHealth(w.t.org.id, w.account.id, NOW))!;
    expect(worse).toMatchObject({ score: 0, band: "AT_RISK", previousBand: "HEALTHY" });
    expect(worse.bandChangedAt).not.toBeNull();
    await refreshAccountHealth(w.t.org.id, w.account.id, NOW);
    await refreshAccountHealth(w.t.org.id, w.account.id, NOW);
    const tasks = await db.crmTask.findMany({ where: { organizationId: w.t.org.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Account at risk: Lekki Gardens Estate", ownerUserId: w.repA.userId, accountId: w.account.id, status: "OPEN" });
    expect(tasks[0].notes).toMatch(/^Health score \d+ of 100\. Weakest:/); // made the moment it first fell to at risk, which opening a case already noticed
    await db.crmTask.update({ where: { id: tasks[0].id }, data: { status: "DONE" } });
    await refreshAccountHealth(w.t.org.id, w.account.id, NOW);
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(2); // still at risk with nothing open: a fresh reminder
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_ACCOUNT_HEALTH_BAND" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit.map((a) => [a.oldValue, a.newValue]))).not.toContain("Lekki");
    expect(audit[0].newValue).toMatchObject({ band: "AT_RISK", score: 0 });
  });

  it("is refreshed when a case is opened or resolved, without waiting for the night", async () => {
    const w = await world();
    expect(await db.crmAccountHealth.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    await saveSlaPolicy(w.admin, { priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 240, businessHoursOnly: false });
    const c = await openCase(w, "CRITICAL");
    const afterOpen = await db.crmAccountHealth.findUniqueOrThrow({ where: { accountId: w.account.id } });
    expect((afterOpen.components as unknown as Array<{ key: string; subScore: number }>).find((x) => x.key === "OPEN_SEVERE_CASES")!.subScore).toBe(60);
    await resolveCase(w.repA, c.id, "Fixed");
    const afterResolve = await db.crmAccountHealth.findUniqueOrThrow({ where: { accountId: w.account.id } });
    expect((afterResolve.components as unknown as Array<{ key: string; subScore: number }>).find((x) => x.key === "OPEN_SEVERE_CASES")!.subScore).toBe(100);
  });

  it("is what the nightly job does for every client account of an organization that has the module on", async () => {
    const w = await world();
    await createAccount(w.repA, { name: "Prospect only" });
    expect(await runHealthJob(NOW, { orgId: w.t.org.id })).toEqual({ scored: 1, atRisk: 0 });
    await updateSalesSetting(w.admin, { enabled: false });
    expect(await runHealthJob(NOW, { orgId: w.t.org.id })).toEqual({ scored: 0, atRisk: 0 });
  });
});

describe("the weights", () => {
  it("start at the standard ones, are changed only by someone who configures sales, and must be whole numbers adding up to 100", async () => {
    const w = await world();
    expect(await getHealthWeights(w.repA)).toMatchObject({ isDefault: true, weights: DEFAULT_WEIGHTS });
    const mine = { SLA_BREACHES: 30, OPEN_SEVERE_CASES: 10, GUARD_ABSENCE: 20, INVOICES_OVERDUE: 20, CONTRACT_END: 10, CLIENT_CONTACT: 10 };
    await expect(saveHealthWeights(w.repA, mine)).rejects.toThrow(/permission/i);
    await expect(saveHealthWeights(w.admin, { ...mine, CLIENT_CONTACT: 15 })).rejects.toThrow(/add up to 100/i);
    await expect(saveHealthWeights(w.admin, { ...mine, SLA_BREACHES: 30.5, CLIENT_CONTACT: 9.5 })).rejects.toThrow(/whole number/i);
    await saveHealthWeights(w.admin, mine);
    expect(await getHealthWeights(w.repA)).toMatchObject({ isDefault: false, weights: mine });
    const row = (await refreshAccountHealth(w.t.org.id, w.account.id, NOW))!;
    expect((row.components as unknown as Array<{ key: string; weight: number }>).find((c) => c.key === "SLA_BREACHES")!.weight).toBe(30);
    const other = await world();
    expect((await getHealthWeights(other.repA)).isDefault).toBe(true); // another organization is untouched
  });
});

describe("who can see it", () => {
  it("keeps a salesperson to their own accounts, lets Operations and managers see all, lists the weakest first, and keeps organizations apart", async () => {
    const w = await world();
    const other = await world();
    await refreshAccountHealth(w.t.org.id, w.account.id, NOW);
    await expect(getAccountHealth(w.repB, w.account.id)).rejects.toThrow(/account not found/i);
    expect(await listHealth(w.repB)).toEqual([]);
    expect((await getAccountHealth(w.ops, w.account.id))!.score).toBeGreaterThan(0);
    expect((await listHealth(w.admin)).map((r) => r.accountId)).toEqual([w.account.id]);
    await expect(getAccountHealth(other.admin, w.account.id)).rejects.toThrow(/account not found/i);
    expect(await listHealth(other.admin)).toEqual([]);
    await expect(getAccountHealth(w.t.ctx("AUDITOR", null, 1), w.account.id)).rejects.toThrow(/permission/i);
    // weakest first
    const second = await createAccount(w.repA, { name: "Second client" });
    const client2 = await db.client.create({ data: { organizationId: w.t.org.id, code: "C2", name: "Second client" } });
    await db.crmAccount.update({ where: { id: second.id }, data: { clientId: client2.id } });
    await db.crmAccountHealth.create({ data: { organizationId: w.t.org.id, accountId: second.id, score: 12, band: "AT_RISK", components: [], computedAt: NOW } });
    const all = await listHealth(w.admin);
    expect([all[0].accountId, all[0].score]).toEqual([second.id, 12]);
    expect(all[1].score).toBeGreaterThan(12);
    expect((await listHealth(w.admin, { band: "AT_RISK" })).map((r) => r.accountId)).toEqual([second.id]);
  });
});
