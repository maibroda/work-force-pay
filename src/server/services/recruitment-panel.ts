/**
 * Interview panels, scorecards and the comparison page (recruitment slice A, approved by the founder on 2026-11-16).
 *
 * ADVICE ONLY: nothing here ranks, orders by score, filters or rejects a candidate. People decide; the page shows them what the panel said and the basis of every figure.
 *
 * Who may do what:
 *  - HR (recruitment.assess, the HR administrator alone) sets a requisition's three to six criteria and an interview's panel, may close a panel's scoring, and reads everything.
 *  - A panel member (an employee with a login, named on the panel) scores through their SEAT: they open only their own interviews, and cannot read another member's scorecard
 *    until the panel is closed (blind scoring). The chair may close it, and recommends the candidate's selection afterwards.
 *  - Closing happens when the last member has submitted, or when the chair or HR closes it (at least one scorecard needed). A closed panel's scorecards cannot change.
 *  - A selection is recommended by the chair and approved or declined by someone else holding hr.approve (never the chair); an offer for a candidate a panel interviewed needs the
 *    approved selection (see createOffer in recruitment.ts).
 *
 * The audit log carries ids and counts, never a comment and never a score or recommendation while the panel is open (so the log cannot break the blindness).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { canCtx } from "@/lib/hr-functions";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { recordSensitiveAccess } from "./sensitive-access";

export const MIN_CRITERIA = 3;
export const MAX_CRITERIA = 6;
export const MIN_PANEL = 2;
export const MAX_PANEL = 5;
const RECOMMENDATIONS = ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"] as const;
type Recommendation = (typeof RECOMMENDATIONS)[number];

export const PANEL_NOTE = "Scores are advice for the people deciding. They never order, filter or reject a candidate; the figures below each come with the scores they are made from.";

const NOT_ON_PANEL = "You are not on this panel.";

async function loadRequisition(ctx: Ctx, id: string) {
  const r = await db.jobRequisition.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Requisition not found.");
  return r;
}

async function loadInterview(ctx: Ctx, id: string) {
  const iv = await db.interview.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { candidate: { include: { requisition: true } }, panelMembers: { include: { employee: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!iv) throw new BusinessError("Interview not found.");
  return iv;
}

/** The average of whole scores to one decimal, half up, in integers (no floating point). */
const average = (scores: number[]) => Math.floor((scores.reduce((a, b) => a + b, 0) * 20 + scores.length) / (2 * scores.length)) / 10;

// ───────────────────────────── Criteria ─────────────────────────────

/** HR sets (or replaces) a requisition's scoring criteria: three to six, named, all different. Not after the first scorecard has been submitted. */
export async function setCriteria(ctx: Ctx, requisitionId: string, names: string[]) {
  assertCan(ctx, "recruitment.assess");
  const req = await loadRequisition(ctx, requisitionId);
  const clean = names.map((n) => (n ?? "").trim());
  if (clean.length < MIN_CRITERIA || clean.length > MAX_CRITERIA) throw new BusinessError(`Set three to six criteria (you gave ${clean.length}).`);
  if (clean.some((n) => n.length < 3 || n.length > 80)) throw new BusinessError("Name each criterion in 3 to 80 characters.");
  if (new Set(clean.map((n) => n.toLowerCase())).size !== clean.length) throw new BusinessError("Each criterion must be different.");
  const submitted = await db.interviewPanelMember.count({ where: { organizationId: ctx.orgId, submittedAt: { not: null }, interview: { candidate: { requisitionId: req.id } } } });
  if (submitted) throw new BusinessError("Criteria can't change once a scorecard has been submitted.");
  await db.$transaction(async (tx) => {
    await tx.requisitionCriterion.deleteMany({ where: { requisitionId: req.id } });
    await tx.requisitionCriterion.createMany({ data: clean.map((name, i) => ({ organizationId: ctx.orgId, requisitionId: req.id, position: i + 1, name })) });
    await logAudit(ctx, { action: "CRITERIA_SET", entity: "JobRequisition", entityId: req.id, newValue: { count: clean.length } }, tx);
  });
  return listCriteria(ctx, requisitionId);
}

