import { describe, expect, it } from "vitest";
import { d, eachDay } from "@/lib/dates";
import { MoneyError } from "@/lib/money-exact";
import { calculateEmployeePayroll, type EngineInput, type HourlySiteInput, type RateInfo, type WorkDay } from "@/lib/payroll/engine";
import { NTA_2025_BANDS, type TaxRuleDef } from "@/lib/payroll/paye";
import { DEFAULT_EARNINGS, type StructureDef } from "@/lib/payroll/structure";

/**
 * Hourly pay, phase 4a (docs/plans/hourly-payroll-phase4-plan.md): the pay engine takes an optional "hourly" input, the approved hours already priced into whole kobo per site (src/lib/payroll/hourly-earnings.ts).
 * The founder's answers of 2026-11-20: H12 hourly pay IS the person's gross earnings, taxed and pension-ed by the SAME method as monthly staff; H8 each site's gross is split by that site's salary structure; H19 the employer
 * costs worked from the client's monthly rate are not applicable for hourly staff, while ITF and NSITF apply as a percentage of gross. The proof that nothing else changes: an hourly person's gross G goes through exactly
 * the same pension, PAYE and net-pay arithmetic as a monthly person whose gross is G, and an input with no hourly part gives the answer it always has. Everything below is INVENTED figures.
 */
const STD: StructureDef = {
  id: "std",
  code: "STD",
  name: "Standard",
  isPartial: false,
  components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })),
};
/** A structure of one part: all of it Basic, taxable and pensionable. */
const ALL_BASIC: StructureDef = {
  id: "ab",
  code: "AB",
  name: "All basic",
  isPartial: false,
  components: [{ code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 100, taxable: true, pensionable: true, active: true, sortOrder: 0 }],
};
const TAX: TaxRuleDef = {
  code: "NTA",
  version: "t",
  bands: NTA_2025_BANDS,
  reliefs: [
    { code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true },
    { code: "RENT", name: "Rent", type: "PERCENT_OF_RENT_CAPPED", rate: 20, cap: 500_000, active: true },
  ],
  exemptions: [{ code: "MIN_WAGE", description: "min wage", annualGrossCeiling: 840_000, active: true }],
};
const ECR = { itfPct: 1, nsitfPct: 1, nhfMedicalPct: 0.5, insurancePct: 7.5, uniformKitsPct: 25, recruitmentTrainingPct: 10.5, leaveRelieverPct: 22, outsourcingLeaveAllowancePct: 20 };
const OCT = eachDay(d("2026-10-01"), d("2026-10-31")).map((x) => x.toISOString().slice(0, 10));

/** The base input: October (31 days), no days worked, the tax rule and pension rates; the tests add hourly sites, or days. */
const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  basisDays: 31,
  days: [],
  resolveRate: () => null,
  pension: { employeeRate: 8, employerRate: 10, version: "v" },
  taxRule: TAX,
  annualRent: 0,
  ...over,
});
const site = (over: Partial<HourlySiteInput> = {}, lines: HourlySiteInput["lines"] = [{ dayClass: "WEEKDAY", minutes: 18_000, rate: 1000, amountKobo: 30_000_000 }, { dayClass: "WEEKEND", minutes: 3_600, rate: 1500, amountKobo: 9_000_000 }, { dayClass: "HOLIDAY", minutes: 600, rate: 2000, amountKobo: 2_000_000 }]): HourlySiteInput => ({
  key: "b0|k0|std",
  clientId: "cl0",
  clientName: "Client 0",
  contractId: "k0",
  beatId: "b0",
  beatName: "Beat 0",
  structure: STD,
  from: "2026-10-01",
  to: "2026-10-31",
  dates: OCT.slice(0, 20),
  lines,
  ...over,
});
// 300 h at 1,000 + 60 h at 1,500 + 10 h at 2,000 = 300,000 + 90,000 + 20,000 = 410,000.00
const G = 410_000;

/** A monthly person whose gross is `gross`, present on every day of October at one site: the same arithmetic the hourly gross must go through. */
function monthly(gross: number, over: Partial<EngineInput> = {}): EngineInput {
  const rate: RateInfo = { key: "R0", source: "CONTRACT_RATE", agreedRate: null, operativeSharePct: null, monthlyGross: gross, structure: STD };
  const days: WorkDay[] = OCT.map((x) => ({ date: d(x), clientId: "cl0", clientName: "Client 0", contractId: "k0", beatId: "b0", beatName: "Beat 0", categoryId: "G", status: "PRESENT" as const, overtimeHours: 0 }));
  return base({ days, resolveRate: () => rate, ...over });
}

