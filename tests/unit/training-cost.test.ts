import { describe, expect, it } from "vitest";
import { asKobo } from "@/lib/money-exact";
import { MIN_ATTENDANCES, allocateEqually, foldSmall } from "@/lib/training-cost";

// Training cost (slice 4A, approved 2026-11-17: plan docs/plans/hr-phases-4-5-plan.md, section 6). Two pure rules, in exact kobo:
// 1. a session's cost is shared EQUALLY per attendee, to the exact kobo, nothing lost and nothing invented (the remainder goes one kobo at a time to the first attendees);
// 2. a breakdown never shows a row that comes from fewer than three attendances, so one named person's cost cannot be read off it, and a hidden row cannot be found by subtraction.

const k = (n: number) => asKobo(n);

describe("sharing a session's cost equally per attendee", () => {
  it("gives each attendee the same whole kobo and the remainder, one kobo each, to the first", () => {
    expect(allocateEqually(k(100), 3)).toEqual([34, 33, 33]);
    expect(allocateEqually(k(100), 4)).toEqual([25, 25, 25, 25]);
    expect(allocateEqually(k(1), 3)).toEqual([1, 0, 0]);
    // 100,000,000 kobo / 7 = 14,285,714 each with 2 kobo left over: the first two attendees take one each
    expect(allocateEqually(k(1_000_000_00), 7)).toEqual([14285715, 14285715, 14285714, 14285714, 14285714, 14285714, 14285714]);
  });
  it("always adds back to the exact total", () => {
    for (const total of [0, 1, 2, 99, 100, 101, 12_345_67, 999_999_99, 5_000_000_00]) for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 100]) expect(allocateEqually(k(total), n)!.reduce((a, b) => a + b, 0), `${total} among ${n}`).toBe(total);
  });
  it("is symmetric for a reversal (a negative total shares the same way, with the opposite sign)", () => {
    expect(allocateEqually(k(-100), 3)).toEqual([-34, -33, -33]);
    expect(allocateEqually(k(-100), 3)!.reduce((a, b) => a + b, 0)).toBe(-100);
  });
  it("has nobody to share among when nobody attended", () => {
    expect(allocateEqually(k(500), 0)).toBeNull();
  });
});

describe("a breakdown that never shows fewer than three attendances", () => {
  const row = (key: string, amount: number, attendances: number) => ({ key, label: key, amount: k(amount), attendances });
  it("shows every row when each has three or more attendances", () => {
    const f = foldSmall([row("A", 900, 9), row("B", 300, 3)]);
    expect(f.shown.map((r) => r.key)).toEqual(["A", "B"]);
    expect(f.other).toBeNull();
  });
  it("folds a small row into one 'other' row, shown only if it has three or more attendances itself", () => {
    const f = foldSmall([row("A", 900, 9), row("B", 100, 1), row("C", 200, 2)]);
    expect(f.shown.map((r) => r.key)).toEqual(["A"]);
    expect(f.other).toEqual({ amount: 300, attendances: 3, rows: 2, shown: true });
  });
  it("hides a second row when the folded ones are still too small, so they cannot be worked out by subtraction", () => {
    // B alone (one attendance) is hidden; showing A and the total would give B by subtraction, so the smallest shown row joins it
    const f = foldSmall([row("A", 900, 9), row("B", 100, 1), row("C", 450, 5)]);
    expect(f.shown.map((r) => r.key)).toEqual(["A"]);
    expect(f.other).toEqual({ amount: 550, attendances: 6, rows: 2, shown: true });
  });
  it("shows nothing at all when the whole year has fewer than three attendances", () => {
    const f = foldSmall([row("A", 100, 1), row("B", 200, 1)]);
    expect(f.shown).toEqual([]);
    expect(f.other).toEqual({ amount: null, attendances: 2, rows: 2, shown: false });
  });
  it("says what the minimum is", () => {
    expect(MIN_ATTENDANCES).toBe(3);
  });
  it("loses nothing and invents nothing: the shown rows and the other row always add back to the total (many random cases)", () => {
    let seed = 99;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const rows = Array.from({ length: 1 + next(7) }, (_, j) => row(`R${j}`, next(5_000_00), next(8)));
      const f = foldSmall(rows);
      const label = JSON.stringify(rows);
      expect(f.shown.reduce((a, r) => a + r.amount, 0) + (f.other?.rows ? rows.filter((r) => !f.shown.some((s) => s.key === r.key)).reduce((a, r) => a + r.amount, 0) : 0), label).toBe(rows.reduce((a, r) => a + r.amount, 0));
      for (const r of f.shown) expect(r.attendances >= MIN_ATTENDANCES, label).toBe(true);
      // next to a shown row, the folded remainder is itself large enough to show (so it cannot be recovered by subtraction)
      if (f.other && f.shown.length > 0) expect(f.other.shown, label).toBe(true);
    }
  });
});
