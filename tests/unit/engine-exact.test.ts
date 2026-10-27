import { describe, expect, it } from "vitest";
import { d, eachDay } from "@/lib/dates";
import { MoneyError } from "@/lib/money-exact";
import { calculateEmployeePayroll, overtimeHourlyRate, type EngineInput, type RateInfo, type WorkDay } from "@/lib/payroll/engine";
import { NTA_2025_BANDS, type TaxRuleDef } from "@/lib/payroll/paye";
import { DEFAULT_EARNINGS, type StructureDef } from "@/lib/payroll/structure";

/**
 * The payroll engine in exact arithmetic, option A: the late rounding stays (components are carried unrounded, added across sites, and rounded once at
 * the payslip line) but nothing is lost to floating point. Everything below is checked two ways: worked by hand, and against an independent exact
 * calculation written here in BigInt kobo with a different shape from the engine. A "tie" is an amount that ends in exactly half a kobo; half up goes UP.
 */
const STD: StructureDef = {
  id: "std",
  code: "STD",
  name: "Standard",
  isPartial: false,
  components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })),
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

type Line = "GUARDING" | "OUTSOURCING" | null;
interface Sc {
  basis: number;
  segs: Array<{ paid: number; absent: number; gross: bigint; agreed: bigint | null; line: Line }>;
  employeeRate: number;
  employerRate: number;
  ecr: boolean;
  overtime: bigint[];
  arrears: Array<{ gross: bigint; pensionable: bigint }>;
  other: Array<{ amount: bigint; taxable: boolean }>;
  deduction: bigint | null;
  rent: bigint;
}
const naira = (k: bigint) => Number(k) / 100;

function build(sc: Sc): EngineInput {
  const days: WorkDay[] = [];
  const cal = eachDay(d("2026-10-01"), d("2026-10-31"));
  let at = 0;
  sc.segs.forEach((s, i) => {
    for (let k = 0; k < s.paid + s.absent; k++)
      days.push({ date: cal[at++], clientId: `cl${i}`, clientName: `Client ${i}`, contractId: s.line ? `C${i}` : null, beatId: `B${i}`, beatName: `Beat ${i}`, categoryId: "G", status: k < s.paid ? "PRESENT" : "ABSENT", overtimeHours: 0 });
  });
  const rates: RateInfo[] = sc.segs.map((s, i) => ({ key: `R${i}`, source: "CONTRACT_RATE", agreedRate: s.agreed === null ? null : naira(s.agreed), operativeSharePct: 70, monthlyGross: naira(s.gross), structure: STD }));
  const input: EngineInput = {
    basisDays: sc.basis,
    days,
    resolveRate: (day) => rates[Number(day.beatId!.slice(1))],
    pension: { employeeRate: sc.employeeRate, employerRate: sc.employerRate, version: "v" },
    taxRule: TAX,
    annualRent: naira(sc.rent),
    businessLineFor: (contractId) => (contractId ? sc.segs[Number(contractId.slice(1))].line : null),
  };
  if (sc.ecr) input.employerCostRule = ECR;
  if (sc.overtime.length) input.overtime = sc.overtime.map((a, i) => ({ id: `o${i}`, beatId: "B0", clientId: "cl0", contractId: "C0", hours: 2, amount: naira(a) }));
  if (sc.arrears.length) input.arrears = sc.arrears.map((a, i) => ({ id: `a${i}`, grossImpact: naira(a.gross), pensionableImpact: naira(a.pensionable) }));
  if (sc.other.length) input.otherEarnings = sc.other.map((o, i) => ({ id: `e${i}`, name: "Bonus", amount: naira(o.amount), taxable: o.taxable }));
  if (sc.deduction !== null) input.deductions = [{ id: "x", type: "LOAN_REPAYMENT", amount: naira(sc.deduction), authorityReference: "REF", reason: "test" }];
  return input;
}

