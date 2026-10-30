/**
 * The automation engine. A rule says: when a deal enters a stage (or its quote or handover is accepted, or it goes quiet), do one thing, at once or after a delay, if
 * the condition holds. Each carrying-out is a row (a run) with a due time; the database allows one run for each rule, deal and entry, so a rule never fires twice for the
 * same entry. A run looks again when it is due: if the deal has left the stage, has had activity since, or the rule was switched off, it is cancelled. Actions run as
 * "Automation: <rule name>", never as a person, through the same functions people use (so every stage gate, consent rule and audit entry still applies). A failing run is
 * recorded as failed and never stops a deal from moving. Every rule starts switched off. Test mode only reads. Run records and audit entries hold ids and figures, never
 * message text.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { ACTIONS, conditionSchema, describeCondition, evaluateCondition, parseAction, renderTemplate, ruleShapeProblem, type ActionType, type Condition } from "@/lib/sales/automation";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { requireSales } from "./access";
import { assertMayMessage, createTask, MARKETING_REFUSED, resolveTarget, SERVICE_REFUSED, sendEmailTo } from "./activities";
import { moveOpportunity } from "./deals";
import { insertOpportunity } from "./pipelines";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Outcome = { status: "DONE" | "SKIPPED" | "CANCELLED"; note?: string; outputs?: Record<string, unknown> };

/** Automation acts as itself, not as a person. It can see every record of the organization (the rules were made by an administrator). */
export const systemCtx = (orgId: string, ruleName: string): Ctx => ({ userId: "system:automation", orgId, role: "COMPANY_ADMIN", name: `Automation: ${ruleName}`, email: "", employeeId: null });

// ─────────────────────────────── the rules ───────────────────────────────

const STARTERS: Array<{ name: string; trigger: "STAGE_ENTRY" | "QUOTE_ACCEPTED" | "HANDOVER_ACCEPTED" | "NO_ACTIVITY"; stage?: string; delayMinutes?: number; quietDays?: number; condition?: Condition; actionType: ActionType; params: Record<string, unknown> | ((stageIds: Map<string, string>) => Record<string, unknown>) }> = [
  { name: "Qualified: book a site survey", trigger: "STAGE_ENTRY", stage: "Qualified", actionType: "CREATE_TASK", params: { title: "Book site survey", dueInHours: 48, assignee: "OWNER" } },
  { name: "Proposal sent: follow up after 3 days", trigger: "STAGE_ENTRY", stage: "Proposal sent", delayMinutes: 3 * 24 * 60, actionType: "CREATE_TASK", params: { title: "Follow up on proposal", dueInHours: 24, assignee: "OWNER" } },
  // the threshold is a placeholder: it is the organization's own figure to set (see docs/crm/06-phase-6-plan.md)
  { name: "Negotiation: tell the sales managers about a big deal", trigger: "STAGE_ENTRY", stage: "Negotiation", condition: { field: "monthlyContractValue", op: ">", value: "5000000" }, actionType: "NOTIFY", params: { to: "MANAGERS", subject: "A large deal has reached negotiation", message: "{{dealName}} ({{company}}) has reached negotiation. Owner: {{ownerName}}." } },
  { name: "Won: tell Operations", trigger: "STAGE_ENTRY", stage: "Won", actionType: "NOTIFY", params: { to: "OPERATIONS", subject: "A deal was won", message: "{{dealName}} ({{company}}) was won. Its handover to Operations is being prepared by {{ownerName}}." } },
  { name: "Won: owner completes the handover", trigger: "STAGE_ENTRY", stage: "Won", actionType: "CREATE_TASK", params: { title: "Complete the handover to Operations", dueInHours: 24, assignee: "OWNER" } },
  { name: "Lost: re-approach after 90 days", trigger: "STAGE_ENTRY", stage: "Lost", delayMinutes: 90 * 24 * 60, actionType: "CREATE_TASK", params: { title: "Re-approach", dueInHours: 24, assignee: "OWNER" } },
  { name: "Quote accepted: move the deal to Contract signing", trigger: "QUOTE_ACCEPTED", actionType: "MOVE_TO_STAGE", params: (s) => ({ stageId: s.get("Contract signing") }) },
  { name: "Handover accepted: move the deal to Won", trigger: "HANDOVER_ACCEPTED", actionType: "MOVE_TO_STAGE", params: (s) => ({ stageId: s.get("Won") }) },
  { name: "No activity for 14 days: tell the owner", trigger: "NO_ACTIVITY", quietDays: 14, actionType: "NOTIFY", params: { to: "OWNER", subject: "A deal has gone quiet", message: "{{dealName}} ({{company}}) has had no activity for a while. Log a call or a task." } },
];

