/**
 * Pure rules for personal-data breaches. No database here.
 *
 * The regulator has to be told within a set number of hours of the company becoming aware of a breach that is
 * likely to put people at risk. The clock starts at discovery, not at the moment someone gets round to assessing
 * it, so a breach nobody has assessed yet is treated as one that may need notifying.
 */

export type Assessment = "UNASSESSED" | "NO_RISK" | "RISK" | "HIGH_RISK";

export const ASSESSMENT_LABELS: Record<Assessment, string> = {
  UNASSESSED: "Not assessed yet",
  NO_RISK: "Unlikely to harm anyone",
  RISK: "Likely to put people at risk",
  HIGH_RISK: "Likely to put people at high risk",
};

export type NotifyState = "NOT_REQUIRED" | "ON_TIME" | "LATE" | "OVERDUE" | "DUE_SOON" | "RUNNING";

export const NOTIFY_STATE_LABELS: Record<NotifyState, string> = {
  NOT_REQUIRED: "Regulator need not be told",
  ON_TIME: "Regulator told in time",
  LATE: "Regulator told late",
  OVERDUE: "Regulator notification overdue",
  DUE_SOON: "Regulator notification due soon",
  RUNNING: "Notification clock running",
};

/** Kinds of data a breach can involve. */
export const DATA_CATEGORIES = [
  "Names and contact details",
  "Dates of birth and ID numbers",
  "Bank account details",
  "Tax and pension details",
  "Payroll and pay records",
  "Employment and HR records",
  "Disciplinary and conduct records",
  "Next of kin and guarantor details",
  "Login credentials",
  "Other",
] as const;

/** Hours before the deadline a notification is flagged as due soon. */
export const DUE_SOON_HOURS = 24;

const HOUR = 3_600_000;

/** The last moment to tell the regulator. */
export function notifyDeadline(discoveredAt: Date, hours: number): Date {
  return new Date(discoveredAt.getTime() + hours * HOUR);
}

/** Does this assessment oblige the company to tell the regulator? An unassessed breach is treated as yes. */
export const needsRegulator = (a: Assessment) => a !== "NO_RISK";

/** Does it oblige the company to tell the people affected? */
export const needsIndividuals = (a: Assessment) => a === "HIGH_RISK";

export function notifyState(input: { assessment: Assessment; discoveredAt: Date; notifiedAt: Date | null; hours: number; now: Date }): NotifyState {
  const { assessment, discoveredAt, notifiedAt, hours, now } = input;
  const deadline = notifyDeadline(discoveredAt, hours);
  if (notifiedAt) return notifiedAt <= deadline ? "ON_TIME" : "LATE";
  if (!needsRegulator(assessment)) return "NOT_REQUIRED";
  const left = deadline.getTime() - now.getTime();
  if (left < 0) return "OVERDUE";
  return left <= DUE_SOON_HOURS * HOUR ? "DUE_SOON" : "RUNNING";
}

/** Whole hours left to tell the regulator (negative once past the deadline). */
export const hoursLeft = (discoveredAt: Date, hours: number, now: Date) => Math.floor((notifyDeadline(discoveredAt, hours).getTime() - now.getTime()) / HOUR);

/** "3 days 4 hours" style text for an hours figure. */
export function describeHours(h: number): string {
  const n = Math.abs(h);
  const days = Math.floor(n / 24);
  const rest = n % 24;
  const parts = [days ? `${days} day${days === 1 ? "" : "s"}` : "", rest || !days ? `${rest} hour${rest === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(" ");
}

export interface DpoContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** Has the company named a real person to contact? A name or an email is enough to act on. */
export const hasContact = (c: DpoContact) => !!(c.name || c.email);

/** "Ada Obi, ada@x.com, 0803…" from whatever has been filled in; null when nothing has. */
export function contactLine(c: DpoContact): string | null {
  const parts = [c.name, c.email, c.phone].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : null;
}

export interface NotificationFacts {
  incidentNumber: string;
  title: string;
  description: string;
  discoveredAt: Date;
  occurredOn: Date | null;
  dataCategories: string[];
  individualsAffected: number | null;
  containmentNote: string | null;
  remediation: string | null;
  contact: string;
  organization: string;
}

/**
 * The facts a regulator's breach notice asks for, in plain text, so whoever files it isn't assembling them under
 * pressure: what happened, when, what data and how many people, the likely consequences, what has been done.
 */
export function notificationSummary(f: NotificationFacts, assessment: Assessment, assessmentNote: string | null): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return [
    `Personal data breach notification — ${f.organization} (${f.incidentNumber})`,
    "",
    `What happened: ${f.title}. ${f.description}`,
    `When it happened: ${f.occurredOn ? day(f.occurredOn) : "not yet established"}. We became aware on ${f.discoveredAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    `Kinds of personal data involved: ${f.dataCategories.length ? f.dataCategories.join("; ") : "not yet established"}.`,
    `Approximate number of people affected: ${f.individualsAffected ?? "not yet established"}.`,
    `Our assessment of the risk to them: ${ASSESSMENT_LABELS[assessment]}${assessmentNote ? ` — ${assessmentNote}` : ""}.`,
    `What we have done to contain it: ${f.containmentNote ?? "containment is still under way"}.`,
    `What we are doing to stop it happening again: ${f.remediation ?? "still being decided"}.`,
    `Contact for more information: ${f.contact}.`,
  ].join("\n");
}
