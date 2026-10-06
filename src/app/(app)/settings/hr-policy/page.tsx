import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getHrPolicy } from "@/server/services/hr-policy";
import { num } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { SmartForm, type Field } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { retentionPreview } from "@/server/services/retention";
import { runRetentionNowAction, updateHrPolicyAction } from "@/app/actions/hr-lifecycle";

const EXIT_TYPES = ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "ABSCONDMENT", "DECEASED"];
const label = (t: string) => `Pays on ${t.replace(/_/g, " ").toLowerCase()}`;
const basis = [
  { value: "GROSS", label: "Gross pay" },
  { value: "BASIC", label: "Basic pay" },
];

export default async function HrPolicyPage() {
  const ctx = await requirePage("hr.configure");
  const [p, categories, retention] = await Promise.all([
    getHrPolicy(ctx.orgId),
    db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    retentionPreview(ctx),
  ]);
  const exitBoxes = (prefix: string, selected: string[]): Field[] =>
    EXIT_TYPES.map((t) => ({ name: `${prefix}_${t}`, label: label(t), type: "checkbox", defaultValue: selected.includes(t) }));

  return (
    <>
      <PageHeader
        title="HR & lifecycle policy"
        description="Every number the HR lifecycle runs on — probation and notice defaults, alert windows, and the end-of-service rules. Change a value here and the next contract, offer or settlement uses it; records already created keep what they were given."
      />

      <Section title="Employment terms & alerts" description="Defaults applied when a contract or offer doesn't say otherwise.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "terms")}
          fields={[
            { name: "defaultProbationMonths", label: "Default probation (months)", type: "number", min: 0, max: 24, defaultValue: p.defaultProbationMonths },
            { name: "maxProbationMonths", label: "Longest probation allowed (months)", type: "number", min: 0, max: 24, defaultValue: p.maxProbationMonths, help: "Caps extensions too." },
            { name: "defaultNoticeDays", label: "Default notice period (days)", type: "number", min: 0, defaultValue: p.defaultNoticeDays, help: "Used when the employee has no contract term." },
            { name: "retirementAge", label: "Retirement age", type: "number", min: 40, max: 80, defaultValue: p.retirementAge },
            { name: "contractAlertDays", label: "Warn this many days before a contract ends", type: "number", min: 0, defaultValue: p.contractAlertDays },
            { name: "probationAlertDays", label: "Warn this many days before probation ends", type: "number", min: 0, defaultValue: p.probationAlertDays },
            { name: "offerValidityDays", label: "Job offers stay valid for (days)", type: "number", min: 1, defaultValue: p.offerValidityDays },
            { name: "relationsCaseSlaDays", label: "Employee-relations case target (days)", type: "number", min: 1, defaultValue: p.relationsCaseSlaDays },
            { name: "dailyRateDivisor", label: "Days in a month for a day's pay", type: "number", min: 1, max: 31, defaultValue: p.dailyRateDivisor, help: "30 = calendar convention; 26 = working days. Drives every end-of-service formula." },
          ]}
        />
      </Section>

      <Section title="Unused leave" description="Paid out on exit for the leave an employee has earned but not taken.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "leave")}
          fields={[
            { name: "leaveEncashmentEnabled", label: "Pay out unused leave", type: "checkbox", defaultValue: p.leaveEncashmentEnabled },
            { name: "leaveEncashmentBasis", label: "Paid at", type: "select", defaultValue: p.leaveEncashmentBasis, options: basis },
            { name: "leaveEncashmentMaxDays", label: "Maximum days paid (0 = no cap)", type: "number", min: 0, defaultValue: p.leaveEncashmentMaxDays ?? 0 },
            { name: "leaveEncashmentRespectsEligibility", label: "Only once the leave policy's service period is complete", type: "checkbox", defaultValue: p.leaveEncashmentRespectsEligibility, span: 2 },
            { name: "leaveEncashmentTaxable", label: "Taxable", type: "checkbox", defaultValue: p.leaveEncashmentTaxable },
            ...exitBoxes("leaveExit", p.leaveEncashmentExitTypes),
          ]}
        />
      </Section>

      <Section title="Gratuity" description="Off by default — gratuity is jurisdiction-specific (and often replaced by pension). Turn it on and set the formula if your employment terms provide it.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "gratuity")}
          fields={[
            { name: "gratuityEnabled", label: "Pay gratuity", type: "checkbox", defaultValue: p.gratuityEnabled },
            { name: "gratuityBasis", label: "Calculated on", type: "select", defaultValue: p.gratuityBasis, options: basis },
            { name: "gratuityMinYears", label: "Completed years needed", type: "number", min: 0, defaultValue: p.gratuityMinYears },
            { name: "gratuityDaysPerYear", label: "Days of pay per year of service", type: "number", min: 0, defaultValue: num(p.gratuityDaysPerYear) },
            { name: "gratuityPartialYears", label: "Count a part-year proportionally", type: "checkbox", defaultValue: p.gratuityPartialYears },
            { name: "gratuityTaxable", label: "Taxable", type: "checkbox", defaultValue: p.gratuityTaxable },
            ...exitBoxes("gratuityExit", p.gratuityExitTypes),
          ]}
        />
      </Section>

      <Section title="Severance & notice" description="Severance applies to a termination recorded with the reason ‘redundancy’. A summary dismissal forfeits notice pay, gratuity and severance.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "severance")}
          fields={[
            { name: "severanceEnabled", label: "Pay severance on redundancy", type: "checkbox", defaultValue: p.severanceEnabled },
            { name: "severanceDaysPerYear", label: "Days of pay per completed year", type: "number", min: 0, defaultValue: num(p.severanceDaysPerYear) },
            { name: "severanceTaxable", label: "Severance is taxable", type: "checkbox", defaultValue: p.severanceTaxable },
            { name: "noticePayEnabled", label: "Pay in lieu when the employer ends employment short of notice", type: "checkbox", defaultValue: p.noticePayEnabled, span: 2 },
            { name: "noticePayTaxable", label: "Notice pay is taxable", type: "checkbox", defaultValue: p.noticePayTaxable },
            { name: "noticeRecoveryEnabled", label: "Recover the shortfall when an employee leaves short of notice", type: "checkbox", defaultValue: p.noticeRecoveryEnabled, span: 3 },
          ]}
        />
      </Section>

      <Section title="Personal records" description="What an employee's file must hold — next of kin, emergency contacts and guarantors — and how guarantors are controlled. Set a requirement to 0 if you don't need it. The Next of Kin, Guarantors and Dependants pages under Employees flag anyone short.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "records")}
          fields={[
            { name: "nextOfKinRequired", label: "Next of kin required", type: "number", min: 0, max: 5, defaultValue: p.nextOfKinRequired },
            { name: "emergencyContactsRequired", label: "Emergency contacts required", type: "number", min: 0, max: 5, defaultValue: p.emergencyContactsRequired },
            { name: "guarantorsRequired", label: "Verified guarantors required", type: "number", min: 0, max: 5, defaultValue: p.guarantorsRequired },
            { name: "guarantorMaxPerPerson", label: "One person may guarantee up to (employees)", type: "number", min: 0, max: 50, defaultValue: p.guarantorMaxPerPerson, help: "0 = no limit." },
            { name: "guarantorSeparateVerifier", label: "Someone other than the recorder must verify a guarantor", type: "checkbox", defaultValue: p.guarantorSeparateVerifier, span: 2 },
            ...categories.map((c): Field => ({ name: `gcat_${c.id}`, label: `Guarantors needed for ${c.name}`, type: "checkbox", defaultValue: p.guarantorCategoryIds.includes(c.id) })),
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">Tick no categories to require guarantors for everyone.</p>
      </Section>

      <Section title="Performance appraisals" description="How appraisals run. The criteria and their weights are edited under Settings → Appraisal Criteria; cycles are launched from HR Lifecycle → Appraisals.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "appraisal")}
          fields={[
            { name: "appraisalSelfAssessment", label: "Employees rate themselves first", type: "checkbox", defaultValue: p.appraisalSelfAssessment },
            { name: "appraisalMinServiceDays", label: "Minimum service to be included in a cycle (days)", type: "number", min: 0, max: 1825, defaultValue: p.appraisalMinServiceDays, help: "Counted at the period end. Specific employees picked for a cycle are always included." },
            { name: "appraisalCommentAtOrBelow", label: "A comment is required for a rating at or below", type: "number", min: 0, max: 5, defaultValue: p.appraisalCommentAtOrBelow, help: "0 = never." },
            { name: "appraisalCommentAtOrAbove", label: "…and for a rating at or above", type: "number", min: 0, max: 5, defaultValue: p.appraisalCommentAtOrAbove, help: "0 = never. 5 is the top rating." },
          ]}
        />
      </Section>

      <Section title="Staff loans & advances" description="Affordability limits checked when a loan or advance is requested. Set a limit to 0 for no limit.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "loans")}
          fields={[
            { name: "loanMaxGrossMultiple", label: "Loans up to this many × monthly gross", type: "number", min: 0, max: 36, defaultValue: num(p.loanMaxGrossMultiple), help: "Counts any loan still outstanding." },
            { name: "loanMaxDeductionPct", label: "Monthly repayments up to this % of gross", type: "number", min: 0, max: 100, defaultValue: p.loanMaxDeductionPct, help: "Across all of the employee's loans." },
            { name: "advanceMaxGrossPct", label: "Salary advance up to this % of gross", type: "number", min: 0, max: 100, defaultValue: p.advanceMaxGrossPct },
          ]}
        />
      </Section>

      <Section
        title="Reminder email"
        description={`One email a day to every active HR admin (plus the addresses below) listing contracts ending, probation reviews, overdue onboarding, case deadlines, approvals waiting, and leavers still holding kit or owing a loan. Never sent when there's nothing to report. ${
          p.lastDigestAt ? `Last sent ${p.lastDigestAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : "Not sent yet."
        } It's sent by a scheduler calling /api/cron/hr-digest (see the README).`}
      >
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "reminders")}
          fields={[
            { name: "reminderEmailsEnabled", label: "Send the daily digest", type: "checkbox", defaultValue: p.reminderEmailsEnabled },
            { name: "extraEmails", label: "Also send to (separate with commas)", type: "textarea", span: 2, defaultValue: p.reminderExtraEmails.join(", "), help: "Blank = HR admins only." },
          ]}
        />
      </Section>

      <Section title="Change control" description="Bank, tax and pension details are where payroll fraud hides. With approval switched on they can't be edited directly: HR (or the employee, for their own details) requests a change and someone else approves it.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "changes")}
          fields={[
            { name: "sensitiveChangeApproval", label: "Changes need a second person's approval", type: "checkbox", defaultValue: p.sensitiveChangeApproval, span: 2 },
            { name: "bankChangeWatchDays", label: "Warn in payroll validation for this many days after a bank change", type: "number", min: 0, max: 365, defaultValue: p.bankChangeWatchDays, help: "0 = never." },
          ]}
        />
      </Section>

      <Section title="Training compliance" description="Which courses and certifications are required is set under Settings → Training Requirements; HR → Training Compliance shows who is missing or expired.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "training")}
          fields={[
            { name: "trainingAlertDays", label: "Flag a certificate this many days before it expires", type: "number", min: 0, max: 365, defaultValue: p.trainingAlertDays, help: "0 = only flag once expired." },
          ]}
        />
      </Section>

      <Section
        title="Data retention"
        description={`Privacy laws limit how long you may keep a job applicant's personal details. Once a rejected or withdrawn candidate has been out of the pipeline longer than this, their name, contact details, CV reference, notes and interview comments are removed (the requisition, stage and offer figures stay, for reporting). Hired candidates and anyone still in the pipeline are never touched. Set 0 to keep everything. ${
          retention.months > 0 ? `${retention.due} candidate(s) are past the limit now.` : "Retention is off."
        } ${retention.alreadyAnonymized} already anonymised. A scheduler calls /api/cron/data-retention daily (see the README).`}
      >
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={updateHrPolicyAction.bind(null, "retention")}
          fields={[
            { name: "candidateRetentionMonths", label: "Keep rejected / withdrawn candidates for (months)", type: "number", min: 0, max: 120, defaultValue: p.candidateRetentionMonths, help: "24 is a common default. 0 = keep for ever." },
          ]}
        />
        {retention.months > 0 && retention.due > 0 && (
          <div className="mt-3">
            <ActionButton action={runRetentionNowAction} confirm={`Permanently remove the personal details of ${retention.due} candidate(s)? This can't be undone.`} variant="outline">
              Run retention now
            </ActionButton>
          </div>
        )}
      </Section>

      <p className="mb-8 text-xs text-muted-foreground">
        Tax treatment of end-of-service payments varies by country — each payment above can be marked taxable or not, and defaults to taxable. Confirm the right treatment with your tax adviser before relying on a setting.
      </p>
    </>
  );
}
