"use server";
import { act, s } from "./_run";
import * as policy from "@/server/services/hr-policy";
import * as contracts from "@/server/services/contracts";
import * as recruit from "@/server/services/recruitment";
import * as rel from "@/server/services/relations";
import * as hr from "@/server/services/hr";
import * as eos from "@/server/services/settlements";
import * as reminders from "@/server/services/reminders";
import * as retention from "@/server/services/retention";

type V = Record<string, unknown>;
const HR = ["/hr", "/employees", "/me"];
const SETTLE = ["/hr", "/employees", "/payroll/settlements"];
const EXIT_TYPES = ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "ABSCONDMENT", "DECEASED"];

const pickExitTypes = (v: V, prefix: string) => EXIT_TYPES.filter((t) => v[`${prefix}_${t}`] === true);
const zeroIsNone = (n: unknown) => (n === undefined ? undefined : Number(n) === 0 ? null : Number(n));

// ───────────────────────────── Policy & templates ─────────────────────────────

/** Each settings form saves its own section; blank numeric fields leave a value unchanged. */
export async function updateHrPolicyAction(section: "terms" | "leave" | "gratuity" | "severance" | "loans" | "reminders" | "retention" | "records" | "appraisal", v: V) {
  return act(
    "hr.configure",
    async (ctx) => {
      let patch: V = {};
      if (section === "terms") patch = v;
      if (section === "leave")
        patch = {
          leaveEncashmentEnabled: v.leaveEncashmentEnabled,
          leaveEncashmentBasis: v.leaveEncashmentBasis,
          leaveEncashmentRespectsEligibility: v.leaveEncashmentRespectsEligibility,
          leaveEncashmentMaxDays: zeroIsNone(v.leaveEncashmentMaxDays),
          leaveEncashmentTaxable: v.leaveEncashmentTaxable,
          leaveEncashmentExitTypes: pickExitTypes(v, "leaveExit"),
        };
      if (section === "gratuity")
        patch = {
          gratuityEnabled: v.gratuityEnabled,
          gratuityBasis: v.gratuityBasis,
          gratuityMinYears: v.gratuityMinYears,
          gratuityDaysPerYear: v.gratuityDaysPerYear,
          gratuityPartialYears: v.gratuityPartialYears,
          gratuityTaxable: v.gratuityTaxable,
          gratuityExitTypes: pickExitTypes(v, "gratuityExit"),
        };
      if (section === "reminders")
        patch = {
          reminderEmailsEnabled: v.reminderEmailsEnabled,
          // blank clears the list; otherwise split on commas, semicolons, spaces or new lines
          reminderExtraEmails: String(v.extraEmails ?? "")
            .split(/[\s,;]+/)
            .filter(Boolean),
        };
      if (section === "appraisal")
        patch = {
          appraisalSelfAssessment: v.appraisalSelfAssessment,
          appraisalCommentAtOrBelow: v.appraisalCommentAtOrBelow,
          appraisalCommentAtOrAbove: v.appraisalCommentAtOrAbove,
          appraisalMinServiceDays: v.appraisalMinServiceDays,
        };
      if (section === "records")
        patch = {
          nextOfKinRequired: v.nextOfKinRequired,
          emergencyContactsRequired: v.emergencyContactsRequired,
          guarantorsRequired: v.guarantorsRequired,
          guarantorMaxPerPerson: v.guarantorMaxPerPerson,
          guarantorSeparateVerifier: v.guarantorSeparateVerifier,
          // one tick box per category; none ticked = guarantors needed for everyone
          guarantorCategoryIds: Object.keys(v).filter((k) => k.startsWith("gcat_") && v[k] === true).map((k) => k.slice(5)),
        };
      if (section === "retention") patch = { candidateRetentionMonths: v.candidateRetentionMonths };
      if (section === "loans")
        patch = {
          loanMaxGrossMultiple: v.loanMaxGrossMultiple,
          loanMaxDeductionPct: v.loanMaxDeductionPct,
          advanceMaxGrossPct: v.advanceMaxGrossPct,
        };
      if (section === "severance")
        patch = {
          severanceEnabled: v.severanceEnabled,
          severanceDaysPerYear: v.severanceDaysPerYear,
          severanceTaxable: v.severanceTaxable,
          noticePayEnabled: v.noticePayEnabled,
          noticeRecoveryEnabled: v.noticeRecoveryEnabled,
          noticePayTaxable: v.noticePayTaxable,
        };
      await policy.updateHrPolicy(ctx, Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)) as never);
      return { message: "HR policy saved." };
    },
    ["/settings", "/hr", "/payroll/settlements"],
  );
}

