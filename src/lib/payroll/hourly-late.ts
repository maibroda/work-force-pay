/**
 * Hourly pay, phase 4c (docs/plans/hourly-payroll-phase4-plan.md): the pure rule for hours that were NOT paid when a payroll was locked. Pure: no database, no framework.
 *
 * The founder's H22 and his answers of 2026-11-20: such hours (a shift approved after the lock) are paid by a supplementary payroll; a correction made after the lock pays only what is still OWED (the increase),
 * and a correction that means the person was overpaid is FLAGGED for a manual deduction, never turned into negative pay. This works that out from two lists of the paid pieces of shifts (a piece is the minutes
 * of one class of day at one site on one day): the pieces of approved shifts that no payroll has paid yet, and the pieces of shifts that WERE paid and have since been replaced by a correction (the "credit").
 * Minutes are set against each other by site, contract, day and class of day, so the rate that applies is always the one for that class. A shift moved to another day or site is owed at the new day and flagged
 * at the old one: they are different days at possibly different rates, so they are not netted.
 *
 * Every piece looked at is returned in `paidIds` or `creditedIds`, so the pay run can mark it and nothing is paid or credited twice.
 */
import type { DayClass } from "./hourly";
import type { ApprovedPiece } from "./hourly-earnings";

export interface SegRef {
  segmentId: string;
  entryId: string;
  employeeId: string;
  beatId: string;
  contractId: string;
  clientId: string;
  date: string;
  dayClass: DayClass;
  minutes: number;
}

export interface Decrease {
  employeeId: string;
  beatId: string;
  contractId: string;
  date: string;
  dayClass: DayClass;
  /** The minutes the person was paid for that are no longer worked. */
  minutes: number;
}

export interface LateNet {
  /** What is still owed, as pieces for the pay engine. Each also lists the credit pieces it was set against, to be marked as credited once the piece is actually paid. */
  pieces: Array<ApprovedPiece & { creditSegmentIds: string[] }>;
  /** Groups that need no pay (they net to nothing, or to a decrease): their pieces are settled and can be marked at once, whatever the rates say. */
  settled: Array<{ employeeId: string; segmentIds: string[]; creditSegmentIds: string[] }>;
  /** What was overpaid, to be recovered by a deduction someone enters. */
  decreases: Decrease[];
  /** Every unpaid piece that was looked at (now to be marked as paid). */
  paidIds: string[];
  /** Every credit piece that was looked at (now to be marked as credited). */
  creditedIds: string[];
}

const keyOf = (s: Pick<SegRef, "employeeId" | "beatId" | "contractId" | "date" | "dayClass">) => [s.employeeId, s.beatId, s.contractId, s.date, s.dayClass].join("|");

export function netLatePieces(unpaid: readonly SegRef[], credit: readonly SegRef[]): LateNet {
  const keys = new Map<string, { sample: SegRef; owed: number; credited: number; segmentIds: string[]; entryIds: string[]; creditSegmentIds: string[] }>();
  const slot = (s: SegRef) => {
    const k = keyOf(s);
    let v = keys.get(k);
    if (!v) {
      v = { sample: s, owed: 0, credited: 0, segmentIds: [], entryIds: [], creditSegmentIds: [] };
      keys.set(k, v);
    }
    return v;
  };
  for (const s of unpaid) {
    const v = slot(s);
    v.owed += s.minutes;
    v.segmentIds.push(s.segmentId);
    if (!v.entryIds.includes(s.entryId)) v.entryIds.push(s.entryId);
  }
  for (const s of credit) {
    const v = slot(s);
    v.credited += s.minutes;
    v.creditSegmentIds.push(s.segmentId);
  }
  const pieces: LateNet["pieces"] = [];
  const settled: LateNet["settled"] = [];
  const decreases: Decrease[] = [];
  for (const v of keys.values()) {
    const net = v.owed - v.credited;
    const s = v.sample;
    if (net > 0) pieces.push({ employeeId: s.employeeId, beatId: s.beatId, contractId: s.contractId, clientId: s.clientId, date: s.date, dayClass: s.dayClass, minutes: net, entryIds: v.entryIds, segmentIds: v.segmentIds, creditSegmentIds: v.creditSegmentIds });
    else {
      if (net < 0) decreases.push({ employeeId: s.employeeId, beatId: s.beatId, contractId: s.contractId, date: s.date, dayClass: s.dayClass, minutes: -net });
      settled.push({ employeeId: s.employeeId, segmentIds: v.segmentIds, creditSegmentIds: v.creditSegmentIds });
    }
  }
  return { pieces, settled, decreases, paidIds: unpaid.map((s) => s.segmentId), creditedIds: credit.map((s) => s.segmentId) };
}
