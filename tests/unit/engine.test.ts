import { describe, expect, it } from "vitest";
import { d, eachDay } from "@/lib/dates";
import { round2 } from "@/lib/money";
import {
  calculateEmployeePayroll,
  DEDUCTION_AUTHORITY_ERROR,
  type RateInfo,
  type WorkDay,
} from "@/lib/payroll/engine";
import { computePaye, NTA_2025_BANDS, taxOnBands, type TaxRuleDef } from "@/lib/payroll/paye";
import { evaluateFormula } from "@/lib/payroll/formula";
import {
  computeComponents,
  DEFAULT_EARNINGS,
  splitAgreedRate,
  STRUCTURE_TOTAL_ERROR,
  validateStructure,
  type StructureDef,
} from "@/lib/payroll/structure";

const STD: StructureDef = {
  id: "std",
  code: "STD",
  name: "Standard",
  isPartial: false,
  components: DEFAULT_EARNINGS.map((c, i) => ({
    ...c,
    calcType: "PERCENTAGE" as const,
    active: true,
    sortOrder: i,
  })),
};
const TAX: TaxRuleDef = {
  code: "NTA",
  version: "t",
  bands: NTA_2025_BANDS,
  reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true }],
  exemptions: [{ code: "MIN_WAGE", description: "min wage", annualGrossCeiling: 840000, active: true }],
};
const PENSION = { employeeRate: 8, employerRate: 10, version: "v" };

function rate(agreed: number, structure = STD, key = "r1"): RateInfo {
  return {
    key,
    source: "CONTRACT_RATE",
    agreedRate: agreed,
    operativeSharePct: 70,
    monthlyGross: splitAgreedRate(agreed, 70).operativeGross,
    structure,
  };
}
function days(
  from: string,
  to: string,
  beat: string,
  client = "ABC Bank",
  status: WorkDay["status"] = "PRESENT",
): WorkDay[] {
  return eachDay(d(from), d(to)).map((date) => ({
    date,
    clientId: client,
    clientName: client,
    contractId: `C-${client}`,
    beatId: beat,
    beatName: beat,
    categoryId: "GUARD",
    status,
    overtimeHours: 0,
  }));
}

