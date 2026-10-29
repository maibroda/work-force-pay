import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import {
  assertSealKey,
  auditContentHash,
  ChainVerifier,
  declaredFromEntries,
  LATE_SEAL_MINUTES,
  nextSeal,
  redactionProof,
  SETTLE_SECONDS,
  STALLED_MINUTES,
  type AuditRowForSeal,
  type Finding,
} from "@/lib/audit-seal";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";

/**
 * Seals for the audit log (rule 5: tamper-evident). The rules and arithmetic are in lib/audit-seal.ts; this is the part that reads and writes the
 * database. docs/plans/tamper-evident-audit-log.md has the design, what it detects and what it cannot.
 * The audit WRITE path is untouched: a scheduled job seals rows a minute or so after they are written.
 */
const BATCH = 500;

/** The key from the environment, or a BusinessError that says what to fix without repeating the key. */
function sealKey(): string {
  try {
    return assertSealKey(process.env.AUDIT_SEAL_KEY);
  } catch (e) {
    throw new BusinessError((e as Error).message);
  }
}

const asRow = (r: Prisma.AuditLogGetPayload<object>): AuditRowForSeal => ({
  id: r.id, organizationId: r.organizationId, userId: r.userId, userName: r.userName, action: r.action, entity: r.entity, entityId: r.entityId,
  oldValue: r.oldValue, newValue: r.newValue, reason: r.reason, metadata: r.metadata, createdAt: r.createdAt,
});

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

// ─────────────────────────────── Sealing ───────────────────────────────

/**
 * Seals the organization's audit rows that are old enough and not yet sealed, oldest first. Two sealers at once cannot both succeed (the number per
 * organization is unique). After the first run it only looks at rows from just before the last sealed one (WINDOW_MINUTES), which is far longer than any
 * transaction takes to commit, so a run costs the same however long the log is. A row older than that which still has no seal is NOT sealed quietly: the
 * check reports it as stalled, which is how a slipped-in back-dated row shows. `sweep: true` seals everything left (the first run does so itself).
 */
const WINDOW_MINUTES = 15;
export async function sealOrganization(orgId: string, opts: { now?: Date; key?: string; sweep?: boolean } = {}) {
  const key = opts.key ?? sealKey();
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - SETTLE_SECONDS * 1000);
  let prev = await db.auditSeal.findFirst({ where: { organizationId: orgId }, orderBy: { seq: "desc" }, select: { seq: true, chainHash: true, auditLogId: true } });
  let after: { createdAt: Date; id: string } | null = null;
  if (prev && !opts.sweep) {
    const lastRow = await db.auditLog.findUnique({ where: { id: prev.auditLogId }, select: { createdAt: true } });
    if (lastRow) after = { createdAt: new Date(lastRow.createdAt.getTime() - WINDOW_MINUTES * 60_000), id: "" };
  }
  let sealed = 0;
  for (;;) {
    const rows: Prisma.AuditLogGetPayload<object>[] = await db.auditLog.findMany({
      where: {
        organizationId: orgId,
        seal: null,
        createdAt: { lt: cutoff },
        ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH,
    });
    if (!rows.length) break;
    const data: Prisma.AuditSealCreateManyInput[] = [];
    for (const r of rows) {
      const s = nextSeal(key, orgId, prev, asRow(r));
      data.push({ organizationId: orgId, seq: s.seq, auditLogId: s.auditLogId, contentHash: s.contentHash, prevHash: s.prevHash, chainHash: s.chainHash, sealedAt: now, sealedLate: now.getTime() - r.createdAt.getTime() > LATE_SEAL_MINUTES * 60_000 });
      prev = { seq: s.seq, chainHash: s.chainHash, auditLogId: s.auditLogId };
    }
    try {
      await db.auditSeal.createMany({ data });
    } catch (e) {
      if (isUniqueViolation(e)) return { sealed, raced: true }; // another sealer got there first; its seals stand
      throw e;
    }
    sealed += rows.length;
    const lastRow = rows[rows.length - 1];
    after = { createdAt: lastRow.createdAt, id: lastRow.id };
    if (rows.length < BATCH) break;
  }
  return { sealed, raced: false };
}

/** Seals every organization (each run is cheap: it only looks at recent rows). This is what the scheduled job calls. */
export async function sealAllOrganizations(opts: { now?: Date } = {}) {
  const key = sealKey();
  const now = opts.now ?? new Date();
  const orgs = await db.organization.findMany({ select: { id: true } });
  const results: Array<{ organizationId: string; sealed: number; raced: boolean }> = [];
  for (const o of orgs) {
    const r = await sealOrganization(o.id, { now, key });
    if (r.sealed > 0 || r.raced) results.push({ organizationId: o.id, ...r });
  }
  return results;
}