describe("an hourly person's gross goes through the same arithmetic as a monthly person's", () => {
  it("earned gross, components, pension, PAYE, deductions and net pay equal those of a monthly person whose gross is the same", () => {
    const hourly = calculateEmployeePayroll(base({ hourly: [site()] }));
    const same = calculateEmployeePayroll(monthly(G));
    expect(hourly.earnedGross).toBe(G);
    expect(hourly.components).toEqual(same.components);
    expect(hourly.earnedGross).toBe(same.earnedGross);
    expect(hourly.totalEarnings).toBe(same.totalEarnings);
    expect(hourly.pensionBase).toBe(same.pensionBase);
    expect(hourly.employeePension).toBe(same.employeePension);
    expect(hourly.employerPension).toBe(same.employerPension);
    expect(hourly.taxableIncome).toBe(same.taxableIncome);
    expect(hourly.paye).toEqual(same.paye);
    expect(hourly.netPay).toBe(same.netPay);
    expect(hourly.paye.paye).toBeGreaterThan(0); // the comparison is not of two zeros: this gross is taxed
    expect(hourly.pensionBase).toBe(159_900); // 39% of 410,000: Basic 10 + Housing 14 + Transport 15 of the standard structure
  });

  it("the same equality holds with a house rent relief, other earnings and a deduction", () => {
    const extras: Partial<EngineInput> = { annualRent: 600_000, otherEarnings: [{ id: "e", name: "Bonus", amount: 25_000, taxable: true }], deductions: [{ id: "x", type: "LOAN", amount: 10_000, authorityReference: "REF", reason: "test" }] };
    const hourly = calculateEmployeePayroll(base({ hourly: [site()], ...extras }));
    const same = calculateEmployeePayroll(monthly(G, extras));
    expect([hourly.totalEarnings, hourly.paye, hourly.totalDeductions, hourly.netPay]).toEqual([same.totalEarnings, same.paye, same.totalDeductions, same.netPay]);
    expect(hourly.totalEarnings).toBe(G + 25_000);
  });

  it("a person with no hourly part, or an empty one, gets exactly the answer they always did", () => {
    const plain = calculateEmployeePayroll(monthly(300_000, { overtime: [{ id: "o", beatId: "b0", clientId: "cl0", contractId: "k0", hours: 2, amount: 5_000 }] }));
    const withEmpty = calculateEmployeePayroll(monthly(300_000, { hourly: [], overtime: [{ id: "o", beatId: "b0", clientId: "cl0", contractId: "k0", hours: 2, amount: 5_000 }] }));
    expect(withEmpty).toEqual(plain);
  });
});

describe("each site's gross is split by that site's own salary structure (H8)", () => {
  it("two sites with different structures: each split by its own percentages, the pension base is the sum of what each structure makes pensionable", () => {
    const a = site({ key: "b0|k0|std", beatId: "b0", beatName: "Beat 0", structure: STD }, [{ dayClass: "WEEKDAY", minutes: 18_000, rate: 1000, amountKobo: 30_000_000 }]); // 300,000 by the standard structure
    const b = site({ key: "b1|k1|ab", beatId: "b1", beatName: "Beat 1", contractId: "k1", clientId: "cl1", clientName: "Client 1", structure: ALL_BASIC }, [{ dayClass: "WEEKEND", minutes: 4_400, rate: 1500, amountKobo: 11_000_000 }]); // 110,000 all basic
    const r = calculateEmployeePayroll(base({ hourly: [a, b] }));
    expect(r.earnedGross).toBe(410_000);
    expect(r.components.find((c) => c.code === "BASIC")?.amount).toBe(140_000); // 10% of 300,000 + 100% of 110,000
    expect(r.pensionBase).toBe(227_000); // 39% of 300,000 + all of 110,000
    expect(r.allocations.map((x) => [x.beatId, x.grossAmount])).toEqual([["b0", 300_000], ["b1", 110_000]]);
  });

  it("the allocations to sites add up to the person's earned gross and their net pay", () => {
    const r = calculateEmployeePayroll(base({ hourly: [site({ beatId: "b0", key: "b0" }, [{ dayClass: "WEEKDAY", minutes: 18_000, rate: 1000, amountKobo: 30_000_000 }]), site({ beatId: "b1", key: "b1", contractId: "k1", clientId: "cl1" }, [{ dayClass: "WEEKDAY", minutes: 6_600, rate: 1000, amountKobo: 11_000_000 }])] }));
    expect(r.allocations.reduce((a, x) => a + x.grossAmount, 0)).toBe(r.earnedGross);
    expect(Math.round(r.allocations.reduce((a, x) => a + x.netAmount, 0) * 100)).toBe(Math.round(r.netPay * 100));
  });
});

describe("a person can be monthly for part of a month and hourly for the rest", () => {
  it("the monthly days are paid by the days as ever (the hourly part never changes the divisor) and the hourly gross is added", () => {
    const rate: RateInfo = { key: "R0", source: "CONTRACT_RATE", agreedRate: null, operativeSharePct: null, monthlyGross: 310_000, structure: STD };
    const days: WorkDay[] = OCT.slice(0, 15).map((x) => ({ date: d(x), clientId: "cl0", clientName: "Client 0", contractId: "k0", beatId: "b0", beatName: "Beat 0", categoryId: "G", status: "PRESENT" as const, overtimeHours: 0 }));
    const r = calculateEmployeePayroll(base({ days, resolveRate: () => rate, hourly: [site({ dates: OCT.slice(15, 20) }, [{ dayClass: "WEEKDAY", minutes: 6_000, rate: 1000, amountKobo: 10_000_000 }])] }));
    // 15 of 31 days of 310,000 is exactly 150,000; the hourly part is 100,000
    expect(r.earnedGross).toBe(250_000);
    expect(r.components.find((c) => c.code === "BASIC")?.amount).toBe(25_000);
    expect(r.daysWorked).toBe(20); // 15 days of monthly pay and 5 distinct days of hourly work
  });
});