describe("earnings structure", () => {
  it("default structure is Basic 10 / Housing 14 / Transport 15 / Ent 5 / Meal 15 / Utility 20 / Leave 2.5 / Medical 5 / Clothing 13.5 = 100%", () => {
    expect(DEFAULT_EARNINGS.map((c) => c.percentage)).toEqual([10, 14, 15, 5, 15, 20, 2.5, 5, 13.5]);
    expect(validateStructure(STD)).toEqual([]);
  });

  it("70:30 sharing — ₦120,000 agreed rate gives the operative ₦84,000 and management ₦36,000", () => {
    expect(splitAgreedRate(120000, 70)).toEqual({ operativeGross: 84000, managementShare: 36000 });
  });

  it("#6 percentage components calculate correctly from the operative gross", () => {
    const c = computeComponents(STD, 84000, 1);
    const by = Object.fromEntries(c.map((x) => [x.code, x.amount]));
    expect(by).toEqual({
      BASIC: 8400,
      HOUSING: 11760,
      TRANSPORT: 12600,
      ENTERTAINMENT: 4200,
      MEAL: 12600,
      UTILITY: 16800,
      LEAVE: 2100,
      MEDICAL: 4200,
      CLOTHING: 11340,
    });
    expect(c.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(84000, 2);
  });

  it("#7 fixed components calculate correctly and are prorated", () => {
    const s: StructureDef = {
      ...STD,
      calculationMethod: "MIXED",
      components: [
        ...STD.components,
        {
          code: "HAZARD",
          name: "Hazard",
          calcType: "FIXED_AMOUNT",
          fixedAmount: 5000,
          taxable: true,
          pensionable: false,
          active: true,
          sortOrder: 99,
        },
      ],
    };
    expect(computeComponents(s, 84000, 1).find((c) => c.code === "HAZARD")!.amount).toBe(5000);
    expect(computeComponents(s, 84000, 0.5).find((c) => c.code === "HAZARD")!.amount).toBe(2500);
  });

  it("formula components are evaluated safely", () => {
    expect(evaluateFormula("MIN(GROSS * 2%, 3000)", { GROSS: 94500 })).toBe(1890);
    expect(evaluateFormula("BASIC + HOUSING / 2", { BASIC: 100, HOUSING: 50 })).toBe(125);
    expect(() => evaluateFormula("process.exit()", {})).toThrow();
  });

  it("#8 structure must total 100% unless explicitly PARTIAL", () => {
    const bad = {
      ...STD,
      components: STD.components.map((c) => (c.code === "BASIC" ? { ...c, percentage: 8 } : c)),
    }; // 98%
    expect(validateStructure(bad)).toContain(STRUCTURE_TOTAL_ERROR);
    const over = {
      ...STD,
      components: STD.components.map((c) => (c.code === "BASIC" ? { ...c, percentage: 12 } : c)),
    }; // 102%
    expect(validateStructure(over)).toContain(STRUCTURE_TOTAL_ERROR);
    expect(validateStructure({ ...bad, isPartial: true })).toEqual([]);
  });

  it("employee override replaces only that employee's component", () => {
    const c = computeComponents(STD, 84000, 1, [
      { componentCode: "BASIC", calcType: "PERCENTAGE", percentage: 12, reason: "x" },
    ]);
    expect(c.find((x) => x.code === "BASIC")).toMatchObject({ amount: 10080, overridden: true });
    expect(STD.components.find((x) => x.code === "BASIC")!.percentage).toBe(10);
  });
});

describe("PAYE — Nigeria Tax Act 2025 bands", () => {
  it("applies 0/15/18/21/23/25 progressive bands", () => {
    expect(taxOnBands(800000, NTA_2025_BANDS)).toBe(0);
    expect(taxOnBands(3000000, NTA_2025_BANDS)).toBeCloseTo(330000, 2);
    expect(taxOnBands(12000000, NTA_2025_BANDS)).toBeCloseTo(330000 + 1620000, 2);
    expect(taxOnBands(60000000, NTA_2025_BANDS)).toBeCloseTo(
      330000 + 1620000 + 2730000 + 5750000 + 2500000,
      2,
    );
  });
  it("deducts pension before tax and taxes one-off income at the marginal rate", () => {
    const r = computePaye(
      {
        monthlyRegularTaxable: 84000,
        monthlyIrregularTaxable: 0,
        monthlyEmployeePension: 2688,
        monthlyBasic: 8400,
      },
      TAX,
    );
    // (84,000×12 − 2,688×12 − 800,000) × 15% / 12
    expect(r.paye).toBeCloseTo(((84000 * 12 - 2688 * 12 - 800000) * 0.15) / 12, 2);
    const withOt = computePaye(
      {
        monthlyRegularTaxable: 84000,
        monthlyIrregularTaxable: 10000,
        monthlyEmployeePension: 2688,
        monthlyBasic: 8400,
      },
      TAX,
    );
    expect(withOt.paye - r.paye).toBeCloseTo(1500, 2);
  });
  it("minimum-wage earners are exempt", () => {
    expect(
      computePaye(
        {
          monthlyRegularTaxable: 70000,
          monthlyIrregularTaxable: 0,
          monthlyEmployeePension: 0,
          monthlyBasic: 0,
        },
        TAX,
      ),
    ).toMatchObject({ paye: 0, exempt: true });
  });
});

describe("payroll engine", () => {
  const base = { basisDays: 30, pension: PENSION, taxRule: TAX };

  it("#16 prorates by paid days / basis days and treats ABSENT/SUSPENDED as unpaid", () => {
    const wd = [
      ...days("2026-09-01", "2026-09-20", "VI"),
      ...days("2026-09-21", "2026-09-30", "VI", "ABC Bank", "ABSENT"),
    ];
    const r = calculateEmployeePayroll({ ...base, days: wd, resolveRate: () => rate(120000) });
    expect(r.daysWorked).toBe(20);
    expect(r.daysAbsent).toBe(10);
    expect(r.earnedGross).toBeCloseTo(56000, 2); // 84,000 × 20/30
  });

  it("#11 / #12 / #15 an employee working at two and four locations in one month is paid from every segment", () => {
    const four = [
      ...days("2026-09-01", "2026-09-10", "Victoria Island"),
      ...days("2026-09-11", "2026-09-18", "Marina"),
      ...days("2026-09-19", "2026-09-25", "Ikoyi"),
      ...days("2026-09-26", "2026-09-30", "Lekki", "XYZ Manufacturing"),
    ];
    const r = calculateEmployeePayroll({
      ...base,
      days: four,
      resolveRate: (dd) => (dd.clientId === "XYZ Manufacturing" ? rate(135000, STD, "xyz") : rate(120000)),
    });
    expect(r.locations.map((l) => [l.clientName, l.beatName, l.days])).toEqual([
      ["ABC Bank", "Victoria Island", 10],
      ["ABC Bank", "Marina", 8],
      ["ABC Bank", "Ikoyi", 7],
      ["XYZ Manufacturing", "Lekki", 5],
    ]);
    expect(r.allocations).toHaveLength(4);
    expect(r.earnedGross).toBeCloseTo(84000 * (25 / 30) + 94500 * (5 / 30), 2);
    expect(r.clientBilling).toBeCloseTo(120000 * (25 / 30) + 135000 * (5 / 30), 2);

    const two = [...days("2026-09-01", "2026-09-15", "A"), ...days("2026-09-16", "2026-09-30", "B")];
    const r2 = calculateEmployeePayroll({ ...base, days: two, resolveRate: () => rate(120000) });
    expect(r2.locations).toHaveLength(2);
    expect(r2.earnedGross).toBeCloseTo(84000, 2);
  });

  it("#17 / #18 employee pension 8% and employer pension 10% of Basic+Housing+Transport; employer pension does not reduce net", () => {
    const r = calculateEmployeePayroll({
      ...base,
      days: days("2026-09-01", "2026-09-30", "VI"),
      resolveRate: () => rate(120000),
    });
    const pensionBase = 8400 + 11760 + 12600;
    expect(r.pensionBase).toBe(pensionBase);
    expect(r.employeePension).toBeCloseTo(pensionBase * 0.08, 2);
    expect(r.employerPension).toBeCloseTo(pensionBase * 0.1, 2);
    expect(r.netPay).toBeCloseTo(r.totalEarnings - r.paye.paye - r.employeePension, 2);
    expect(r.employerCost).toBeCloseTo(r.totalEarnings + r.employerPension, 2);
  });

  it("#19 approved overtime is included, taxable but not pensionable", () => {
    const wd = days("2026-09-01", "2026-09-30", "VI");
    const noOt = calculateEmployeePayroll({ ...base, days: wd, resolveRate: () => rate(120000) });
    const ot = calculateEmployeePayroll({
      ...base,
      days: wd,
      resolveRate: () => rate(120000),
      overtime: [{ id: "o", beatId: "VI", clientId: "ABC Bank", contractId: "C", hours: 6, amount: 2100 }],
    });
    expect(ot.overtimeAmount).toBe(2100);
    expect(ot.totalEarnings).toBeCloseTo(noOt.totalEarnings + 2100, 2);
    expect(ot.employeePension).toBe(noOt.employeePension);
    expect(ot.paye.paye).toBeGreaterThan(noOt.paye.paye);
  });

  it("#21 a deduction without documented authority is rejected by the engine", () => {
    const r = calculateEmployeePayroll({
      ...base,
      days: days("2026-09-01", "2026-09-30", "VI"),
      resolveRate: () => rate(120000),
      deductions: [
        { id: "ok", type: "LOAN", amount: 5000, authorityReference: "COOP/1", reason: "loan" },
        { id: "bad", type: "PENALTY", amount: 3000, authorityReference: "", reason: "no ref" },
      ],
    });
    expect(r.otherDeductions).toBe(5000);
    expect(r.rejectedDeductions).toEqual([{ id: "bad", reason: DEDUCTION_AUTHORITY_ERROR }]);
  });

  it("never pays more than a full month when paid days exceed the basis", () => {
    const r = calculateEmployeePayroll({
      ...base,
      basisDays: 30,
      days: days("2026-07-01", "2026-07-31", "VI"),
      resolveRate: () => rate(120000),
    });
    expect(r.earnedGross).toBeCloseTo(84000, 2);
  });

  it("days without a configured rate are flagged, not silently paid", () => {
    const r = calculateEmployeePayroll({
      ...base,
      days: days("2026-09-01", "2026-09-30", "VI"),
      resolveRate: () => null,
    });
    expect(r.unratedDays).toHaveLength(30);
    expect(r.earnedGross).toBe(0);
  });
});

describe("guarding / outsourcing / back-office employer add-on costs", () => {
  const base = { basisDays: 30, pension: PENSION, taxRule: TAX };
  const ECR = {
    itfPct: 1,
    nsitfPct: 1,
    nhfMedicalPct: 0,
    insurancePct: 7.5,
    uniformKitsPct: 25,
    recruitmentTrainingPct: 10.5,
    leaveRelieverPct: 22,
    outsourcingLeaveAllowancePct: 20,
  };
  const wd = days("2026-09-01", "2026-09-30", "VI"); // contractId "C-ABC Bank", full month at ₦120,000

  it("has no add-on costs unless a business line and a rule are both supplied", () => {
    const noRule = calculateEmployeePayroll({ ...base, days: wd, resolveRate: () => rate(120000) });
    expect(noRule.totalEmployerAddOns).toBe(0);
    expect(noRule.businessLine).toBe("BACK_OFFICE");

    const noBusinessLine = calculateEmployeePayroll({
      ...base,
      days: wd,
      resolveRate: () => rate(120000),
      employerCostRule: ECR,
    });
    expect(noBusinessLine.totalEmployerAddOns).toBe(0);
  });

  it("GUARDING: ITF/NSITF are 1% of gross; insurance/uniform&kits/recruitment/leave reliever are % of (management fee − employer pension − ITF − NSITF); no outsourcing leave allowance", () => {
    const r = calculateEmployeePayroll({
      ...base,
      days: wd,
      resolveRate: () => rate(120000),
      businessLineFor: () => "GUARDING",
      employerCostRule: ECR,
    });
    expect(r.businessLine).toBe("GUARDING");
    expect(r.itfAmount).toBeCloseTo(84000 * 0.01, 2); // 1% of the ₦84,000 operative gross
    expect(r.nsitfAmount).toBeCloseTo(84000 * 0.01, 2);
    const statBase = round2(36000 - r.employerPension - r.itfAmount - r.nsitfAmount); // 36,000 mgmt fee
    expect(r.insuranceAmount).toBeCloseTo(statBase * 0.075, 2);
    expect(r.uniformKitsAmount).toBeCloseTo(statBase * 0.25, 2);
    expect(r.recruitmentTrainingAmount).toBeCloseTo(statBase * 0.105, 2);
    expect(r.leaveRelieverAmount).toBeCloseTo(statBase * 0.22, 2);
    expect(r.outsourcingLeaveAllowanceAmount).toBe(0);
    expect(r.totalEmployerAddOns).toBeCloseTo(
      r.itfAmount +
        r.nsitfAmount +
        r.insuranceAmount +
        r.uniformKitsAmount +
        r.recruitmentTrainingAmount +
        r.leaveRelieverAmount,
      2,
    );
    expect(r.employerCost).toBeCloseTo(r.totalEarnings + r.employerPension + r.totalEmployerAddOns, 2);
    const line = (code: string) => r.lines.find((l) => l.code === code);
    expect(line("ITF")!.amount).toBeCloseTo(r.itfAmount, 2);
    expect(line("UNIFORM_KITS")!.amount).toBeCloseTo(r.uniformKitsAmount, 2);
    expect(line("OUTSOURCING_LEAVE_ALLOWANCE")).toBeUndefined();
  });

  it("OUTSOURCING: same as guarding but no uniform & kits, plus a leave allowance of 20% of Basic", () => {
    const r = calculateEmployeePayroll({
      ...base,
      days: wd,
      resolveRate: () => rate(120000),
      businessLineFor: () => "OUTSOURCING",
      employerCostRule: ECR,
    });
    expect(r.businessLine).toBe("OUTSOURCING");
    expect(r.uniformKitsAmount).toBe(0);
    expect(r.outsourcingLeaveAllowanceAmount).toBeCloseTo(8400 * 0.2, 2); // 20% of Basic (₦8,400)
    expect(r.insuranceAmount).toBeGreaterThan(0);
    expect(r.lines.find((l) => l.code === "OUTSOURCING_LEAVE_ALLOWANCE")!.amount).toBeCloseTo(
      r.outsourcingLeaveAllowanceAmount,
      2,
    );
    expect(r.lines.find((l) => l.code === "UNIFORM_KITS")).toBeUndefined();
  });

  it("back-office (no contract) pay carries none of these costs even when a rule is configured", () => {
    const officeDay: WorkDay = {
      date: d("2026-09-01"),
      clientId: null,
      clientName: "Head Office",
      contractId: null,
      beatId: null,
      beatName: "Head Office",
      categoryId: "OFF",
      status: "PRESENT",
      overtimeHours: 0,
    };
    const r = calculateEmployeePayroll({
      ...base,
      days: eachDay(d("2026-09-01"), d("2026-09-30")).map((date) => ({ ...officeDay, date })),
      resolveRate: () => ({
        key: "PR:1",
        source: "EMPLOYEE_PAY_RATE",
        agreedRate: null,
        operativeSharePct: null,
        monthlyGross: 150000,
        structure: STD,
      }),
      businessLineFor: () => "GUARDING", // even a misconfigured resolver can't apply add-ons — no contract
      employerCostRule: ECR,
    });
    expect(r.businessLine).toBe("BACK_OFFICE");
    expect(r.totalEmployerAddOns).toBe(0);
    expect(r.employerCost).toBeCloseTo(r.totalEarnings + r.employerPension, 2);
  });

  it("a mixed month (guarding one beat, outsourcing another) is labelled MIXED", () => {
    const mixed = [
      ...days("2026-09-01", "2026-09-15", "VI"),
      ...days("2026-09-16", "2026-09-30", "Lekki", "XYZ Manufacturing"),
    ];
    const r = calculateEmployeePayroll({
      ...base,
      days: mixed,
      resolveRate: (dd) => (dd.clientId === "XYZ Manufacturing" ? rate(135000, STD, "xyz") : rate(120000)),
      businessLineFor: (contractId) => (contractId === "C-ABC Bank" ? "GUARDING" : "OUTSOURCING"),
      employerCostRule: ECR,
    });
    expect(r.businessLine).toBe("MIXED");
    expect(r.totalEmployerAddOns).toBeGreaterThan(0);
  });
});
