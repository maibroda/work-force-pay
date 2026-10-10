/**
 * Billing rules: how a service, or one contract, is billed.
 *
 * A service type (Security & Guarding, Consulting …) carries the organization's default rule for its contracts; a contract
 * can carry its own rule, which overrides it. A rule sets the direct/indirect split of each charge-out amount and what VAT
 * and withholding tax are charged on, from a date. Invoicing reads the rule in force on the invoice date for each contract
 * and records which one it used.
 *
 *  • A rule is proposed by one person and approved by another (never the proposer). Approving it ends the one it replaces the
 *    day before. An approved rule is never edited or deleted (the database refuses, even by SQL); a change is a new rule
 *    from a later date, which can't start on or before an invoice already issued under it.
 *  • A contract with no rule at all is billed on the built-in default, the treatment in force before rules existed, so
 *    nothing changes for anyone who never sets one.
 *  • Assigning a contract to a service type changes which rule bills it, so it takes the approval permission and is audited.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEFAULT_TREATMENT, ruleOn, ruleProblems, type BillingBase, type RuleRow, type RuleSource, type RuleStatus } from "@/lib/billing-rules";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

const rowOf = (r: { directPct: unknown; indirectPct: unknown; vatBase: string; whtBase: string; effectiveFrom: Date; effectiveTo: Date | null; status: string }): RuleRow => ({
  directPct: num(r.directPct),
  indirectPct: num(r.indirectPct),
  vatBase: r.vatBase as BillingBase,
  whtBase: r.whtBase as BillingBase,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  status: r.status as RuleStatus,
});

// ───────────────────────────── Service types ─────────────────────────────

export const serviceTypeSchema = z.object({
  code: z.string().trim().min(2, "Give the service a short code").max(30).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores"),
  name: z.string().trim().min(3, "Name the service").max(120),
});
export type ServiceTypeInput = z.input<typeof serviceTypeSchema>;

export async function saveServiceType(ctx: Ctx, raw: ServiceTypeInput) {
  assertCan(ctx, "billing.rule.manage");
  const v = serviceTypeSchema.parse(raw);
  if (await db.serviceType.count({ where: { organizationId: ctx.orgId, code: v.code } })) throw new BusinessError(`There is already a service type ${v.code}.`);
  return db.$transaction(async (tx) => {
    const s = await tx.serviceType.create({ data: { organizationId: ctx.orgId, code: v.code, name: v.name, createdBy: ctx.name } });
    await logAudit(ctx, { action: "SERVICE_TYPE_CREATE", entity: "ServiceType", entityId: s.id, newValue: { code: v.code, name: v.name } }, tx);
    return s;
  });
}

export async function setServiceTypeActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "billing.rule.manage");
  return db.$transaction(async (tx) => {
    const s = await tx.serviceType.findFirst({ where: { id, organizationId: ctx.orgId }, include: { _count: { select: { contracts: true } } } });
    if (!s) throw new BusinessError("Service type not found.");
    if (!active && s._count.contracts) throw new BusinessError(`${s._count.contracts} contract(s) are billed under this service type. Move them first.`);
    await tx.serviceType.update({ where: { id }, data: { active } });
    await logAudit(ctx, { action: active ? "SERVICE_TYPE_ACTIVATE" : "SERVICE_TYPE_DEACTIVATE", entity: "ServiceType", entityId: id, newValue: { code: s.code } }, tx);
  });
}

/** Puts a contract under a service type (or none). It changes which rule bills the contract, so it is approver-level and audited. */
export async function assignServiceType(ctx: Ctx, contractId: string, serviceTypeId: string | null, reason: string) {
  assertCan(ctx, "billing.rule.approve");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why the contract is being moved.");
  return db.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({ where: { id: contractId, organizationId: ctx.orgId }, select: { id: true, name: true, serviceTypeId: true } });
    if (!contract) throw new BusinessError("Contract not found.");
    if (serviceTypeId) {
      const s = await tx.serviceType.findFirst({ where: { id: serviceTypeId, organizationId: ctx.orgId } });
      if (!s) throw new BusinessError("Service type not found.");
      if (!s.active) throw new BusinessError("That service type is inactive.");
    }
    await tx.contract.update({ where: { id: contractId }, data: { serviceTypeId } });
    await logAudit(ctx, { action: "CONTRACT_SERVICE_TYPE", entity: "Contract", entityId: contractId, oldValue: { serviceTypeId: contract.serviceTypeId }, newValue: { serviceTypeId }, reason }, tx);
  });
}