export async function listCriteria(ctx: Ctx, requisitionId: string) {
  assertCan(ctx, "recruitment.assess");
  const req = await loadRequisition(ctx, requisitionId);
  return db.requisitionCriterion.findMany({ where: { requisitionId: req.id }, orderBy: { position: "asc" }, select: { id: true, position: true, name: true } });
}

// ───────────────────────────── The panel ─────────────────────────────

const panelSchema = z.object({ chairEmployeeId: z.string().min(1), memberEmployeeIds: z.array(z.string().min(1)) });

/** HR names an interview's panel: the chair and one to four others, all employees of this company with a login, and nobody twice. Not once a scorecard is in. */
export async function setPanel(ctx: Ctx, interviewId: string, raw: z.input<typeof panelSchema>) {
  assertCan(ctx, "recruitment.assess");
  const v = panelSchema.parse(raw);
  const iv = await loadInterview(ctx, interviewId);
  const ids = [v.chairEmployeeId, ...v.memberEmployeeIds];
  if (new Set(ids).size !== ids.length) throw new BusinessError("A person can sit on a panel only once.");
  if (ids.length < MIN_PANEL || ids.length > MAX_PANEL) throw new BusinessError(`A panel has two to five people, one of them the chair (you named ${ids.length}).`);
  if (iv.panelClosedAt || iv.panelMembers.some((m) => m.submittedAt)) throw new BusinessError("A scorecard has already been submitted, so the panel can't change.");
  if (iv.completedAt && !iv.panelMembers.length) throw new BusinessError("Feedback has already been recorded for this interview, so it can't be given a panel.");
  const criteria = await db.requisitionCriterion.count({ where: { requisitionId: iv.candidate.requisitionId } });
  if (criteria < MIN_CRITERIA) throw new BusinessError("Set the requisition's scoring criteria first.");
  const people = await db.employee.findMany({ where: { id: { in: ids }, organizationId: ctx.orgId }, select: { id: true, firstName: true, lastName: true, status: true } });
  if (people.length !== ids.length) throw new BusinessError("Employee not found.");
  const logins = await db.user.findMany({ where: { organizationId: ctx.orgId, employeeId: { in: ids } }, select: { employeeId: true } });
  const withLogin = new Set(logins.map((u) => u.employeeId));
  for (const p of people) {
    if (["EXITED", "TERMINATED", "RESIGNED"].includes(p.status)) throw new BusinessError(`${p.firstName} ${p.lastName} is no longer employed here.`);
    if (!withLogin.has(p.id)) throw new BusinessError(`${p.firstName} ${p.lastName} has no login, so can't sit on a panel.`);
  }
  await db.$transaction(async (tx) => {
    await tx.interviewPanelMember.deleteMany({ where: { interviewId: iv.id } });
    await tx.interviewPanelMember.createMany({ data: ids.map((employeeId, i) => ({ organizationId: ctx.orgId, interviewId: iv.id, employeeId, isChair: i === 0 })) });
    await logAudit(ctx, { action: "PANEL_SET", entity: "Candidate", entityId: iv.candidateId, newValue: { interviewId: iv.id, size: ids.length } }, tx);
  });
}

// ───────────────────────────── A member's seat ─────────────────────────────

/** The interviews this person sits on, and nothing else. */
export async function mySeats(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const seats = await db.interviewPanelMember.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId },
    include: { interview: { include: { candidate: { select: { firstName: true, lastName: true, requisition: { select: { title: true } } } } } } },
    orderBy: { interview: { scheduledAt: "desc" } },
  });
  return seats.map((s) => ({
    interviewId: s.interviewId,
    round: s.interview.round,
    scheduledAt: s.interview.scheduledAt,
    candidateName: `${s.interview.candidate.firstName} ${s.interview.candidate.lastName}`,
    jobTitle: s.interview.candidate.requisition.title,
    closed: s.interview.panelClosedAt !== null,
    submitted: s.submittedAt !== null,
  }));
}

async function mySeat(ctx: Ctx, interviewId: string) {
  const iv = await db.interview.findFirst({ where: { id: interviewId, organizationId: ctx.orgId } });
  const seat = iv && ctx.employeeId ? await db.interviewPanelMember.findFirst({ where: { interviewId, employeeId: ctx.employeeId, organizationId: ctx.orgId } }) : null;
  if (!iv || !seat) throw new BusinessError(NOT_ON_PANEL);
  return { iv, seat };
}