// ─────────────────────────────── Checking ───────────────────────────────

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  /** Capped at 200; `findingCount` is the full number. */
  findings: Finding[];
  findingCount: number;
  /** Rows still without a seal after STALLED_MINUTES: the sealing job is not running. */
  stalledRows: number;
  head: { seq: number; chainHash: string };
  firstSealedAt: Date | null;
  sealedLate: number;
}

/** Reads the organization's seals in order and checks every one against its audit row. Reads only. */
export async function verifyOrganization(orgId: string, opts: { now?: Date; key?: string } = {}): Promise<IntegrityReport> {
  const key = opts.key ?? sealKey();
  const now = opts.now ?? new Date();
  const redactions = await db.auditLog.findMany({ where: { organizationId: orgId, action: "AUDIT_REDACTION" }, select: { newValue: true } });
  const verifier = new ChainVerifier(key, orgId, declaredFromEntries(key, orgId, redactions.map((r) => r.newValue)));
  let after = 0;
  for (;;) {
    const seals = await db.auditSeal.findMany({ where: { organizationId: orgId, seq: { gt: after } }, orderBy: { seq: "asc" }, take: 1000 });
    if (!seals.length) break;
    const rows = await db.auditLog.findMany({ where: { organizationId: orgId, id: { in: seals.map((s) => s.auditLogId) } } });
    verifier.feed(seals, new Map(rows.map((r) => [r.id, asRow(r)])));
    after = seals[seals.length - 1].seq;
    if (seals.length < 1000) break;
  }
  const stalledRows = await db.auditLog.count({ where: { organizationId: orgId, seal: null, createdAt: { lt: new Date(now.getTime() - STALLED_MINUTES * 60_000) } } });
  const first = await db.auditSeal.findFirst({ where: { organizationId: orgId }, orderBy: { seq: "asc" }, select: { sealedAt: true } });
  const sealedLate = await db.auditSeal.count({ where: { organizationId: orgId, sealedLate: true } });
  const all = verifier.findings();
  return { ok: all.length === 0 && stalledRows === 0, checked: verifier.checked(), findings: all.slice(0, 200), findingCount: all.length, stalledRows, head: verifier.head(), firstSealedAt: first?.sealedAt ?? null, sealedLate };
}

// ─────────────────────────────── Redaction ───────────────────────────────

/**
 * The one sanctioned way to change audit rows on purpose (for example masking account numbers when field encryption is rolled out): inside one transaction
 * it lifts the append-only protection for just that transaction, applies the changes, and writes an AUDIT_REDACTION entry that lists each changed row with
 * the content hash it now has and a keyed proof, so the check accepts exactly those changes and nothing else. Every redaction is itself a sealed, audited event.
 */
