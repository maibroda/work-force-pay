/**
 * The bureau's statutory rule library. The bureau's own rule tables are the master set. A new version (PAYE bands, pension rates, employer
 * contributions) reaches clients only through a release: proposed with its source, verified by one person from HR and one from Finance
 * (neither the proposer), then published to every client organization. A checksum pins exactly what was proposed, verified and published,
 * so a master rule edited after sign-off cannot slip out unverified. Clients cannot change their PAYE or pension rules themselves.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

export const RULE_KINDS = ["TAX", "PENSION", "EMPLOYER_COST"] as const;
export type RuleKindName = (typeof RULE_KINDS)[number];
export const RULE_KIND_LABELS: Record<RuleKindName, string> = { TAX: "PAYE (income tax)", PENSION: "Pension", EMPLOYER_COST: "Employer contributions" };

const dayBefore = (d: Date) => new Date(d.getTime() - 86400000);

// ─────────────────────────────── The master rule and its fingerprint ───────────────────────────────

type MasterTax = Prisma.TaxRuleGetPayload<{ include: { bands: true; reliefs: true; exemptions: true } }>;
type Master = { kind: "TAX"; row: MasterTax } | { kind: "PENSION"; row: Prisma.PensionRuleGetPayload<object> } | { kind: "EMPLOYER_COST"; row: Prisma.EmployerCostRuleGetPayload<object> };

async function loadMaster(client: Tx | typeof db, bureauId: string, kind: RuleKindName, ruleId: string): Promise<Master | null> {
  if (kind === "TAX") {
    const row = await client.taxRule.findFirst({ where: { id: ruleId, organizationId: bureauId }, include: { bands: true, reliefs: true, exemptions: true } });
    return row ? { kind, row } : null;
  }
  if (kind === "PENSION") {
    const row = await client.pensionRule.findFirst({ where: { id: ruleId, organizationId: bureauId } });
    return row ? { kind, row } : null;
  }
  const row = await client.employerCostRule.findFirst({ where: { id: ruleId, organizationId: bureauId } });
  return row ? { kind, row } : null;
}

/** Everything that decides what a rule does, and nothing that merely records its life (end dates, timestamps, ids). */
function fingerprintOf(m: Master): string {
  let body: unknown;
  if (m.kind === "TAX") {
    const r = m.row;
    body = {
      code: r.code,
      name: r.name,
      version: r.version,
      from: iso(r.effectiveFrom),
      bands: [...r.bands].sort((a, b) => a.sortOrder - b.sortOrder).map((b) => [b.sortOrder, num(b.lowerBound), b.upperBound === null ? null : num(b.upperBound), num(b.rate)]),
      reliefs: [...r.reliefs].sort((a, b) => a.code.localeCompare(b.code)).map((x) => [x.code, x.name, x.type, x.rate === null ? null : num(x.rate), x.amount === null ? null : num(x.amount), x.cap === null ? null : num(x.cap), x.active]),
      exemptions: [...r.exemptions].sort((a, b) => a.code.localeCompare(b.code)).map((x) => [x.code, x.description, num(x.annualGrossCeiling), x.active]),
    };
  } else if (m.kind === "PENSION") {
    const r = m.row;
    body = { version: r.version, from: iso(r.effectiveFrom), employee: num(r.employeeRate), employer: num(r.employerRate), codes: [...r.pensionableCodes].sort() };
  } else {
    const r = m.row;
    body = {
      version: r.version,
      from: iso(r.effectiveFrom),
      pct: [r.itfPct, r.nsitfPct, r.nhfMedicalPct, r.insurancePct, r.uniformKitsPct, r.recruitmentTrainingPct, r.leaveRelieverPct, r.outsourcingLeaveAllowancePct].map(num),
    };
  }
  return createHash("sha256").update(JSON.stringify([m.kind, body])).digest("hex");
}

const labelOf = (m: Master) => (m.kind === "TAX" ? `PAYE ${m.row.code} v${m.row.version}` : m.kind === "PENSION" ? `Pension v${m.row.version}` : `Employer contributions v${m.row.version}`);