/**
 * For an organization that has no service types: a "Security & Guarding" type holding the original treatment (90% direct /
 * 10% indirect, VAT on the indirect charge, withholding on the whole amount) as an approved rule, with every contract
 * under it. Nothing changes in what is billed; it just writes the treatment down where it can be seen and later changed.
 */
export async function installStandardBilling(ctx: Ctx) {
  assertCan(ctx, "billing.rule.approve");
  return db.$transaction(async (tx) => {
    if (await tx.serviceType.count({ where: { organizationId: ctx.orgId } })) throw new BusinessError("This organization already has service types.");
    const s = await tx.serviceType.create({ data: { organizationId: ctx.orgId, code: "SECURITY", name: "Security & Guarding", createdBy: ctx.name } });
    await tx.billingRule.create({
      data: {
        organizationId: ctx.orgId,
        serviceTypeId: s.id,
        directPct: DEFAULT_TREATMENT.directPct,
        indirectPct: DEFAULT_TREATMENT.indirectPct,
        vatBase: DEFAULT_TREATMENT.vatBase,
        whtBase: DEFAULT_TREATMENT.whtBase,
        effectiveFrom: d("2000-01-01"),
        status: "APPROVED",
        reason: "The standard treatment: 90% direct and 10% indirect charge, VAT on the indirect charge, withholding tax on the whole amount.",
        requestedBy: "System (standard setup)",
        requestedByUserId: "system",
        decidedBy: "System (standard setup)",
        decidedByUserId: "system",
        decidedAt: new Date(),
        decisionNote: "Installed with the standard setup.",
      },
    });
    const moved = await tx.contract.updateMany({ where: { organizationId: ctx.orgId, serviceTypeId: null }, data: { serviceTypeId: s.id } });
    await logAudit(ctx, { action: "BILLING_INSTALL_STANDARD", entity: "Organization", entityId: ctx.orgId, newValue: { contracts: moved.count } }, tx);
    return s;
  });
}

// ───────────────────────────── Proposing and deciding rules ─────────────────────────────

export const ruleSchema = z.object({
  directPct: z.coerce.number(),
  indirectPct: z.coerce.number(),
  vatBase: z.string().default("INDIRECT"),
  whtBase: z.string().default("FULL"),
  vatTaxCodeId: z.string().optional().transform((v) => (v ? v : null)),
  whtTaxCodeId: z.string().optional().transform((v) => (v ? v : null)),
  effectiveFrom: z.string().min(10, "Choose the date the rule takes effect"),
  effectiveTo: z.string().optional().transform((v) => (v ? v : null)),
  reason: z.string().trim().default(""),
});
export type RuleInput = z.input<typeof ruleSchema>;

/** The date of the latest invoice not cancelled that was billed under a service type or a contract. */
async function lastInvoiceDate(tx: Tx, orgId: string, scope: { serviceTypeId?: string; contractId?: string }) {
  const line = await tx.clientInvoiceLine.findFirst({
    where: { invoice: { organizationId: orgId, status: { not: "CANCELLED" } }, ...(scope.contractId ? { contractId: scope.contractId } : { contract: { serviceTypeId: scope.serviceTypeId } }) },
    orderBy: { invoice: { invoiceDate: "desc" } },
    select: { invoice: { select: { invoiceDate: true } } },
  });
  return line?.invoice.invoiceDate ?? null;
}