/** Offers every organization the starting rules for its New business pipeline, all switched off. Safe to call again. */
export async function ensureStarterRules(orgId: string) {
  if (await db.crmAutomationRule.findFirst({ where: { organizationId: orgId, isStarter: true }, select: { id: true } })) return;
  const pipeline = await db.crmPipeline.findFirst({ where: { organizationId: orgId, kind: "NEW_BUSINESS", active: true }, orderBy: { isDefault: "desc" }, include: { stages: { where: { active: true } } } });
  if (!pipeline) return;
  const stageIds = new Map(pipeline.stages.map((s) => [s.name, s.id]));
  const rows = STARTERS.filter((r) => (!r.stage || stageIds.has(r.stage)) && (r.trigger !== "QUOTE_ACCEPTED" || stageIds.has("Contract signing")) && (r.trigger !== "HANDOVER_ACCEPTED" || stageIds.has("Won"))).map((r) => ({
    organizationId: orgId, name: r.name, trigger: r.trigger, pipelineId: pipeline.id, stageId: r.stage ? stageIds.get(r.stage)! : null, delayMinutes: r.delayMinutes ?? 0, quietDays: r.quietDays ?? null,
    condition: (r.condition ?? undefined) as never, actionType: r.actionType, actionParams: (typeof r.params === "function" ? r.params(stageIds) : r.params) as never, enabled: false, isStarter: true, createdBy: "Starter rule",
  }));
  if (rows.length) await db.crmAutomationRule.createMany({ data: rows });
}