export async function addTemplateItemAction(v: V) {
  return act("hr.configure", async (ctx) => {
    await policy.addTemplateItem(ctx, v as never);
    return { message: "Checklist step added." };
  }, ["/settings"]);
}
export async function updateTemplateItemAction(id: string, v: V) {
  return act("hr.configure", async (ctx) => {
    await policy.updateTemplateItem(ctx, id, v as never);
    return { message: "Checklist step updated." };
  }, ["/settings"]);
}
export async function toggleTemplateItemAction(id: string, active: boolean) {
  return act("hr.configure", async (ctx) => {
    await policy.updateTemplateItem(ctx, id, { active });
    return { message: active ? "Step switched on." : "Step switched off — new hires/exits won't get it." };
  }, ["/settings"]);
}
export async function deleteTemplateItemAction(id: string) {
  return act("hr.configure", async (ctx) => {
    await policy.deleteTemplateItem(ctx, id);
    return { message: "Checklist step removed." };
  }, ["/settings"]);
}

// ───────────────────────────── Contracts ─────────────────────────────

export async function createContractAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const c = await contracts.createContract(ctx, v as never);
    return { message: `Contract ${c.contractNumber} recorded.`, redirectTo: `/hr/contracts/${c.id}` };
  }, HR);
}
export async function renewContractAction(id: string, v: V) {
  return act("hr.manage", async (ctx) => {
    const c = await contracts.renewContract(ctx, id, v as never);
    return { message: `Renewed as ${c.contractNumber}.`, redirectTo: `/hr/contracts/${c.id}` };
  }, HR);
}
export async function decideProbationAction(id: string, v: V) {
  return act("hr.approve", async (ctx) => {
    const r = await contracts.decideProbation(ctx, id, v as never);
    return {
      message:
        v.decision === "CONFIRMED"
          ? r.next
            ? `Probation confirmed — permanent contract ${r.next.contractNumber} created.`
            : "Probation confirmed."
          : v.decision === "EXTENDED"
            ? "Probation extended."
            : "Probation marked as failed — initiate an exit if employment should end.",
    };
  }, HR);
}
export async function processExpiredContractsAction() {
  return act("hr.manage", async (ctx) => {
    const n = await contracts.processExpiredContracts(ctx);
    return { message: n ? `${n} contract(s) marked expired.` : "No contracts had passed their end date." };
  }, HR);
}

// ───────────────────────────── Recruitment ─────────────────────────────

