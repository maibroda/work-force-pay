import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { logActivity } from "@/server/services/sales/activities";
import { createRule, ensureStarterRules, fireEvent, listNotifications, listRules, listRuns, markNotificationsRead, processDueRuns, runAutomationJob, scanQuietDeals, setRuleEnabled, testRule, unreadNotificationCount } from "@/server/services/sales/automation";
import { scheduleStageEntry } from "@/server/services/sales/automation-schedule";
import { recordConsent } from "@/server/services/sales/consent";
import { moveOpportunity } from "@/server/services/sales/deals";
import { acceptHandover, designateAcceptor, getHandoverForDeal, getHandover, saveHandover, submitHandover } from "@/server/services/sales/handover";
import { createOpportunity, listPipelines } from "@/server/services/sales/pipelines";
import { createQuote, decideQuote, sendQuote, setMinimumMargin } from "@/server/services/sales/quotes";
import { createAccount, createContact } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const mail = vi.mocked(sendEmail);
beforeEach(() => mail.mockClear());

const DAY = 86_400_000;
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  const ops = t.ctx("OPERATIONS", null, 1);
  for (const c of [admin, repA, repB, ops]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const contact = await createContact(repA, { accountId: account.id, firstName: "Funmi", lastName: "Bello", phone: "0803 123 4567", email: "funmi@lekki.test" });
  const deal = await createOpportunity(repA, { accountId: account.id, name: "24/7 guarding, 2 sites", primaryContactId: contact.id });
  const pipeline = (await listPipelines(admin))[0];
  const stage = (n: string) => pipeline.stages.find((s) => s.name === n)!.id;
  return { t, admin, repA, repB, ops, account, contact, deal, pipeline, stage };
}
type W = Awaited<ReturnType<typeof world>>;