function shapeCard(m: { isChair: boolean; recommendation: Recommendation | null; comment: string | null; employee: { firstName: string; lastName: string }; scores: Array<{ criterionId: string; score: number; comment: string | null }> }) {
  return {
    member: `${m.employee.firstName} ${m.employee.lastName}`,
    isChair: m.isChair,
    recommendation: m.recommendation as Recommendation,
    scores: m.scores.map((s) => ({ criterionId: s.criterionId, score: s.score, comment: s.comment })),
    comment: m.comment,
  };
}

/** The scorecard form for one of my interviews: the criteria, my own scores, and the others' only once the panel is closed. */
export async function getMyScorecard(ctx: Ctx, interviewId: string) {
  const { iv, seat } = await mySeat(ctx, interviewId);
  const full = await loadInterview(ctx, iv.id);
  const criteria = await db.requisitionCriterion.findMany({ where: { requisitionId: full.candidate.requisitionId }, orderBy: { position: "asc" }, select: { id: true, position: true, name: true } });
  const mine = await db.interviewPanelMember.findUniqueOrThrow({ where: { id: seat.id }, include: { scores: true, employee: { select: { firstName: true, lastName: true } } } });
  const closed = full.panelClosedAt !== null;
  let others: Array<ReturnType<typeof shapeCard>> | null = null;
  if (closed) {
    const rows = await db.interviewPanelMember.findMany({
      where: { interviewId: iv.id, id: { not: seat.id }, submittedAt: { not: null } },
      include: { scores: true, employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    });
    others = rows.map(shapeCard);
  }
  return {
    interview: { id: full.id, candidateId: full.candidateId, requisitionId: full.candidate.requisitionId, round: full.round, scheduledAt: full.scheduledAt, candidateName: `${full.candidate.firstName} ${full.candidate.lastName}`, jobTitle: full.candidate.requisition.title },
    criteria,
    mine: mine.submittedAt ? shapeCard(mine) : null,
    submitted: mine.submittedAt !== null,
    isChair: mine.isChair,
    closed,
    others,
  };
}

const cardSchema = z.object({
  scores: z.array(z.object({ criterionId: z.string().min(1), score: z.number(), comment: z.string().trim().max(300).optional() })),
  recommendation: z.enum(RECOMMENDATIONS, { message: "Give your recommendation." }),
  comment: z.string().trim().max(1000).optional(),
});

/** A member's scorecard: a score from 1 to 5 on every criterion and a recommendation. It can be corrected until the panel closes; the last submission closes the panel. */
export async function submitScorecard(ctx: Ctx, interviewId: string, raw: z.input<typeof cardSchema>) {
  const { seat } = await mySeat(ctx, interviewId);
  const v = cardSchema.parse(raw);
  await db.$transaction(async (tx) => {
    // one at a time per interview, so two last submissions cannot each think the other is still missing
    await tx.$queryRaw`SELECT id FROM "Interview" WHERE id = ${interviewId} FOR UPDATE`;
    const iv = await tx.interview.findUniqueOrThrow({ where: { id: interviewId }, include: { candidate: true } });
    if (iv.panelClosedAt) throw new BusinessError("This panel is closed, so scorecards can't change.");
    const criteria = await tx.requisitionCriterion.findMany({ where: { requisitionId: iv.candidate.requisitionId } });
    const known = new Set(criteria.map((c) => c.id));
    if (v.scores.some((s) => !known.has(s.criterionId))) throw new BusinessError("That criterion isn't part of this requisition.");
    const given = new Set(v.scores.map((s) => s.criterionId));
    if (given.size !== v.scores.length || given.size !== criteria.length) throw new BusinessError("Score every criterion, once each.");
    if (v.scores.some((s) => !Number.isInteger(s.score) || s.score < 1 || s.score > 5)) throw new BusinessError("Score each criterion from 1 to 5, in whole numbers.");
    await tx.scorecardScore.deleteMany({ where: { panelMemberId: seat.id } });
    await tx.scorecardScore.createMany({ data: v.scores.map((s) => ({ organizationId: ctx.orgId, panelMemberId: seat.id, criterionId: s.criterionId, score: s.score, comment: s.comment || null })) });
    await tx.interviewPanelMember.update({ where: { id: seat.id }, data: { submittedAt: new Date(), recommendation: v.recommendation, comment: v.comment || null } });
    // ids and a count only: no score, recommendation or comment, so the log cannot be read to see a colleague's scorecard before the panel closes
    await logAudit(ctx, { action: "SCORECARD_SUBMIT", entity: "Candidate", entityId: iv.candidateId, newValue: { interviewId, criteria: v.scores.length } }, tx);
    const waiting = await tx.interviewPanelMember.count({ where: { interviewId, submittedAt: null } });
    if (waiting === 0) await closeInTx(tx, ctx, iv, "all members submitted");
  });
}

async function closeInTx(tx: Tx, ctx: Ctx, iv: { id: string; candidateId: string; completedAt: Date | null }, by: string) {
  const members = await tx.interviewPanelMember.findMany({ where: { interviewId: iv.id }, select: { submittedAt: true } });
  await tx.interview.update({ where: { id: iv.id }, data: { panelClosedAt: new Date(), panelClosedBy: by, ...(iv.completedAt ? {} : { completedAt: new Date() }) } });
  await logAudit(ctx, { action: "PANEL_CLOSE", entity: "Candidate", entityId: iv.candidateId, newValue: { interviewId: iv.id, panelSize: members.length, submitted: members.filter((m) => m.submittedAt).length, closedBy: by } }, tx);
}

/** The chair or HR closes the scoring before everyone has submitted (at least one scorecard is needed). It also completes the interview, as recording feedback did. */
export async function closePanel(ctx: Ctx, interviewId: string) {
  const iv = await loadInterview(ctx, interviewId);
  if (!iv.panelMembers.length) throw new BusinessError("This interview has no panel.");
  const isHr = canCtx(ctx, "recruitment.assess");
  if (!isHr) {
    const seat = ctx.employeeId ? iv.panelMembers.find((m) => m.employeeId === ctx.employeeId) : undefined;
    if (!seat) throw new BusinessError("You don't have permission to close this panel.");
    if (!seat.isChair) throw new BusinessError("Only the chair can close the panel.");
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Interview" WHERE id = ${interviewId} FOR UPDATE`;
    const now = await tx.interview.findUniqueOrThrow({ where: { id: interviewId } });
    if (now.panelClosedAt) throw new BusinessError("This panel is already closed.");
    const submitted = await tx.interviewPanelMember.count({ where: { interviewId, submittedAt: { not: null } } });
    if (!submitted) throw new BusinessError("At least one scorecard is needed before the panel can be closed.");
    await closeInTx(tx, ctx, now, isHr ? "HR" : "the chair");
  });
}