async function bureauOf(ctx: Ctx) {
  const org = await db.organization.findUnique({ where: { id: ctx.homeOrgId ?? ctx.orgId } });
  if (!org?.isBureau) throw new BusinessError("The rule library belongs to a payroll bureau.");
  return org;
}

// ─────────────────────────────── Propose, verify, withdraw ───────────────────────────────

export const proposeSchema = z.object({
  kind: z.enum(RULE_KINDS),
  ruleId: z.string().min(1, "Choose the rule version"),
  summary: z.string().trim().min(10, "Say what changed and why (at least 10 characters)"),
  source: z.string().trim().min(5, "Give the law, gazette or circular this comes from"),
});

export async function proposeRelease(ctx: Ctx, raw: z.input<typeof proposeSchema>) {
  assertCan(ctx, "rules.manage");
  const bureau = await bureauOf(ctx);
  const v = proposeSchema.parse(raw);
  const master = await loadMaster(db, bureau.id, v.kind, v.ruleId);
  if (!master) throw new BusinessError("That rule version is not in the bureau's own tables.");
  const live = await db.ruleRelease.findFirst({ where: { bureauOrganizationId: bureau.id, kind: v.kind, ruleId: v.ruleId, status: { in: ["PROPOSED", "VERIFIED", "PUBLISHED"] } } });
  if (live) throw new BusinessError(`${labelOf(master)} already has a release in progress or published.`);
  const release = await db.ruleRelease.create({
    data: {
      bureauOrganizationId: bureau.id,
      kind: v.kind,
      ruleId: v.ruleId,
      label: labelOf(master),
      version: master.row.version,
      effectiveFrom: master.row.effectiveFrom,
      summary: v.summary,
      source: v.source,
      checksum: fingerprintOf(master),
      proposedBy: ctx.name,
      proposedByUserId: ctx.userId,
    },
  });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "RULE_RELEASE_PROPOSE", entity: "RuleRelease", entityId: release.id, newValue: { label: release.label, effectiveFrom: iso(release.effectiveFrom), source: v.source } });
  return release;
}

/** HR or Finance signs off the rule as proposed. Needs both, and neither may be whoever proposed it. */
export async function verifyRelease(ctx: Ctx, releaseId: string, note: string) {
  assertCan(ctx, "rules.verify");
  const bureau = await bureauOf(ctx);
  const slot = ctx.role === "HR_ADMIN" ? "HR" : ctx.role === "FINANCE" ? "FINANCE" : null;
  if (!slot) throw new BusinessError("Statutory rates are verified by HR and by Finance. Your role can't fill either place.");
  if (!note || note.trim().length < 10) throw new BusinessError("Say what you checked the rate against (at least 10 characters).");
  return db.$transaction(async (tx) => {
    const rel = await tx.ruleRelease.findFirst({ where: { id: releaseId, bureauOrganizationId: bureau.id }, include: { verifications: true } });
    if (!rel) throw new BusinessError("Rule release not found.");
    if (rel.status !== "PROPOSED") throw new BusinessError("Only a proposed rule release can be verified.");
    if (rel.proposedByUserId === ctx.userId) throw new BusinessError("You proposed this rule, so someone else has to verify it.");
    if (rel.verifications.some((x) => x.slot === slot)) throw new BusinessError(`${slot === "HR" ? "HR" : "Finance"} has already verified this rule.`);
    const master = await loadMaster(tx, bureau.id, rel.kind, rel.ruleId);
    if (!master || fingerprintOf(master) !== rel.checksum) throw new BusinessError("The rule in the bureau's tables no longer matches what was proposed. Withdraw this release and propose it again.");
    await tx.ruleVerification.create({ data: { releaseId, slot, verifierName: ctx.name, verifierUserId: ctx.userId, note: note.trim(), checksum: rel.checksum } });
    const both = rel.verifications.length + 1 >= 2;
    if (both) await tx.ruleRelease.update({ where: { id: releaseId }, data: { status: "VERIFIED" } });
    await logAudit({ ...ctx, orgId: bureau.id }, { action: "RULE_RELEASE_VERIFY", entity: "RuleRelease", entityId: releaseId, newValue: { slot, label: rel.label, nowVerified: both }, reason: note }, tx);
    return { verified: both };
  });
}