const task = (title: string, hours = 48) => ({ actionType: "CREATE_TASK" as const, actionParams: { title, dueInHours: hours, assignee: "OWNER" } });
async function rule(w: W, over: Record<string, unknown>, enable = true) {
  const r = await createRule(w.admin, { name: "Test rule", trigger: "STAGE_ENTRY", pipelineId: w.pipeline.id, stageId: w.stage("Qualified"), ...task("A task"), ...over } as never);
  return enable ? setRuleEnabled(w.admin, r.id, true) : r;
}
const move = (w: W, stage: string, id = w.deal.id) => moveOpportunity(w.repA, id, { stageId: w.stage(stage), nextStep: "Next step is to call" });
const runs = (w: W, where: object = {}) => db.crmAutomationRun.findMany({ where: { organizationId: w.t.org.id, ...where }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const counts = async (w: W) => ({
  tasks: await db.crmTask.count({ where: { organizationId: w.t.org.id } }),
  notes: await db.crmNotification.count({ where: { organizationId: w.t.org.id } }),
  runs: await db.crmAutomationRun.count({ where: { organizationId: w.t.org.id } }),
  acts: await db.crmActivity.count({ where: { organizationId: w.t.org.id } }),
  deals: await db.crmOpportunity.count({ where: { organizationId: w.t.org.id } }),
  audit: await db.auditLog.count({ where: { organizationId: w.t.org.id } }),
  mail: mail.mock.calls.length,
});

describe("the rules an organization starts with", () => {
  it("offers the starting rules, all switched off, once, and only to someone who configures sales", async () => {
    const w = await world();
    await expect(listRules(w.repA)).rejects.toThrow(/permission/i);
    const rules = await listRules(w.admin);
    expect(rules).toHaveLength(9);
    expect(rules.every((r) => !r.enabled && r.isStarter)).toBe(true);
    expect(rules.map((r) => r.name)).toEqual(expect.arrayContaining(["Qualified: book a site survey", "Proposal sent: follow up after 3 days", "Won: tell Operations", "Lost: re-approach after 90 days", "Quote accepted: move the deal to Contract signing"]));
    expect(rules.find((r) => r.name.startsWith("Proposal sent"))!.delayMinutes).toBe(4320);
    expect(rules.find((r) => r.name.startsWith("Lost"))!.delayMinutes).toBe(129600);
    expect(rules.find((r) => r.name.startsWith("Negotiation"))!.condition).toMatchObject({ field: "monthlyContractValue", op: ">" });
    await ensureStarterRules(w.t.org.id);
    expect(await db.crmAutomationRule.count({ where: { organizationId: w.t.org.id } })).toBe(9);
    await move(w, "Qualified"); // everything is off: nothing is queued, nothing happens
    expect(await runs(w)).toHaveLength(0);
  });
});

describe("making a rule", () => {
  it("starts switched off, is audited, and is checked: shape, settings, people, pipelines and conditions", async () => {
    const w = await world();
    const r = await rule(w, {}, false);
    expect(r).toMatchObject({ enabled: false, isStarter: false });
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SALES_AUTOMATION_RULE_CREATE" } })).toBe(1);
    const bad = (over: Record<string, unknown>, re: RegExp) => expect(createRule(w.admin, { name: "Bad rule", trigger: "STAGE_ENTRY", pipelineId: w.pipeline.id, stageId: w.stage("Qualified"), ...task("Task"), ...over } as never)).rejects.toThrow(re);
    await bad({ stageId: undefined }, /needs the stage/i);
    await bad({ actionType: "MOVE_TO_STAGE", actionParams: { stageId: w.stage("Won") } }, /moves a deal|only an event/i);
    await bad({ actionParams: { title: "x", dueInHours: 5, assignee: "OWNER" } }, /too short/i);
    await bad({ actionParams: { title: "Task title", dueInHours: 5, assignee: "USER", userId: "nobody" } }, /not an active user/i);
    await bad({ condition: { field: "monthlyContractValue", op: ">", value: "lots" } }, /amount/i);
    await bad({ condition: { field: "source", op: ">", value: "TENDER" } }, /equal or not equal/i);
    await bad({ pipelineId: "nope" }, /pipeline not found/i);
    await bad({ stageId: "nope" }, /stage not found/i);
    await bad({ trigger: "NO_ACTIVITY", stageId: undefined, quietDays: undefined, actionType: "NOTIFY", actionParams: { to: "OWNER", subject: "Quiet deal", message: "Look at {{dealName}}" } }, /quiet days/i);
    await bad({ actionType: "CREATE_FOLLOW_UP", actionParams: { pipelineId: w.pipeline.id, name: "Follow-up deal" } }, /another pipeline/i);
    await bad({ actionType: "NOTIFY", actionParams: { to: "OWNER", subject: "Hello", message: "Pay is {{salary}}" } }, /salary/);
    const other = await world();
    await expect(createRule(other.admin, { name: "Cross", trigger: "STAGE_ENTRY", pipelineId: w.pipeline.id, stageId: w.stage("Qualified"), ...task("Task") } as never)).rejects.toThrow(/pipeline not found/i);
    await expect(setRuleEnabled(other.admin, r.id, true)).rejects.toThrow(/rule not found/i);
    await expect(createRule(w.repA, { name: "Nope", trigger: "STAGE_ENTRY", pipelineId: w.pipeline.id, stageId: w.stage("Qualified"), ...task("Task") } as never)).rejects.toThrow(/permission/i);
  });
});

describe("a rule when a deal enters its stage", () => {
  it("is queued at the move and carried out: the task is for the owner and due when the rule says; the run records inputs, outputs and how long it took", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Qualified"), ...task("Book site survey", 48) });
    await move(w, "Qualified");
    const queued = await runs(w);
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("PENDING"); // queued by the move itself
    const res = await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect(res).toMatchObject({ done: 1, failed: 0 });
    const t = await db.crmTask.findFirstOrThrow({ where: { organizationId: w.t.org.id } });
    expect(t).toMatchObject({ title: "Book site survey", ownerUserId: w.repA.userId, opportunityId: w.deal.id, status: "OPEN", createdBy: "Automation: Test rule" });
    expect(Math.abs(t.dueAt.getTime() - (Date.now() + 48 * 3_600_000))).toBeLessThan(60_000);
    const [run] = await runs(w);
    expect(run).toMatchObject({ status: "DONE", error: null });
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(run.inputs).toMatchObject({ rule: "Test rule", trigger: "STAGE_ENTRY", action: "CREATE_TASK", stage: "Qualified" });
    expect(run.outputs).toMatchObject({ taskId: t.id, ownerUserId: w.repA.userId });
    expect((await listRuns(w.admin))[0]).toMatchObject({ id: run.id, rule: { name: "Test rule" } });
    await expect(listRuns(w.repA)).rejects.toThrow(/permission/i);
    const other = await world();
    expect(await listRuns(other.admin)).toEqual([]); // another organization sees none of it
  });

  it("also acts when a deal is created into the stage", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Lead in"), ...task("First call") });
    const fresh = await createOpportunity(w.repA, { accountId: w.account.id, name: "Another deal" });
    await processDueRuns(new Date(), { orgId: w.t.org.id, opportunityId: fresh.id });
    expect((await db.crmTask.findMany({ where: { opportunityId: fresh.id } })).map((x) => x.title)).toEqual(["First call"]);
    expect(await db.crmTask.count({ where: { opportunityId: w.deal.id } })).toBe(0); // the deal that existed before the rule was switched on is left alone
  });

  it("waits out its delay, then looks again: it acts when due, and never earlier", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Proposal sent"), delayMinutes: 3 * 24 * 60, ...task("Follow up on proposal") });
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { primaryContactId: w.contact.id } });
    await db.crmQuote.create({ data: { organizationId: w.t.org.id, opportunityId: w.deal.id, number: "SQ-91001", versionNo: 1, status: "SENT", createdBy: "x", createdByUserId: w.repA.userId } });
    await move(w, "Proposal sent");
    const now = Date.now();
    expect(await processDueRuns(new Date(now + 2 * DAY), { orgId: w.t.org.id })).toMatchObject({ done: 0 });
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await processDueRuns(new Date(now + 3 * DAY + 60_000), { orgId: w.t.org.id })).toMatchObject({ done: 1 });
    expect((await db.crmTask.findFirstOrThrow({ where: { organizationId: w.t.org.id } })).title).toBe("Follow up on proposal");
  });

  it("is cancelled when the deal leaves the stage (at once, and again when due if it somehow was not), and when the rule is switched off", async () => {
    const w = await world();
    const r = await rule(w, { stageId: w.stage("Proposal sent"), delayMinutes: 3 * 24 * 60, ...task("Follow up") });
    await db.crmQuote.create({ data: { organizationId: w.t.org.id, opportunityId: w.deal.id, number: "SQ-91002", versionNo: 1, status: "SENT", createdBy: "x", createdByUserId: w.repA.userId } });
    await move(w, "Proposal sent");
    await move(w, "Negotiation"); // leaves the stage
    const [run] = await runs(w);
    expect(run).toMatchObject({ status: "CANCELLED", error: "The deal left the stage before this was due." });
    // forced back to waiting (the engine must still look again when it is due)
    await db.crmAutomationRun.update({ where: { id: run.id }, data: { status: "PENDING", error: null } });
    await processDueRuns(new Date(Date.now() + 4 * DAY), { orgId: w.t.org.id });
    expect((await runs(w))[0]).toMatchObject({ status: "CANCELLED", error: "The deal left the stage before this was due." });
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    // switched off while waiting
    await move(w, "Proposal sent");
    expect((await runs(w)).filter((x) => x.status === "PENDING")).toHaveLength(1);
    await setRuleEnabled(w.admin, r.id, false);
    expect((await runs(w)).filter((x) => x.status === "PENDING")).toHaveLength(0);
    await db.crmAutomationRun.updateMany({ where: { ruleId: r.id, status: "CANCELLED" }, data: { status: "PENDING" } }); // and again, forced
    await processDueRuns(new Date(Date.now() + 4 * DAY), { orgId: w.t.org.id });
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect((await runs(w)).every((x) => x.status === "CANCELLED")).toBe(true);
  });

  it("never fires twice for the same stage entry, but fires again when the deal enters the stage again", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Qualified"), ...task("Book site survey") });
    await move(w, "Qualified");
    const entry = (await db.crmStageHistory.findFirstOrThrow({ where: { opportunityId: w.deal.id, toStageId: w.stage("Qualified") } })).id;
    await db.$transaction((tx) => scheduleStageEntry(tx, w.t.org.id, w.deal.id, w.stage("Qualified"), entry)); // asked again for the same entry
    expect(await runs(w)).toHaveLength(1);
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    await move(w, "Negotiation");
    await move(w, "Qualified"); // a new entry
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect(await runs(w)).toHaveLength(2);
    expect(await db.crmTask.count({ where: { organizationId: w.t.org.id } })).toBe(2);
  });
});

