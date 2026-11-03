import { describe, expect, it } from "vitest";
import { calculateEmployeePayroll, type WorkDay } from "@/lib/payroll/engine";
import { DEFAULT_EARNINGS, splitAgreedRate, type StructureDef } from "@/lib/payroll/structure";
import { estimateHeadCost, type EstimateInput } from "@/lib/sales/cost-estimator";
import { belowMinimum, bpsToPercent, checkHeadcount, checkPersonnel, clientView, lineTotals, marginBps, percentToBps, quoteTotals } from "@/lib/sales/quote";

const STD: StructureDef = { id: "std", code: "STD", name: "Standard", isPartial: false, components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })) };
// the standard rules: employer pension 10% of Basic, Housing and Transport; ITF and NSITF 1% of gross; the other add-ons at the starting percentages
const ECR = { itfPct: 1, nsitfPct: 1, nhfMedicalPct: 0, insurancePct: 7.5, uniformKitsPct: 25, recruitmentTrainingPct: 10.5, leaveRelieverPct: 22, outsourcingLeaveAllowancePct: 20 };
const PENSION = { employeeRate: 8, employerRate: 10, version: "v1" };
const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({ structure: STD, billRatePerHead: 120000, operativeSharePct: 70, businessLine: "GUARDING", pension: PENSION, employerCostRule: ECR, ...over });

describe("what one guard costs the company a month", () => {
  it("worked by hand for a guarding line at 120,000 with the 70% share", () => {
    const c = estimateHeadCost(input());
    // gross 84,000; pensionable base 8,400 + 11,760 + 12,600 = 32,760; pension 10% = 3,276.00; ITF and NSITF 1% of gross = 840.00 each
    expect(c).toMatchObject({ billPerHead: "120000.00", gross: "84000.00", managementShare: "36000.00", pensionBase: "32760.00", employerPension: "3276.00" });
    expect(c.addOns).toMatchObject({ itf: "840.00", nsitf: "840.00", nhfMedical: "0.00", outsourcingLeaveAllowance: "0.00" });
    // the other add-ons are a share of what is left of the 36,000 after pension, ITF and NSITF: 36,000 - 3,276 - 840 - 840 = 31,044
    expect(c.addOns).toMatchObject({ insurance: "2328.30", recruitmentTraining: "3259.62", leaveReliever: "6829.68", uniformKits: "7761.00" });
    expect(c.employerCosts).toBe("25134.60"); // 3,276 + 840 + 840 + 2,328.30 + 3,259.62 + 6,829.68 + 7,761
    expect(c.costPerHead).toBe("109134.60"); // 84,000 + 25,134.60
    expect(c.marginPerHead).toBe("10865.40");
  });

  it("an outsourcing line has no uniform and kit cost but a leave allowance of 20% of Basic", () => {
    const c = estimateHeadCost(input({ businessLine: "OUTSOURCING" }));
    expect(c.addOns).toMatchObject({ uniformKits: "0.00", outsourcingLeaveAllowance: "1680.00" }); // 20% of the 8,400 Basic
    expect(c.costPerHead).toBe("103053.60");
    expect(c.marginPerHead).toBe("16946.40");
  });

  it("a line with its own share (60%) is worked on that share, not the default", () => {
    const c = estimateHeadCost(input({ operativeSharePct: 60 }));
    expect(c).toMatchObject({ gross: "72000.00", managementShare: "48000.00", employerPension: "2808.00" });
    expect(c.addOns).toMatchObject({ itf: "720.00", nsitf: "720.00", insurance: "3281.40", recruitmentTraining: "4593.96", leaveReliever: "9625.44", uniformKits: "10938.00" });
    expect(c.costPerHead).toBe("104686.80");
    expect(c.marginPerHead).toBe("15313.20");
  });

  it("is exactly what payroll works out for the same guard: it runs the payroll engine, not a copy of it", () => {
    for (const [bill, share, line] of [[120000, 70, "GUARDING"], [95500.55, 65, "OUTSOURCING"], [250000.01, 70, "GUARDING"]] as const) {
      const days: WorkDay[] = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)), clientId: "c", clientName: "c", contractId: "k", beatId: "b", beatName: "b", categoryId: "g", status: "PRESENT" as const, overtimeHours: 0 }));
      const direct = calculateEmployeePayroll({
        basisDays: 30,
        days,
        resolveRate: () => ({ key: "r", source: "CONTRACT_RATE", agreedRate: bill, operativeSharePct: share, monthlyGross: splitAgreedRate(bill, share).operativeGross, structure: STD }),
        businessLineFor: () => line,
        employerCostRule: ECR,
        pension: PENSION,
        taxRule: { code: "T", version: "t", bands: [{ lowerBound: 0, upperBound: null, rate: 0 }], reliefs: [], exemptions: [] },
      });
      const c = estimateHeadCost(input({ billRatePerHead: bill, operativeSharePct: share, businessLine: line }));
      expect(Number(c.costPerHead), `${bill} ${share} ${line}`).toBeCloseTo(direct.employerCost, 2);
      expect(Number(c.employerPension)).toBeCloseTo(direct.employerPension, 2);
      expect(Number(c.gross)).toBeCloseTo(direct.earnedGross, 2);
      expect(c.costPerHead).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("changes when the rules change, and a bill rate that is not above zero is refused", () => {
    expect(estimateHeadCost(input({ employerCostRule: { ...ECR, itfPct: 2 } })).addOns.itf).toBe("1680.00");
    expect(estimateHeadCost(input({ pension: { ...PENSION, employerRate: 12 } })).employerPension).toBe("3931.20");
    expect(() => estimateHeadCost(input({ billRatePerHead: 0 }))).toThrow(/above zero/);
    expect(() => estimateHeadCost(input({ billRatePerHead: "abc" }))).toThrow(/above zero/);
  });
});

