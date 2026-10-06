/**
 * Data retention for recruitment. A rejected or withdrawn candidate's personal details shouldn't be
 * kept for ever — most privacy laws (Nigeria's NDPA, GDPR and similar) limit it to what's needed.
 * Once a candidate has been out of the pipeline for longer than the HR policy's retention period,
 * their name, contact details, CV reference, notes and interview comments are removed and the record
 * is marked anonymized. What stays is what the business needs: that the person applied for a
 * requisition, the stage they reached, and any offer's numbers — not who they were.
 *
 * Hired candidates are never touched (they became employees), nor is anyone still in the pipeline.
 * Run daily by /api/cron/data-retention; HR can also run it on demand.
 */
import type { Ctx } from "@/lib/auth/context";
import { addMonths } from "@/lib/leave";
import { logger } from "@/lib/logger";
import { assertCan, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";

const REMOVED = "[removed]";

export interface RetentionResult {
  organization: string;
  anonymized: number;
  skipped?: string;
}

/** Candidates whose details are past the retention period, as of `now`. */
async function eligibleCandidates(orgId: string, months: number, now: Date) {
  const cutoff = addMonths(new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`), -months);
  return db.candidate.findMany({
    where: {
      organizationId: orgId,
      stage: { in: ["REJECTED", "WITHDRAWN"] },
      stageChangedAt: { lt: cutoff },
      anonymizedAt: null,
      employeeId: null,
    },
    select: { id: true },
  });
}

export async function anonymizeStaleCandidates(orgId: string, now = new Date()): Promise<RetentionResult> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
  const policy = await getHrPolicy(orgId);
  if (policy.candidateRetentionMonths <= 0) return { organization: org.name, anonymized: 0, skipped: "Retention is switched off (0 months)." };
  const ids = (await eligibleCandidates(orgId, policy.candidateRetentionMonths, now)).map((c) => c.id);
  if (!ids.length) return { organization: org.name, anonymized: 0, skipped: "No candidate has passed the retention period." };

  await db.$transaction(async (tx) => {
    await tx.candidate.updateMany({
      where: { id: { in: ids } },
      data: { firstName: "Anonymised", lastName: "Candidate", phone: null, email: null, resumeReference: null, notes: null, rejectionReason: REMOVED, anonymizedAt: now },
    });
    await tx.interview.updateMany({ where: { candidateId: { in: ids }, feedback: { not: null } }, data: { feedback: REMOVED } });
    await tx.candidateCheck.updateMany({ where: { candidateId: { in: ids }, notes: { not: null } }, data: { notes: null } });
    await tx.jobOffer.updateMany({ where: { candidateId: { in: ids } }, data: { declineReason: null, decisionNote: null } });
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        userName: "System (data retention)",
        action: "CANDIDATE_ANONYMIZE",
        entity: "Candidate",
        newValue: { count: ids.length, retentionMonths: policy.candidateRetentionMonths },
        metadata: { candidateIds: ids },
      },
    });
  });
  return { organization: org.name, anonymized: ids.length };
}

/** The scheduled job: every organization in turn; one failing never stops the rest. */
export async function runRetentionForAllOrgs(now = new Date()): Promise<RetentionResult[]> {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const out: RetentionResult[] = [];
  for (const o of orgs) {
    try {
      out.push(await anonymizeStaleCandidates(o.id, now));
    } catch (e) {
      logger.error("retention_org_failed", { organization: o.name, error: e });
      out.push({ organization: o.name, anonymized: 0, skipped: "Failed — see the server log." });
    }
  }
  return out;
}

/** HR running it on demand. */
export async function runRetentionNow(ctx: Ctx) {
  assertCan(ctx, "hr.configure");
  const r = await anonymizeStaleCandidates(ctx.orgId);
  await logAudit(ctx, { action: "RETENTION_RUN_NOW", entity: "HrPolicy", newValue: r });
  return r;
}

/** How many candidates the next run would anonymize, for the settings page. */
export async function retentionPreview(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const policy = await getHrPolicy(ctx.orgId);
  const months = policy.candidateRetentionMonths;
  const due = months > 0 ? (await eligibleCandidates(ctx.orgId, months, new Date())).length : 0;
  const done = await db.candidate.count({ where: { organizationId: ctx.orgId, anonymizedAt: { not: null } } });
  return { months, due, alreadyAnonymized: done };
}