// ── The independent exact calculation (BigInt kobo; rates in ten-thousandths of a percent) ──
const RS = 1_000_000n;
const half = (n: bigint, den: bigint): bigint => (n >= 0n ? (n * 2n + den) / (den * 2n) : -((-n * 2n + den) / (den * 2n)));
const U = DEFAULT_EARNINGS.map((c) => BigInt(Math.round((c.percentage ?? 0) * 10000)));
const rateU = (pct: number) => BigInt(Math.round(pct * 10000));
const sumB = (a: bigint[]) => a.reduce((x, y) => x + y, 0n);
function oracleUnits(c: bigint): bigint {
  let t = 0n;
  for (const b of NTA_2025_BANDS) {
    const lo = BigInt(b.lowerBound) * 100n;
    if (c <= lo) break;
    const hi = b.upperBound === null ? c : BigInt(b.upperBound) * 100n;
    t += ((c < hi ? c : hi) - lo) * BigInt(Math.round(b.rate * 10000));
  }
  return t;
}
function oraclePaye(reg: bigint, irr: bigint, pen: bigint, rent: bigint): bigint {
  const annualReg = reg * 12n;
  if (annualReg + irr > 0n && annualReg + irr <= 84_000_000n) return 0n;
  let rr = half(rent * 200_000n, RS);
  if (rr > 50_000_000n) rr = 50_000_000n;
  const relief = pen * 12n + rr;
  const chargeable = annualReg - relief > 0n ? annualReg - relief : 0n;
  const a = oracleUnits(chargeable);
  const b = oracleUnits(chargeable + irr);
  const num = a + 12n * (b - a);
  return num <= 0n ? 0n : half(num, 12n * RS);
}
function oracle(sc: Sc) {
  const D = BigInt(Math.max(sc.basis, sc.segs.reduce((a, s) => a + s.paid, 0)));
  const comps = U.map((u) => half(sumB(sc.segs.map((s) => s.gross * u * BigInt(s.paid))), RS * D));
  const earned = sumB(comps);
  const pensionableComps = sumB(comps.slice(0, 3));
  const seg = sc.segs.map((s) => {
    const paid = BigInt(s.paid);
    const gross = half(s.gross * paid, D);
    const pensionable = half(s.gross * (U[0] + U[1] + U[2]) * paid, RS * D);
    const billing = s.agreed === null ? 0n : half(s.agreed * paid, D);
    const mgmt = s.agreed === null ? 0n : half((s.agreed - s.gross) * paid, D);
    const o = { gross, pensionable, billing, mgmt, itf: 0n, nsitf: 0n, nhf: 0n, ins: 0n, uni: 0n, rec: 0n, rel: 0n, ola: 0n };
    if (s.line && sc.ecr) {
      const ep = half(pensionable * rateU(sc.employerRate), RS);
      o.itf = half(gross * rateU(ECR.itfPct), RS);
      o.nsitf = half(gross * rateU(ECR.nsitfPct), RS);
      o.nhf = half(gross * rateU(ECR.nhfMedicalPct), RS);
      const stat = mgmt - ep - o.itf - o.nsitf - o.nhf > 0n ? mgmt - ep - o.itf - o.nsitf - o.nhf : 0n;
      o.ins = half(stat * rateU(ECR.insurancePct), RS);
      o.rec = half(stat * rateU(ECR.recruitmentTrainingPct), RS);
      o.rel = half(stat * rateU(ECR.leaveRelieverPct), RS);
      if (s.line === "GUARDING") o.uni = half(stat * rateU(ECR.uniformKitsPct), RS);
      if (s.line === "OUTSOURCING") o.ola = half(s.gross * U[0] * paid * rateU(ECR.outsourcingLeaveAllowancePct), RS * D * RS);
    }
    return o;
  });
  const overtime = sumB(sc.overtime);
  const arrears = sumB(sc.arrears.map((a) => a.gross));
  const arrearsPens = sumB(sc.arrears.map((a) => a.pensionable));
  const other = sumB(sc.other.map((o) => o.amount));
  const otherTaxable = sumB(sc.other.filter((o) => o.taxable).map((o) => o.amount));
  const totalEarnings = earned + overtime + arrears + other;
  const pensionBase = pensionableComps + arrearsPens;
  const ee = half(pensionBase * rateU(sc.employeeRate), RS);
  const er = half(pensionBase * rateU(sc.employerRate), RS);
  const paye = oraclePaye(earned, overtime + arrears + otherTaxable, ee, sc.rent);
  const deduction = sc.deduction ?? 0n;
  const totalDeductions = paye + ee + deduction;
  const billed = sc.segs.map((s) => (s.agreed === null ? null : s));
  const clientBilling = half(sumB(billed.filter((s) => s).map((s) => s!.agreed! * BigInt(s!.paid))), D);
  const managementShare = half(sumB(billed.filter((s) => s).map((s) => (s!.agreed! - s!.gross) * BigInt(s!.paid))), D);
  const sumOf = (f: (s: (typeof seg)[number]) => bigint) => sumB(seg.map(f));
  const addOns = { itf: sumOf((s) => s.itf), nsitf: sumOf((s) => s.nsitf), nhf: sumOf((s) => s.nhf), ins: sumOf((s) => s.ins), uni: sumOf((s) => s.uni), rec: sumOf((s) => s.rec), rel: sumOf((s) => s.rel), ola: sumOf((s) => s.ola) };
  const totalAddOns = sumB(Object.values(addOns));
  return { comps, earned, seg, totalEarnings, pensionBase, ee, er, taxable: earned + overtime + arrears + otherTaxable, paye, totalDeductions, net: totalEarnings - totalDeductions, clientBilling, managementShare, addOns, totalAddOns, employerCost: totalEarnings + er + totalAddOns };
}
const kobo = (n: number) => BigInt(Math.round(n * 100));