describe("conditions", () => {
  it("act only when the condition holds when the run is due, comparing the value exactly to the kobo", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Negotiation"), condition: { field: "monthlyContractValue", op: ">", value: "5000000" }, actionType: "NOTIFY", actionParams: { to: "OWNER", subject: "Big deal", message: "{{dealName}} is big" } });
    const go = async (value: string) => {
      await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { monthlyContractValue: value } });
      await move(w, "Negotiation");
      await processDueRuns(new Date(), { orgId: w.t.org.id });
      await move(w, "Qualified");
      return (await runs(w)).at(-1)!;
    };
    const equal = await go("5000000.00");
    expect(equal).toMatchObject({ status: "SKIPPED", error: "The condition was not met." });
    expect(equal.inputs).toMatchObject({ condition: "Monthly value ₦5,000,000.00 is not above ₦5,000,000.00" });
    const oneKobo = await go("5000000.01");
    expect(oneKobo.status).toBe("DONE");
    expect((await go("7000000.00")).status).toBe("DONE");
    expect(await db.crmNotification.count({ where: { organizationId: w.t.org.id } })).toBe(2);
  });
});

describe("the actions", () => {
  it("tells people in the app and by email: the owner, the sales managers, or Operations", async () => {
    const w = await world();
    for (const to of ["OWNER", "MANAGERS", "OPERATIONS"]) await rule(w, { name: `Tell ${to}`, stageId: w.stage("Qualified"), actionType: "NOTIFY", actionParams: { to, subject: "{{dealName}} moved", message: "Owner is {{ownerName}}" } });
    await move(w, "Qualified");
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    const who = async (u: { userId: string }) => (await db.crmNotification.findMany({ where: { organizationId: w.t.org.id, userId: u.userId } })).map((n) => n.title);
    expect(await who(w.repA)).toEqual(["24/7 guarding, 2 sites moved"]); // OWNER
    expect(await who(w.admin)).toEqual(["24/7 guarding, 2 sites moved"]); // MANAGERS
    expect(await who(w.ops)).toEqual(["24/7 guarding, 2 sites moved"]); // OPERATIONS
    expect(await who(w.repB)).toEqual([]);
    expect(mail.mock.calls.map((c) => c[0].to).sort()).toEqual([w.admin.email, w.ops.email, w.repA.email].sort());
    expect(await unreadNotificationCount(w.repA)).toBe(1);
    expect((await listNotifications(w.repA))[0]).toMatchObject({ body: `Owner is ${w.repA.name}`, href: `/sales/opportunities/${w.deal.id}` });
    await markNotificationsRead(w.repA);
    expect(await unreadNotificationCount(w.repA)).toBe(0);
    expect(await unreadNotificationCount(w.repB)).toBe(0);
  });

  it("writes to the deal's contact only when allowed: consent blocks marketing (skipped, nothing sent, nothing logged), and service is for clients", async () => {
    const w = await world();
    await rule(w, { name: "Marketing mail", stageId: w.stage("Qualified"), actionType: "SEND_EMAIL", actionParams: { purpose: "MARKETING", subject: "Our patrol service", body: "Hello {{contactFirstName}}, about {{company}}" } });
    await move(w, "Qualified");
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    const blocked = (await runs(w))[0];
    expect(blocked.status).toBe("SKIPPED");
    expect(blocked.error).toMatch(/agreed/i);
    expect(mail).not.toHaveBeenCalled();
    expect(await db.crmActivity.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    await recordConsent(w.repA, { contactId: w.contact.id, purpose: "MARKETING", status: "GRANTED", channel: "WEB_FORM", source: "Enquiry form on the website" });
    await move(w, "Negotiation");
    await move(w, "Qualified"); // enters again
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect((await runs(w)).at(-1)!.status).toBe("DONE");
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0]).toMatchObject({ to: "funmi@lekki.test", subject: "Our patrol service", text: "Hello Funmi, about Lekki Gardens Estate" });
    const act = await db.crmActivity.findFirstOrThrow({ where: { organizationId: w.t.org.id } });
    expect(act).toMatchObject({ kind: "EMAIL", purpose: "MARKETING", createdBy: "Automation: Marketing mail" });
    await recordConsent(w.repA, { contactId: w.contact.id, purpose: "MARKETING", status: "WITHDRAWN", channel: "EMAIL", source: "Replied STOP" });
    await move(w, "Negotiation");
    await move(w, "Qualified");
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect((await runs(w)).at(-1)!.status).toBe("SKIPPED"); // opting out is immediate
    expect(mail).toHaveBeenCalledTimes(1);
  });

  it("skips a service email to someone who is not at a client, and a deal with no primary contact", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Qualified"), actionType: "SEND_EMAIL", actionParams: { purpose: "SERVICE", subject: "Welcome aboard", body: "Hello" } });
    await move(w, "Qualified");
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect((await runs(w))[0]).toMatchObject({ status: "SKIPPED", error: expect.stringMatching(/not at a client/i) });
    const bare = await createOpportunity(w.repA, { accountId: w.account.id, name: "No contact deal" });
    await move(w, "Qualified", bare.id);
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect((await runs(w, { opportunityId: bare.id }))[0]).toMatchObject({ status: "SKIPPED", error: expect.stringMatching(/no primary contact/i) });
    expect(mail).not.toHaveBeenCalled();
  });

  it("changes the owner, sets a field, and opens a follow-up deal in another pipeline", async () => {
    const w = await world();
    const renewal = await db.crmPipeline.create({ data: { organizationId: w.t.org.id, name: "Renewals", kind: "RENEWAL", stages: { create: [{ name: "Review due", sortOrder: 1, stageType: "OPEN", defaultProbability: 60 }] } }, include: { stages: true } });
    await rule(w, { name: "Hand to B", stageId: w.stage("Qualified"), actionType: "CHANGE_OWNER", actionParams: { userId: w.repB.userId } });
    await rule(w, { name: "Set next step", stageId: w.stage("Qualified"), actionType: "SET_FIELD", actionParams: { field: "nextStep", value: "Visit {{company}} on Monday" } });
    await rule(w, { name: "Set probability", stageId: w.stage("Qualified"), actionType: "SET_FIELD", actionParams: { field: "probability", value: "42" } });
    await rule(w, { name: "Follow up", stageId: w.stage("Qualified"), actionType: "CREATE_FOLLOW_UP", actionParams: { pipelineId: renewal.id, name: "Renewal of {{dealName}}" } });
    await move(w, "Qualified");
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    const deal = await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id } });
    expect(deal).toMatchObject({ ownerUserId: w.repB.userId, nextStep: "Visit Lekki Gardens Estate on Monday", probability: 42 });
    const follow = await db.crmOpportunity.findFirstOrThrow({ where: { organizationId: w.t.org.id, pipelineId: renewal.id } });
    expect(follow).toMatchObject({ name: "Renewal of 24/7 guarding, 2 sites", accountId: w.account.id, stageId: renewal.stages[0].id });
    expect((await runs(w)).every((r) => r.status === "DONE")).toBe(true);
  });

  it("shows a failing rule as failed, with the reason, and the deal still moves", async () => {
    const w = await world();
    await rule(w, { stageId: w.stage("Qualified"), actionType: "CHANGE_OWNER", actionParams: { userId: w.repB.userId } });
    await db.user.update({ where: { id: w.repB.userId }, data: { active: false } });
    const moved = await move(w, "Qualified"); // the move is not affected
    expect(moved.stageId).toBe(w.stage("Qualified"));
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    expect((await runs(w))[0]).toMatchObject({ status: "FAILED", error: "That person is not an active user of this organization." });
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id } })).ownerUserId).toBe(w.repA.userId);
  });
});