export async function proposeRule(ctx: Ctx, scope: { serviceTypeId?: string; contractId?: string }, raw: RuleInput) {
  assertCan(ctx, "billing.rule.manage");
  if (!!scope.serviceTypeId === !!scope.contractId) throw new BusinessError("A rule is for a service type or for one contract.");
  const v = ruleSchema.parse(raw);
  const from = d(v.effectiveFrom);
  const to = v.effectiveTo ? d(v.effectiveTo) : null;
  return db.$transaction(async (tx) => {
    const where = { organizationId: ctx.orgId, ...(scope.contractId ? { contractId: scope.contractId } : { serviceTypeId: scope.serviceTypeId }) };
    if (scope.contractId) {
      if (!(await tx.contract.count({ where: { id: scope.contractId, organizationId: ctx.orgId } }))) throw new BusinessError("Contract not found.");
    } else if (!(await tx.serviceType.count({ where: { id: scope.serviceTypeId, organizationId: ctx.orgId } }))) throw new BusinessError("Service type not found.");
    for (const [id, type] of [[v.vatTaxCodeId, "VAT"], [v.whtTaxCodeId, "WHT"]] as const)
      if (id && !(await tx.taxCode.count({ where: { id, organizationId: ctx.orgId, type, active: true } }))) throw new BusinessError(`The ${type === "VAT" ? "VAT" : "withholding"} tax code isn't an active ${type} code of this organization.`);
    const existing = await tx.billingRule.findMany({ where });
    const problems = ruleProblems({ directPct: v.directPct, indirectPct: v.indirectPct, vatBase: v.vatBase, whtBase: v.whtBase, effectiveFrom: from, effectiveTo: to, reason: v.reason }, existing.map(rowOf), await lastInvoiceDate(tx, ctx.orgId, scope));
    if (problems.length) throw new BusinessError(problems.slice(0, 2).join(" "));
    if (existing.some((r) => r.status === "PENDING")) throw new BusinessError("A rule for this is already waiting for approval. Decide it first.");
    const rule = await tx.billingRule.create({
      data: {
        organizationId: ctx.orgId,
        serviceTypeId: scope.serviceTypeId ?? null,
        contractId: scope.contractId ?? null,
        directPct: v.directPct,
        indirectPct: v.indirectPct,
        vatBase: v.vatBase as BillingBase,
        whtBase: v.whtBase as BillingBase,
        vatTaxCodeId: v.vatTaxCodeId,
        whtTaxCodeId: v.whtTaxCodeId,
        effectiveFrom: from,
        effectiveTo: to,
        reason: v.reason.trim(),
        requestedBy: ctx.name,
        requestedByUserId: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "BILLING_RULE_PROPOSE", entity: "BillingRule", entityId: rule.id, newValue: { scope, directPct: v.directPct, indirectPct: v.indirectPct, vatBase: v.vatBase, whtBase: v.whtBase, effectiveFrom: v.effectiveFrom }, reason: v.reason }, tx);
    return rule;
  });
}

export async function decideRule(ctx: Ctx, ruleId: string, approve: boolean, note?: string) {
  assertCan(ctx, "billing.rule.approve");
  if (!approve && (!note || note.trim().length < 5)) throw new BusinessError("Say why the rule is being turned down.");
  return db.$transaction(async (tx) => {
    const rule = await tx.billingRule.findFirst({ where: { id: ruleId, organizationId: ctx.orgId } });
    if (!rule) throw new BusinessError("Rule not found.");
    if (rule.status !== "PENDING") throw new BusinessError("This rule has already been decided.");
    if (rule.requestedByUserId === ctx.userId) throw new BusinessError("You proposed this rule, so someone else has to approve it.");
    const now = new Date();
    if (!approve) {
      const u = await tx.billingRule.update({ where: { id: ruleId }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: note!.trim() } });
      await logAudit(ctx, { action: "BILLING_RULE_REJECT", entity: "BillingRule", entityId: ruleId, reason: note }, tx);
      return u;
    }
    // the rule it replaces: a later one can't already be approved, nor an earlier one still running into this one's dates
    const approved = await tx.billingRule.findMany({ where: { organizationId: ctx.orgId, status: "APPROVED", id: { not: rule.id }, ...(rule.contractId ? { contractId: rule.contractId } : { serviceTypeId: rule.serviceTypeId }) } });
    if (approved.some((r) => r.effectiveFrom >= rule.effectiveFrom)) throw new BusinessError("A rule that starts on or after this date is already approved, so this one can't be slotted in before it. Turn it down and propose it again from a later date.");
    if (approved.some((r) => r.effectiveTo && r.effectiveTo >= rule.effectiveFrom)) throw new BusinessError("The rule before this one runs past the day this one starts. Turn this down and propose it from a date after that one ends.");
    const previous = approved.filter((r) => !r.effectiveTo).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    if (previous) await tx.billingRule.update({ where: { id: previous.id }, data: { effectiveTo: addDays(rule.effectiveFrom, -1) } });
    const u = await tx.billingRule.update({ where: { id: ruleId }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "BILLING_RULE_APPROVE", entity: "BillingRule", entityId: ruleId, newValue: { effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10), directPct: num(rule.directPct) } }, tx);
    return u;
  });
}

