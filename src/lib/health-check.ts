/**
 * Pure rules for the Payroll Health Check: the checklist, what must be true before a check can go for review or be issued, and the figures on
 * its summary. No database here.
 *
 * A health check is a limited review of a prospect's payroll process. It reports process evidence: whether a control was seen operating, and what
 * was seen. It never says a payroll is "compliant", "error-free" or certified; the summary says so in as many words.
 */

export const TEMPLATE_VERSION = "2026.1";

export const AREAS = ["INPUTS_APPROVALS", "CALCULATIONS", "RECORDS", "STATUTORY", "REPORTING_AUDIT"] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABELS: Record<Area, string> = {
  INPUTS_APPROVALS: "Input and approval controls",
  CALCULATIONS: "Calculations and reconciliations",
  RECORDS: "Employee records and changes",
  STATUTORY: "Statutory schedules",
  REPORTING_AUDIT: "Reporting and audit trails",
};

export type TemplateItem = { code: string; area: Area; question: string; guidance: string };

/** The standard checklist. Each question is a control that can be seen operating (or not), with what to ask for as the evidence. */
export const TEMPLATE: readonly TemplateItem[] = [
  { code: "IN-01", area: "INPUTS_APPROVALS", question: "Payroll inputs (starters, leavers, overtime, allowances, deductions) arrive in writing from a named, authorised person by an agreed cut-off.", guidance: "Ask for the last two months' input emails or forms, and whatever sets the cut-off." },
  { code: "IN-02", area: "INPUTS_APPROVALS", question: "Late or missing inputs are chased and recorded, not estimated.", guidance: "Ask what happened the last time an input was late, and for the record of it." },
  { code: "IN-03", area: "INPUTS_APPROVALS", question: "Changes to pay (increases, new allowances, new deductions) carry written authority from someone other than the person who processes the payroll.", guidance: "Pick two pay changes from the last quarter and ask for the authority for each." },
  { code: "IN-04", area: "INPUTS_APPROVALS", question: "The person who prepares the payroll is not the only person who approves it.", guidance: "Ask who prepares and who approves, and see the last two approvals." },
  { code: "IN-05", area: "INPUTS_APPROVALS", question: "The approver sees a summary of changes against the previous month before approving, and the approval is recorded with a name and a date.", guidance: "Ask to see what the approver was given, and the record of their approval." },
  { code: "CA-01", area: "CALCULATIONS", question: "Gross-to-net pay is calculated by a system or a controlled spreadsheet, not keyed by hand each month.", guidance: "Watch or be walked through a calculation, and ask who can change the formulas." },
  { code: "CA-02", area: "CALCULATIONS", question: "The PAYE, pension and other statutory rates in use are written down with their source and effective date, and are updated when the law changes.", guidance: "Ask where the rates are recorded and who checks them, and when they were last checked." },
  { code: "CA-03", area: "CALCULATIONS", question: "Each month's payroll is compared with the previous month and large movements are explained.", guidance: "Ask for the last two comparisons and how a large movement was handled." },
  { code: "CA-04", area: "CALCULATIONS", question: "Total net pay is reconciled to the payment file and to the amount actually paid.", guidance: "Ask for the payment file total, the bank debit and the payroll total for one month." },
  { code: "CA-05", area: "CALCULATIONS", question: "Payroll cost is reconciled to the ledger or management accounts, or there is a recorded reason why it is not.", guidance: "Ask how payroll cost gets into the accounts and who checks that it agrees." },
  { code: "RC-01", area: "RECORDS", question: "There is one current record per employee, with evidence of the terms of employment (offer or contract).", guidance: "Pick three employees and ask for their record and their offer or contract." },
  { code: "RC-02", area: "RECORDS", question: "Changes to bank details are confirmed with the employee (not by email alone) and approved by a second person before they take effect.", guidance: "Ask about the last bank change: who asked, who confirmed, who approved." },
  { code: "RC-03", area: "RECORDS", question: "Starters and leavers are added and removed on documented dates, and final pay is calculated by a documented method.", guidance: "Pick a starter and a leaver from the last quarter and trace each." },
  { code: "RC-04", area: "RECORDS", question: "Each month the payroll is checked against the business's own headcount list, for people paid who should not be and people missing.", guidance: "Ask for the last headcount comparison, and how differences were resolved." },
  { code: "RC-05", area: "RECORDS", question: "Access to salary and bank data is limited to the people who need it, and a leaver's access is removed.", guidance: "Ask who can open payroll files and what happens to access when someone leaves." },
  { code: "ST-01", area: "STATUTORY", question: "PAYE is remitted by its due date each month, with a schedule that agrees to the payroll.", guidance: "Ask for the last three months' PAYE schedules and evidence of the dates paid." },
  { code: "ST-02", area: "STATUTORY", question: "Pension contributions are remitted by their due date, with a schedule per employee that agrees to the payroll.", guidance: "Ask for the last three months' pension schedules and evidence of payment." },
  { code: "ST-03", area: "STATUTORY", question: "Other statutory items that apply (for example NHF, NSITF, ITF) are identified, calculated and remitted, or a reason is recorded why they do not apply.", guidance: "Ask which apply to this business, and who decided." },
  { code: "ST-04", area: "STATUTORY", question: "Proof of each remittance (receipts, confirmations) is kept and filed against the month it relates to.", guidance: "Ask to see the proof for one month, found without help." },
  { code: "ST-05", area: "STATUTORY", question: "Employees' tax IDs and pension PINs are held, and checked for completeness.", guidance: "Ask how many employees are missing either, and what is done about it." },
  { code: "RA-01", area: "REPORTING_AUDIT", question: "Payslips reach every employee each month through a controlled route, not forwarded informally.", guidance: "Ask how payslips are delivered and who can see someone else's." },
  { code: "RA-02", area: "REPORTING_AUDIT", question: "A payroll register for each month is kept and can be reproduced later.", guidance: "Ask for the register for a month from a year ago." },
  { code: "RA-03", area: "REPORTING_AUDIT", question: "Who changed what, and when, can be shown for the data that affects pay.", guidance: "Ask to see the trail for one change, from request to payroll." },
  { code: "RA-04", area: "REPORTING_AUDIT", question: "Payroll files are exchanged through controlled channels, not personal email or chat apps, and copies are not left on personal devices.", guidance: "Ask how the last payroll file was sent, and where copies are kept." },
  { code: "RA-05", area: "REPORTING_AUDIT", question: "Payroll records are kept for the period the business has decided, are backed up, and a restore has been tried.", guidance: "Ask for the retention rule, and when a backup was last restored." },
];

