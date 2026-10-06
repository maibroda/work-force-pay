/**
 * Pure rules for data subject access requests. No database here.
 */

export type DueState = "DONE" | "OVERDUE" | "DUE_SOON" | "ON_TRACK";

export const DUE_STATE_LABELS: Record<DueState, string> = {
  DONE: "Closed",
  OVERDUE: "Overdue",
  DUE_SOON: "Due soon",
  ON_TRACK: "On track",
};

/** How many days before the deadline a request is flagged as due soon. */
export const DUE_SOON_DAYS = 7;

const DAY = 86_400_000;

/** The last day to answer: the policy's number of days after the request was received. */
export function dueDateFor(receivedOn: Date, days: number): Date {
  return new Date(receivedOn.getTime() + days * DAY);
}

/** Where an open request stands against its deadline; the due day itself is still on time. */
export function dueState(status: "OPEN" | "FULFILLED" | "REFUSED", dueOn: Date, today: Date): DueState {
  if (status !== "OPEN") return "DONE";
  const left = Math.round((dueOn.getTime() - today.getTime()) / DAY);
  if (left < 0) return "OVERDUE";
  return left <= DUE_SOON_DAYS ? "DUE_SOON" : "ON_TRACK";
}

/** Days left to answer (negative once overdue). */
export const daysLeft = (dueOn: Date, today: Date) => Math.round((dueOn.getTime() - today.getTime()) / DAY);

/** What an export deliberately leaves out, and why — printed in the file so the person knows. */
export const WITHHELD_NOTES = [
  "Free-text feedback written by interviewers and other internal assessment notes made during recruitment.",
  "Confidential investigation records (for example harassment and whistleblowing cases), to protect the people involved. Ask HR which exemption applies to a given record.",
  "Other people's personal details: for guarantors and referees only a name, relationship and status are shown, not their contact details or ID numbers.",
  "Security and system logs, and the audit trail of who has used the system.",
] as const;
