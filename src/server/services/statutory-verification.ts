/**
 * The gate for rule 3: payroll for a production client is stopped while a required statutory rule is unverified.
 *
 * A "production client" is a client of a bureau whose engagement is ACTIVE. For such a client, the PAYE, pension and employer-contribution rules in force on
 * the period's end date must each be exactly what HR and Finance both signed in the bureau's Statutory Rule Library (src/lib/rule-verification.ts says what
 * "exactly" means). The check is made when a payroll is calculated, when a supplementary payroll is created, and when a payroll is submitted, approved and
 * locked, so a rule changed after the calculation cannot slip through. Every block is written to the audit log. There is no override: to unblock a payroll,
 * verify the rule in the library.
 *
 * Clients still onboarding, the bureau's own organization, and organizations that are not bureau clients are not stopped. A client that is onboarding is
 * told plainly on the payroll page which rules are not yet verified.
 */
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { assessRules, REQUIRED_RULE_KINDS, type InForceRule, type ReleaseFact, type RuleKind, type RuleVerdict } from "@/lib/rule-verification";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { fingerprintOf, labelOf, type Master } from "./rule-library";

export type VerificationStep = "calculate" | "supplementary" | "submit" | "approve" | "lock";

const STEP_TEXT: Record<VerificationStep, string> = {
  calculate: "This payroll can't be calculated",
  supplementary: "A supplementary payroll can't be created",
  submit: "This payroll can't be submitted for approval",
  approve: "This payroll can't be approved",
  lock: "This payroll can't be locked",
};

export interface StatutoryVerification {
  /** The organization is a client of a bureau (otherwise there is no library to check against). */
  bureauClient: boolean;
  /** An unverified rule stops payroll for this organization. */
  gated: boolean;
  verdicts: RuleVerdict[];
  unverified: RuleVerdict[];
}

/** The rule in force on the date for each required kind, as the payroll itself selects it. */
async function inForceRules(client: Tx | typeof db, orgId: string, date: Date): Promise<Partial<Record<RuleKind, InForceRule>>> {
  const window = { effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] };
  const [tax, pension, employer] = await Promise.all([
    client.taxRule.findFirst({ where: { organizationId: orgId, active: true, ...window }, include: { bands: true, reliefs: true, exemptions: true }, orderBy: { effectiveFrom: "desc" } }),
    client.pensionRule.findFirst({ where: { organizationId: orgId, ...window }, orderBy: { effectiveFrom: "desc" } }),
    client.employerCostRule.findFirst({ where: { organizationId: orgId, ...window }, orderBy: { effectiveFrom: "desc" } }),
  ]);
  const out: Partial<Record<RuleKind, InForceRule>> = {};
  const add = (m: Master) => (out[m.kind] = { kind: m.kind, label: labelOf(m), version: m.row.version, fingerprint: fingerprintOf(m) });
  if (tax) add({ kind: "TAX", row: tax });
  if (pension) add({ kind: "PENSION", row: pension });
  if (employer) add({ kind: "EMPLOYER_COST", row: employer });
  return out;
}

/** Whether the organization is gated, and which of its required rules in force on the date are verified. */
export async function statutoryVerification(client: Tx | typeof db, orgId: string, date: Date): Promise<StatutoryVerification> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { bureauOrganizationId: true, engagement: { select: { status: true } } } });
  if (!org?.bureauOrganizationId) return { bureauClient: false, gated: false, verdicts: [], unverified: [] };
  const [rules, releases] = await Promise.all([
    inForceRules(client, orgId, date),
    client.ruleRelease.findMany({ where: { bureauOrganizationId: org.bureauOrganizationId, kind: { in: [...REQUIRED_RULE_KINDS] } }, include: { verifications: true } }),
  ]);
  const facts: ReleaseFact[] = releases.map((r) => ({
    kind: r.kind,
    version: r.version,
    checksum: r.checksum,
    status: r.status,
    signatures: r.verifications.map((v) => ({ slot: v.slot, name: v.verifierName, at: v.createdAt, checksum: v.checksum })),
  }));
  const verdicts = assessRules(rules, facts);
  return { bureauClient: true, gated: org.engagement?.status === "ACTIVE", verdicts, unverified: verdicts.filter((v) => !v.verified) };
}

/**
 * Stops the step if the organization is a production client and a required rule is unverified. Call it BEFORE opening a transaction, so the audit entry
 * for the block is kept. Throws a BusinessError that names the rule and says how to fix it.
 */
export async function enforceVerifiedRules(ctx: Ctx, date: Date, step: VerificationStep): Promise<void> {
  const v = await statutoryVerification(db, ctx.orgId, date);
  if (!v.gated || !v.unverified.length) return;
  await logAudit(ctx, {
    action: "PAYROLL_BLOCKED_UNVERIFIED_RULES",
    entity: "Organization",
    entityId: ctx.orgId,
    newValue: { step, onDate: iso(date), rules: v.unverified.map((u) => ({ kind: u.kind, label: u.label, reason: u.reason })) },
  });
  throw new BusinessError(
    `${STEP_TEXT[step]} because a statutory rule has not been verified. ${v.unverified.map((u) => `${u.label}: ${u.reason}`).join(" ")} HR and Finance must verify it in the bureau's Statutory Rule Library; then try again.`,
  );
}

/** What the payroll page shows for a period: whether the client is gated and which rules are verified, by whom and when. */
export async function statutoryStatus(ctx: Ctx, periodId: string) {
  assertCan(ctx, "payroll.view");
  const period = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId }, select: { id: true, name: true, endDate: true } });
  if (!period) throw new BusinessError("Payroll period not found.");
  return { period, ...(await statutoryVerification(db, ctx.orgId, period.endDate)) };
}