export async function createRequisitionAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const r = await recruit.createRequisition(ctx, v as never);
    return { message: `${r.requisitionNumber} raised — awaiting approval.`, redirectTo: `/hr/requisitions/${r.id}` };
  }, HR);
}
export async function approveRequisitionAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await recruit.approveRequisition(ctx, id, note);
    return { message: "Requisition approved — candidates can now be added." };
  }, HR);
}
export async function rejectRequisitionAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await recruit.rejectRequisition(ctx, id, note ?? "");
    return { message: "Requisition rejected." };
  }, HR);
}
export async function holdRequisitionAction(id: string, hold: boolean) {
  return act("hr.manage", async (ctx) => {
    await recruit.setRequisitionHold(ctx, id, hold);
    return { message: hold ? "Requisition put on hold." : "Requisition re-opened." };
  }, HR);
}
export async function closeRequisitionAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await recruit.closeRequisition(ctx, id, reason ?? "");
    return { message: "Requisition closed." };
  }, HR);
}
export async function addCandidateAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const c = await recruit.addCandidate(ctx, v as never);
    return { message: `${c.candidateNumber} added to the pipeline.` };
  }, HR);
}
export async function moveCandidateAction(id: string, stage: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await recruit.moveCandidate(ctx, id, stage as never, reason);
    return { message: `Candidate moved to ${stage.toLowerCase()}.` };
  }, HR);
}
export async function scheduleInterviewAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await recruit.scheduleInterview(ctx, v as never);
    return { message: "Interview scheduled." };
  }, HR);
}
export async function interviewFeedbackAction(interviewId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await recruit.recordInterviewFeedback(ctx, interviewId, v as never);
    return { message: "Interview feedback recorded." };
  }, HR);
}
export async function addStandardChecksAction(candidateId: string) {
  return act("hr.manage", async (ctx) => {
    const n = await recruit.addStandardChecks(ctx, candidateId);
    return { message: n ? `${n} vetting check(s) added.` : "The standard checks were already on this candidate." };
  }, HR);
}
export async function addCheckAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await recruit.addCheck(ctx, v as never);
    return { message: "Check added." };
  }, HR);
}
export async function updateCheckAction(id: string, status: string, notes?: string) {
  return act("hr.manage", async (ctx) => {
    await recruit.updateCheck(ctx, id, status as never, notes);
    return { message: `Check marked ${status.toLowerCase()}.` };
  }, HR);
}
export async function createOfferAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const o = await recruit.createOffer(ctx, v as never);
    return { message: `${o.offerNumber} raised — awaiting approval.` };
  }, HR);
}
export async function approveOfferAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await recruit.approveOffer(ctx, id, note);
    return { message: "Offer approved." };
  }, HR);
}
export async function rejectOfferAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await recruit.rejectOffer(ctx, id, note ?? "");
    return { message: "Offer rejected." };
  }, HR);
}
export async function markOfferSentAction(id: string) {
  return act("hr.manage", async (ctx) => {
    await recruit.markOfferSent(ctx, id);
    return { message: "Offer marked as sent." };
  }, HR);
}
export async function offerResponseAction(id: string, decision: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await recruit.recordOfferResponse(ctx, id, decision as never, reason);
    return { message: decision === "ACCEPTED" ? "Offer accepted." : "Offer declined." };
  }, HR);
}
export async function withdrawOfferAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await recruit.withdrawOffer(ctx, id, reason ?? "");
    return { message: "Offer withdrawn." };
  }, HR);
}
export async function hireCandidateAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const r = await recruit.hireCandidate(ctx, v as never);
    return {
      message: `${r.employee.employeeNumber} hired — contract ${r.contract.contractNumber} and the onboarding checklist are ready.`,
      redirectTo: `/employees/${r.employee.id}?tab=lifecycle`,
    };
  }, HR);
}

// ───────────────────────────── Employee relations ─────────────────────────────

/** Open to anyone who may raise a case; the service decides what each role may open. */
export async function raiseCaseAction(v: V) {
  return act(undefined, async (ctx) => {
    const c = await rel.raiseCase(ctx, v as never);
    return {
      message: `${c.caseNumber} raised.`,
      redirectTo: ctx.role === "EMPLOYEE" || ctx.role === "SUPERVISOR" ? "/me/grievances" : `/hr/relations/${c.id}`,
    };
  }, [...HR, "/me/grievances"]);
}
export async function addCaseNoteAction(caseId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await rel.addCaseNote(ctx, caseId, v as never);
    return { message: "Added to the case file." };
  }, HR);
}
export async function assignCaseAction(caseId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await rel.assignCase(ctx, caseId, s(v.assignedTo) ?? "");
    return { message: "Case assigned." };
  }, HR);
}
export async function setCaseStatusAction(caseId: string, status: string) {
  return act("hr.manage", async (ctx) => {
    await rel.setCaseStatus(ctx, caseId, status as never);
    return { message: `Case moved to ${status.toLowerCase()}.` };
  }, HR);
}
export async function resolveCaseAction(caseId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await rel.resolveCase(ctx, caseId, v as never);
    return { message: "Case resolved — awaiting sign-off to close." };
  }, HR);
}
export async function closeCaseAction(caseId: string) {
  return act("hr.approve", async (ctx) => {
    await rel.closeCase(ctx, caseId);
    return { message: "Case closed." };
  }, HR);
}
export async function reopenCaseAction(caseId: string, reason?: string) {
  return act("hr.approve", async (ctx) => {
    await rel.reopenCase(ctx, caseId, reason ?? "");
    return { message: "Case re-opened for investigation." };
  }, HR);
}
export async function issueSanctionAction(caseId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await rel.issueSanctionFromCase(ctx, caseId, v as never);
    return { message: "Sanction raised — pending sign-off in the employee's disciplinary record." };
  }, HR);
}

