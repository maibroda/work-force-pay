/**
 * Letter templates (pure, framework-free, unit-testable): which merge fields each kind of letter
 * offers, the default wording, and the merge itself. Templates are plain text with {{field}}
 * placeholders — never HTML — so a field value can't inject markup into a letter.
 */

export const LETTER_TYPES = [
  "OFFER",
  "EMPLOYMENT_CONFIRMATION",
  "PROBATION_CONFIRMATION",
  "WARNING",
  "EXIT_LETTER",
  "EXPERIENCE",
  "CLEARANCE_CERTIFICATE",
] as const;
export type LetterTypeKey = (typeof LETTER_TYPES)[number];

export const LETTER_LABELS: Record<LetterTypeKey, string> = {
  OFFER: "Offer of employment",
  EMPLOYMENT_CONFIRMATION: "Employment confirmation",
  PROBATION_CONFIRMATION: "Probation confirmation",
  WARNING: "Warning letter",
  EXIT_LETTER: "Exit letter",
  EXPERIENCE: "Experience letter",
  CLEARANCE_CERTIFICATE: "Clearance certificate",
};

export interface FieldDef {
  key: string;
  label: string;
}

const COMMON: FieldDef[] = [
  { key: "organization", label: "Organization name" },
  { key: "today", label: "Date of the letter" },
  { key: "recipient", label: "Recipient's full name" },
];
const PERSON: FieldDef[] = [
  { key: "employeeNumber", label: "Employee number" },
  { key: "jobTitle", label: "Job title" },
];

/** The merge fields each letter type offers — a template may use only these. */
export const LETTER_FIELDS: Record<LetterTypeKey, FieldDef[]> = {
  OFFER: [
    ...COMMON,
    { key: "jobTitle", label: "Job title" },
    { key: "employmentType", label: "Employment type (permanent, fixed term…)" },
    { key: "monthlyGross", label: "Monthly gross salary" },
    { key: "startDate", label: "Start date" },
    { key: "validUntil", label: "Offer valid until" },
    { key: "probationText", label: "Sentence about the probation period" },
    { key: "noticeDays", label: "Notice period (days)" },
  ],
  EMPLOYMENT_CONFIRMATION: [
    ...COMMON,
    ...PERSON,
    { key: "department", label: "Department" },
    { key: "category", label: "Employee category" },
    { key: "startDate", label: "Date employment began" },
    { key: "contractType", label: "Contract type" },
  ],
  PROBATION_CONFIRMATION: [
    ...COMMON,
    ...PERSON,
    { key: "startDate", label: "Date employment began" },
    { key: "probationEndDate", label: "Date probation ended" },
  ],
  WARNING: [
    ...COMMON,
    ...PERSON,
    { key: "warningType", label: "Kind of warning" },
    { key: "incidentDate", label: "Date of the incident" },
    { key: "description", label: "What happened" },
    { key: "actionTaken", label: "Action taken" },
  ],
  EXIT_LETTER: [
    ...COMMON,
    ...PERSON,
    { key: "exitType", label: "How employment ends (resignation, termination…)" },
    { key: "noticeDate", label: "Date notice was given" },
    { key: "lastWorkingDate", label: "Last working day" },
  ],
  EXPERIENCE: [
    ...COMMON,
    ...PERSON,
    { key: "department", label: "Department" },
    { key: "startDate", label: "Date employment began" },
    { key: "endDate", label: "Date employment ended" },
    { key: "serviceLength", label: "Length of service (e.g. 5 years, 2 months)" },
  ],
  CLEARANCE_CERTIFICATE: [
    ...COMMON,
    ...PERSON,
    { key: "lastWorkingDate", label: "Last working day" },
    { key: "clearanceDate", label: "Date clearance was completed" },
  ],
};

const FIELD_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Every placeholder name used in a piece of text. */
export function fieldsUsed(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD_RE)].map((m) => m[1]))];
}

/** Placeholders in the text that this letter type doesn't offer. */
export function unknownFields(text: string, type: LetterTypeKey): string[] {
  const allowed = new Set(LETTER_FIELDS[type].map((f) => f.key));
  return fieldsUsed(text).filter((k) => !allowed.has(k));
}

/** Fills the placeholders. A field with no value shows as "—" rather than leaving a hole in the letter. */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(FIELD_RE, (_, key: string) => (values[key]?.trim() ? values[key] : "—"));
}