function expectMatches(sc: Sc, label: string) {
  const r = calculateEmployeePayroll(build(sc));
  const o = oracle(sc);
  const eq = (name: string, got: number, want: bigint) => expect(kobo(got), `${label}: ${name}`).toBe(want);
  r.components.forEach((c, i) => eq(`component ${c.code}`, c.amount, o.comps[i]));
  eq("earnedGross", r.earnedGross, o.earned);
  eq("totalEarnings", r.totalEarnings, o.totalEarnings);
  eq("pensionBase", r.pensionBase, o.pensionBase);
  eq("employeePension", r.employeePension, o.ee);
  eq("employerPension", r.employerPension, o.er);
  eq("taxableIncome", r.taxableIncome, o.taxable);
  eq("paye", r.paye.paye, o.paye);
  eq("totalDeductions", r.totalDeductions, o.totalDeductions);
  eq("netPay", r.netPay, o.net);
  eq("clientBilling", r.clientBilling, o.clientBilling);
  eq("managementShare", r.managementShare, o.managementShare);
  eq("employerCost", r.employerCost, o.employerCost);
  eq("itf", r.itfAmount, o.addOns.itf);
  eq("nsitf", r.nsitfAmount, o.addOns.nsitf);
  eq("nhfMedical", r.nhfMedicalAmount, o.addOns.nhf);
  eq("insurance", r.insuranceAmount, o.addOns.ins);
  eq("uniformKits", r.uniformKitsAmount, o.addOns.uni);
  eq("recruitmentTraining", r.recruitmentTrainingAmount, o.addOns.rec);
  eq("leaveReliever", r.leaveRelieverAmount, o.addOns.rel);
  eq("outsourcingLeaveAllowance", r.outsourcingLeaveAllowanceAmount, o.addOns.ola);
  eq("totalEmployerAddOns", r.totalEmployerAddOns, o.totalAddOns);
  r.segments.forEach((s, i) => {
    eq(`segment ${i} gross`, s.gross, o.seg[i].gross);
    eq(`segment ${i} pensionable`, s.pensionable, o.seg[i].pensionable);
    eq(`segment ${i} clientBilling`, s.clientBilling, o.seg[i].billing);
    eq(`segment ${i} managementShare`, s.managementShare, o.seg[i].mgmt);
  });
  // The beats' net shares always add back to the employee's net pay, to the kobo.
  expect(kobo(r.allocations.reduce((a, x) => a + x.netAmount, 0)), `${label}: allocations add to net pay`).toBe(o.net);
}

const one = (over: Partial<Sc> & Pick<Sc, "segs">): Sc => ({ basis: 30, employeeRate: 8, employerRate: 10, ecr: false, overtime: [], arrears: [], other: [], deduction: null, rent: 0n, ...over });