export async function redactAuditRows(
  ctx: Ctx,
  updates: ReadonlyArray<{ id: string; oldValue?: Prisma.InputJsonValue | null; newValue?: Prisma.InputJsonValue | null; metadata?: Prisma.InputJsonValue | null }>,
  reason: string,
) {
  assertCan(ctx, "settings.manage");
  if (reason.trim().length < 10) throw new BusinessError("A redaction needs a reason of at least 10 characters.");
  if (!updates.length) throw new BusinessError("Nothing to redact.");
  const key = sealKey();
  const J = (v: Prisma.InputJsonValue | null) => (v === null ? Prisma.DbNull : v);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('wfp.allow_audit_redaction', 'on', true)`;
    const redacted: Array<{ id: string; contentHash: string; proof: string }> = [];
    for (const u of updates) {
      const done = await tx.auditLog.updateMany({
        where: { id: u.id, organizationId: ctx.orgId },
        data: {
          ...(u.oldValue !== undefined ? { oldValue: J(u.oldValue) } : {}),
          ...(u.newValue !== undefined ? { newValue: J(u.newValue) } : {}),
          ...(u.metadata !== undefined ? { metadata: J(u.metadata) } : {}),
        },
      });
      if (done.count !== 1) throw new BusinessError("An audit entry to redact was not found in this organization.");
      const now = await tx.auditLog.findUniqueOrThrow({ where: { id: u.id } });
      const contentHash = auditContentHash(asRow(now));
      redacted.push({ id: u.id, contentHash, proof: redactionProof(key, ctx.orgId, u.id, contentHash) });
    }
    await logAudit(ctx, { action: "AUDIT_REDACTION", entity: "AuditLog", newValue: { redacted }, reason: reason.trim() }, tx);
    return { redacted: redacted.length };
  });
}

// ─────────────────────────────── People who are told ───────────────────────────────

/**
 * Who is told (a failed check, the weekly chain head): by default everyone in the organization who can view the audit log; the organization can add
 * addresses (an outside auditor) or narrow it to the addresses it names. It is never nobody: an empty narrowed list falls back to the viewers.
 */
async function recipientsFor(orgId: string) {
  const policy = await getHrPolicy(orgId);
  const users = await db.user.findMany({ where: { organizationId: orgId, active: true }, select: { email: true, role: true } });
  const viewers = users.filter((u) => can(u.role, "audit.view")).map((u) => u.email);
  const extra = policy.auditAlertEmails ?? [];
  const list = policy.auditAlertIncludeEveryone ? [...viewers, ...extra] : extra;
  // the same address once, however it is capitalized; each is sent to as it is stored
  const seen = new Set<string>();
  return (list.length ? list : viewers).filter((e) => !seen.has(e.toLowerCase()) && !!seen.add(e.toLowerCase()));
}

export const auditAlertSchema = z.object({ extraEmails: z.array(z.string()).max(20, "At most 20 extra addresses."), includeEveryone: z.boolean() });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The current setting. Needs the audit permission. */
export async function auditAlertSettings(ctx: Ctx) {
  assertCan(ctx, "audit.view");
  const p = await getHrPolicy(ctx.orgId);
  return { extraEmails: p.auditAlertEmails ?? [], includeEveryone: p.auditAlertIncludeEveryone };
}

/** Changes who is told about the audit log. Needs the settings permission; every change is written to the audit log. */
export async function setAuditAlertRecipients(ctx: Ctx, raw: z.input<typeof auditAlertSchema>) {
  assertCan(ctx, "settings.manage");
  const v = auditAlertSchema.parse(raw);
  const emails: string[] = [];
  for (const e of v.extraEmails.map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (!EMAIL.test(e)) throw new BusinessError(`"${e}" is not an email address.`);
    if (!emails.includes(e)) emails.push(e);
  }
  const before = await getHrPolicy(ctx.orgId);
  await db.hrPolicy.update({ where: { organizationId: ctx.orgId }, data: { auditAlertEmails: emails, auditAlertIncludeEveryone: v.includeEveryone } });
  await logAudit(ctx, {
    action: "AUDIT_ALERT_RECIPIENTS_CHANGE",
    entity: "HrPolicy",
    entityId: before.id,
    oldValue: { extraEmails: before.auditAlertEmails ?? [], includeEveryone: before.auditAlertIncludeEveryone },
    newValue: { extraEmails: emails, includeEveryone: v.includeEveryone },
  });
  return { extraEmails: emails, includeEveryone: v.includeEveryone };
}

/** An entry written by the system itself (no signed-in person). */
async function systemEntry(orgId: string, action: string, newValue: Prisma.InputJsonValue, reason?: string) {
  await db.auditLog.create({ data: { organizationId: orgId, userName: "System (audit seal)", action, entity: "AuditLog", newValue, reason: reason ?? null } });
}

/** Records and emails a failed check. Never contains the key or any audit content: only kinds, numbers and entry ids. */
export async function reportIntegrityFailure(orgId: string, report: IntegrityReport) {
  const kinds = [...new Set(report.findings.map((f) => f.kind))];
  await systemEntry(orgId, "AUDIT_INTEGRITY_FAILED", { findingCount: report.findingCount, kinds, stalledRows: report.stalledRows, firstFindings: report.findings.slice(0, 5).map((f) => ({ kind: f.kind, seq: f.seq, auditLogId: f.auditLogId })) });
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const to = await recipientsFor(orgId);
  const text = `The audit log of ${org?.name ?? "an organization"} failed its integrity check.\n\nProblems found: ${report.findingCount}${kinds.length ? ` (${kinds.join(", ")})` : ""}. Entries still waiting to be sealed after ${STALLED_MINUTES} minutes: ${report.stalledRows}.\n\nOpen Settings > Audit integrity to see which entries. Do not assume this is a mistake: it means an audit entry changed, vanished, was added out of order, or the sealing job has stopped.`;
  for (const email of to) await sendEmail({ to: email, subject: `Audit log integrity check FAILED: ${org?.name ?? ""}`.trim(), text, html: `<p>${text.replace(/\n/g, "<br>")}</p>` }).catch((e) => logger.error("audit_failure_email_failed", { error: e }));
}

/** The daily check, for every organization that has seals (and for any with rows stuck unsealed). Failures are recorded and emailed. */
export async function verifyAllOrganizations(opts: { now?: Date } = {}) {
  const key = sealKey();
  const orgs = new Set([
    ...(await db.auditSeal.findMany({ distinct: ["organizationId"], select: { organizationId: true } })).map((s) => s.organizationId),
  ]);
  const out: Array<{ organizationId: string; ok: boolean; checked: number; findingCount: number; stalledRows: number }> = [];
  for (const orgId of orgs) {
    const report = await verifyOrganization(orgId, { key, now: opts.now });
    if (!report.ok) await reportIntegrityFailure(orgId, report);
    out.push({ organizationId: orgId, ok: report.ok, checked: report.checked, findingCount: report.findingCount, stalledRows: report.stalledRows });
  }
  return out;
}

/** The weekly copy of each organization's chain head, emailed outside the system, so an altered or cut-off log is visible against an old email. */
export async function sendChainHeads(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const heads = await db.$queryRaw<Array<{ organizationId: string; seq: number; chainHash: string }>>`
    SELECT DISTINCT ON ("organizationId") "organizationId", "seq", "chainHash" FROM "AuditSeal" ORDER BY "organizationId", "seq" DESC`;
  const out: Array<{ organizationId: string; seq: number; recipients: number }> = [];
  for (const h of heads) {
    const org = await db.organization.findUnique({ where: { id: h.organizationId }, select: { name: true } });
    const to = await recipientsFor(h.organizationId);
    const text = `Audit log chain head for ${org?.name ?? "your organization"}, ${now.toISOString().slice(0, 10)}.\n\nEntries sealed: ${h.seq}\nChain head: ${h.chainHash}\n\nKeep this email. If the audit log is ever altered or cut short, the chain will no longer reach this head, and comparing with the emails you kept shows it.`;
    for (const email of to) await sendEmail({ to: email, subject: `Audit log chain head: ${org?.name ?? ""} (${h.seq} entries)`.trim(), text, html: `<p>${text.replace(/\n/g, "<br>")}</p>` }).catch((e) => logger.error("audit_head_email_failed", { error: e }));
    await systemEntry(h.organizationId, "AUDIT_ANCHOR_SENT", { seq: h.seq, chainHash: h.chainHash, recipients: to.length });
    out.push({ organizationId: h.organizationId, seq: h.seq, recipients: to.length });
  }
  return out;
}

// ─────────────────────────────── For the screen ───────────────────────────────

/** What the Audit integrity screen shows. Needs the audit permission; sees only the caller's own organization. */
export async function auditIntegrityOverview(ctx: Ctx) {
  assertCan(ctx, "audit.view");
  const keyOk = (() => {
    try {
      assertSealKey(process.env.AUDIT_SEAL_KEY);
      return true;
    } catch {
      return false;
    }
  })();
  const [sealed, unsealed, last, first, late, jobs] = await Promise.all([
    db.auditSeal.count({ where: { organizationId: ctx.orgId } }),
    db.auditLog.count({ where: { organizationId: ctx.orgId, seal: null } }),
    db.auditSeal.findFirst({ where: { organizationId: ctx.orgId }, orderBy: { seq: "desc" }, select: { seq: true, chainHash: true, sealedAt: true } }),
    db.auditSeal.findFirst({ where: { organizationId: ctx.orgId }, orderBy: { seq: "asc" }, select: { sealedAt: true } }),
    db.auditSeal.count({ where: { organizationId: ctx.orgId, sealedLate: true } }),
    db.jobRun.findMany({ where: { name: { in: ["audit-seal", "audit-verify", "audit-heads"] } }, orderBy: { startedAt: "desc" }, take: 30 }),
  ]);
  const lastJob = (name: string) => jobs.find((j) => j.name === name) ?? null;
  return { keyConfigured: keyOk, sealed, unsealed, head: last, firstSealedAt: first?.sealedAt ?? null, sealedLate: late, jobs: { seal: lastJob("audit-seal"), verify: lastJob("audit-verify"), heads: lastJob("audit-heads") } };
}

/** "Check now" on the screen. Writes an audit entry saying who ran it and what it found (never the findings' content). */
export async function verifyAuditNow(ctx: Ctx): Promise<IntegrityReport> {
  assertCan(ctx, "audit.view");
  await sealOrganization(ctx.orgId); // bring the seals up to date first
  const report = await verifyOrganization(ctx.orgId);
  await logAudit(ctx, { action: "AUDIT_INTEGRITY_CHECK", entity: "AuditLog", newValue: { ok: report.ok, checked: report.checked, findingCount: report.findingCount, stalledRows: report.stalledRows } });
  return report;
}
