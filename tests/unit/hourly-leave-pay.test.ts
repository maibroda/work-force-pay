import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HourlySiteInput } from "@/lib/payroll/engine";
import { MoneyError } from "@/lib/money-exact";
import { addLeavePay, leaveWithoutBasic } from "@/lib/payroll/hourly-leave-pay";
import { DEFAULT_EARNINGS, type StructureDef } from "@/lib/payroll/structure";

/**
 * Hourly pay, H14 piece 1 (docs/plans/hourly-payroll-h14-build-plan.md): the leave pay for a person paid by the hour is a PERCENTAGE ADDED TO EVERY HOUR WORKED (the founder's answers of 2026-11-20), from the day they complete
 * the company's service period for annual leave. This is the pure step that works it out for each site's hours: the percentage of the pay for the hours worked on or after that day (the caller marks which minutes of each line
 * those are), in whole kobo, rounded half up once. No figure is built in: the percentage is the company's. The rates and percentages here are INVENTED.
 */
const STRUCT: StructureDef = { id: "std", code: "STD", name: "std", isPartial: false, components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })) };
const site = (lines: HourlySiteInput["lines"], over: Partial<HourlySiteInput> = {}): HourlySiteInput => ({ key: "b1|k1|std", clientId: "c1", clientName: "Client", contractId: "k1", beatId: "b1", beatName: "Site", structure: STRUCT, from: "2043-03-01", to: "2043-03-31", dates: ["2043-03-03"], lines, ...over });
const line = (minutes: number, rate: number, amountKobo: number, eligibleMinutes?: number): HourlySiteInput["lines"][number] => ({ dayClass: "WEEKDAY", minutes, rate, amountKobo, ...(eligibleMinutes === undefined ? {} : { eligibleMinutes }) });

describe("addLeavePay: the percentage of the pay for hours worked after the service period", () => {
  it("is the percentage of the pay for the eligible hours, added to the site as its own leave pay", () => {
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 600)])], 10); // 10 h at 1,000 = 10,000.00, all eligible
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 1_000_000, pct: 10, amountKobo: 100_000 }]); // 10% = 1,000.00
  });

  it("counts only the minutes worked on or after the eligibility day (a line part before and part after)", () => {
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 300)])], 10); // 5 of the 10 hours are eligible: base 5,000.00
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 500_000, pct: 10, amountKobo: 50_000 }]);
  });

  it("is nothing for hours with no eligible minutes (the person has not yet completed the service period)", () => {
    expect(addLeavePay([site([line(600, 1000, 1_000_000)])], 10)[0].allowances).toBeUndefined();
    expect(addLeavePay([site([line(600, 1000, 1_000_000, 0)])], 10)[0].allowances).toBeUndefined();
  });

  it("is nothing at 0% (off): the sites come back as they were", () => {
    const sites = [site([line(600, 1000, 1_000_000, 600)])];
    expect(addLeavePay(sites, 0)).toEqual(sites);
  });

  it("works each site on its own and each line's eligible pay is rounded to the kobo once before the percentage is taken", () => {
    const a = site([line(61, 1000, 101_667, 61), line(30, 1500, 75_000, 30)], { key: "b1|k1|std" }); // 61 min at 1,000 an hour = 1,016.67 (rounded to the kobo); 30 min at 1,500 = 750.00
    const b = site([line(120, 1000, 200_000, 120)], { key: "b2|k1|std", beatId: "b2", beatName: "Site 2" });
    const [sa, sb] = addLeavePay([a, b], 8.33);
    expect(sa.allowances![0].baseKobo).toBe(176_667); // 1,016.67 + 750.00 = 1,766.67
    expect(sa.allowances![0].amountKobo).toBe(14_716); // 8.33% of 1,766.67 = 147.163611, which rounds to 147.16
    expect(sb.allowances![0].baseKobo).toBe(200_000); // 2 h at 1,000 = 2,000.00
    expect(sb.allowances![0].amountKobo).toBe(16_660); // 8.33% of 2,000.00 = 166.60
  });

  it("rounds half up to the kobo, once", () => {
    // 8.33% of 1,234.56 = 102.838848, which rounds to 102.84
    const [s] = addLeavePay([site([line(60, 1234.56, 123_456, 60)])], 8.33);
    expect(s.allowances![0].amountKobo).toBe(10_284);
  });

  it("refuses a percentage that is not from 0 to 100", () => {
    expect(() => addLeavePay([site([line(60, 1000, 100_000, 60)])], -1)).toThrow(MoneyError);
    expect(() => addLeavePay([site([line(60, 1000, 100_000, 60)])], 101)).toThrow(MoneyError);
  });

  it("does not change the hours, the lines or the sites it was given", () => {
    const original = site([line(600, 1000, 1_000_000, 600)]);
    const copy = JSON.parse(JSON.stringify(original));
    addLeavePay([original], 10);
    expect(JSON.parse(JSON.stringify(original))).toEqual(copy);
  });
});