// ───────────────────────────── The comparison ─────────────────────────────

type CardRow = ReturnType<typeof shapeCard>;

/**
 * Candidates for one requisition, side by side, in the order of their candidate numbers (never by score). For each panelled interview: while it is open, only how many members have
 * submitted; once closed, every scorecard and the spread (lowest, highest, average and count) per criterion, with the recommendations counted. HR reads the whole requisition; a panel
 * member reads only the closed interviews they sat on.
 */
export async function comparison(ctx: Ctx, requisitionId: string) {
  const req = await loadRequisition(ctx, requisitionId);
  const isHr = canCtx(ctx, "recruitment.assess");
  const mySeatIds = ctx.employeeId
    ? new Set((await db.interviewPanelMember.findMany({ where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, interview: { candidate: { requisitionId: req.id } } }, select: { interviewId: true } })).map((m) => m.interviewId))
    : new Set<string>();
  if (!isHr && mySeatIds.size === 0) throw new BusinessError("You don't have permission to compare these candidates.");
  const criteria = await db.requisitionCriterion.findMany({ where: { requisitionId: req.id }, orderBy: { position: "asc" }, select: { id: true, name: true } });
  const candidates = await db.candidate.findMany({
    where: { requisitionId: req.id, organizationId: ctx.orgId },
    orderBy: { candidateNumber: "asc" },
    include: {
      interviews: {
        orderBy: { round: "asc" },
        include: { panelMembers: { orderBy: { createdAt: "asc" }, include: { scores: true, employee: { select: { firstName: true, lastName: true } } } } },
      },
    },
  });
  const rows = candidates
    .map((c) => {
      const interviews = c.interviews
        .filter((iv) => iv.panelMembers.length > 0)
        .filter((iv) => isHr || (mySeatIds.has(iv.id) && iv.panelClosedAt !== null))
        .map((iv) => {
          const closed = iv.panelClosedAt !== null;
          const submitted = iv.panelMembers.filter((m) => m.submittedAt);
          let scorecards: CardRow[] | null = null;
          let spread: { criteria: Array<{ criterionId: string; name: string; min: number; max: number; average: number; count: number }>; recommendations: Record<string, number> } | null = null;
          if (closed) {
            scorecards = submitted.map(shapeCard);
            spread = {
              criteria: criteria.map((cr) => {
                const s = submitted.flatMap((m) => m.scores.filter((x) => x.criterionId === cr.id).map((x) => x.score));
                return { criterionId: cr.id, name: cr.name, min: s.length ? Math.min(...s) : 0, max: s.length ? Math.max(...s) : 0, average: s.length ? average(s) : 0, count: s.length };
              }),
              recommendations: submitted.reduce<Record<string, number>>((a, m) => ({ ...a, [m.recommendation!]: (a[m.recommendation!] ?? 0) + 1 }), {}),
            };
          }
          return { interviewId: iv.id, round: iv.round, closed, panelSize: iv.panelMembers.length, submitted: submitted.length, scorecards, spread };
        });
      return { candidateId: c.id, candidateNumber: c.candidateNumber, name: `${c.firstName} ${c.lastName}`, stage: c.stage, interviews };
    })
    // a panel member sees only the candidates they interviewed; HR sees every candidate, including those with no panel
    .filter((c) => isHr || c.interviews.length > 0);
  if (isHr) await recordSensitiveAccess(ctx, { kind: "CANDIDATE_ASSESSMENT", entity: "JobRequisition", ref: req.id, count: rows.length });
  return { requisitionId: req.id, criteria, candidates: rows, note: PANEL_NOTE };
}