describe("events that move a deal", () => {
  it("moves a deal into the stage when the event happens, once, with every stage gate; a gate not met is shown as failed, never bypassed", async () => {
    const w = await world();
    await rule(w, { name: "Accepted: sign", trigger: "QUOTE_ACCEPTED", stageId: undefined, actionType: "MOVE_TO_STAGE", actionParams: { stageId: w.stage("Contract signing") } });
    await rule(w, { name: "Handover: won", trigger: "HANDOVER_ACCEPTED", stageId: undefined, actionType: "MOVE_TO_STAGE", actionParams: { stageId: w.stage("Won") } });
    await fireEvent(w.t.org.id, "QUOTE_ACCEPTED", w.deal.id, "quote-1");
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id }, include: { stage: true } })).stage.name).toBe("Contract signing");
    await fireEvent(w.t.org.id, "QUOTE_ACCEPTED", w.deal.id, "quote-1"); // the same event again
    expect(await runs(w, { entryKey: "quote-1" })).toHaveLength(1);
    await fireEvent(w.t.org.id, "HANDOVER_ACCEPTED", w.deal.id, "handover-1"); // the Won stage needs a value, a term and a start date
    const failed = (await runs(w, { entryKey: "handover-1" }))[0];
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/you still need/i);
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id }, include: { stage: true } })).stage.name).toBe("Contract signing");
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { monthlyContractValue: "1440000.00", contractTermMonths: 12, expectedStartDate: d("2027-01-01") } });
    await fireEvent(w.t.org.id, "HANDOVER_ACCEPTED", w.deal.id, "handover-2");
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id }, include: { stage: true } })).stage.stageType).toBe("WON");
    await fireEvent(w.t.org.id, "HANDOVER_ACCEPTED", w.deal.id, "handover-3"); // already closed
    expect((await runs(w, { entryKey: "handover-3" }))[0]).toMatchObject({ status: "SKIPPED", error: "The deal is closed." });
  });

  it("is started by the real quote acceptance and the real handover acceptance, and the deal reaches Won by itself with the handover's start date and term", async () => {
    const w = await world();
    await setMinimumMargin(w.admin, 0);
    const structure = await db.salaryStructure.create({
      data: { organizationId: w.t.org.id, code: "STD", name: "Standard guard", status: "ACTIVE", effectiveFrom: d("2020-01-01"), isDefault: true, components: { create: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: c.percentage, taxable: c.taxable, pensionable: c.pensionable, sortOrder: i })) } },
    });
    await db.pensionRule.create({ data: { organizationId: w.t.org.id, version: "P1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC", "HOUSING", "TRANSPORT"], effectiveFrom: d("2020-01-01") } });
    await db.employerCostRule.create({ data: { organizationId: w.t.org.id, version: "E1", effectiveFrom: d("2020-01-01") } });
    const category = await db.employeeCategory.create({ data: { organizationId: w.t.org.id, code: "GRD", name: "Guard" } });
    await rule(w, { name: "Accepted: sign", trigger: "QUOTE_ACCEPTED", stageId: undefined, actionType: "MOVE_TO_STAGE", actionParams: { stageId: w.stage("Contract signing") } });
    await rule(w, { name: "Handover: won", trigger: "HANDOVER_ACCEPTED", stageId: undefined, actionType: "MOVE_TO_STAGE", actionParams: { stageId: w.stage("Won") } });

    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ siteName: "Lekki Gardens Phase 1", siteAddress: "1 Admiralty Way", postLabel: "Main gate", shiftPattern: "24/7", salaryStructureId: structure.id, headcount: 12, billRatePerHead: "120000.00" }] });
    await sendQuote(w.repA, q.id);
    await decideQuote(w.repA, q.id, "ACCEPTED");
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id }, include: { stage: true } })).stage.name).toBe("Contract signing");

    const h = (await getHandoverForDeal(w.repA, w.deal.id))!;
    const full = await getHandover(w.repA, h.id);
    await saveHandover(w.repA, h.id, {
      scope: "24/7 guarding", clientRequirements: "Licensed guards", startDate: "2027-01-01", termMonths: 12, noSpecialSla: true,
      sites: full.sites.map((s) => ({ id: s.id, address: "1 Admiralty Way", state: "Lagos", lga: "Eti-Osa", contactName: "Mrs Bello", contactPhone: "0803 123 4567", noEquipment: true })),
      posts: full.sites.flatMap((s) => s.posts).map((p) => ({ id: p.id, categoryId: category.id })),
    });
    await designateAcceptor(w.admin, w.ops.userId);
    await submitHandover(w.repA, h.id);
    await acceptHandover(w.ops, h.id, {});
    const deal = await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id }, include: { stage: true } });
    expect(deal.stage).toMatchObject({ name: "Won", stageType: "WON" });
    expect(deal).toMatchObject({ contractTermMonths: 12 });
    expect(deal.expectedStartDate!.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect((await runs(w)).map((r) => r.status)).toEqual(["DONE", "DONE"]);
  });
});