describe("what the payslip and the records show for an hourly person", () => {
  it("has no monthly gross (they have no fixed salary), counts the distinct days worked, and lists the site worked", () => {
    const r = calculateEmployeePayroll(base({ hourly: [site({ dates: ["2026-10-02", "2026-10-03", "2026-10-09"], from: "2026-10-02", to: "2026-10-09" })] }));
    expect(r.monthlyGross).toBe(0);
    expect(r.daysWorked).toBe(3);
    expect(r.locations).toEqual([{ clientName: "Client 0", beatName: "Beat 0", days: 3, from: "2026-10-02", to: "2026-10-09" }]);
    expect(r.allocations[0].days).toBe(3);
  });

  it("keeps the hourly lines (class, minutes, rate, amount) on the site's piece of pay, for the stored breakdown", () => {
    const r = calculateEmployeePayroll(base({ hourly: [site()] }));
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].hourly?.lines.map((l) => [l.dayClass, l.minutes, l.rate, l.amountKobo])).toEqual([["WEEKDAY", 18_000, 1000, 30_000_000], ["WEEKEND", 3_600, 1500, 9_000_000], ["HOLIDAY", 600, 2000, 2_000_000]]);
    expect(r.segments[0].gross).toBe(G);
  });
});

describe("employer costs for an hourly person (H19, confirmed 2026-11-20)", () => {
  it("ITF and NSITF apply as a percentage of gross; the costs worked from the client's monthly rate are not applicable (zero), and there is no client billing", () => {
    const r = calculateEmployeePayroll(base({ hourly: [site()], employerCostRule: ECR, businessLineFor: () => "GUARDING" }));
    expect(r.itfAmount).toBe(4_100); // 1% of 410,000
    expect(r.nsitfAmount).toBe(4_100);
    expect([r.insuranceAmount, r.uniformKitsAmount, r.recruitmentTrainingAmount, r.leaveRelieverAmount, r.outsourcingLeaveAllowanceAmount]).toEqual([0, 0, 0, 0, 0]);
    expect([r.clientBilling, r.managementShare]).toEqual([0, 0]);
    expect(r.businessLine).toBe("GUARDING");
  });

  it("the outsourcing leave allowance is not applicable either (as confirmed), though it is worked from Basic for a monthly person", () => {
    const hourly = calculateEmployeePayroll(base({ hourly: [site()], employerCostRule: ECR, businessLineFor: () => "OUTSOURCING" }));
    expect(hourly.outsourcingLeaveAllowanceAmount).toBe(0);
    const monthlyOutsourced = calculateEmployeePayroll(monthly(G, { employerCostRule: ECR, businessLineFor: () => "OUTSOURCING" }));
    expect(monthlyOutsourced.outsourcingLeaveAllowanceAmount).toBeGreaterThan(0); // unchanged for a monthly person
  });

  it("a site with no contract (no business line) carries no add-on costs, as for any person", () => {
    const r = calculateEmployeePayroll(base({ hourly: [site({ contractId: null })], employerCostRule: ECR, businessLineFor: () => null }));
    expect(r.totalEmployerAddOns).toBe(0);
    expect(r.businessLine).toBe("BACK_OFFICE");
  });

  it("employer cost is the earnings, the employer pension and the add-ons, as ever", () => {
    const r = calculateEmployeePayroll(base({ hourly: [site()], employerCostRule: ECR, businessLineFor: () => "GUARDING" }));
    expect(r.employerCost).toBeCloseTo(r.totalEarnings + r.employerPension + r.totalEmployerAddOns, 2);
  });
});

describe("what the engine refuses", () => {
  it("hourly earnings in a supplementary run that pays only adjustments (late hours are a later piece)", () => {
    expect(() => calculateEmployeePayroll(base({ hourly: [site()], adjustmentsOnly: true }))).toThrow(MoneyError);
  });

  it("an hourly amount that is not whole kobo, or is negative, or a line with no minutes", () => {
    for (const bad of [{ minutes: 60, rate: 1, amountKobo: 1.5 }, { minutes: 60, rate: 1, amountKobo: -1 }, { minutes: 0, rate: 1, amountKobo: 100 }, { minutes: 60.5, rate: 1, amountKobo: 100 }]) {
      expect(() => calculateEmployeePayroll(base({ hourly: [site({}, [{ dayClass: "WEEKDAY", ...bad }])] })), JSON.stringify(bad)).toThrow(MoneyError);
    }
  });
});
