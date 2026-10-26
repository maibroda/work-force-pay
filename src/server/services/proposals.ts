/**
 * Pricing and proposals. The rate card (the bureau's costs, target margin, package prices and add-ons) is set by whoever owns pricing and must be
 * confirmed before any proposal goes out. A proposal attaches to a lead, is priced from the rate card, and shows what delivering it costs and the
 * lowest fee that still earns the target margin. One priced below that cannot be sent without a recorded approval and a reason. Once sent, what it
 * says is frozen (the database holds it); a revised offer is a new proposal that supersedes the old.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { addDays, effectiveStatus, findForbiddenClaims, PACKAGE_NAMES, PROPOSAL_PACKAGES, quote, STARTING_ADDONS, STARTING_CARD, STARTING_PACKAGES, TERMS, type AddOnTerms, type PackageTerms, type ProposalState, type Quote, type RateCard } from "@/lib/pricing";
import { proposalPdf, type ProposalDoc } from "@/lib/proposal-pdf";
import { assertCan, BusinessError, db, toJson } from "./_base";
import { logAudit } from "./audit";
import { crmAvailable, moveLead } from "./crm";
import { nextNumber } from "./numbering";

async function requireBureau(ctx: Ctx, permission: "crm.view" | "crm.manage" | "pricing.manage") {
  assertCan(ctx, permission);
  if (ctx.homeOrgId) throw new BusinessError("Pricing and proposals belong to the bureau's own organization. Go back to the bureau first.");
  if (!(await crmAvailable(ctx))) throw new BusinessError("Pricing and proposals belong to a payroll bureau.");
}

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const today = () => iso(new Date());

// ─────────────────────────────── The rate card ───────────────────────────────

/** Creates the starting (placeholder, unconfirmed) rate card the first time it is needed. */
async function ensureRateCard(ctx: Ctx) {
  const have = await db.pricingSetting.findUnique({ where: { organizationId: ctx.orgId } });
  if (have) return;
  await db.$transaction(async (tx) => {
    await tx.pricingSetting.upsert({ where: { organizationId: ctx.orgId }, update: {}, create: { organizationId: ctx.orgId, ...STARTING_CARD, updatedBy: "Starting values" } });
    for (const p of STARTING_PACKAGES)
      await tx.pricingPackage.upsert({ where: { organizationId_key: { organizationId: ctx.orgId, key: p.key } }, update: {}, create: { organizationId: ctx.orgId, key: p.key, perEmployeeRate: p.perEmployeeRate, monthlyMinimum: p.monthlyMinimum, onboardingFee: p.onboardingFee, baseHours: p.baseHours, minutesPerEmployee: p.minutesPerEmployee, scope: p.scope, responsibilities: p.responsibilities } });
    for (const a of STARTING_ADDONS)
      await tx.pricingAddOn.upsert({ where: { organizationId_code: { organizationId: ctx.orgId, code: a.code } }, update: {}, create: { organizationId: ctx.orgId, code: a.code, name: a.name, description: a.description, monthlyFee: a.monthlyFee, perEmployeeFee: a.perEmployeeFee, onboardingFee: a.onboardingFee, hours: a.hours, minutesPerEmployee: a.minutesPerEmployee } });
  });
}

const cardOf = (s: { hourlyCost: unknown; softwareFixed: unknown; softwarePerEmployee: unknown; overheadPct: unknown; targetMarginPct: unknown; vatRatePct: unknown }): RateCard => ({
  hourlyCost: num(s.hourlyCost), softwareFixed: num(s.softwareFixed), softwarePerEmployee: num(s.softwarePerEmployee), overheadPct: num(s.overheadPct), targetMarginPct: num(s.targetMarginPct), vatRatePct: num(s.vatRatePct),
});
const pkgOf = (p: { key: string; perEmployeeRate: unknown; monthlyMinimum: unknown; onboardingFee: unknown; baseHours: unknown; minutesPerEmployee: unknown; scope: string; responsibilities: string }): PackageTerms => ({
  key: p.key, name: PACKAGE_NAMES[p.key as keyof typeof PACKAGE_NAMES] ?? p.key, perEmployeeRate: num(p.perEmployeeRate), monthlyMinimum: num(p.monthlyMinimum), onboardingFee: num(p.onboardingFee), baseHours: num(p.baseHours), minutesPerEmployee: num(p.minutesPerEmployee), scope: p.scope, responsibilities: p.responsibilities,
});
const addOnOf = (a: { code: string; name: string; description: string | null; monthlyFee: unknown; perEmployeeFee: unknown; onboardingFee: unknown; hours: unknown; minutesPerEmployee: unknown }): AddOnTerms => ({
  code: a.code, name: a.name, description: a.description, monthlyFee: num(a.monthlyFee), perEmployeeFee: num(a.perEmployeeFee), onboardingFee: num(a.onboardingFee), hours: num(a.hours), minutesPerEmployee: num(a.minutesPerEmployee),
});

