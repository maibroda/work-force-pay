/**
 * Screening criteria and an explained shortlist (recruitment slice C, approved by the founder on 2026-11-16: plan section 5, rule 9).
 *
 * ADVICE ONLY. A requisition has one to ten criteria, each a must-have or preferred. HR (the right to assess candidates, the HR administrator alone) records for each candidate and
 * criterion one of MET, NOT MET or UNCLEAR, with the evidence for a met or not met. Nothing here ranks, orders by the answers, filters, hides or rejects a candidate, and nothing changes a
 * candidate's stage: a person moves a candidate. Shortlisting is a NAMED person's decision with a recorded reason.
 *
 * The evidence and the reasons are free text about a person who may not be an employee, so they are read by HR alone, every read is logged, the audit log carries ids and counts only, and
 * they are cleared when an unsuccessful applicant is anonymised (retention.ts).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { recordSensitiveAccess } from "./sensitive-access";

export const MIN_SCREENING_CRITERIA = 1;
export const MAX_SCREENING_CRITERIA = 10;
const OPEN_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "ASSESSMENT", "OFFER"];
const KINDS = ["MUST_HAVE", "PREFERRED"] as const;
const OUTCOMES = ["MET", "NOT_MET", "UNCLEAR"] as const;

export const SCREENING_NOTE = "Screening answers are advice for the people deciding. They never order, filter or reject a candidate: a person moves each candidate, and a shortlist is a named person's decision with a reason.";

async function loadRequisition(ctx: Ctx, id: string) {
  const r = await db.jobRequisition.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Requisition not found.");
  return r;
}

async function loadCandidate(ctx: Ctx, id: string) {
  const c = await db.candidate.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new BusinessError("Candidate not found.");
  return c;
}

const criterionSchema = z.object({ name: z.string().trim().min(3, "Name each criterion in 3 to 80 characters.").max(80, "Name each criterion in 3 to 80 characters."), kind: z.enum(KINDS) });

// ───────────────────────────── Criteria ─────────────────────────────

/** HR sets (or replaces) a requisition's screening criteria. Not after the first answer has been recorded. */
export async function setScreeningCriteria(ctx: Ctx, requisitionId: string, items: Array<{ name: string; kind: (typeof KINDS)[number] }>) {
  assertCan(ctx, "recruitment.assess");
  const req = await loadRequisition(ctx, requisitionId);
  if (items.length < MIN_SCREENING_CRITERIA || items.length > MAX_SCREENING_CRITERIA) throw new BusinessError(`Set one to ten screening criteria (you gave ${items.length}).`);
  const clean = items.map((i) => criterionSchema.parse(i));
  if (new Set(clean.map((c) => c.name.toLowerCase())).size !== clean.length) throw new BusinessError("Each criterion must be different.");
  const recorded = await db.candidateScreening.count({ where: { organizationId: ctx.orgId, candidate: { requisitionId: req.id } } });
  if (recorded) throw new BusinessError("Criteria can't change once an answer has been recorded.");
  await db.$transaction(async (tx) => {
    await tx.screeningCriterion.deleteMany({ where: { requisitionId: req.id } });
    await tx.screeningCriterion.createMany({ data: clean.map((c, i) => ({ organizationId: ctx.orgId, requisitionId: req.id, position: i + 1, name: c.name, kind: c.kind })) });
    await logAudit(ctx, { action: "SCREENING_CRITERIA_SET", entity: "JobRequisition", entityId: req.id, newValue: { count: clean.length } }, tx);
  });
  return listScreeningCriteria(ctx, requisitionId);
}

export async function listScreeningCriteria(ctx: Ctx, requisitionId: string) {
  assertCan(ctx, "recruitment.assess");
  const req = await loadRequisition(ctx, requisitionId);
  return db.screeningCriterion.findMany({ where: { requisitionId: req.id }, orderBy: { position: "asc" }, select: { id: true, position: true, name: true, kind: true } });
}

// ───────────────────────────── The answers ─────────────────────────────

const answerSchema = z.object({ criterionId: z.string().min(1), outcome: z.enum(OUTCOMES), evidence: z.string().trim().max(500).optional() });

/** HR records the answer for every criterion for one candidate (replacing any earlier answers). A met or not met needs the evidence; an unclear needs none. */
export async function recordScreening(ctx: Ctx, candidateId: string, raw: Array<z.input<typeof answerSchema>>) {
  assertCan(ctx, "recruitment.assess");
  const c = await loadCandidate(ctx, candidateId);
  if (!OPEN_STAGES.includes(c.stage)) throw new BusinessError(`This candidate is already ${c.stage.toLowerCase()}.`);
  const criteria = await db.screeningCriterion.findMany({ where: { requisitionId: c.requisitionId } });
  if (!criteria.length) throw new BusinessError("Set the requisition's screening criteria first.");
  const v = raw.map((a) => answerSchema.parse(a));
  const known = new Set(criteria.map((x) => x.id));
  if (v.some((a) => !known.has(a.criterionId))) throw new BusinessError("That criterion isn't part of this requisition.");
  if (new Set(v.map((a) => a.criterionId)).size !== v.length || v.length !== criteria.length) throw new BusinessError("Answer every criterion, once each.");
  if (v.some((a) => a.outcome !== "UNCLEAR" && (a.evidence ?? "").length < 5)) throw new BusinessError("Give the evidence (at least 5 characters) for each answer that is met or not met.");
  await db.$transaction(async (tx) => {
    for (const a of v) {
      const data = { outcome: a.outcome, evidence: a.evidence || null, recordedById: ctx.userId, recordedBy: ctx.name };
      await tx.candidateScreening.upsert({ where: { candidateId_criterionId: { candidateId, criterionId: a.criterionId } }, update: data, create: { organizationId: ctx.orgId, candidateId, criterionId: a.criterionId, ...data } });
    }
    // ids and a count only: never the evidence
    await logAudit(ctx, { action: "SCREENING_RECORD", entity: "Candidate", entityId: candidateId, newValue: { criteria: v.length } }, tx);
  });
}

