import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DayClass } from "@/lib/payroll/hourly";
import { netLatePieces, type SegRef } from "@/lib/payroll/hourly-late";

/**
 * Hourly pay, phase 4c (docs/plans/hourly-payroll-phase4-plan.md), the founder's H22 and his answers of 2026-11-20: hours that were not paid when a payroll was locked (a shift approved late) are paid by a
 * supplementary payroll; a correction made after the lock pays only what is still OWED (the increase), and a correction that means the person was overpaid is FLAGGED for a manual deduction, never turned into
 * negative pay. This is the pure rule that works that out: the pieces not yet paid, set against the pieces of shifts that were paid and have since been replaced by a correction. Minutes are compared by site,
 * contract, day and class of day, so the rate that applies is always the one for that class.
 */
let n = 0;
const seg = (date: string, dayClass: DayClass, minutes: number, over: Partial<SegRef> = {}): SegRef => ({ segmentId: `s${++n}`, entryId: `e${n}`, employeeId: "e1", beatId: "b1", contractId: "k1", clientId: "c1", date, dayClass, minutes, ...over });
const shape = (r: ReturnType<typeof netLatePieces>) => ({ pieces: r.pieces.map((p) => [p.date, p.dayClass, p.minutes]), decreases: r.decreases.map((x) => [x.date, x.dayClass, x.minutes]) });

describe("netLatePieces: what is still owed for hours that missed a payroll", () => {
  it("a shift approved after the lock, with nothing to set against it, is owed in full", () => {
    const r = netLatePieces([seg("2026-11-20", "WEEKDAY", 300), seg("2026-11-21", "WEEKEND", 420)], []);
    expect(shape(r)).toEqual({ pieces: [["2026-11-20", "WEEKDAY", 300], ["2026-11-21", "WEEKEND", 420]], decreases: [] });
  });

  it("pieces of the same site, day and class are added together", () => {
    const r = netLatePieces([seg("2026-11-20", "WEEKDAY", 120), seg("2026-11-20", "WEEKDAY", 270)], []);
    expect(shape(r).pieces).toEqual([["2026-11-20", "WEEKDAY", 390]]);
  });

  it("a correction that adds time: only the increase is owed (the shift was paid for 480 minutes and is now worth 540)", () => {
    const r = netLatePieces([seg("2026-11-20", "WEEKDAY", 540)], [seg("2026-11-20", "WEEKDAY", 480)]);
    expect(shape(r)).toEqual({ pieces: [["2026-11-20", "WEEKDAY", 60]], decreases: [] });
  });

  it("a correction that takes time off: nothing is paid, and the 60 minutes the person was overpaid are flagged, never negative pay", () => {
    const r = netLatePieces([seg("2026-11-20", "WEEKDAY", 420)], [seg("2026-11-20", "WEEKDAY", 480)]);
    expect(shape(r)).toEqual({ pieces: [], decreases: [["2026-11-20", "WEEKDAY", 60]] });
  });

  it("a correction that changes nothing owes nothing and flags nothing", () => {
    expect(shape(netLatePieces([seg("2026-11-20", "WEEKDAY", 480)], [seg("2026-11-20", "WEEKDAY", 480)]))).toEqual({ pieces: [], decreases: [] });
  });

  it("a shift moved to another day: the new day is owed and the old day's overpayment is flagged (the two are not netted: they are different days at possibly different rates)", () => {
    const r = netLatePieces([seg("2026-11-21", "WEEKEND", 480)], [seg("2026-11-20", "WEEKDAY", 480)]);
    expect(shape(r)).toEqual({ pieces: [["2026-11-21", "WEEKEND", 480]], decreases: [["2026-11-20", "WEEKDAY", 480]] });
  });

  it("a shift moved to another site is owed at the new site and flagged at the old one", () => {
    const r = netLatePieces([seg("2026-11-20", "WEEKDAY", 480, { beatId: "b2" })], [seg("2026-11-20", "WEEKDAY", 480)]);
    expect(r.pieces.map((p) => [p.beatId, p.minutes])).toEqual([["b2", 480]]);
    expect(r.decreases.map((x) => [x.beatId, x.minutes])).toEqual([["b1", 480]]);
  });

  it("the pieces carry the segments and shifts they came from, and every segment looked at is marked, so nothing is paid or credited twice", () => {
    const a = seg("2026-11-20", "WEEKDAY", 540);
    const old = seg("2026-11-20", "WEEKDAY", 480);
    const r = netLatePieces([a], [old]);
    expect(r.paidIds).toEqual([a.segmentId]);
    expect(r.creditedIds).toEqual([old.segmentId]);
    expect(r.pieces[0]).toMatchObject({ segmentIds: [a.segmentId], entryIds: [a.entryId] });
  });

  it("a piece lists the credit it was set against, and a group that nets to nothing or to a decrease is settled at once (its pieces are marked whatever the rates say)", () => {
    const owed = seg("2026-11-20", "WEEKDAY", 540);
    const oldOwed = seg("2026-11-20", "WEEKDAY", 480);
    const less = seg("2026-11-21", "WEEKEND", 100);
    const oldLess = seg("2026-11-21", "WEEKEND", 160);
    const same = seg("2026-11-22", "WEEKEND", 60);
    const oldSame = seg("2026-11-22", "WEEKEND", 60);
    const r = netLatePieces([owed, less, same], [oldOwed, oldLess, oldSame]);
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].creditSegmentIds).toEqual([oldOwed.segmentId]);
    expect(r.settled.flatMap((g) => g.segmentIds).sort()).toEqual([less.segmentId, same.segmentId].sort());
    expect(r.settled.flatMap((g) => g.creditSegmentIds).sort()).toEqual([oldLess.segmentId, oldSame.segmentId].sort());
    expect(r.settled.every((g) => g.employeeId === "e1")).toBe(true);
    expect(r.decreases).toEqual([{ employeeId: "e1", beatId: "b1", contractId: "k1", date: "2026-11-21", dayClass: "WEEKEND", minutes: 60 }]);
  });

  it("every minute is accounted for: what is owed minus what is flagged is the unpaid minutes minus the credited ones", () => {
    const unpaid = [seg("2026-11-20", "WEEKDAY", 300), seg("2026-11-21", "WEEKEND", 100), seg("2026-11-22", "WEEKEND", 50)];
    const credit = [seg("2026-11-20", "WEEKDAY", 120), seg("2026-11-21", "WEEKEND", 160), seg("2026-11-23", "WEEKDAY", 40)];
    const r = netLatePieces(unpaid, credit);
    const owed = r.pieces.reduce((a, p) => a + p.minutes, 0);
    const flagged = r.decreases.reduce((a, x) => a + x.minutes, 0);
    expect(owed - flagged).toBe(unpaid.reduce((a, s) => a + s.minutes, 0) - credit.reduce((a, s) => a + s.minutes, 0));
    expect(owed).toBe(180 + 50); // 300-120 and 50 (the 100 against 160 is a decrease of 60; 40 on the 23rd is a decrease of 40)
    expect(flagged).toBe(60 + 40);
  });

  it("nothing to look at is nothing owed", () => {
    expect(netLatePieces([], [])).toEqual({ pieces: [], settled: [], decreases: [], paidIds: [], creditedIds: [] });
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-late.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