/**
 * The rate card as the signed-in person may see it. The sales role sees the prices, the wording and the margin target, but not the bureau's own
 * cost figures (what an officer's hour costs, software cost, overhead).
 */
export async function getRateCard(ctx: Ctx) {
  await requireBureau(ctx, "crm.view");
  await ensureRateCard(ctx);
  const [s, packages, addOns] = await Promise.all([
    db.pricingSetting.findUniqueOrThrow({ where: { organizationId: ctx.orgId } }),
    db.pricingPackage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { perEmployeeRate: "asc" } }),
    db.pricingAddOn.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } }),
  ]);
  const costs = can(ctx.role, "pricing.manage");
  const card = cardOf(s);
  return {
    costs,
    setting: { ...(costs ? { hourlyCost: card.hourlyCost, softwareFixed: card.softwareFixed, softwarePerEmployee: card.softwarePerEmployee, overheadPct: card.overheadPct } : {}), targetMarginPct: card.targetMarginPct, vatRatePct: card.vatRatePct, validityDays: s.validityDays },
    confirmed: s.confirmedAt ? { by: s.confirmedBy!, at: s.confirmedAt } : null,
    packages: packages.map((p) => ({ ...pkgOf(p), id: p.id, active: p.active, hours: costs ? { base: num(p.baseHours), perEmployee: num(p.minutesPerEmployee) } : null })),
    addOns: addOns.map((a) => ({ ...addOnOf(a), id: a.id, active: a.active, hasHours: costs })),
  };
}

export const settingSchema = z.object({
  hourlyCost: z.coerce.number().min(0).max(1_000_000),
  softwareFixed: z.coerce.number().min(0).max(100_000_000),
  softwarePerEmployee: z.coerce.number().min(0).max(1_000_000),
  overheadPct: z.coerce.number().min(0).max(300),
  targetMarginPct: z.coerce.number().min(0).max(95),
  vatRatePct: z.coerce.number().min(0).max(50),
  validityDays: z.coerce.number().int().min(1).max(180),
});

export async function saveSetting(ctx: Ctx, raw: z.input<typeof settingSchema>) {
  await requireBureau(ctx, "pricing.manage");
  await ensureRateCard(ctx);
  const v = settingSchema.parse(raw);
  const old = await db.pricingSetting.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
  await db.pricingSetting.update({ where: { organizationId: ctx.orgId }, data: { ...v, updatedBy: ctx.name, confirmedAt: null, confirmedBy: null, confirmedByUserId: null } });
  await logAudit(ctx, { action: "PRICING_SETTING_SAVE", entity: "PricingSetting", entityId: old.id, oldValue: cardOf(old), newValue: v });
}

export const packageSchema = z.object({
  perEmployeeRate: z.coerce.number().min(0).max(10_000_000),
  monthlyMinimum: z.coerce.number().min(0).max(1_000_000_000),
  onboardingFee: z.coerce.number().min(0).max(1_000_000_000),
  baseHours: z.coerce.number().min(0).max(1000),
  minutesPerEmployee: z.coerce.number().min(0).max(600),
  scope: z.string().trim().min(10, "Say what is included"),
  responsibilities: z.string().trim().min(10, "Say what the client must do"),
  active: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(true),
});

function assertNoPromises(label: string, text: string) {
  const found = findForbiddenClaims(text);
  if (found.length) throw new BusinessError(`${label} makes a promise the product doesn't make (${found.join(", ")}). Describe the process and what is included, not a guaranteed result.`);
}