export async function withdrawRelease(ctx: Ctx, releaseId: string, reason: string) {
  assertCan(ctx, "rules.manage");
  const bureau = await bureauOf(ctx);
  if (!reason || reason.trim().length < 10) throw new BusinessError("Say why this release is being withdrawn (at least 10 characters).");
  const rel = await db.ruleRelease.findFirst({ where: { id: releaseId, bureauOrganizationId: bureau.id } });
  if (!rel) throw new BusinessError("Rule release not found.");
  if (rel.status === "PUBLISHED") throw new BusinessError("A published release is not withdrawn: clients already hold it. Propose a corrected version instead.");
  if (rel.status === "WITHDRAWN") throw new BusinessError("This release is already withdrawn.");
  await db.ruleRelease.update({ where: { id: releaseId }, data: { status: "WITHDRAWN", withdrawnReason: reason.trim(), withdrawnBy: ctx.name } });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "RULE_RELEASE_WITHDRAW", entity: "RuleRelease", entityId: releaseId, newValue: { label: rel.label }, reason });
}

// ─────────────────────────────── Publishing ───────────────────────────────

type Outcome = { clientId: string; clientName: string; outcome: "PUBLISHED" | "ALREADY_HELD" | "FAILED"; message?: string };

/** Puts the master rule into one client's tables, ending the version it replaces. Throws a BusinessError if it can't go in cleanly. */
async function installInto(tx: Tx, m: Master, clientId: string): Promise<"PUBLISHED" | "ALREADY_HELD"> {
  const from = m.row.effectiveFrom;
  const end = dayBefore(from);
  if (m.kind === "TAX") {
    const r = m.row;
    if (await tx.taxRule.findFirst({ where: { organizationId: clientId, code: r.code, version: r.version } })) return "ALREADY_HELD";
    const open = await tx.taxRule.findMany({ where: { organizationId: clientId, effectiveTo: null, active: true } });
    if (open.some((o) => o.effectiveFrom >= from)) throw new BusinessError("The client already has an open PAYE rule starting on or after this date.");
    for (const o of open) await tx.taxRule.update({ where: { id: o.id }, data: { effectiveTo: end } });
    await tx.taxRule.create({
      data: {
        organizationId: clientId, code: r.code, name: r.name, version: r.version, legalBasis: r.legalBasis, effectiveFrom: from, effectiveTo: r.effectiveTo, active: r.active,
        bands: { create: r.bands.map((b) => ({ sortOrder: b.sortOrder, lowerBound: b.lowerBound, upperBound: b.upperBound, rate: b.rate })) },
        reliefs: { create: r.reliefs.map((x) => ({ code: x.code, name: x.name, type: x.type, rate: x.rate, amount: x.amount, cap: x.cap, active: x.active })) },
        exemptions: { create: r.exemptions.map((x) => ({ code: x.code, description: x.description, annualGrossCeiling: x.annualGrossCeiling, active: x.active })) },
      },
    });
    return "PUBLISHED";
  }
  if (m.kind === "PENSION") {
    const r = m.row;
    if (await tx.pensionRule.findFirst({ where: { organizationId: clientId, version: r.version } })) return "ALREADY_HELD";
    const open = await tx.pensionRule.findMany({ where: { organizationId: clientId, effectiveTo: null } });
    if (open.some((o) => o.effectiveFrom >= from)) throw new BusinessError("The client already has an open pension rule starting on or after this date.");
    for (const o of open) await tx.pensionRule.update({ where: { id: o.id }, data: { effectiveTo: end } });
    await tx.pensionRule.create({ data: { organizationId: clientId, version: r.version, employeeRate: r.employeeRate, employerRate: r.employerRate, pensionableCodes: r.pensionableCodes, effectiveFrom: from, effectiveTo: r.effectiveTo } });
    return "PUBLISHED";
  }
  const r = m.row;
  if (await tx.employerCostRule.findFirst({ where: { organizationId: clientId, version: r.version } })) return "ALREADY_HELD";
  const open = await tx.employerCostRule.findMany({ where: { organizationId: clientId, effectiveTo: null } });
  if (open.some((o) => o.effectiveFrom >= from)) throw new BusinessError("The client already has an open employer-contribution rule starting on or after this date.");
  for (const o of open) await tx.employerCostRule.update({ where: { id: o.id }, data: { effectiveTo: end } });
  await tx.employerCostRule.create({
    data: {
      organizationId: clientId, version: r.version, itfPct: r.itfPct, nsitfPct: r.nsitfPct, nhfMedicalPct: r.nhfMedicalPct, insurancePct: r.insurancePct, uniformKitsPct: r.uniformKitsPct,
      recruitmentTrainingPct: r.recruitmentTrainingPct, leaveRelieverPct: r.leaveRelieverPct, outsourcingLeaveAllowancePct: r.outsourcingLeaveAllowancePct, effectiveFrom: from, effectiveTo: r.effectiveTo,
    },
  });
  return "PUBLISHED";
}