// ───────────────────────────── Reading the rule for an invoice ─────────────────────────────

export interface ResolvedBilling {
  source: RuleSource;
  ruleId: string | null;
  directPct: number;
  indirectPct: number;
  vatBase: BillingBase;
  whtBase: BillingBase;
  vatTaxCodeId: string | null;
  whtTaxCodeId: string | null;
}

/** The billing treatment of each contract on a date: its own rule, else its service type's, else the built-in default. */
export async function resolveBilling(tx: Tx, orgId: string, contracts: Array<{ id: string; serviceTypeId: string | null }>, date: Date): Promise<Map<string, ResolvedBilling>> {
  const typeIds = [...new Set(contracts.map((c) => c.serviceTypeId).filter((x): x is string => !!x))];
  const rules = await tx.billingRule.findMany({
    where: { organizationId: orgId, status: "APPROVED", OR: [{ contractId: { in: contracts.map((c) => c.id) } }, ...(typeIds.length ? [{ serviceTypeId: { in: typeIds } }] : [])] },
  });
  const out = new Map<string, ResolvedBilling>();
  for (const c of contracts) {
    const own = ruleOn(rules.filter((r) => r.contractId === c.id).map((r) => ({ ...rowOf(r), r })), date);
    const svc = !own && c.serviceTypeId ? ruleOn(rules.filter((r) => r.serviceTypeId === c.serviceTypeId).map((r) => ({ ...rowOf(r), r })), date) : null;
    const hit = own ?? svc;
    out.set(
      c.id,
      hit
        ? { source: own ? "CONTRACT_OVERRIDE" : "SERVICE_RULE", ruleId: hit.r.id, directPct: hit.directPct, indirectPct: hit.indirectPct, vatBase: hit.vatBase, whtBase: hit.whtBase, vatTaxCodeId: hit.r.vatTaxCodeId, whtTaxCodeId: hit.r.whtTaxCodeId }
        : { source: "DEFAULT", ruleId: null, ...DEFAULT_TREATMENT, vatTaxCodeId: null, whtTaxCodeId: null },
    );
  }
  return out;
}

// ───────────────────────────── Reading ─────────────────────────────

export async function billingOverview(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const [types, rules, contracts, codes] = await Promise.all([
    db.serviceType.findMany({ where: { organizationId: ctx.orgId }, include: { _count: { select: { contracts: true } } }, orderBy: { code: "asc" } }),
    db.billingRule.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ effectiveFrom: "desc" }] }),
    db.contract.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, contractNumber: true, name: true, serviceTypeId: true, client: { select: { name: true } } }, orderBy: { contractNumber: "asc" } }),
    db.taxCode.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, code: true, type: true, active: true } }),
  ]);
  const resolved = await resolveBilling(db, ctx.orgId, contracts, today);
  return {
    types: types.map((t) => ({ ...t, rules: rules.filter((r) => r.serviceTypeId === t.id) })),
    contracts: contracts.map((c) => ({ ...c, rules: rules.filter((r) => r.contractId === c.id), now: resolved.get(c.id)! })),
    pending: rules.filter((r) => r.status === "PENDING"),
    codes,
  };
}