// ───────────────────────────── Selection ─────────────────────────────

/** The chair of a closed panel recommends selecting the candidate, with a reason. A second person decides (decideSelection). */
export async function recommendSelection(ctx: Ctx, candidateId: string, note: string) {
  const c = await db.candidate.findFirst({ where: { id: candidateId, organizationId: ctx.orgId } });
  if (!c) throw new BusinessError("Candidate not found.");
  const seats = ctx.employeeId
    ? await db.interviewPanelMember.findMany({ where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, isChair: true, interview: { candidateId } }, include: { interview: true } })
    : [];
  if (!seats.length) throw new BusinessError("Only the chair of the panel that interviewed this candidate can recommend a selection.");
  if (!seats.some((s) => s.interview.panelClosedAt)) throw new BusinessError("The panel must be closed before a selection can be recommended.");
  const reason = (note ?? "").trim();
  if (reason.length < 10) throw new BusinessError("Give a reason for the recommendation (at least 10 characters).");
  if (!["INTERVIEW", "ASSESSMENT", "OFFER"].includes(c.stage)) throw new BusinessError("This candidate is no longer in the interview stages.");
  const existing = await db.candidateSelection.findUnique({ where: { candidateId } });
  if (existing && existing.status !== "REJECTED") throw new BusinessError("A selection is already recommended for this candidate.");
  await db.$transaction(async (tx) => {
    const data = { status: "PENDING" as const, recommendedById: ctx.userId, recommendedBy: ctx.name, recommendedAt: new Date(), note: reason, decidedById: null, decidedBy: null, decidedAt: null, decisionNote: null };
    if (existing) await tx.candidateSelection.update({ where: { candidateId }, data });
    else await tx.candidateSelection.create({ data: { organizationId: ctx.orgId, candidateId, ...data } });
    await logAudit(ctx, { action: "SELECTION_RECOMMEND", entity: "Candidate", entityId: candidateId, newValue: { status: "PENDING" } }, tx);
  });
}