/**
 * Sends a verified release to the clients that don't hold it yet (all of them, or the ones named). Each client is its own step: one that can't
 * take it (for example it has a later rule of its own) is reported and left alone, and the rest still get it. Can be run again for clients
 * onboarded afterwards.
 */
export async function publishRelease(ctx: Ctx, releaseId: string, clientIds?: string[]) {
  assertCan(ctx, "rules.manage");
  const bureau = await bureauOf(ctx);
  const rel = await db.ruleRelease.findFirst({ where: { id: releaseId, bureauOrganizationId: bureau.id }, include: { verifications: true } });
  if (!rel) throw new BusinessError("Rule release not found.");
  if (rel.status !== "VERIFIED" && rel.status !== "PUBLISHED") throw new BusinessError("Only a rule release verified by both HR and Finance can be published.");
  const master = await loadMaster(db, bureau.id, rel.kind, rel.ruleId);
  if (!master || fingerprintOf(master) !== rel.checksum || rel.verifications.some((x) => x.checksum !== rel.checksum))
    throw new BusinessError("The rule in the bureau's tables no longer matches what was verified, so it can't be published. Withdraw this release and propose it again.");

  const clients = await db.organization.findMany({
    where: { bureauOrganizationId: bureau.id, ...(clientIds?.length ? { id: { in: clientIds } } : {}), engagement: { status: { not: "ENDED" } }, rulePublications: { none: { releaseId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!clients.length) throw new BusinessError("Every client already has this release.");
  if (rel.status === "VERIFIED") await db.ruleRelease.update({ where: { id: releaseId }, data: { status: "PUBLISHED", publishedAt: new Date(), publishedBy: ctx.name } });

  const results: Outcome[] = [];
  for (const c of clients) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        const o = await installInto(tx, master, c.id);
        await tx.rulePublication.create({ data: { releaseId, clientOrganizationId: c.id, outcome: o, publishedBy: ctx.name } });
        await logAudit(
          { ...ctx, orgId: c.id },
          { action: "RULE_PUBLISHED", entity: "RuleRelease", entityId: releaseId, newValue: { label: rel.label, effectiveFrom: iso(rel.effectiveFrom), source: rel.source, outcome: o, verifiedBy: rel.verifications.map((x) => `${x.slot}: ${x.verifierName}`) } },
          tx,
        );
        return o;
      });
      results.push({ clientId: c.id, clientName: c.name, outcome });
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e;
      results.push({ clientId: c.id, clientName: c.name, outcome: "FAILED", message: e.message });
      await logAudit({ ...ctx, orgId: c.id }, { action: "RULE_PUBLISH_FAILED", entity: "RuleRelease", entityId: releaseId, newValue: { label: rel.label, reason: e.message } });
    }
  }
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "RULE_RELEASE_PUBLISH", entity: "RuleRelease", entityId: releaseId, newValue: { label: rel.label, published: results.filter((r) => r.outcome === "PUBLISHED").length, alreadyHeld: results.filter((r) => r.outcome === "ALREADY_HELD").length, failed: results.filter((r) => r.outcome === "FAILED").length } });
  return results;
}

// ─────────────────────────────── Reading ───────────────────────────────