describe("quote totals and margin", () => {
  it("prices a line and a quote exactly in kobo, with no drift", () => {
    expect(lineTotals({ headcount: 12, billPerHead: "120000.00", costPerHead: "109134.60" })).toEqual({ bill: "1440000.00", cost: "1309615.20", margin: "130384.80" });
    const t = quoteTotals([
      { headcount: 12, billPerHead: "120000.00", costPerHead: "109134.60" },
      { headcount: 2, billPerHead: "150000.00", costPerHead: "130000.55" },
    ]);
    expect(t).toEqual({ monthlyBill: "1740000.00", monthlyCost: "1569616.30", monthlyMargin: "170383.70", marginBps: 979 }); // 9.792% rounds to 9.79%
    const many = quoteTotals(Array.from({ length: 1000 }, () => ({ headcount: 1, billPerHead: "100.01", costPerHead: "90.03" })));
    expect(many).toMatchObject({ monthlyBill: "100010.00", monthlyCost: "90030.00", monthlyMargin: "9980.00" });
  });
  it("bills the guards the client pays for but costs the personnel needed to cover the shifts, which can be more", () => {
    // 6 guards billed at 120,000 = 720,000; 7 people on the roster at 109,134.60 each = 763,942.20 of cost, so the line loses money
    expect(lineTotals({ headcount: 6, requiredPersonnel: 7, billPerHead: "120000.00", costPerHead: "109134.60" })).toEqual({ bill: "720000.00", cost: "763942.20", margin: "-43942.20" });
    // the same line covered by the 6 billed: the cost follows the people, not the bill
    expect(lineTotals({ headcount: 6, requiredPersonnel: 6, billPerHead: "120000.00", costPerHead: "109134.60" })).toEqual({ bill: "720000.00", cost: "654807.60", margin: "65192.40" });
    // personnel not given means the same as the billed headcount
    expect(lineTotals({ headcount: 6, billPerHead: "120000.00", costPerHead: "109134.60" })).toEqual(lineTotals({ headcount: 6, requiredPersonnel: 6, billPerHead: "120000.00", costPerHead: "109134.60" }));
    const t = quoteTotals([
      { headcount: 12, requiredPersonnel: 14, billPerHead: "120000.00", costPerHead: "109134.60" }, // a 24/7 post: 12 billed, 14 needed
      { headcount: 2, billPerHead: "150000.00", costPerHead: "130858.50" },
    ]);
    expect(t).toEqual({ monthlyBill: "1740000.00", monthlyCost: "1789601.40", monthlyMargin: "-49601.40", marginBps: -285 }); // 14 x 109,134.60 + 2 x 130,858.50 = 1,527,884.40 + 261,717.00
    expect(() => checkPersonnel(0)).toThrow(/personnel/i);
    expect(checkPersonnel(14)).toBe(14);
  });

  it("holds a margin percentage as basis points rounded half up, negative for a loss, zero when there is no bill", () => {
    expect(marginBps("905.45", "10000.00")).toBe(905); // 9.0545% -> 905.45 bps -> 905
    expect(marginBps("0.05", "100.00")).toBe(5); // 0.05% exactly
    expect(marginBps("10.00", "100.00")).toBe(1000);
    expect(marginBps("-5.00", "100.00")).toBe(-500);
    expect(marginBps("0.00", "0.00")).toBe(0);
    expect(bpsToPercent(905)).toBe("9.05");
  });
  it("compares against the minimum margin only when one is set", () => {
    expect(belowMinimum(905, 1000)).toBe(true);
    expect(belowMinimum(1000, 1000)).toBe(false);
    expect(belowMinimum(-50, 0)).toBe(false); // no minimum set: nothing to be below
    expect(percentToBps(12.5)).toBe(1250);
    expect(() => percentToBps(12.345)).toThrow(/two decimals/);
    expect(() => percentToBps(101)).toThrow(/between 0 and 100/);
  });
  it("accepts a whole number of guards from 1 to 10,000", () => {
    for (const n of [0, -1, 1.5, 10001]) expect(() => checkHeadcount(n), String(n)).toThrow(/whole number from 1/);
    expect(checkHeadcount(18)).toBe(18);
  });
  it("shows the client the bill and nothing of the company's cost or margin", () => {
    const v = clientView([{ siteName: "Lekki Gardens", postLabel: "Main gate", shiftPattern: "24/7", headcount: 6, billPerHead: "120000.00", ...({ costPerHead: "109134.60", margin: "1" } as object) }]);
    expect(v).toEqual({ rows: [{ siteName: "Lekki Gardens", siteAddress: null, postLabel: "Main gate", shiftPattern: "24/7", headcount: 6, billPerHead: "120000.00", monthly: "720000.00" }], total: "720000.00" });
    expect(JSON.stringify(v)).not.toMatch(/cost|margin|109134|personnel|required/i); // the client sees the billed guards, never how many people the roster needs
  });
});