describe("engine ties round half up (worked by hand)", () => {
  it("components: 20 of 30 days at ₦50,000.05: 15% is 7,500.0075, two thirds is 5,000.005 → Transport and Meal are ₦5,000.01", () => {
    const r = calculateEmployeePayroll(build(one({ segs: [{ paid: 20, absent: 10, gross: kobo(50000.05), agreed: null, line: null }] })));
    const by = Object.fromEntries(r.components.map((c) => [c.code, c.amount]));
    expect(by.TRANSPORT).toBe(5000.01);
    expect(by.MEAL).toBe(5000.01);
    // Basic: 10% = 5,000.005 × 2/3 = 3,333.3366… → 3,333.34
    expect(by.BASIC).toBe(3333.34);
  });
  it("a half month at ₦50,000.25: Basic is 10% (5,000.025) × 15/30 = 2,500.0125 → 2,500.01, and Utility 20% (10,000.05) × ½ is 5,000.025 → 5,000.03", () => {
    const r = calculateEmployeePayroll(build(one({ segs: [{ paid: 15, absent: 15, gross: kobo(50000.25), agreed: null, line: null }] })));
    const by = Object.fromEntries(r.components.map((c) => [c.code, c.amount]));
    expect(by.UTILITY).toBe(5000.03);
    expect(by.BASIC).toBe(2500.01);
  });
  it("two sites are added BEFORE rounding (option A): 15 days at ₦50,000.07 and 15 days at ₦50,000.07 of 30; Basic = 2 × 5,000.007 × ½ = 5,000.007 → 5,000.01 (rounding each site first would give 5,000.00)", () => {
    const r = calculateEmployeePayroll(
      build(one({ segs: [{ paid: 15, absent: 0, gross: kobo(50000.07), agreed: null, line: null }, { paid: 15, absent: 0, gross: kobo(50000.07), agreed: null, line: null }] })),
    );
    expect(r.components.find((c) => c.code === "BASIC")!.amount).toBe(5000.01);
  });
  it("a tie across two sites: 15 days at ₦50,000.00 and 15 at ₦50,000.10; Basic = 2,500.00 + 2,500.005 = 5,000.005 → 5,000.01", () => {
    const r = calculateEmployeePayroll(
      build(one({ segs: [{ paid: 15, absent: 0, gross: kobo(50000), agreed: null, line: null }, { paid: 15, absent: 0, gross: kobo(50000.1), agreed: null, line: null }] })),
    );
    expect(r.components.find((c) => c.code === "BASIC")!.amount).toBe(5000.01);
  });
  it("client billing and management share: ₦131,072.05 agreed, 15 of 30 days → billing 65,536.025 → 65,536.03; operative ₦70,000.71 × ½ = 35,000.355 → the site's gross is 35,000.36, management 30,535.67", () => {
    const r = calculateEmployeePayroll(build(one({ segs: [{ paid: 15, absent: 15, gross: kobo(70000.71), agreed: kobo(131072.05), line: null }] })));
    expect(r.clientBilling).toBe(65536.03);
    expect(r.segments[0].gross).toBe(35000.36);
    // rawBilling 65,536.025 − rawGross 35,000.355 = 30,535.670 exactly
    expect(r.managementShare).toBe(30535.67);
  });
  it("employer pension: a pensionable base ending in 5 kobo at 10% is a tie. Base ₦81,920.05 → 8,192.005 → ₦8,192.01", () => {
    // A month with no days worked and only a pensionable arrears amount of 81,920.05
    const input = build(one({ segs: [{ paid: 0, absent: 0, gross: kobo(100000), agreed: null, line: null }], arrears: [{ gross: kobo(81920.05), pensionable: kobo(81920.05) }] }));
    const r = calculateEmployeePayroll(input);
    expect(r.pensionBase).toBe(81920.05);
    expect(r.employerPension).toBe(8192.01);
  });
  it("ITF and NSITF are 1% of the segment gross: ₦102,421.50 → 1,024.215 → ₦1,024.22; NHF/medical 0.5% is 512.1075 → ₦512.11", () => {
    const r = calculateEmployeePayroll(build(one({ ecr: true, segs: [{ paid: 30, absent: 0, gross: kobo(102421.5), agreed: kobo(120000), line: "GUARDING" }] })));
    expect(r.segments[0].gross).toBe(102421.5);
    expect(r.itfAmount).toBe(1024.22);
    expect(r.nsitfAmount).toBe(1024.22);
    expect(r.nhfMedicalAmount).toBe(512.11);
  });
});