/** Approves or declines a recommended selection: someone holding the approval right who is not the chair who recommended it. */
export async function decideSelection(ctx: Ctx, candidateId: string, decision: "APPROVED" | "REJECTED", note?: string) {
  assertCan(ctx, "hr.approve");
  const sel = await db.candidateSelection.findFirst({ where: { candidateId, organizationId: ctx.orgId } });
  if (!sel) throw new BusinessError("No selection has been recommended for this candidate (or it was not found).");
  if (sel.status !== "PENDING") throw new BusinessError(`This selection has already been ${sel.status.toLowerCase()}.`);
  if (sel.recommendedById === ctx.userId) throw new BusinessError("You recommended this selection, so someone else must decide it.");
  const why = (note ?? "").trim();
  if (decision === "REJECTED" && why.length < 5) throw new BusinessError("Give a reason for declining.");
  await db.$transaction(async (tx) => {
    await tx.candidateSelection.update({ where: { candidateId }, data: { status: decision, decidedById: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), decisionNote: why || null } });
    await logAudit(ctx, { action: "SELECTION_DECIDE", entity: "Candidate", entityId: candidateId, newValue: { status: decision } }, tx);
  });
}

export async function getSelection(ctx: Ctx, candidateId: string) {
  const sel = await db.candidateSelection.findFirst({ where: { candidateId, organizationId: ctx.orgId } });
  if (!sel) return null;
  const mayRead = canCtx(ctx, "recruitment.assess") || canCtx(ctx, "hr.approve") || sel.recommendedById === ctx.userId;
  return mayRead ? sel : null;
}

// ───────────────────────────── For the screens ─────────────────────────────

/** The employees who could sit on a panel: still employed, with a login. HR (recruitment.assess) only. */
export async function eligiblePanelists(ctx: Ctx) {
  assertCan(ctx, "recruitment.assess");
  const users = await db.user.findMany({ where: { organizationId: ctx.orgId, employeeId: { not: null } }, select: { employeeId: true } });
  const ids = [...new Set(users.map((u) => u.employeeId!))];
  const people = await db.employee.findMany({
    where: { id: { in: ids }, organizationId: ctx.orgId, status: { notIn: ["EXITED", "TERMINATED", "RESIGNED"] } },
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
    orderBy: { employeeNumber: "asc" },
  });
  return people.map((p) => ({ employeeId: p.id, label: `${p.employeeNumber} ${p.firstName} ${p.lastName}` }));
}

/** One candidate's panels and selection, for HR's candidate page: who sits on each interview, who has submitted (never a score), whether it is closed, and the selection's state. */
export async function panelOverview(ctx: Ctx, candidateId: string) {
  assertCan(ctx, "recruitment.assess");
  const c = await db.candidate.findFirst({ where: { id: candidateId, organizationId: ctx.orgId }, select: { id: true } });
  if (!c) throw new BusinessError("Candidate not found.");
  const interviews = await db.interview.findMany({
    where: { candidateId, organizationId: ctx.orgId },
    orderBy: { round: "asc" },
    select: {
      id: true,
      round: true,
      completedAt: true,
      panelClosedAt: true,
      panelMembers: { orderBy: { createdAt: "asc" }, select: { isChair: true, submittedAt: true, employee: { select: { firstName: true, lastName: true } } } },
    },
  });
  const selection = await db.candidateSelection.findUnique({ where: { candidateId } });
  return {
    interviews: interviews.map((iv) => ({
      interviewId: iv.id,
      round: iv.round,
      completed: iv.completedAt !== null,
      closed: iv.panelClosedAt !== null,
      members: iv.panelMembers.map((m) => ({ name: `${m.employee.firstName} ${m.employee.lastName}`, isChair: m.isChair, submitted: m.submittedAt !== null })),
    })),
    selection: selection
      ? { status: selection.status, recommendedBy: selection.recommendedBy, recommendedById: selection.recommendedById, note: selection.note, decidedBy: selection.decidedBy, decisionNote: selection.decisionNote }
      : null,
  };
}

/** Whether a panel member (this person) is the chair of a closed panel for this candidate, and whether a selection already exists: what the scorecard page needs to offer the recommendation. */
export async function myChairing(ctx: Ctx, candidateId: string) {
  if (!ctx.employeeId) return { chair: false, closed: false, selection: null as null | { status: string } };
  const seats = await db.interviewPanelMember.findMany({ where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, isChair: true, interview: { candidateId } }, include: { interview: { select: { panelClosedAt: true } } } });
  const selection = seats.length ? await db.candidateSelection.findUnique({ where: { candidateId }, select: { status: true } }) : null;
  return { chair: seats.length > 0, closed: seats.some((s) => s.interview.panelClosedAt !== null), selection };
}
