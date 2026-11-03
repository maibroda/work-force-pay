import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/entitlements/catalogue";
import { priceBlueprint, type PriceBookData } from "@/lib/entitlements/pricing";

/**
 * Step E4b of docs/plans/module-entitlements-e4.md: what a blueprint costs per month, from a price book. Pure, and exact: whole kobo, rounded half up once (only the VAT line can
 * need rounding, because a price in kobo times a whole number is already exact). **Every amount in this file is a TEST value chosen so the arithmetic can be checked by hand; none is
 * a price the founder has given.** The founder's real amounts are entered in the price book and are never in code.
 */
const book = (over: Partial<PriceBookData> = {}): PriceBookData => ({
  currency: "NGN",
  effectiveFrom: "2100-01-01",
  minimumMonthly: "50000.00",
  lines: [
    { moduleKey: "payroll", basis: "active_employee", amount: "1500.00" },
    { moduleKey: "hr", basis: "active_employee", amount: "800.50" },
    { moduleKey: "crm", basis: "crm_user", amount: "12000.00" },
    { moduleKey: "analytics", basis: "flat", amount: "25000.00" },
  ],
  ...over,
});
const price = (modules: ModuleKey[], employees: number, o: { crmUsers?: number | null; book?: PriceBookData | null; vat?: string | null } = {}) =>
  priceBlueprint({ modules, employees, crmUsers: o.crmUsers ?? null, book: o.book === undefined ? book() : o.book, vatRatePct: o.vat === undefined ? "7.5" : o.vat });

describe("worked quotes (test amounts, checked by hand)", () => {
  it("Payroll for 120 employees at 1,500.00 each: 180,000.00, above the 50,000.00 minimum, plus 7.5% VAT of 13,500.00", () => {
    const q = price(["core", "payroll"], 120);
    expect(q.ok).toBe(true);
    expect(q.lines).toEqual([{ moduleKey: "payroll", name: "Payroll", basis: "active_employee", quantity: 120, unitPrice: "1500.00", monthly: "180000.00" }]);
    expect(q).toMatchObject({ subtotal: "180000.00", minimumApplied: false, monthly: "180000.00", vat: "13500.00", monthlyWithVat: "193500.00", currency: "NGN" });
  });

  it("the minimum applies when the total is below it: 20 employees is 30,000.00, so the quote is 50,000.00 (VAT 3,750.00)", () => {
    const q = price(["core", "payroll"], 20);
    expect(q).toMatchObject({ subtotal: "30000.00", minimumApplied: true, monthly: "50000.00", vat: "3750.00", monthlyWithVat: "53750.00" });
  });

  it("several modules for 37 employees: 55,500.00 + 29,618.50 + a flat 25,000.00 = 110,118.50; VAT 8,258.8875 rounds half up to 8,258.89; 118,377.39 in all", () => {
    const q = price(["core", "payroll", "hr", "analytics"], 37);
    expect(q.lines.map((l) => [l.moduleKey, l.monthly])).toEqual([["hr", "29618.50"], ["payroll", "55500.00"], ["analytics", "25000.00"]]); // in the catalogue's order
    expect(q.lines.find((l) => l.moduleKey === "analytics")).toMatchObject({ basis: "flat", quantity: null, unitPrice: "25000.00" });
    expect(q).toMatchObject({ subtotal: "110118.50", monthly: "110118.50", vat: "8258.89", monthlyWithVat: "118377.39" });
  });

  it("a per-user module is priced by the number of CRM users, not employees: 5 users at 12,000.00 is 60,000.00", () => {
    const q = price(["core", "crm"], 200, { crmUsers: 5 });
    expect(q.lines).toEqual([{ moduleKey: "crm", name: "CRM", basis: "crm_user", quantity: 5, unitPrice: "12000.00", monthly: "60000.00" }]);
    expect(q.monthly).toBe("60000.00");
  });

  it("rounds half up, once, on the VAT line only: 1.01 at 7.5% is 0.07575, so 0.08", () => {
    const tiny = book({ minimumMonthly: "0.00", lines: [{ moduleKey: "analytics", basis: "flat", amount: "1.01" }] });
    expect(price(["core", "analytics"], 1, { book: tiny })).toMatchObject({ monthly: "1.01", vat: "0.08", monthlyWithVat: "1.09" });
  });
});