describe("deals that go quiet", () => {
  it("are noticed once for each quiet spell, only when they are quiet enough, and again after new activity", async () => {
    const w = await world();
    await rule(w, { name: "Quiet deal", trigger: "NO_ACTIVITY", stageId: undefined, quietDays: 14, actionType: "NOTIFY", actionParams: { to: "OWNER", subject: "{{dealName}} has gone quiet", message: "Log a call" } });
    const now = new Date();
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: new Date(now.getTime() - 13 * DAY) } });
    expect((await scanQuietDeals(now, { orgId: w.t.org.id })).queued).toBe(0); // 13 days is not enough
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: new Date(now.getTime() - 20 * DAY) } });
    expect((await scanQuietDeals(now, { orgId: w.t.org.id })).queued).toBe(1);
    expect((await scanQuietDeals(now, { orgId: w.t.org.id })).queued).toBe(0); // the same spell
    await processDueRuns(now, { orgId: w.t.org.id });
    expect((await runs(w))[0]).toMatchObject({ status: "DONE" });
    expect((await listNotifications(w.repA))[0].title).toBe("24/7 guarding, 2 sites has gone quiet");
    await logActivity(w.repA, { kind: "NOTE", opportunityId: w.deal.id, body: "Spoke to them" }); // activity: the spell ends
    expect((await scanQuietDeals(now, { orgId: w.t.org.id })).queued).toBe(0);
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: new Date(now.getTime() - 30 * DAY) } }); // quiet again, a new spell
    expect((await scanQuietDeals(now, { orgId: w.t.org.id })).queued).toBe(1);
    // a run for a spell that has ended is cancelled when due
    await logActivity(w.repA, { kind: "NOTE", opportunityId: w.deal.id, body: "Another call" });
    await processDueRuns(now, { orgId: w.t.org.id });
    expect((await runs(w)).at(-1)).toMatchObject({ status: "CANCELLED", error: "There has been activity on the deal since." });
  });

  it("is what the scheduled job does, together with carrying out what is due", async () => {
    const w = await world();
    await rule(w, { name: "Quiet deal", trigger: "NO_ACTIVITY", stageId: undefined, quietDays: 7, actionType: "NOTIFY", actionParams: { to: "OWNER", subject: "Quiet", message: "Log a call" } });
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: new Date(Date.now() - 10 * DAY) } });
    const res = await runAutomationJob();
    expect(res.queued).toBeGreaterThanOrEqual(1);
    expect((await runs(w))[0].status).toBe("DONE");
  });
});

