/**
 * Pure rules for planning training: seats, the expiry of the certificate that attending creates, when someone may be enrolled or marked attended, and the life of a
 * training need. No database and no clock here (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * The compliance rules (is an employee covered by a required course?) stay in `training-compliance.ts`; nothing here changes how they work. Attending a session only
 * creates the same certificate record HR creates by hand today, so the existing check and the digest keep working unchanged.
 */
import { addMonths } from "@/lib/leave";
import { d, iso } from "@/lib/dates";

export type SessionStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { SCHEDULED: "Scheduled", COMPLETED: "Completed", CANCELLED: "Cancelled" };

export type NeedStatus = "OPEN" | "PLANNED" | "MET" | "DROPPED";
export const NEED_STATUS_LABELS: Record<NeedStatus, string> = { OPEN: "Needs a session", PLANNED: "Enrolled", MET: "Met", DROPPED: "Dropped" };

export const NEED_SOURCES = ["COMPLIANCE", "APPRAISAL", "REQUEST", "OTHER"] as const;
export type NeedSource = (typeof NEED_SOURCES)[number];
export const NEED_SOURCE_LABELS: Record<NeedSource, string> = { COMPLIANCE: "Compliance gap", APPRAISAL: "Appraisal recommendation", REQUEST: "Request", OTHER: "Other" };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
/** The same match the compliance check uses between a required course and a held certificate. */
export const sameCourse = (a: string, b: string) => norm(a) === norm(b);

export const seatsLeft = (seats: number, taken: number) => Math.max(seats - taken, 0);

/** The expiry of the certificate that attending creates: the session date plus the programme's validity, or none if it does not expire. */
export function certificateExpiry(sessionDate: string, validityMonths: number | null): string | null {
  return validityMonths ? iso(addMonths(d(sessionDate), validityMonths)) : null;
}

export function canEnrol(s: { status: SessionStatus; sessionDate: string; seats: number; taken: number }, today: string): string | null {
  if (s.status === "CANCELLED") return "This session was cancelled.";
  if (s.status === "COMPLETED") return "This session is completed.";
  if (s.sessionDate < today) return "This session has already taken place.";
  if (seatsLeft(s.seats, s.taken) === 0) return "This session is full.";
  return null;
}

/** Attendance is recorded on or after the day of the session (and may be corrected after it is completed), never for a cancelled one. */
export function canMarkAttendance(s: { status: SessionStatus; sessionDate: string }, today: string): string | null {
  if (s.status === "CANCELLED") return "This session was cancelled.";
  if (today < s.sessionDate) return "Attendance can't be recorded before the session takes place.";
  return null;
}

export type NeedEvent = "ENROLLED" | "UNENROLLED" | "ATTENDED" | "DROPPED";
/** Where a need goes after an event, or null if the event does not apply. Met and Dropped are final. */
export function needStatusAfter(from: NeedStatus, event: NeedEvent): NeedStatus | null {
  if (from === "MET" || from === "DROPPED") return null;
  if (event === "ENROLLED") return from === "OPEN" ? "PLANNED" : null;
  if (event === "UNENROLLED") return from === "PLANNED" ? "OPEN" : null;
  if (event === "ATTENDED") return "MET";
  return "DROPPED";
}

/** The first and last day of a month given as "YYYY-MM". */
export function monthRange(month: string): { from: string; to: string } {
  const first = d(`${month}-01`);
  return { from: iso(first), to: iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))) };
}