describe("what a quote will not do", () => {
  it("shows no total, and says which modules have no price, when any module is unpriced", () => {
    const q = price(["core", "payroll", "inventory", "accounting"], 50);
    expect(q.ok).toBe(false);
    expect(q.unpriced).toEqual(["accounting", "inventory"]); // in the catalogue's order, whatever order they were asked in
    expect(q.reasons).toEqual(["No price is set for: Accounting, Inventory."]);
    expect(q).toMatchObject({ subtotal: null, monthly: null, vat: null, monthlyWithVat: null });
    expect(q.lines.map((l) => l.moduleKey)).toEqual(["payroll"]); // what is priced is still shown
  });

  it("shows no total when no price book is in force, and says so", () => {
    const q = price(["core", "payroll"], 50, { book: null });
    expect(q).toMatchObject({ ok: false, monthly: null, lines: [], priceBookFrom: null });
    expect(q.reasons).toEqual(["No price book is in force for this date."]);
  });

  it("refuses a per-user module with no number of users", () => {
    const q = price(["core", "crm"], 50, { crmUsers: null });
    expect(q.ok).toBe(false);
    expect(q.reasons).toContain("CRM is priced per user: say how many sales users there will be.");
    expect(q.monthly).toBeNull();
  });

  it("refuses a price that was written for a different way of charging than the module has now, rather than guess", () => {
    const stale = book({ lines: [{ moduleKey: "analytics", basis: "active_employee", amount: "10.00" }] });
    const q = price(["core", "analytics"], 10, { book: stale });
    expect(q.ok).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/Analytics.*priced per employee.*charged flat/);
  });

  it("gives no VAT when no rate is known, without failing the quote", () => {
    const q = price(["core", "payroll"], 120, { vat: null });
    expect(q).toMatchObject({ ok: true, monthly: "180000.00", vat: null, monthlyWithVat: null, vatRatePct: null });
  });

  it("charges nothing for the core, which is always included, and has no line for it", () => {
    const q = price(["core"], 10, { book: book({ minimumMonthly: "0.00" }) });
    expect(q).toMatchObject({ ok: true, lines: [], subtotal: "0.00", monthly: "0.00" });
  });

  it("refuses an employee count that is not a whole number of 1 or more", () => {
    for (const employees of [0, -1, 2.5, Number.NaN]) expect(price(["core", "payroll"], employees).ok, String(employees)).toBe(false);
  });
});

describe("always", () => {
  it("adds up exactly: the lines sum to the subtotal, the total is the larger of that and the minimum, and VAT plus total is the total with VAT", () => {
    const sets: ModuleKey[][] = [["payroll"], ["payroll", "hr"], ["hr", "analytics"], ["payroll", "hr", "analytics", "crm"]];
    for (const m of sets)
      for (const employees of [1, 7, 33, 120, 999, 3000]) {
        const q = price(["core", ...m], employees, { crmUsers: 4 });
        const cents = (s: string) => BigInt(s.replace(".", ""));
        expect(q.ok).toBe(true);
        expect(q.lines.reduce((t, l) => t + cents(l.monthly), 0n)).toBe(cents(q.subtotal!));
        expect(cents(q.monthly!)).toBe(cents(q.subtotal!) > 5_000_000n ? cents(q.subtotal!) : 5_000_000n);
        expect(cents(q.monthlyWithVat!)).toBe(cents(q.monthly!) + cents(q.vat!));
      }
  });

  it("is the same every time and does not change what it is given", () => {
    const b = book();
    const before = JSON.stringify(b);
    expect(price(["core", "payroll", "hr"], 80, { book: b })).toEqual(price(["core", "payroll", "hr"], 80, { book: b }));
    expect(JSON.stringify(b)).toBe(before);
  });
});
