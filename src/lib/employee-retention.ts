/**
 * Pure rules for removing a former employee's personal details. No database here.
 *
 * The company sets how many years after someone leaves it must keep their records (tax and pension duties). Until
 * then nothing can be erased, whoever asks. After it, the details can go — but only when nothing is still owed
 * either way, and only when a second person agrees.
 */
import { addMonths } from "./leave";

export const LEFT_STATUSES = ["TERMINATED", "RESIGNED", "EXITED"] as const;

export const ERASURE_KIND_LABELS = {
  RETENTION: "Retention period over",
  REQUEST: "Person asked for erasure",
} as const;

/** The first day the records may be erased: the exit date plus the retention period. */
export function eraseFrom(exitDate: Date, years: number): Date {
  return addMonths(exitDate, years * 12);
}

export interface ErasureFacts {
  /** Years to keep records after leaving; 0 = the feature is off. */
  years: number;
  status: string;
  exitDate: Date | null;
  anonymizedAt: Date | null;
  today: Date;
  /** Naira still owed on live staff loans. */
  loanOwed: number;
  /** Settlements started but not yet released. */
  settlementsOpen: number;
  /** Employee-relations cases not yet closed. */
  casesOpen: number;
  /** Data access requests not yet answered. */
  dataRequestsOpen: number;
  /** Another erasure request for the same person is already waiting. */
  alreadyPending: boolean;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Everything standing in the way, in plain words. Empty = it can go ahead. */
export function erasureBlockers(f: ErasureFacts): string[] {
  if (f.years <= 0) return ["Set how long records are kept (Settings → HR & Lifecycle Policy → Data retention) before anything can be erased."];
  const out: string[] = [];
  if (f.anonymizedAt) return ["Their personal details have already been removed."];
  if (!(LEFT_STATUSES as readonly string[]).includes(f.status)) out.push(`They haven't left (status ${f.status.replace(/_/g, " ").toLowerCase()}).`);
  else if (!f.exitDate) out.push("There is no exit date, so the retention period can't be counted.");
  else {
    const from = eraseFrom(f.exitDate, f.years);
    if (f.today < from) out.push(`Records must be kept until ${day(from)} (${f.years} year${f.years === 1 ? "" : "s"} after they left).`);
  }
  if (f.loanOwed > 0) out.push("They still owe a staff loan.");
  if (f.settlementsOpen > 0) out.push("An end-of-service settlement hasn't been released.");
  if (f.casesOpen > 0) out.push("An employee-relations case is still open.");
  if (f.dataRequestsOpen > 0) out.push("A data access request for them is still open.");
  if (f.alreadyPending) out.push("An erasure request for them is already waiting for approval.");
  return out;
}