describe("addLeavePay: a percentage chosen per site (the contract rate may set its own)", () => {
  it("takes the percentage for each site from a function, so two sites can have different percentages", () => {
    const a = site([line(600, 1000, 1_000_000, 600)], { key: "b1|k1|std", contractId: "k1" });
    const b = site([line(600, 1000, 1_000_000, 600)], { key: "b2|k2|std", contractId: "k2", beatId: "b2", beatName: "Site 2" });
    const [x, y] = addLeavePay([a, b], (s) => (s.contractId === "k1" ? 5 : 10));
    expect(x.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 1_000_000, pct: 5, amountKobo: 50_000 }]);
    expect(y.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 1_000_000, pct: 10, amountKobo: 100_000 }]);
  });

  it("gives nothing to a site whose percentage is 0, and rejects a percentage outside 0 to 100 from the function too", () => {
    const a = site([line(600, 1000, 1_000_000, 600)]);
    expect(addLeavePay([a], () => 0)[0].allowances).toBeUndefined();
    expect(() => addLeavePay([a], () => 101)).toThrow(MoneyError);
    expect(() => addLeavePay([a], () => -1)).toThrow(MoneyError);
  });
});

describe("addLeavePay on the BASIC part (the founder's decision: leave pay is a percentage of the Basic salary)", () => {
  // the test structure gives Basic 10% of the gross (DEFAULT_EARNINGS), so the Basic part of 10,000.00 of hours is 1,000.00
  it("is the percentage of the Basic part of the eligible pay, and the stored base is that Basic part", () => {
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 600)])], 10, "BASIC"); // 10 h at 1,000 = 10,000.00; Basic 1,000.00; 10% = 100.00
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 100_000, pct: 10, amountKobo: 10_000, basis: "BASIC" }]);
  });

  it("at 2.5%: 2.5% of the Basic part of 10,000.00 is 25.00", () => {
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 600)])], 2.5, "BASIC");
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 100_000, pct: 2.5, amountKobo: 2_500, basis: "BASIC" }]);
  });

  it("counts only the eligible minutes, as for the all-pay basis", () => {
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 300)])], 10, "BASIC"); // 5 of 10 hours eligible: pay 5,000.00, Basic 500.00, 10% = 50.00
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 50_000, pct: 10, amountKobo: 5_000, basis: "BASIC" }]);
  });

  it("rounds half up to the kobo at each line: the Basic part once, then the leave pay once", () => {
    // 61 min at 1,000 an hour = 1,016.67 of pay; Basic 10% = 101.667, which rounds to 101.67; 2.5% of 101.67 = 2.54175, which rounds to 2.54
    const [s] = addLeavePay([site([line(61, 1000, 101_667, 61)])], 2.5, "BASIC");
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 10_167, pct: 2.5, amountKobo: 254, basis: "BASIC" }]);
  });

  it("uses the Basic component of the site's own structure: a structure with Basic at 40% gives four times as much", () => {
    const forty: StructureDef = { ...STRUCT, id: "forty", code: "FORTY", components: [{ code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 40, taxable: true, pensionable: true, active: true, sortOrder: 0 }, { code: "HOUSING", name: "Housing", calcType: "PERCENTAGE", percentage: 60, taxable: true, pensionable: true, active: true, sortOrder: 1 }] };
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 600)], { structure: forty })], 10, "BASIC");
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 400_000, pct: 10, amountKobo: 40_000, basis: "BASIC" }]);
  });

  it("a structure with no Basic component pays no leave pay, and leaveWithoutBasic names that site so the pay run can raise a finding", () => {
    const noBasic: StructureDef = { ...STRUCT, id: "nb", code: "NB", components: [{ code: "HOUSING", name: "Housing", calcType: "PERCENTAGE", percentage: 100, taxable: true, pensionable: true, active: true, sortOrder: 0 }] };
    const sites = [site([line(600, 1000, 1_000_000, 600)], { structure: noBasic })];
    expect(addLeavePay(sites, 10, "BASIC")[0].allowances).toBeUndefined();
    expect(leaveWithoutBasic(sites, 10, "BASIC").map((x) => x.beatId)).toEqual(["b1"]);
    expect(leaveWithoutBasic([site([line(600, 1000, 1_000_000, 600)])], 10, "BASIC")).toEqual([]); // a structure with Basic: none
    expect(leaveWithoutBasic(sites, 10, "ALL_PAY")).toEqual([]); // the all-pay basis never needs a Basic part
    expect(leaveWithoutBasic(sites, 0, "BASIC")).toEqual([]); // leave pay off
    expect(leaveWithoutBasic([site([line(600, 1000, 1_000_000)], { structure: noBasic })], 10, "BASIC")).toEqual([]); // nothing eligible: nothing to pay
  });

  it("the all-pay basis is unchanged (the default), so a rule version made before this decision still works the same", () => {
    const [s] = addLeavePay([site([line(600, 1000, 1_000_000, 600)])], 10, "ALL_PAY");
    expect(s.allowances).toEqual([{ kind: "LEAVE_PERCENT", baseKobo: 1_000_000, pct: 10, amountKobo: 100_000 }]);
    expect(addLeavePay([site([line(600, 1000, 1_000_000, 600)])], 10)[0].allowances).toEqual(s.allowances);
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-leave-pay.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