/** "5 years, 2 months" — whole calendar months, the last day counted as worked. */
export function serviceLength(start: Date, end: Date): string {
  const endExclusive = new Date(end.getTime() + 86400000);
  let months = (endExclusive.getUTCFullYear() - start.getUTCFullYear()) * 12 + (endExclusive.getUTCMonth() - start.getUTCMonth());
  if (endExclusive.getUTCDate() < start.getUTCDate()) months--;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years ? `${years} year${years === 1 ? "" : "s"}` : "", rest ? `${rest} month${rest === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "less than a month";
}

export const DEFAULT_TEMPLATES: Record<LetterTypeKey, { subject: string; body: string; signatoryTitle: string }> = {
  OFFER: {
    subject: "Offer of employment — {{jobTitle}}",
    signatoryTitle: "Human Resources",
    body: `Dear {{recipient}},

We are pleased to offer you the position of {{jobTitle}} at {{organization}} on a {{employmentType}} basis, starting on {{startDate}}.

Your monthly gross salary will be {{monthlyGross}}. {{probationText}} Either party may end the employment by giving {{noticeDays}} days' written notice.

This offer is open for your acceptance until {{validUntil}}. To accept, please sign and return a copy of this letter. It is subject to satisfactory completion of our pre-employment checks.

We look forward to welcoming you.

Yours sincerely,`,
  },
  EMPLOYMENT_CONFIRMATION: {
    subject: "Confirmation of employment — {{recipient}}",
    signatoryTitle: "Human Resources",
    body: `To whom it may concern,

This is to confirm that {{recipient}} (employee number {{employeeNumber}}) is employed by {{organization}} as {{jobTitle}} in the {{department}} department, on a {{contractType}} contract. Employment began on {{startDate}} and is continuing at the date of this letter.

This letter is issued at the employee's request and carries no obligation on the part of {{organization}}.

Yours faithfully,`,
  },
  PROBATION_CONFIRMATION: {
    subject: "Confirmation of appointment — {{jobTitle}}",
    signatoryTitle: "Human Resources",
    body: `Dear {{recipient}},

Your probation as {{jobTitle}} at {{organization}}, which began on {{startDate}}, ended on {{probationEndDate}}. We are pleased to confirm your appointment.

Thank you for your contribution so far. All other terms of your contract of employment are unchanged.

Yours sincerely,`,
  },
  WARNING: {
    subject: "{{warningType}} — {{recipient}}",
    signatoryTitle: "Human Resources",
    body: `Dear {{recipient}},

This letter records a {{warningType}} following the incident on {{incidentDate}}:

{{description}}

Action taken: {{actionTaken}}

You are expected to meet the standards of conduct required of {{jobTitle}} at {{organization}}. Further breaches may lead to more serious disciplinary action. You have the right to respond in writing to this letter.

Yours sincerely,`,
  },
  EXIT_LETTER: {
    subject: "End of employment — {{recipient}}",
    signatoryTitle: "Human Resources",
    body: `Dear {{recipient}},

This letter confirms that your employment with {{organization}} as {{jobTitle}} (employee number {{employeeNumber}}) is ending by way of {{exitType}}. Notice was given on {{noticeDate}} and your last working day will be {{lastWorkingDate}}.

Before you leave, please complete the clearance process and return all company property. Your final entitlements will be calculated and paid in line with company policy.

We thank you for your service and wish you well.

Yours sincerely,`,
  },
  EXPERIENCE: {
    subject: "Letter of experience — {{recipient}}",
    signatoryTitle: "Human Resources",
    body: `To whom it may concern,

This is to certify that {{recipient}} (employee number {{employeeNumber}}) worked for {{organization}} as {{jobTitle}} in the {{department}} department from {{startDate}} to {{endDate}}, a period of {{serviceLength}}.

We wish {{recipient}} every success in future endeavours.

Yours faithfully,`,
  },
  CLEARANCE_CERTIFICATE: {
    subject: "Clearance certificate — {{recipient}}",
    signatoryTitle: "Human Resources",
    body: `To whom it may concern,

This certifies that {{recipient}} (employee number {{employeeNumber}}), formerly {{jobTitle}} at {{organization}}, whose last working day was {{lastWorkingDate}}, completed the company's exit clearance on {{clearanceDate}}. All company property has been returned or accounted for.

Issued for the record.

Yours faithfully,`,
  },
};