// ───────────────────────────── Exit extras ─────────────────────────────

export async function recordExitInterviewAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await hr.recordExitInterview(ctx, v as never);
    return { message: "Exit interview recorded." };
  }, HR);
}
export async function waiveTaskAction(kind: "onboarding" | "exit", id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await hr.markTaskNotApplicable(ctx, kind, id, reason ?? "");
    return { message: "Step waived." };
  }, HR);
}

// ───────────────────────────── Settlements ─────────────────────────────

export async function prepareSettlementAction(exitRecordId: string, v: V = {}) {
  return act("settlement.manage", async (ctx) => {
    const st = await eos.prepareSettlement(ctx, exitRecordId, v as never);
    return { message: `Settlement ${st.settlementNumber} calculated.`, redirectTo: `/payroll/settlements/${st.id}` };
  }, SETTLE);
}
export async function addSettlementLineAction(id: string, v: V) {
  return act("settlement.manage", async (ctx) => {
    await eos.addManualLine(ctx, id, v as never);
    return { message: "Line added." };
  }, SETTLE);
}
export async function removeSettlementLineAction(lineId: string) {
  return act("settlement.manage", async (ctx) => {
    await eos.removeManualLine(ctx, lineId);
    return { message: "Line removed." };
  }, SETTLE);
}
export async function submitSettlementAction(id: string) {
  return act("settlement.manage", async (ctx) => {
    await eos.submitSettlement(ctx, id);
    return { message: "Submitted for approval." };
  }, SETTLE);
}
export async function approveSettlementAction(id: string) {
  return act("settlement.approve", async (ctx) => {
    await eos.approveSettlement(ctx, id);
    return { message: "Settlement approved — release it into payroll next." };
  }, SETTLE);
}
export async function returnSettlementAction(id: string, reason?: string) {
  return act("settlement.approve", async (ctx) => {
    await eos.returnSettlement(ctx, id, reason ?? "");
    return { message: "Sent back to the preparer." };
  }, SETTLE);
}
export async function cancelSettlementAction(id: string, reason?: string) {
  return act(undefined, async (ctx) => {
    await eos.cancelSettlement(ctx, id, reason ?? "");
    return { message: "Settlement cancelled." };
  }, SETTLE);
}
export async function releaseSettlementAction(id: string, v: V) {
  return act("settlement.approve", async (ctx) => {
    const r = await eos.releaseSettlement(ctx, id, String(v.periodId ?? ""));
    return {
      message:
        r.route === "supplementary"
          ? `Released into ${r.periodName}. That payroll is locked — create a supplementary run to pay it.`
          : `Released into ${r.periodName}. Recalculate that payroll and the settlement lines appear on the payslip.`,
    };
  }, SETTLE);
}

export async function sendDigestNowAction() {
  return act("hr.manage", async (ctx) => {
    const r = await reminders.sendHrDigestNow(ctx);
    return { message: r.skipped ? `Not sent — ${r.skipped}` : `Digest sent to ${r.sent} recipient(s)${r.failed.length ? ` (${r.failed.length} failed)` : ""}.` };
  }, HR);
}

export async function runRetentionNowAction() {
  return act("hr.configure", async (ctx) => {
    const r = await retention.runRetentionNow(ctx);
    return { message: r.anonymized ? `Removed the personal details of ${r.anonymized} candidate(s).` : `Nothing removed — ${r.skipped}` };
  }, ["/settings", "/hr"]);
}

/** Edits one checklist step; the form carries the step's id. */
export async function editTemplateItemAction(v: V) {
  return act("hr.configure", async (ctx) => {
    const { id, ...patch } = v;
    if (!id) throw new Error("Choose the step to edit.");
    const clean = Object.fromEntries(
      Object.entries(patch)
        .filter(([, x]) => x !== undefined)
        // Selects post "true"/"false" strings; the schema wants real booleans.
        .map(([k, x]) => [k, x === "true" ? true : x === "false" ? false : x]),
    );
    await policy.updateTemplateItem(ctx, String(id), clean as never);
    return { message: "Checklist step updated." };
  }, ["/settings"]);
}