// ─────────────────────────────── Responses and findings ───────────────────────────────

export const RESPONSES = ["NOT_ASSESSED", "IN_PLACE", "PARTLY", "NOT_SEEN", "NOT_APPLICABLE"] as const;
export type Response = (typeof RESPONSES)[number];
export const RESPONSE_LABELS: Record<Response, string> = {
  NOT_ASSESSED: "Not assessed yet",
  IN_PLACE: "Seen in place",
  PARTLY: "Seen in part",
  NOT_SEEN: "Not seen",
  NOT_APPLICABLE: "Does not apply",
};
/** What the assessor must write for each response. */
export const RESPONSE_HELP: Record<Response, string> = {
  NOT_ASSESSED: "",
  IN_PLACE: "Say what you saw that shows it operating (at least 10 characters).",
  PARTLY: "Say what you saw, and what was missing (at least 10 characters), and record a finding.",
  NOT_SEEN: "Say what you asked for and what you were shown, and record a finding.",
  NOT_APPLICABLE: "Say why it does not apply to this business (a note).",
};

export const SEVERITIES = ["HIGH", "MEDIUM", "LOW", "OBSERVATION"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low", OBSERVATION: "Observation" };
const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, OBSERVATION: 3 };

export type ItemFacts = { code: string; area: Area; question: string; response: Response; evidence?: string | null; note?: string | null };
export type FindingFacts = { number: number; itemCode: string | null; area: Area; title: string; severity: Severity; recommendation: string };

const len = (s: string | null | undefined) => (s ?? "").trim().length;

/** What must be put right before this check can be sent for review or issued. Empty when it can go. */
export function blockers(items: readonly ItemFacts[], findings: readonly FindingFacts[]): string[] {
  const out: string[] = [];
  const open = items.filter((i) => i.response === "NOT_ASSESSED");
  if (open.length) out.push(`${open.length} control(s) have not been assessed yet: ${open.slice(0, 6).map((i) => i.code).join(", ")}${open.length > 6 ? ", …" : ""}.`);
  for (const i of items) {
    if ((i.response === "IN_PLACE" || i.response === "PARTLY") && len(i.evidence) < 10) out.push(`${i.code} says what was seen too briefly (at least 10 characters).`);
    if (i.response === "NOT_APPLICABLE" && len(i.note) < 5) out.push(`${i.code} is marked as not applying without saying why.`);
    if ((i.response === "PARTLY" || i.response === "NOT_SEEN") && !findings.some((f) => f.itemCode === i.code)) out.push(`${i.code} is a gap with no finding recorded against it.`);
  }
  return out;
}

export function summarise(items: readonly ItemFacts[], findings: readonly FindingFacts[]) {
  const areas = AREAS.map((a) => {
    const here = items.filter((i) => i.area === a);
    const n = (r: Response) => here.filter((i) => i.response === r).length;
    return { area: a, label: AREA_LABELS[a], total: here.length, inPlace: n("IN_PLACE"), partly: n("PARTLY"), notSeen: n("NOT_SEEN"), notApplicable: n("NOT_APPLICABLE"), notAssessed: n("NOT_ASSESSED") };
  });
  const sum = (k: "total" | "inPlace" | "partly" | "notSeen" | "notApplicable" | "notAssessed") => areas.reduce((a, x) => a + x[k], 0);
  const bySeverity = SEVERITIES.map((s) => ({ severity: s, count: findings.filter((f) => f.severity === s).length }));
  return {
    areas,
    totals: { total: sum("total"), inPlace: sum("inPlace"), partly: sum("partly"), notSeen: sum("notSeen"), notApplicable: sum("notApplicable"), notAssessed: sum("notAssessed") },
    bySeverity,
    /** Findings, most serious first, then in the order they were recorded. */
    ordered: [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.number - b.number),
  };
}

export const DISCLAIMER =
  "This is a summary of a limited review of the payroll processes described, based on the information and evidence shown to us on the dates above. It is not an audit, a certification of compliance, or an assurance that no errors exist. Detailed reviews are separately scoped.";