export async function savePackage(ctx: Ctx, key: string, raw: z.input<typeof packageSchema>) {
  await requireBureau(ctx, "pricing.manage");
  await ensureRateCard(ctx);
  if (!(PROPOSAL_PACKAGES as readonly string[]).includes(key)) throw new BusinessError("That package can't be quoted.");
  const v = packageSchema.parse(raw);
  assertNoPromises("The scope", v.scope);
  assertNoPromises("The client's responsibilities", v.responsibilities);
  const old = await db.pricingPackage.findUniqueOrThrow({ where: { organizationId_key: { organizationId: ctx.orgId, key } } });
  await db.$transaction(async (tx) => {
    await tx.pricingPackage.update({ where: { id: old.id }, data: v });
    await tx.pricingSetting.update({ where: { organizationId: ctx.orgId }, data: { confirmedAt: null, confirmedBy: null, confirmedByUserId: null } });
    await logAudit(ctx, { action: "PRICING_PACKAGE_SAVE", entity: "PricingPackage", entityId: old.id, oldValue: { perEmployeeRate: num(old.perEmployeeRate), monthlyMinimum: num(old.monthlyMinimum), onboardingFee: num(old.onboardingFee), active: old.active }, newValue: { key, perEmployeeRate: v.perEmployeeRate, monthlyMinimum: v.monthlyMinimum, onboardingFee: v.onboardingFee, active: v.active } }, tx);
  });
}

export const addOnSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,24}$/, "The code is 2 to 24 letters, digits or underscores"),
  name: z.string().trim().min(3, "Name is required"),
  description: opt,
  monthlyFee: z.coerce.number().min(0).max(1_000_000_000).default(0),
  perEmployeeFee: z.coerce.number().min(0).max(10_000_000).default(0),
  onboardingFee: z.coerce.number().min(0).max(1_000_000_000).default(0),
  hours: z.coerce.number().min(0).max(1000).default(0),
  minutesPerEmployee: z.coerce.number().min(0).max(600).default(0),
  active: z.preprocess((v) => v === true || v === "true" || v === "on" || v === undefined, z.boolean()).default(true),
});

export async function saveAddOn(ctx: Ctx, raw: z.input<typeof addOnSchema>) {
  await requireBureau(ctx, "pricing.manage");
  await ensureRateCard(ctx);
  const v = addOnSchema.parse(raw);
  assertNoPromises("The add-on description", `${v.name} ${v.description ?? ""}`);
  await db.$transaction(async (tx) => {
    const a = await tx.pricingAddOn.upsert({ where: { organizationId_code: { organizationId: ctx.orgId, code: v.code } }, update: v, create: { organizationId: ctx.orgId, ...v } });
    await tx.pricingSetting.update({ where: { organizationId: ctx.orgId }, data: { confirmedAt: null, confirmedBy: null, confirmedByUserId: null } });
    await logAudit(ctx, { action: "PRICING_ADDON_SAVE", entity: "PricingAddOn", entityId: a.id, newValue: { code: v.code, monthlyFee: v.monthlyFee, perEmployeeFee: v.perEmployeeFee, onboardingFee: v.onboardingFee, active: v.active } }, tx);
  });
}

/**
 * Whoever owns pricing says these figures are real. Editing any figure takes the confirmation back, and nothing can be sent while it is not
 * there, so a placeholder price can never reach a prospect.
 */
export async function confirmRateCard(ctx: Ctx, note: string) {
  await requireBureau(ctx, "pricing.manage");
  await ensureRateCard(ctx);
  if (!note || note.trim().length < 10) throw new BusinessError("Say what you checked (at least 10 characters), so the confirmation means something.");
  await db.pricingSetting.update({ where: { organizationId: ctx.orgId }, data: { confirmedAt: new Date(), confirmedBy: ctx.name, confirmedByUserId: ctx.userId } });
  await logAudit(ctx, { action: "PRICING_CONFIRM", entity: "PricingSetting", entityId: ctx.orgId, reason: note.trim() });
}

// ─────────────────────────────── Proposals ───────────────────────────────

export const proposalSchema = z.object({
  packageKey: z.enum(PROPOSAL_PACKAGES),
  headcount: z.coerce.number().int().min(1, "How many employees?").max(1_000_000),
  termMonths: z.coerce.number().refine((n) => (TERMS as readonly number[]).includes(n), "The term is 6 or 12 months"),
  addOnCodes: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.string())).default([]),
  extraHours: z.coerce.number().min(0).max(1000).default(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  discountReason: opt,
});
type ProposalInput = z.output<typeof proposalSchema>;

