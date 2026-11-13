/**
 * The words of one kind of record, cleared (governance step 3b-2). The SAME field lists the erasure of a former employee uses (employee-retention.ts calls these for the kinds of record that
 * have a retention run), so a run and an erasure can never disagree about what counts as "the words". What stays is the shape: that a record existed, its kind, dates and outcome.
 *
 * Each function runs inside the caller's transaction and returns how many rows of each kind it touched (counts only). Nothing here decides WHEN anything may be cleared: that is the run
 * (retention-run.ts), with its second person, its legal-hold check and its audit.
 */
import { stripProbationNotes, type RunnableCategory } from "@/lib/retention-run";
import type { Tx } from "./_base";

export const REMOVED = "[removed]";

/** Who or what to clear: every record of the kind for these people, or (for a welfare case or a succession entry counted per record) these records. */
export interface Target {
  employeeIds?: string[];
  recordIds?: string[];
}
type Counts = Record<string, number>;
type Anonymiser = (tx: Tx, orgId: string, t: Target) => Promise<Counts>;

const people = (orgId: string, t: Target) => ({ organizationId: orgId, employeeId: { in: t.employeeIds ?? [] } });

export const ANONYMISERS: Record<RunnableCategory, Anonymiser> = {
  async APPRAISALS(tx, orgId, t) {
    const where = people(orgId, t);
    const appraisals = await tx.appraisal.findMany({ where, select: { id: true } });
    const counts: Counts = {};
    counts.appraisals = (
      await tx.appraisal.updateMany({ where, data: { employeeSelfComment: null, strengths: null, improvements: null, goals: null, reviewerComment: null, returnNote: null, approvalNote: null, employeeResponse: null } })
    ).count;
    if (appraisals.length) await tx.appraisalRating.updateMany({ where: { appraisalId: { in: appraisals.map((a) => a.id) } }, data: { selfComment: null, comment: null } });
    return counts;
  },

  async PROBATION(tx, orgId, t) {
    const where = people(orgId, t);
    const counts: Counts = {};
    // probation decisions: the reasons go (on each decision, and the same words written into the contract's notes); what stays is the shape (the decision, its dates and who decided)
    counts.probationDecisions = (await tx.probationDecision.updateMany({ where, data: { note: REMOVED } })).count;
    // the probation workflow: the words go (the manager's reasons, HR's note, the feedback and the response); what stays is the shape (the step, the recommendation, who and when, whether they agreed)
    counts.probationReviews = (await tx.probationReview.updateMany({ where, data: { recommendationNote: REMOVED, reviewNote: null, feedbackText: null, responseText: null } })).count;
    // the contract's own notes hold other text too, so only the lines the probation steps wrote ("Probation failed: ...") go; the whole-person erasure clears every note
    const contracts = await tx.employmentContract.findMany({ where, select: { id: true, notes: true } });
    let changed = 0;
    for (const c of contracts) {
      const next = stripProbationNotes(c.notes);
      if (next !== c.notes) {
        await tx.employmentContract.update({ where: { id: c.id }, data: { notes: next } });
        changed++;
      }
    }
    counts.contractNotes = changed;
    return counts;
  },

  // feedback about them: the words go (the note, their reply and the reason an entry was voided); what stays is the shape (that an entry existed, its kind and date)
  async FEEDBACK(tx, orgId, t) {
    return { feedback: (await tx.performanceFeedback.updateMany({ where: people(orgId, t), data: { body: REMOVED, employeeReply: null, voidReason: null } })).count };
  },

  // performance improvement plans: the words go (concerns, objectives, review summaries, notes, the employee's own response and comments); what stays is the shape (that a plan existed, its dates and how it ended)
  async IMPROVEMENT_PLANS(tx, orgId, t) {
    const where = people(orgId, t);
    const plans = await tx.performanceImprovementPlan.findMany({ where, select: { id: true } });
    const planIds = plans.map((p) => p.id);
    const counts: Counts = {};
    counts.improvementPlans = (
      await tx.performanceImprovementPlan.updateMany({
        where,
        data: { concerns: REMOVED, activationNote: null, returnNote: null, proposedNote: null, outcomeNote: null, withdrawReason: null, employeeResponse: null },
      })
    ).count;
    if (planIds.length) {
      await tx.pipObjective.updateMany({ where: { planId: { in: planIds } }, data: { gap: REMOVED, target: REMOVED, support: null } });
      await tx.pipReview.updateMany({ where: { planId: { in: planIds } }, data: { summary: REMOVED, employeeComment: null } });
      await tx.pipReviewAssessment.updateMany({ where: { review: { planId: { in: planIds } } }, data: { note: null } });
    }
    return counts;
  },

  async DISCIPLINARY(tx, orgId, t) {
    return { disciplinary: (await tx.disciplinaryRecord.updateMany({ where: people(orgId, t), data: { description: REMOVED, actionTaken: null, remarks: null, approvedSingleReason: null } })).count };
  },

  // training: the words go (why someone did not attend, a need's note and the reason it was dropped, the evaluation's comment, a request's reasons); what stays is the shape (that they were enrolled, the result, the course, the ratings and the dates)
  async TRAINING(tx, orgId, t) {
    const where = people(orgId, t);
    const counts: Counts = {};
    counts.trainingEnrolments = (await tx.trainingEnrolment.updateMany({ where, data: { absenceReason: null } })).count;
    counts.trainingNeeds = (await tx.trainingNeed.updateMany({ where, data: { note: null, droppedReason: null } })).count;
    counts.trainingEvaluations = (await tx.trainingEvaluation.updateMany({ where: { organizationId: orgId, enrolment: { employeeId: { in: t.employeeIds ?? [] } } }, data: { comment: null } })).count;
    counts.trainingRequests = (await tx.trainingRequest.updateMany({ where, data: { reason: REMOVED, decisionNote: null, withdrawReason: null } })).count;
    return counts;
  },

  // skill assessments: the comments go; the skill, the level, who assessed and when stay (the shape)
  async SKILLS(tx, orgId, t) {
    return { skillAssessments: (await tx.skillAssessment.updateMany({ where: people(orgId, t), data: { comment: null } })).count };
  },

  // welfare cases (the always-confidential kind): the words go (the summary, the description, the resolution and every note); what stays is the shape (that a case existed, its kind, dates and outcome)
  async WELFARE_CASES(tx, orgId, t) {
    const where = t.recordIds ? { organizationId: orgId, id: { in: t.recordIds }, type: "WELFARE" as const } : { ...people(orgId, t), type: "WELFARE" as const };
    const cases = await tx.relationsCase.findMany({ where, select: { id: true } });
    const caseIds = cases.map((c) => c.id);
    const counts: Counts = {};
    counts.welfareCases = (await tx.relationsCase.updateMany({ where, data: { summary: REMOVED, description: REMOVED, resolution: null, closedSingleReason: null } })).count;
    counts.caseNotes = caseIds.length ? (await tx.relationsCaseNote.updateMany({ where: { caseId: { in: caseIds } }, data: { note: REMOVED } })).count : 0;
    return counts;
  },

  // succession: the one-line reason goes, the entry stays
  async SUCCESSION(tx, orgId, t) {
    const where = t.recordIds ? { organizationId: orgId, id: { in: t.recordIds } } : people(orgId, t);
    return { successionEntries: (await tx.successionCandidate.updateMany({ where, data: { reason: null, singleReason: null } })).count };
  },
};
