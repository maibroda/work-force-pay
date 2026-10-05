import { requirePage } from "@/lib/auth/session";
import { getHrPolicy } from "@/server/services/hr-policy";
import { num } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { SmartForm, type Field } from "@/components/smart-form";
import { updateHrPolicyAction } from "@/app/actions/hr-lifecycle";

const EXIT_TYPES = ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "ABSCONDMENT", "DECEASED"];
const label = (t: string) => `Pays on ${t.replace(/_/g, " ").toLowerCase()}`;
const basis = [
  { value: "GROSS", label: "Gross pay" },
  { value: "BASIC", label: "Basic pay" },
];

export default async function HrPolicyPage() {
  const ctx = await requirePage("hr.configure");
  const p = await getHrPolicy(ctx.orgId);
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

      <p className="mb-8 text-xs text-muted-foreground">
        Tax treatment of end-of-service payments varies by country — each payment above can be marked taxable or not, and defaults to taxable. Confirm the right treatment with your tax adviser before relying on a setting.
      </p>
    </>
  );
}