async function priceIt(orgId: string, v: ProposalInput): Promise<{ q: Quote; card: RateCard }> {
  const [s, p, adds] = await Promise.all([
    db.pricingSetting.findUniqueOrThrow({ where: { organizationId: orgId } }),
    db.pricingPackage.findUnique({ where: { organizationId_key: { organizationId: orgId, key: v.packageKey } } }),
    db.pricingAddOn.findMany({ where: { organizationId: orgId, code: { in: v.addOnCodes } } }),
  ]);
  if (!p || !p.active) throw new BusinessError("That package isn't on offer.");
  const missing = v.addOnCodes.filter((c) => !adds.some((a) => a.code === c && a.active));
  if (missing.length) throw new BusinessError(`Add-on not on offer: ${missing.join(", ")}.`);
  if (v.discountPct > 0 && (v.discountReason ?? "").length < 5) throw new BusinessError("Say why there is a discount (at least 5 characters).");
  const card = cardOf(s);
  return { card, q: quote({ card, pkg: pkgOf(p), addOns: adds.map(addOnOf), headcount: v.headcount, termMonths: v.termMonths, extraHours: v.extraHours, discountPct: v.discountPct }) };
}

const columns = (q: Quote) => ({ monthlyFee: q.monthlyFee, onboardingFee: q.onboardingFee, marginPct: q.marginPct, belowTarget: q.belowTarget, quote: toJson(q) });

export async function createProposal(ctx: Ctx, leadId: string, raw: z.input<typeof proposalSchema>) {
  await requireBureau(ctx, "crm.manage");
  await ensureRateCard(ctx);
  const v = proposalSchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.orgId } });
  if (!lead) throw new BusinessError("Lead not found.");
  if (lead.stage === "LOST") throw new BusinessError("This lead was lost. Reopen it before making a proposal.");
  if (lead.stage === "WON") throw new BusinessError("This lead is already won.");
  const { q } = await priceIt(ctx.orgId, v);
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "PROPOSAL");
    const p = await tx.proposal.create({
      data: { organizationId: ctx.orgId, leadId, number, packageKey: v.packageKey, headcount: v.headcount, termMonths: v.termMonths, extraHours: v.extraHours, discountPct: v.discountPct, discountReason: v.discountPct > 0 ? v.discountReason : null, addOnCodes: v.addOnCodes, ...columns(q), createdBy: ctx.name, createdByUserId: ctx.userId },
    });
    await logAudit(ctx, { action: "PROPOSAL_CREATE", entity: "Proposal", entityId: p.id, newValue: { number, lead: lead.number, package: v.packageKey, monthlyFee: q.monthlyFee, marginPct: q.marginPct, belowTarget: q.belowTarget } }, tx);
    return p;
  });
}

async function load(ctx: Ctx, id: string) {
  const p = await db.proposal.findFirst({ where: { id, organizationId: ctx.orgId }, include: { lead: true } });
  if (!p) throw new BusinessError("Proposal not found.");
  return p;
}

/** Reprices an unsent proposal from the current rate card with new terms. Any earlier approval was for the old price, so it is withdrawn. */
export async function updateProposal(ctx: Ctx, id: string, raw: z.input<typeof proposalSchema>) {
  await requireBureau(ctx, "crm.manage");
  const p = await load(ctx, id);
  if (p.status !== "DRAFT" && p.status !== "APPROVED") throw new BusinessError("A sent proposal can't be changed. Revise it to make a new one.");
  // the sales role's form has no field for extra delivery hours (a cost figure), so a missing value keeps what is there
  const v = proposalSchema.parse({ ...raw, extraHours: raw.extraHours ?? num(p.extraHours) });
  const { q } = await priceIt(ctx.orgId, v);
  const u = await db.proposal.update({
    where: { id },
    data: { packageKey: v.packageKey, headcount: v.headcount, termMonths: v.termMonths, extraHours: v.extraHours, discountPct: v.discountPct, discountReason: v.discountPct > 0 ? v.discountReason : null, addOnCodes: v.addOnCodes, ...columns(q), status: "DRAFT", approvedAt: null, approvedBy: null, approvedByUserId: null, approvalNote: null },
  });
  await logAudit(ctx, { action: "PROPOSAL_UPDATE", entity: "Proposal", entityId: id, oldValue: { monthlyFee: num(p.monthlyFee), marginPct: num(p.marginPct) }, newValue: { number: p.number, monthlyFee: q.monthlyFee, marginPct: q.marginPct, belowTarget: q.belowTarget } });
  return u;
}