export async function listReleases(ctx: Ctx) {
  assertCan(ctx, "bureau.view");
  const bureau = await bureauOf(ctx);
  return db.ruleRelease.findMany({
    where: { bureauOrganizationId: bureau.id },
    include: { verifications: true, _count: { select: { publications: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/** The bureau's own rule versions that could be put forward: none already in a live release. */
export async function releasableRules(ctx: Ctx) {
  assertCan(ctx, "rules.manage");
  const bureau = await bureauOf(ctx);
  const [tax, pension, employer, live] = await Promise.all([
    db.taxRule.findMany({ where: { organizationId: bureau.id }, orderBy: { effectiveFrom: "desc" } }),
    db.pensionRule.findMany({ where: { organizationId: bureau.id }, orderBy: { effectiveFrom: "desc" } }),
    db.employerCostRule.findMany({ where: { organizationId: bureau.id }, orderBy: { effectiveFrom: "desc" } }),
    db.ruleRelease.findMany({ where: { bureauOrganizationId: bureau.id, status: { in: ["PROPOSED", "VERIFIED", "PUBLISHED"] } }, select: { ruleId: true } }),
  ]);
  const taken = new Set(live.map((l) => l.ruleId));
  return [
    ...tax.map((r) => ({ kind: "TAX" as const, id: r.id, label: `PAYE ${r.code} v${r.version}`, effectiveFrom: r.effectiveFrom })),
    ...pension.map((r) => ({ kind: "PENSION" as const, id: r.id, label: `Pension v${r.version}`, effectiveFrom: r.effectiveFrom })),
    ...employer.map((r) => ({ kind: "EMPLOYER_COST" as const, id: r.id, label: `Employer contributions v${r.version}`, effectiveFrom: r.effectiveFrom })),
  ].filter((r) => !taken.has(r.id));
}

export async function getRelease(ctx: Ctx, releaseId: string) {
  assertCan(ctx, "bureau.view");
  const bureau = await bureauOf(ctx);
  const rel = await db.ruleRelease.findFirst({
    where: { id: releaseId, bureauOrganizationId: bureau.id },
    include: { verifications: { orderBy: { createdAt: "asc" } }, publications: { include: { client: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!rel) return null;
  const master = await loadMaster(db, bureau.id, rel.kind, rel.ruleId);
  const pending = await db.organization.findMany({
    where: { bureauOrganizationId: bureau.id, engagement: { status: { not: "ENDED" } }, rulePublications: { none: { releaseId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return { rel, master, intact: !!master && fingerprintOf(master) === rel.checksum, pendingClients: pending };
}

/**
 * The bureau's rule versions a newly onboarded client may start with: those that were published through the library, and those the bureau
 * itself is already paying on today and that were never put through it (the baseline). Anything proposed but not yet published, withdrawn,
 * or dated in the future without a release is left out, so an unverified rate can't reach a client by the back door.
 */
export async function startingRuleIds(tx: Tx, bureauId: string): Promise<Set<string>> {
  const today = new Date(iso(new Date()) + "T00:00:00Z");
  const [tax, pension, employer, releases] = await Promise.all([
    tx.taxRule.findMany({ where: { organizationId: bureauId }, select: { id: true, effectiveFrom: true } }),
    tx.pensionRule.findMany({ where: { organizationId: bureauId }, select: { id: true, effectiveFrom: true } }),
    tx.employerCostRule.findMany({ where: { organizationId: bureauId }, select: { id: true, effectiveFrom: true } }),
    tx.ruleRelease.findMany({ where: { bureauOrganizationId: bureauId }, select: { ruleId: true, status: true } }),
  ]);
  const published = new Set(releases.filter((r) => r.status === "PUBLISHED").map((r) => r.ruleId));
  const released = new Set(releases.map((r) => r.ruleId));
  const ids = new Set<string>();
  for (const r of [...tax, ...pension, ...employer]) if (published.has(r.id) || (!released.has(r.id) && r.effectiveFrom <= today)) ids.add(r.id);
  return ids;
}

/** Clients may not change PAYE or pension rules themselves; they come from the bureau's rule library. */
export async function assertNotBureauManaged(client: Tx | typeof db, orgId: string, what: string) {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { bureauOrganizationId: true, bureauOrganization: { select: { name: true } } } });
  if (org?.bureauOrganizationId)
    throw new BusinessError(`${what} for this client are published by ${org.bureauOrganization?.name ?? "the bureau"} from its rule library, so they can't be changed here.`);
}