describe("test mode", () => {
  it("shows what a rule would do and writes nothing at all: no run, task, notification, email, activity, deal or audit entry", async () => {
    const w = await world();
    const renewal = await db.crmPipeline.create({ data: { organizationId: w.t.org.id, name: "Renewals", kind: "RENEWAL", stages: { create: [{ name: "Review due", sortOrder: 1, stageType: "OPEN", defaultProbability: 60 }] } } });
    const made = [
      await rule(w, { name: "Rule T1", stageId: w.stage("Qualified"), ...task("Book site survey for {{company}}") }, false),
      await rule(w, { name: "Rule T2", stageId: w.stage("Qualified"), actionType: "NOTIFY", actionParams: { to: "MANAGERS", subject: "{{dealName}} moved", message: "Look" } }),
      await rule(w, { name: "Rule T3", stageId: w.stage("Qualified"), actionType: "SEND_EMAIL", actionParams: { purpose: "MARKETING", subject: "Our service", body: "Hello" } }),
      await rule(w, { name: "Rule T4", stageId: w.stage("Qualified"), actionType: "CHANGE_OWNER", actionParams: { userId: w.repB.userId } }),
      await rule(w, { name: "Rule T5", stageId: w.stage("Qualified"), actionType: "SET_FIELD", actionParams: { field: "nextStep", value: "Visit" } }),
      await rule(w, { name: "Rule T6", stageId: w.stage("Qualified"), actionType: "CREATE_FOLLOW_UP", actionParams: { pipelineId: renewal.id, name: "Renewal of {{dealName}}" } }),
      await rule(w, { name: "Rule T7", trigger: "QUOTE_ACCEPTED", stageId: undefined, actionType: "MOVE_TO_STAGE", actionParams: { stageId: w.stage("Contract signing") } }),
      await rule(w, { name: "Rule T8", stageId: w.stage("Negotiation"), condition: { field: "monthlyContractValue", op: ">", value: "5000000" }, ...task("Big deal") }),
    ];
    const before = await counts(w);
    const out = [];
    for (const r of made) out.push(await testRule(w.admin, r.id, w.deal.id));
    expect(await counts(w)).toEqual(before);
    expect(out[0]).toMatchObject({ wouldRun: false }); // T1 is switched off
    expect(out[0].steps.join(" ")).toMatch(/Would create the task "Book site survey for Lekki Gardens Estate" for .*, due in 48 hour/);
    expect(out[0].steps.join(" ")).toMatch(/switched off/i);
    expect(out[1].steps.join(" ")).toMatch(/Would tell .* in the app and by email/);
    expect(out[2]).toMatchObject({ wouldRun: false }); // no consent
    expect(out[2].steps.join(" ")).toMatch(/Would NOT send: .*agreed/i);
    expect(out[3].steps.join(" ")).toMatch(/Would make .* the owner/);
    expect(out[5].steps.join(" ")).toMatch(/Would open the deal "Renewal of 24\/7 guarding, 2 sites" in Renewals/);
    expect(out[6].steps.join(" ")).toMatch(/Would move the deal to "Contract signing"/);
    expect(out[7]).toMatchObject({ wouldRun: false });
    expect(out[7].steps.join(" ")).toMatch(/Not met, so nothing would happen/);
    await expect(testRule(w.repA, made[0].id, w.deal.id)).rejects.toThrow(/permission/i);
    const other = await world();
    await expect(testRule(other.admin, made[0].id, w.deal.id)).rejects.toThrow(/rule not found/i);
    await expect(testRule(w.admin, made[0].id, other.deal.id)).rejects.toThrow(/deal not found/i);
  });
});