/** The owner of pricing accepts a price below the target margin, in writing. */
export async function approveBelowMargin(ctx: Ctx, id: string, note: string) {
  await requireBureau(ctx, "pricing.manage");
  const p = await load(ctx, id);
  if (p.status !== "DRAFT") throw new BusinessError(p.status === "APPROVED" ? "This price is already approved." : "Only a draft needs approving.");
  if (!p.belowTarget) throw new BusinessError("This price meets the target margin, so it needs no approval.");
  if (!note || note.trim().length < 10) throw new BusinessError("Say why this price is acceptable below the target margin (at least 10 characters).");
  await db.proposal.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: ctx.name, approvedByUserId: ctx.userId, approvalNote: note.trim() } });
  await logAudit(ctx, { action: "PROPOSAL_APPROVE_BELOW_MARGIN", entity: "Proposal", entityId: id, newValue: { number: p.number, marginPct: num(p.marginPct) }, reason: note });
}

export async function sendProposal(ctx: Ctx, id: string) {
  await requireBureau(ctx, "crm.manage");
  const p = await load(ctx, id);
  if (p.status === "SENT") throw new BusinessError("This proposal has already been sent.");
  if (p.status !== "DRAFT" && p.status !== "APPROVED") throw new BusinessError(`This proposal is ${p.status.toLowerCase()}.`);
  const s = await db.pricingSetting.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
  if (!s.confirmedAt) throw new BusinessError("The rate card hasn't been confirmed, so its prices are still placeholders. Ask whoever owns pricing to confirm it first.");
  if (p.belowTarget && p.status !== "APPROVED") throw new BusinessError("This price is below the target margin. It needs the pricing owner's approval, with a reason, before it can be sent.");
  // the price must be what the rate card says today
  const input = proposalSchema.parse({ packageKey: p.packageKey, headcount: p.headcount, termMonths: p.termMonths, addOnCodes: p.addOnCodes, extraHours: num(p.extraHours), discountPct: num(p.discountPct), discountReason: p.discountReason ?? undefined });
  const { q } = await priceIt(ctx.orgId, input);
  if (q.monthlyFee !== num(p.monthlyFee) || q.onboardingFee !== num(p.onboardingFee) || q.belowTarget !== p.belowTarget)
    throw new BusinessError("The rate card has changed since this was priced. Save the proposal again to reprice it, then send it.");
  const now = new Date();
  const validUntil = new Date(`${addDays(today(), s.validityDays)}T00:00:00Z`);
  await db.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id }, data: { status: "SENT", sentAt: now, sentBy: ctx.name, validUntil } });
    if (num(p.lead.expectedMrr) === 0) await tx.lead.update({ where: { id: p.leadId }, data: { expectedMrr: p.monthlyFee } });
    await logAudit(ctx, { action: "PROPOSAL_SEND", entity: "Proposal", entityId: id, newValue: { number: p.number, lead: p.lead.number, monthlyFee: num(p.monthlyFee), validUntil: iso(validUntil) } }, tx);
  });
  // sending a proposal is what moves a lead to the proposal stage
  if (p.lead.stage === "QUALIFIED" || p.lead.stage === "DISCOVERY") await moveLead(ctx, p.leadId, { to: "PROPOSAL", note: `Proposal ${p.number} sent` });
}

export async function decideProposal(ctx: Ctx, id: string, decision: "ACCEPTED" | "DECLINED", note?: string) {
  await requireBureau(ctx, "crm.manage");
  const p = await load(ctx, id);
  if (p.status !== "SENT") throw new BusinessError(p.status === "ACCEPTED" || p.status === "DECLINED" ? `This proposal was already ${p.status.toLowerCase()}.` : "Only a sent proposal can be accepted or declined.");
  if (decision === "ACCEPTED" && p.validUntil && iso(p.validUntil) < today()) throw new BusinessError(`This proposal expired on ${iso(p.validUntil)}. Revise it to make a new offer.`);
  if (decision === "DECLINED" && (note ?? "").trim().length < 5) throw new BusinessError("Say why it was declined (at least 5 characters), so the pipeline learns from it.");
  await db.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id }, data: { status: decision, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    // an accepted offer is what the lead is expected to pay
    if (decision === "ACCEPTED" && p.lead.stage !== "WON" && p.lead.stage !== "LOST") await tx.lead.update({ where: { id: p.leadId }, data: { expectedMrr: p.monthlyFee, headcount: p.headcount } });
    await logAudit(ctx, { action: decision === "ACCEPTED" ? "PROPOSAL_ACCEPT" : "PROPOSAL_DECLINE", entity: "Proposal", entityId: id, newValue: { number: p.number, monthlyFee: num(p.monthlyFee) }, reason: note }, tx);
  });
}