// ───────────────────────────── The shortlist ─────────────────────────────

/** A named person (HR) decides to shortlist the candidate or not, with a reason. It changes nothing else, and a later decision replaces it. */
export async function decideShortlist(ctx: Ctx, candidateId: string, decision: "SHORTLISTED" | "NOT_SHORTLISTED", reason: string) {
  assertCan(ctx, "recruitment.assess");
  const c = await loadCandidate(ctx, candidateId);
  if (!OPEN_STAGES.includes(c.stage)) throw new BusinessError(`This candidate is already ${c.stage.toLowerCase()}.`);
  if (!(["SHORTLISTED", "NOT_SHORTLISTED"] as string[]).includes(decision)) throw new BusinessError("Choose shortlisted or not shortlisted.");
  const why = (reason ?? "").trim();
  const criteria = await db.screeningCriterion.count({ where: { requisitionId: c.requisitionId } });
  if (criteria) {
    const answered = await db.candidateScreening.count({ where: { candidateId } });
    if (answered < criteria) throw new BusinessError("Record the screening answers before shortlisting.");
  }
  if (why.length < 10) throw new BusinessError("Give a reason for the decision (at least 10 characters).");
  await db.$transaction(async (tx) => {
    const data = { decision, reason: why, decidedById: ctx.userId, decidedBy: ctx.name, decidedAt: new Date() };
    await tx.candidateShortlist.upsert({ where: { candidateId }, update: data, create: { organizationId: ctx.orgId, candidateId, ...data } });
    await logAudit(ctx, { action: "SHORTLIST_DECIDE", entity: "Candidate", entityId: candidateId, newValue: { decision } }, tx);
  });
}

// ───────────────────────────── Reading ─────────────────────────────

/**
 * Every candidate of a requisition with their answers, in the order of their candidate numbers (never by the answers) and none hidden. "Must-haves not met" is a count shown to the person,
 * not a filter. HR alone; every read is logged.
 */
export async function screeningOverview(ctx: Ctx, requisitionId: string) {
  assertCan(ctx, "recruitment.assess");
  const req = await loadRequisition(ctx, requisitionId);
  const criteria = await db.screeningCriterion.findMany({ where: { requisitionId: req.id }, orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } });
  const candidates = await db.candidate.findMany({
    where: { requisitionId: req.id, organizationId: ctx.orgId },
    orderBy: { candidateNumber: "asc" },
    include: { screenings: true, shortlist: true },
  });
  const rows = candidates.map((c) => {
    const answers = criteria.flatMap((cr) => {
      const a = c.screenings.find((s) => s.criterionId === cr.id);
      return a ? [{ criterionId: cr.id, outcome: a.outcome, evidence: a.evidence }] : [];
    });
    const must = new Set(criteria.filter((cr) => cr.kind === "MUST_HAVE").map((cr) => cr.id));
    return {
      candidateId: c.id,
      candidateNumber: c.candidateNumber,
      name: `${c.firstName} ${c.lastName}`,
      stage: c.stage,
      answers,
      summary: {
        met: answers.filter((a) => a.outcome === "MET").length,
        notMet: answers.filter((a) => a.outcome === "NOT_MET").length,
        unclear: answers.filter((a) => a.outcome === "UNCLEAR").length,
        total: criteria.length,
        mustHaveNotMet: answers.filter((a) => a.outcome === "NOT_MET" && must.has(a.criterionId)).length,
      },
      shortlist: c.shortlist ? { decision: c.shortlist.decision, reason: c.shortlist.reason, decidedBy: c.shortlist.decidedBy } : null,
    };
  });
  await recordSensitiveAccess(ctx, { kind: "CANDIDATE_ASSESSMENT", entity: "JobRequisition", ref: req.id, count: rows.length });
  return { requisitionId: req.id, criteria, candidates: rows, note: SCREENING_NOTE };
}

/** One candidate's criteria, answers and shortlist decision, for HR's candidate page. HR alone; the read is logged. */
export async function candidateScreening(ctx: Ctx, candidateId: string) {
  assertCan(ctx, "recruitment.assess");
  const c = await loadCandidate(ctx, candidateId);
  const [criteria, answers, shortlist] = await Promise.all([
    db.screeningCriterion.findMany({ where: { requisitionId: c.requisitionId }, orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } }),
    db.candidateScreening.findMany({ where: { candidateId }, select: { criterionId: true, outcome: true, evidence: true, recordedBy: true } }),
    db.candidateShortlist.findUnique({ where: { candidateId }, select: { decision: true, reason: true, decidedBy: true } }),
  ]);
  if (answers.length || shortlist) await recordSensitiveAccess(ctx, { kind: "CANDIDATE_ASSESSMENT", entity: "Candidate", ref: candidateId });
  return { criteria, answers, shortlist };
}