describe("engine: exact against an independent calculation", () => {
  it("3,000 random employee-months: one to three sites, the add-on cost rule, overtime, arrears, other pay, a deduction, rent", () => {
    let seed = 31102026;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const money = (min: number, span: number) => BigInt(min + rnd(span));
    for (let i = 0; i < 3000; i++) {
      const basis = rnd(2) ? 30 : 31;
      const n = 1 + rnd(3);
      let left = basis === 30 && rnd(10) === 0 ? 31 : basis;
      const segs: Sc["segs"] = [];
      for (let s = 0; s < n; s++) {
        const paid = Math.min(left, 1 + rnd(Math.max(1, Math.floor(left / (n - s)) + 4)));
        left -= paid;
        const gross = money(4_000_000, 36_000_000);
        const line: Line = rnd(5) === 0 ? null : rnd(2) ? "GUARDING" : "OUTSOURCING";
        segs.push({ paid, absent: rnd(3) === 0 && paid < 25 ? 2 : 0, gross, agreed: rnd(8) === 0 ? null : (gross * 100n) / 70n + BigInt(rnd(100)), line });
      }
      for (const s of segs) if (segs.reduce((a, x) => a + x.paid + x.absent, 0) > 31) s.absent = 0;
      expectMatches(
        {
          basis,
          segs,
          employeeRate: [8, 8, 7.5, 5][rnd(4)],
          employerRate: [10, 10, 15][rnd(3)],
          ecr: rnd(2) === 0,
          overtime: rnd(3) === 0 ? [money(100_000, 900_000)] : [],
          arrears: rnd(5) === 0 ? [{ gross: money(100_000, 900_000), pensionable: money(50_000, 300_000) }] : [],
          other: rnd(4) === 0 ? [{ amount: money(100_000, 2_000_000), taxable: rnd(2) === 0 }] : [],
          deduction: rnd(4) === 0 ? money(50_000, 1_000_000) : null,
          rent: rnd(3) === 0 ? money(30_000_000, 90_000_000) : 0n,
        },
        `employee-month ${i}`,
      );
    }
  });
});

describe("engine: amounts that cannot be exact are refused", () => {
  it("an overtime, arrears, other-pay or deduction amount part-way through a kobo is refused, not rounded", () => {
    const base = build(one({ segs: [{ paid: 30, absent: 0, gross: kobo(84000), agreed: null, line: null }] }));
    expect(() => calculateEmployeePayroll({ ...base, overtime: [{ id: "o", beatId: "B0", clientId: "cl0", contractId: "C0", hours: 1, amount: 10.005 }] })).toThrow(MoneyError);
    expect(() => calculateEmployeePayroll({ ...base, arrears: [{ id: "a", grossImpact: 10.004, pensionableImpact: 0 }] })).toThrow(MoneyError);
    expect(() => calculateEmployeePayroll({ ...base, otherEarnings: [{ id: "e", name: "x", amount: 0.001, taxable: true }] })).toThrow(MoneyError);
    expect(() => calculateEmployeePayroll({ ...base, deductions: [{ id: "x", type: "LOAN_REPAYMENT", amount: 5.555, authorityReference: "R", reason: "t" }] })).toThrow(MoneyError);
  });
});

describe("overtime hourly rate", () => {
  it("is the gross over the days and hours, times the multiplier, rounded once: ₦4,800.60 ÷ 30 ÷ 8 × 2 = 40.005 → ₦40.01", () => {
    expect(overtimeHourlyRate(4800.6, 30, 8, 2)).toBe(40.01);
  });
  it("ties that were rounded down: ₦50,004 ÷ 30 ÷ 8 × 1.5 = 312.525 → ₦312.53, and ₦50,001.30 ÷ 30 ÷ 9 × 1.5 = 277.785 → ₦277.79", () => {
    expect(overtimeHourlyRate(50004, 30, 8, 1.5)).toBe(312.53);
    expect(overtimeHourlyRate(50001.3, 30, 9, 1.5)).toBe(277.79);
  });
  it("keeps the usual figures: ₦84,000 ÷ 30 ÷ 8 × 1.5 = ₦525", () => {
    expect(overtimeHourlyRate(84000, 30, 8, 1.5)).toBe(525);
    expect(overtimeHourlyRate(120000, 30, 8, 1)).toBe(500);
  });
  it("refuses an amount part-way through a kobo, and a multiplier with more than four decimals", () => {
    expect(() => overtimeHourlyRate(84000.005, 30, 8, 1.5)).toThrow(MoneyError);
    expect(() => overtimeHourlyRate(84000, 30, 8, 1.55555)).toThrow(MoneyError);
  });
});