/** Makes a new draft from a sent proposal (same terms, priced afresh) and supersedes the old one. */
export async function reviseProposal(ctx: Ctx, id: string) {
  await requireBureau(ctx, "crm.manage");
  const old = await load(ctx, id);
  if (old.status !== "SENT") throw new BusinessError("Only a sent proposal is revised; an unsent one can simply be edited.");
  const fresh = await createProposal(ctx, old.leadId, { packageKey: old.packageKey as never, headcount: old.headcount, termMonths: old.termMonths, addOnCodes: old.addOnCodes, extraHours: num(old.extraHours), discountPct: num(old.discountPct), discountReason: old.discountReason ?? undefined });
  await db.proposal.update({ where: { id }, data: { status: "SUPERSEDED", decidedAt: new Date(), decisionNote: `Replaced by ${fresh.number}` } });
  await logAudit(ctx, { action: "PROPOSAL_REVISE", entity: "Proposal", entityId: id, newValue: { number: old.number, replacedBy: fresh.number } });
  return fresh;
}

export async function withdrawProposal(ctx: Ctx, id: string, reason: string) {
  await requireBureau(ctx, "crm.manage");
  const p = await load(ctx, id);
  if (p.status !== "DRAFT" && p.status !== "APPROVED") throw new BusinessError("Only an unsent proposal is withdrawn. A sent one is declined or revised.");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why it is being withdrawn (at least 5 characters).");
  await db.proposal.update({ where: { id }, data: { status: "WITHDRAWN", decisionNote: reason.trim() } });
  await logAudit(ctx, { action: "PROPOSAL_WITHDRAW", entity: "Proposal", entityId: id, newValue: { number: p.number }, reason });
}

export async function listProposals(ctx: Ctx, f: { status?: string; leadId?: string } = {}) {
  await requireBureau(ctx, "crm.view");
  const rows = await db.proposal.findMany({ where: { organizationId: ctx.orgId, ...(f.leadId ? { leadId: f.leadId } : {}) }, include: { lead: { select: { number: true, company: true } } }, orderBy: { createdAt: "desc" }, take: 300 });
  const t = today();
  const withState = rows.map((p) => ({ ...p, state: effectiveStatus({ status: p.status as ProposalState, validUntil: p.validUntil }, t) }));
  return f.status ? withState.filter((p) => p.state === f.status) : withState;
}

export async function getProposal(ctx: Ctx, id: string) {
  await requireBureau(ctx, "crm.view");
  const p = await load(ctx, id);
  const s = await db.pricingSetting.findUniqueOrThrow({ where: { organizationId: ctx.orgId } }).catch(() => null);
  return { ...p, q: p.quote as unknown as Quote, state: effectiveStatus({ status: p.status as ProposalState, validUntil: p.validUntil }, today()), rateCardConfirmed: !!s?.confirmedAt };
}

/** The proposal as a PDF. An unsent one is stamped as a draft. Every download is audited. */
export async function proposalFile(ctx: Ctx, id: string) {
  await requireBureau(ctx, "crm.view");
  const p = await load(ctx, id);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const sent = p.status === "SENT" || p.status === "ACCEPTED" || p.status === "DECLINED" || p.status === "SUPERSEDED";
  const doc: ProposalDoc = {
    bureauName: org.name,
    number: p.number,
    issuedOn: iso(p.sentAt ?? new Date()),
    validUntil: p.validUntil ? iso(p.validUntil) : null,
    preparedFor: { company: p.lead.company, contact: p.lead.contactName, role: p.lead.contactRole },
    quote: p.quote as unknown as Quote,
    draft: !sent,
  };
  const bytes = await proposalPdf(doc);
  await logAudit(ctx, { action: "PROPOSAL_PDF_DOWNLOAD", entity: "Proposal", entityId: id, newValue: { number: p.number, status: p.status } });
  return { bytes, fileName: `${p.number}-${p.lead.company.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf` };
}