export async function listRules(ctx: Ctx) {
  await requireSales(ctx, "sales.configure");
  await ensureStarterRules(ctx.orgId);
  return db.crmAutomationRule.findMany({ where: { organizationId: ctx.orgId }, include: { pipeline: { select: { name: true } }, stage: { select: { name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

export const ruleSchema = z.object({
  name: z.string().trim().min(3, "Give the rule a name").max(120),
  trigger: z.enum(["STAGE_ENTRY", "QUOTE_ACCEPTED", "HANDOVER_ACCEPTED", "NO_ACTIVITY"]),
  pipelineId: z.string().min(1, "Choose the pipeline"),
  stageId: z.string().optional(),
  delayMinutes: z.number().int().optional(),
  quietDays: z.number().int().optional(),
  condition: conditionSchema.optional(),
  actionType: z.enum(ACTIONS),
  actionParams: z.record(z.string(), z.unknown()),
});

async function activeUser(orgId: string, userId: string, perm: "sales.manage" | "sales.view") {
  const u = await db.user.findFirst({ where: { id: userId, organizationId: orgId, active: true }, select: { id: true, role: true } });
  if (!u) throw new BusinessError("That person is not an active user of this organization.");
  if (!can(u.role as never, perm)) throw new BusinessError("That person does not work in sales, so cannot be given this.");
}

/** Makes a rule. It starts switched off: nothing happens until an administrator switches it on. */
export async function createRule(ctx: Ctx, raw: z.input<typeof ruleSchema>) {
  await requireSales(ctx, "sales.configure");
  const p = ruleSchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  const problem = ruleShapeProblem({ trigger: v.trigger, stageId: v.stageId, quietDays: v.quietDays, actionType: v.actionType, delayMinutes: v.delayMinutes ?? 0 });
  if (problem) throw new BusinessError(problem);
  const pipeline = await db.crmPipeline.findFirst({ where: { id: v.pipelineId, organizationId: ctx.orgId, active: true }, select: { id: true } });
  if (!pipeline) throw new BusinessError("Pipeline not found.");
  if (v.stageId && !(await db.crmStage.findFirst({ where: { id: v.stageId, pipelineId: pipeline.id, active: true }, select: { id: true } }))) throw new BusinessError("Stage not found in that pipeline.");
  let params: Record<string, unknown>;
  try {
    params = parseAction(v.actionType, v.actionParams) as Record<string, unknown>;
  } catch (e) {
    throw new BusinessError((e as Error).message);
  }
  if (v.condition) {
    try {
      evaluateCondition(v.condition, { monthlyContractValue: "0", probability: 0, source: null, serviceType: "OTHER" }); // a condition that can never be read is refused now, not at run time
    } catch (e) {
      throw new BusinessError((e as Error).message);
    }
  }
  if (typeof params.userId === "string") await activeUser(ctx.orgId, params.userId, v.actionType === "NOTIFY" ? "sales.view" : "sales.manage");
  if (v.actionType === "MOVE_TO_STAGE" && !(await db.crmStage.findFirst({ where: { id: String(params.stageId), pipelineId: pipeline.id, active: true }, select: { id: true } }))) throw new BusinessError("The stage to move to is not in that pipeline.");
  if (v.actionType === "CREATE_FOLLOW_UP") {
    if (params.pipelineId === pipeline.id) throw new BusinessError("A follow-up deal goes in another pipeline.");
    if (!(await db.crmPipeline.findFirst({ where: { id: String(params.pipelineId), organizationId: ctx.orgId, active: true }, select: { id: true } }))) throw new BusinessError("The follow-up pipeline was not found.");
  }
  const r = await db.crmAutomationRule.create({
    data: { organizationId: ctx.orgId, name: v.name, trigger: v.trigger, pipelineId: pipeline.id, stageId: v.stageId ?? null, delayMinutes: v.delayMinutes ?? 0, quietDays: v.quietDays ?? null, condition: v.condition as never, actionType: v.actionType, actionParams: params as never, enabled: false, createdBy: ctx.name },
  });
  await logAudit(ctx, { action: "SALES_AUTOMATION_RULE_CREATE", entity: "CrmAutomationRule", entityId: r.id, newValue: { trigger: v.trigger, actionType: v.actionType } });
  return r;
}

export async function setRuleEnabled(ctx: Ctx, id: string, enabled: boolean) {
  await requireSales(ctx, "sales.configure");
  const r = await db.crmAutomationRule.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Rule not found.");
  if (r.enabled === enabled) return r;
  const u = await db.crmAutomationRule.update({ where: { id }, data: { enabled, updatedBy: ctx.name } });
  if (!enabled) await db.crmAutomationRun.updateMany({ where: { ruleId: id, status: "PENDING" }, data: { status: "CANCELLED", finishedAt: new Date(), error: "The rule was switched off before this was due." } });
  await logAudit(ctx, { action: enabled ? "SALES_AUTOMATION_RULE_ENABLE" : "SALES_AUTOMATION_RULE_DISABLE", entity: "CrmAutomationRule", entityId: id });
  return u;
}

// ─────────────────────────────── queuing: events and quiet deals ───────────────────────────────

/** Queues the rules for an event (a quote or handover accepted) and carries them out. Never throws: a rule problem must not undo the event. */
export async function fireEvent(orgId: string, event: "QUOTE_ACCEPTED" | "HANDOVER_ACCEPTED", opportunityId: string, entryKey: string, now = new Date()) {
  try {
    const deal = await db.crmOpportunity.findFirst({ where: { id: opportunityId, organizationId: orgId }, select: { id: true, pipelineId: true } });
    if (!deal) return;
    const rules = await db.crmAutomationRule.findMany({ where: { organizationId: orgId, trigger: event, pipelineId: deal.pipelineId, enabled: true }, select: { id: true, delayMinutes: true } });
    if (!rules.length) return;
    await db.crmAutomationRun.createMany({ data: rules.map((r) => ({ organizationId: orgId, ruleId: r.id, opportunityId, entryKey, runAt: new Date(now.getTime() + r.delayMinutes * MINUTE) })), skipDuplicates: true });
    await processDueRuns(now, { orgId, opportunityId });
  } catch (e) {
    logger.error("sales_automation_event_failed", { event, error: e });
  }
}

/** Carries out what is due for a deal that has just moved or been made. Never throws. */
export async function kickAutomation(orgId: string, opportunityId: string) {
  try {
    await processDueRuns(new Date(), { orgId, opportunityId });
  } catch (e) {
    logger.error("sales_automation_kick_failed", { error: e });
  }
}

/** Queues the no-activity rules for deals that have gone quiet: once for each quiet spell (it can fire again after the next activity). */
export async function scanQuietDeals(now = new Date(), opts: { orgId?: string } = {}) {
  const rules = await db.crmAutomationRule.findMany({ where: { trigger: "NO_ACTIVITY", enabled: true, ...(opts.orgId ? { organizationId: opts.orgId } : {}) } });
  let queued = 0;
  for (const r of rules) {
    const deals = await db.crmOpportunity.findMany({
      where: { organizationId: r.organizationId, pipelineId: r.pipelineId, status: "ACTIVE", stage: { stageType: "OPEN" }, lastActivityAt: { lt: new Date(now.getTime() - (r.quietDays ?? 0) * DAY) } },
      select: { id: true, lastActivityAt: true },
      take: 500,
    });
    if (!deals.length) continue;
    const res = await db.crmAutomationRun.createMany({ data: deals.map((d) => ({ organizationId: r.organizationId, ruleId: r.id, opportunityId: d.id, entryKey: d.lastActivityAt.toISOString(), runAt: now })), skipDuplicates: true });
    queued += res.count;
  }
  return { queued };
}

// ─────────────────────────────── carrying out what is due ───────────────────────────────

type Rule = Awaited<ReturnType<typeof db.crmAutomationRule.findFirstOrThrow>>;
type Deal = NonNullable<Awaited<ReturnType<typeof loadDeal>>>;

function loadDeal(orgId: string, id: string) {
  return db.crmOpportunity.findFirst({ where: { id, organizationId: orgId }, include: { stage: { select: { name: true, stageType: true } }, account: { select: { name: true } }, primaryContact: { select: { firstName: true } } } });
}
const varsOf = (d: Deal) => ({ contactFirstName: d.primaryContact?.firstName ?? "", dealName: d.name, company: d.account.name, ownerName: d.ownerName });
const factsOf = (d: Deal) => ({ monthlyContractValue: d.monthlyContractValue, probability: d.probability, source: d.source, serviceType: d.serviceType });

async function recipients(orgId: string, to: "OWNER" | "MANAGERS" | "OPERATIONS" | "USER", deal: Deal, userId?: string) {
  if (to === "OWNER") return db.user.findMany({ where: { organizationId: orgId, id: deal.ownerUserId, active: true }, select: { id: true, name: true, email: true } });
  if (to === "USER") return db.user.findMany({ where: { organizationId: orgId, id: userId, active: true }, select: { id: true, name: true, email: true } });
  const users = await db.user.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, name: true, email: true, role: true } });
  return users.filter((u) => (to === "OPERATIONS" ? u.role === "OPERATIONS" : can(u.role as never, "sales.manage") && can(u.role as never, "sales.view.all")));
}

async function perform(rule: Rule, deal: Deal, now: Date): Promise<Outcome> {
  const orgId = rule.organizationId;
  const sys = systemCtx(orgId, rule.name);
  const vars = varsOf(deal);
  const type = rule.actionType as ActionType;
  if (type === "CREATE_TASK") {
    const p = parseAction("CREATE_TASK", rule.actionParams);
    const t = await createTask(sys, { title: renderTemplate(p.title, vars), notes: p.notes ? renderTemplate(p.notes, vars) : undefined, dueAt: new Date(now.getTime() + p.dueInHours * HOUR).toISOString(), ownerUserId: p.assignee === "OWNER" ? deal.ownerUserId : p.userId, opportunityId: deal.id });
    return { status: "DONE", outputs: { taskId: t.id, ownerUserId: t.ownerUserId } };
  }
  if (type === "NOTIFY") {
    const p = parseAction("NOTIFY", rule.actionParams);
    const people = await recipients(orgId, p.to, deal, p.userId);
    if (!people.length) return { status: "SKIPPED", note: "There is no one to tell." };
    const title = renderTemplate(p.subject, vars);
    const body = renderTemplate(p.message, vars);
    await db.crmNotification.createMany({ data: people.map((u) => ({ organizationId: orgId, userId: u.id, title, body, href: `/sales/opportunities/${deal.id}` })) });
    let emailed = 0;
    for (const u of people) {
      try {
        await sendEmail({ to: u.email, subject: title, text: body, html: `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` });
        emailed++;
      } catch (e) {
        logger.error("sales_automation_notify_email_failed", { error: e });
      }
    }
    return { status: "DONE", outputs: { notified: people.length, emailed } };
  }
  if (type === "SEND_EMAIL") {
    const p = parseAction("SEND_EMAIL", rule.actionParams);
    if (!deal.primaryContactId) return { status: "SKIPPED", note: "The deal has no primary contact to write to." };
    try {
      const a = await sendEmailTo(sys, { opportunityId: deal.id, subject: renderTemplate(p.subject, vars), body: renderTemplate(p.body, vars), purpose: p.purpose });
      return { status: "DONE", outputs: { activityId: a.id, purpose: p.purpose } };
    } catch (e) {
      // not allowed to write to this person (no consent, not a client, no address): nothing was sent, and that is the rule working
      if (e instanceof BusinessError && (e.message === MARKETING_REFUSED || e.message === SERVICE_REFUSED || /no email address/i.test(e.message))) return { status: "SKIPPED", note: e.message };
      throw e;
    }
  }
  if (type === "CHANGE_OWNER") {
    const p = parseAction("CHANGE_OWNER", rule.actionParams);
    if (p.userId === deal.ownerUserId) return { status: "SKIPPED", note: "That person already owns the deal." };
    await activeUser(orgId, p.userId, "sales.manage");
    const u = await db.user.findFirstOrThrow({ where: { id: p.userId, organizationId: orgId }, select: { name: true } });
    await db.crmOpportunity.update({ where: { id: deal.id }, data: { ownerUserId: p.userId, ownerName: u.name } });
    await logAudit(sys, { action: "SALES_OPPORTUNITY_OWNER_CHANGE", entity: "CrmOpportunity", entityId: deal.id, oldValue: { ownerUserId: deal.ownerUserId }, newValue: { ownerUserId: p.userId } });
    return { status: "DONE", outputs: { ownerUserId: p.userId } };
  }
  if (type === "SET_FIELD") {
    const p = parseAction("SET_FIELD", rule.actionParams);
    if (p.field === "probability" && deal.stage.stageType !== "OPEN") return { status: "SKIPPED", note: "The deal is closed, so its probability is fixed." };
    await db.crmOpportunity.update({ where: { id: deal.id }, data: p.field === "probability" ? { probability: Number(p.value) } : { [p.field]: renderTemplate(p.value, vars) } });
    await logAudit(sys, { action: "SALES_OPPORTUNITY_UPDATE", entity: "CrmOpportunity", entityId: deal.id, newValue: { fields: [p.field] } });
    return { status: "DONE", outputs: { field: p.field } };
  }
  if (type === "CREATE_FOLLOW_UP") {
    const p = parseAction("CREATE_FOLLOW_UP", rule.actionParams);
    const o = await db.$transaction((tx: Tx) =>
      insertOpportunity(sys, tx, { accountId: deal.accountId, primaryContactId: deal.primaryContactId ?? undefined, name: renderTemplate(p.name, vars), serviceType: deal.serviceType, monthlyContractValue: deal.monthlyContractValue.toString(), pipelineId: p.pipelineId, source: deal.source ?? undefined, ownerUserId: deal.ownerUserId, ownerName: deal.ownerName }),
    );
    return { status: "DONE", outputs: { opportunityId: o.id } };
  }
  // MOVE_TO_STAGE: the same move a person makes, with every stage gate; a gate that is not met makes the run fail with its reason
  const p = parseAction("MOVE_TO_STAGE", rule.actionParams);
  if (deal.stage.stageType !== "OPEN") return { status: "SKIPPED", note: "The deal is closed." };
  if (deal.stageId === p.stageId) return { status: "SKIPPED", note: "The deal is already in that stage." };
  await moveOpportunity(sys, deal.id, { stageId: p.stageId, nextStep: `Moved by automation (${rule.name})` });
  return { status: "DONE", outputs: { stageId: p.stageId } };
}

/** Looks again at the deal and the rule; cancels, skips or acts. */
async function decide(run: { organizationId: string; opportunityId: string; entryKey: string }, rule: Rule, now: Date): Promise<Outcome & { inputs: Record<string, unknown> }> {
  const inputs: Record<string, unknown> = { rule: rule.name, trigger: rule.trigger, action: rule.actionType };
  if (!rule.enabled) return { status: "CANCELLED", note: "The rule was switched off before this was due.", inputs };
  const deal = await loadDeal(run.organizationId, run.opportunityId);
  if (!deal || deal.status !== "ACTIVE") return { status: "CANCELLED", note: "The deal is no longer active.", inputs };
  inputs.stage = deal.stage.name;
  if (rule.trigger === "STAGE_ENTRY") {
    const latest = await db.crmStageHistory.findFirst({ where: { opportunityId: deal.id }, orderBy: [{ changedAt: "desc" }, { id: "desc" }], select: { id: true } });
    if (deal.stageId !== rule.stageId || latest?.id !== run.entryKey) return { status: "CANCELLED", note: "The deal left the stage before this was due.", inputs };
  }
  if (rule.trigger === "NO_ACTIVITY" && (deal.lastActivityAt.toISOString() !== run.entryKey || deal.stage.stageType !== "OPEN")) return { status: "CANCELLED", note: "There has been activity on the deal since.", inputs };
  if (rule.condition) {
    const res = evaluateCondition(conditionSchema.parse(rule.condition), factsOf(deal));
    inputs.condition = res.detail;
    if (!res.met) return { status: "SKIPPED", note: "The condition was not met.", inputs };
  }
  const out = await perform(rule, deal, now);
  return { ...out, inputs };
}

async function runOne(run: Awaited<ReturnType<typeof db.crmAutomationRun.findFirstOrThrow>> & { rule: Rule }, now: Date) {
  const claimed = await db.crmAutomationRun.updateMany({ where: { id: run.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claimed.count === 0) return null; // another worker has it
  const t0 = Date.now();
  let status: "DONE" | "FAILED" | "CANCELLED" | "SKIPPED" = "FAILED";
  let inputs: Record<string, unknown> | undefined;
  let outputs: Record<string, unknown> | undefined;
  let error: string | null = null;
  try {
    const r = await decide(run, run.rule, now);
    status = r.status;
    inputs = r.inputs;
    outputs = r.outputs;
    error = r.note ?? null;
  } catch (e) {
    status = "FAILED";
    if (e instanceof BusinessError) error = e.message;
    else {
      error = "Something unexpected went wrong. It has been logged.";
      logger.error("sales_automation_run_failed", { runId: run.id, error: e });
    }
  }
  await db.crmAutomationRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), durationMs: Date.now() - t0, inputs: inputs as never, outputs: outputs as never, error } });
  return status;
}

/** Carries out the runs that are due (for one organization or deal, or all). Each is claimed first, so two workers never carry out the same one. */
export async function processDueRuns(now = new Date(), opts: { orgId?: string; opportunityId?: string } = {}) {
  const counts = { done: 0, failed: 0, cancelled: 0, skipped: 0 };
  for (let round = 0; round < 20; round++) {
    const batch = await db.crmAutomationRun.findMany({
      where: { status: "PENDING", runAt: { lte: now }, ...(opts.orgId ? { organizationId: opts.orgId } : {}), ...(opts.opportunityId ? { opportunityId: opts.opportunityId } : {}) },
      orderBy: [{ runAt: "asc" }, { id: "asc" }],
      take: 50,
      include: { rule: true },
    });
    if (!batch.length) break;
    for (const run of batch) {
      const s = await runOne(run, now);
      if (s) counts[s.toLowerCase() as keyof typeof counts]++;
    }
  }
  return counts;
}

/** The scheduled job: queue the quiet-deal rules, then carry out everything that is due, in every organization. */
export async function runAutomationJob(now = new Date()) {
  const quiet = await scanQuietDeals(now);
  const counts = await processDueRuns(now);
  return { ...quiet, ...counts };
}

// ─────────────────────────────── test mode and the log ───────────────────────────────

/** What the rule WOULD do for this deal. It only reads: no run is recorded, nothing is sent, created or changed. */
export async function testRule(ctx: Ctx, ruleId: string, opportunityId: string) {
  await requireSales(ctx, "sales.configure");
  const rule = await db.crmAutomationRule.findFirst({ where: { id: ruleId, organizationId: ctx.orgId }, include: { stage: { select: { name: true } } } });
  if (!rule) throw new BusinessError("Rule not found.");
  const deal = await loadDeal(ctx.orgId, opportunityId);
  if (!deal) throw new BusinessError("Deal not found.");
  const steps: string[] = [];
  let wouldRun = true;
  if (rule.trigger === "STAGE_ENTRY") steps.push(deal.stageId === rule.stageId ? `The deal is in "${rule.stage?.name}" now.` : `The deal is in "${deal.stage.name}"; this rule acts when a deal enters "${rule.stage?.name}".`);
  else if (rule.trigger === "NO_ACTIVITY") {
    const quiet = Math.floor((Date.now() - deal.lastActivityAt.getTime()) / DAY);
    steps.push(`The deal has had no activity for ${quiet} day(s); this rule acts after ${rule.quietDays}.`);
    if (quiet < (rule.quietDays ?? 0)) wouldRun = false;
  } else steps.push(rule.trigger === "QUOTE_ACCEPTED" ? "This rule acts when the deal's quote is accepted." : "This rule acts when the deal's handover is accepted.");
  if (rule.delayMinutes) steps.push(`It waits ${rule.delayMinutes >= 1440 ? `${Math.round(rule.delayMinutes / 1440)} day(s)` : `${rule.delayMinutes} minute(s)`} and looks again before acting.`);
  if (rule.condition) {
    const res = evaluateCondition(conditionSchema.parse(rule.condition), factsOf(deal));
    steps.push(`Condition (${describeCondition(conditionSchema.parse(rule.condition))}): ${res.detail}. ${res.met ? "Met." : "Not met, so nothing would happen."}`);
    if (!res.met) wouldRun = false;
  }
  const vars = varsOf(deal);
  const type = rule.actionType as ActionType;
  if (type === "CREATE_TASK") {
    const p = parseAction("CREATE_TASK", rule.actionParams);
    const owner = p.assignee === "OWNER" ? deal.ownerName : ((await db.user.findFirst({ where: { id: p.userId, organizationId: ctx.orgId }, select: { name: true } }))?.name ?? "someone");
    steps.push(`Would create the task "${renderTemplate(p.title, vars)}" for ${owner}, due in ${p.dueInHours} hour(s).`);
  } else if (type === "NOTIFY") {
    const p = parseAction("NOTIFY", rule.actionParams);
    const people = await recipients(ctx.orgId, p.to, deal, p.userId);
    steps.push(people.length ? `Would tell ${people.map((u) => u.name).join(", ")} in the app and by email: "${renderTemplate(p.subject, vars)}".` : "There is no one to tell, so nothing would happen.");
    if (!people.length) wouldRun = false;
  } else if (type === "SEND_EMAIL") {
    const p = parseAction("SEND_EMAIL", rule.actionParams);
    if (!deal.primaryContactId) {
      steps.push("The deal has no primary contact, so nothing would be sent.");
      wouldRun = false;
    } else {
      try {
        const sys = systemCtx(ctx.orgId, rule.name);
        const r = await resolveTarget(sys, db, { opportunityId: deal.id });
        r.contactId = deal.primaryContactId;
        await assertMayMessage(sys, db, r, p.purpose);
        steps.push(`Would email ${deal.primaryContact?.firstName ?? "the contact"} ("${renderTemplate(p.subject, vars)}") as a ${p.purpose.toLowerCase()} message, and log it.`);
      } catch (e) {
        steps.push(`Would NOT send: ${(e as Error).message}`);
        wouldRun = false;
      }
    }
  } else if (type === "CHANGE_OWNER") {
    const p = parseAction("CHANGE_OWNER", rule.actionParams);
    steps.push(`Would make ${(await db.user.findFirst({ where: { id: p.userId, organizationId: ctx.orgId }, select: { name: true } }))?.name ?? "someone"} the owner.`);
  } else if (type === "SET_FIELD") {
    const p = parseAction("SET_FIELD", rule.actionParams);
    steps.push(`Would set ${p.field} to "${p.value}".`);
  } else if (type === "CREATE_FOLLOW_UP") {
    const p = parseAction("CREATE_FOLLOW_UP", rule.actionParams);
    steps.push(`Would open the deal "${renderTemplate(p.name, vars)}" in ${(await db.crmPipeline.findFirst({ where: { id: p.pipelineId, organizationId: ctx.orgId }, select: { name: true } }))?.name ?? "another pipeline"}.`);
  } else {
    const p = parseAction("MOVE_TO_STAGE", rule.actionParams);
    steps.push(`Would move the deal to "${(await db.crmStage.findFirst({ where: { id: p.stageId, pipeline: { organizationId: ctx.orgId } }, select: { name: true } }))?.name ?? "that stage"}" (the stage's required fields are checked when it runs).`);
  }
  if (!rule.enabled) steps.push("This rule is switched off, so it would not run until it is switched on.");
  return { wouldRun: wouldRun && rule.enabled, steps };
}

export async function listRuns(ctx: Ctx, f: { status?: string; ruleId?: string; take?: number } = {}) {
  await requireSales(ctx, "sales.configure");
  return db.crmAutomationRun.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status as never } : {}), ...(f.ruleId ? { ruleId: f.ruleId } : {}) },
    include: { rule: { select: { name: true, actionType: true } }, opportunity: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: f.take ?? 100,
  });
}

// ─────────────────────────────── in-app notifications ───────────────────────────────

export async function listNotifications(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return db.crmNotification.findMany({ where: { organizationId: ctx.orgId, userId: ctx.userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
}
export async function unreadNotificationCount(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return db.crmNotification.count({ where: { organizationId: ctx.orgId, userId: ctx.userId, readAt: null } });
}
export async function markNotificationsRead(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  await db.crmNotification.updateMany({ where: { organizationId: ctx.orgId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}