describe("the audit log and the run log", () => {
  it("name the automation and the rule, and hold ids and figures but never the text of a message, task or email", async () => {
    const w = await world();
    await recordConsent(w.repA, { contactId: w.contact.id, purpose: "MARKETING", status: "GRANTED", channel: "WEB_FORM", source: "Enquiry form" });
    await rule(w, { name: "Secret rule", stageId: w.stage("Qualified"), ...task("Secret task title for {{company}}") });
    await rule(w, { name: "Secret mail", stageId: w.stage("Qualified"), actionType: "SEND_EMAIL", actionParams: { purpose: "MARKETING", subject: "Secret subject", body: "Secret body" } });
    await rule(w, { name: "Secret note", stageId: w.stage("Qualified"), actionType: "NOTIFY", actionParams: { to: "OWNER", subject: "Secret alert", message: "Secret alert text" } });
    await move(w, "Qualified");
    await processDueRuns(new Date(), { orgId: w.t.org.id });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, userName: { startsWith: "Automation:" } } });
    expect(rows.map((r) => r.userName)).toEqual(expect.arrayContaining(["Automation: Secret rule", "Automation: Secret mail"]));
    const text = JSON.stringify([rows.map((r) => [r.oldValue, r.newValue, r.reason]), (await runs(w)).map((r) => [r.inputs, r.outputs, r.error])]);
    for (const secret of ["Secret task title", "Secret subject", "Secret body", "Secret alert", "Lekki Gardens Estate", "Funmi", "funmi@lekki.test"]) expect(text).not.toContain(secret);
    expect((await runs(w)).every((r) => r.status === "DONE")).toBe(true);
  });
});
