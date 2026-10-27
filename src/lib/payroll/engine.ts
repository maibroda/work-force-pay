/**
 * WorkforcePay payroll calculation engine (pure, framework-free, fully unit-testable).
 *
 * Key business rules implemented here:
 *  • Payroll location history comes from the employee's WORK RECORDS for the period — never
 *    from the "current location". Each beat/contract/rate combination becomes a segment.
 *  • Agreed client rate is shared 70:30 (configurable per contract / rate). The operative's
 *    share is the monthly gross that is split into salary components by the salary structure.
 *  • Components are prorated by paid days / basis days, per segment.
 *  • Employee pension = pensionable base × employee rate; employer pension computed separately
 *    and never reduces net pay. Employer pension is funded from the management share.
 *  • PAYE comes from the versioned tax rule passed in.
 */
/*
 * Arithmetic: every amount is whole kobo and every rate a whole number of units (money-exact.ts). Amounts that are not yet rounded (a salary component
 * before the days are added up across sites, a client billing) are exact fractions (exact-fraction.ts) and are rounded ONCE, where they have always been
 * rounded: the payslip line. The engine's inputs and results are still naira numbers because the services above it pass numbers; `kobo()` is the
 * temporary bridge (it refuses an amount that is part-way through a kobo) and goes when the services pass kobo (stage 4 of docs/plans/exact-money.md).
 */
import { round2 } from "../money"; // hours worked only; no money is rounded with it
import { Exact } from "../exact-fraction";
import { iso } from "../dates";
import {
  addKobo,
  koboFromNaira as kobo,
  koboToNumber,
  MoneyError,
  mulPct,
  pctToRate,
  RATE_SCALE,
  subKobo,
  sumKobo,
  type Kobo,
  type Rate,
} from "../money-exact";
import {
  computeComponentsExact,
  type ComponentAmount,
  type ComponentOverride,
  type ExactComponent,
  type StructureDef,
} from "./structure";
import { computePayeKobo, payeResultToNaira, type PayeResult, type PayeResultKobo, type TaxRuleDef } from "./paye";

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "OFF" | "SUSPENDED";
export const PAID_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "LEAVE", "OFF"];

export interface WorkDay {
  date: Date;
  clientId: string | null;
  clientName: string;
  contractId: string | null;
  beatId: string | null;
  beatName: string;
  categoryId: string;
  status: AttendanceStatus;
  overtimeHours: number;
}

export interface RateInfo {
  key: string; // unique key of the rate/structure combination
  source: "CONTRACT_RATE" | "EMPLOYEE_PAY_RATE";
  agreedRate: number | null; // client billing per head per month
  operativeSharePct: number | null;
  monthlyGross: number; // operative monthly gross
  structure: StructureDef;
}

export type BusinessLine = "GUARDING" | "OUTSOURCING";

/** Employer add-on costs beyond employer pension — see EmployerCostRule. */
export interface EmployerCostRuleInput {
  itfPct: number;
  nsitfPct: number;
  nhfMedicalPct: number;
  insurancePct: number;
  uniformKitsPct: number; // GUARDING only
  recruitmentTrainingPct: number;
  leaveRelieverPct: number;
  outsourcingLeaveAllowancePct: number; // OUTSOURCING only, % of Basic
}

export interface EngineInput {
  basisDays: number;
  days: WorkDay[];
  resolveRate: (day: WorkDay) => RateInfo | null;
  /** Business line of a contract (null = no contract → back-office pay, no add-on costs). */
  businessLineFor?: (contractId: string | null) => BusinessLine | null;
  employerCostRule?: EmployerCostRuleInput;
  overrides?: ComponentOverride[];
  overtime?: Array<{
    id: string;
    beatId: string;
    clientId: string;
    contractId: string;
    hours: number;
    amount: number;
  }>;
  arrears?: Array<{ id: string; grossImpact: number; pensionableImpact: number }>;
  otherEarnings?: Array<{ id: string; name: string; amount: number; taxable: boolean }>;
  deductions?: Array<{
    id: string;
    type: string;
    amount: number;
    authorityReference?: string | null;
    reason: string;
  }>;
  pension: { employeeRate: number; employerRate: number; version: string };
  taxRule: TaxRuleDef;
  annualRent?: number | null;
  /** Supplementary runs pay only adjustments (no base salary). */
  adjustmentsOnly?: boolean;
  /** For supplementary runs: the regular income already taxed in the locked run, so tax is marginal. */
  payeBase?: { regularTaxable: number; employeePension: number; basic: number };
}

export interface Segment {
  key: string;
  clientId: string | null;
  clientName: string;
  contractId: string | null;
  beatId: string | null;
  beatName: string;
  paidDays: number;
  recordedDays: number;
  from: string;
  to: string;
  factor: number;
  rate: RateInfo;
  components: ComponentAmount[];
  gross: number;
  pensionable: number;
  clientBilling: number;
  managementShare: number;
  businessLine: BusinessLine | null;
  itf: number;
  nsitf: number;
  nhfMedical: number;
  insurance: number;
  uniformKits: number;
  recruitmentTraining: number;
  leaveReliever: number;
  outsourcingLeaveAllowance: number;
}

export interface PayrollLine {
  type: "EARNING" | "DEDUCTION" | "EMPLOYER";
  code: string;
  name: string;
  amount: number;
}

export interface LocationWorked {
  clientName: string;
  beatName: string;
  days: number;
  from: string;
  to: string;
}

export interface Allocation {
  clientId: string | null;
  contractId: string | null;
  beatId: string | null;
  days: number;
  grossAmount: number;
  overtimeAmount: number;
  employerPension: number;
  clientBilling: number;
  managementShare: number;
  itf: number;
  nsitf: number;
  nhfMedical: number;
  insurance: number;
  uniformKits: number;
  recruitmentTraining: number;
  leaveReliever: number;
  outsourcingLeaveAllowance: number;
  businessCosts: number;
  netAmount: number;
}

/** BACK_OFFICE = no contract segments at all (pay-rate only); MIXED = paid segments split business lines. */
export type RecordBusinessLine = BusinessLine | "BACK_OFFICE" | "MIXED";

export interface EngineResult {
  basisDays: number;
  daysWorked: number;
  daysAbsent: number;
  suspensionDays: number;
  overtimeHours: number;
  monthlyGross: number;
  earnedGross: number;
  components: ComponentAmount[];
  overtimeAmount: number;
  arrearsAmount: number;
  otherEarnings: number;
  totalEarnings: number;
  pensionBase: number;
  employeePension: number;
  employerPension: number;
  taxableIncome: number;
  paye: PayeResult;
  otherDeductions: number;
  rejectedDeductions: Array<{ id: string; reason: string }>;
  totalDeductions: number;
  netPay: number;
  clientBilling: number;
  managementShare: number;
  employerCost: number;
  businessLine: RecordBusinessLine;
  itfAmount: number;
  nsitfAmount: number;
  nhfMedicalAmount: number;
  insuranceAmount: number;
  uniformKitsAmount: number;
  recruitmentTrainingAmount: number;
  leaveRelieverAmount: number;
  outsourcingLeaveAllowanceAmount: number;
  totalEmployerAddOns: number;
  hasOverride: boolean;
  lines: PayrollLine[];
  segments: Segment[];
  locations: LocationWorked[];
  allocations: Allocation[];
  unratedDays: WorkDay[];
}

export const DEDUCTION_AUTHORITY_ERROR =
  "Deduction cannot be processed because approval/reference documentation is missing.";

/** One site's amounts while the calculation runs: whole kobo, plus the exact (unrounded) pieces that are added across sites before rounding. */
interface SegmentWork {
  seg: Segment;
  comps: ExactComponent[];
  rawGross: Exact;
  gross: Kobo;
  pensionable: Kobo;
  clientBilling: Kobo;
  managementShare: Kobo;
  itf: Kobo;
  nsitf: Kobo;
  nhfMedical: Kobo;
  insurance: Kobo;
  uniformKits: Kobo;
  recruitmentTraining: Kobo;
  leaveReliever: Kobo;
  outsourcingLeaveAllowance: Kobo;
}

/** One beat's amounts while the calculation runs, in whole kobo. */
interface AllocationWork {
  clientId: string | null;
  contractId: string | null;
  beatId: string | null;
  days: number;
  grossAmount: Kobo;
  overtimeAmount: Kobo;
  employerPension: Kobo;
  clientBilling: Kobo;
  managementShare: Kobo;
  itf: Kobo;
  nsitf: Kobo;
  nhfMedical: Kobo;
  insurance: Kobo;
  uniformKits: Kobo;
  recruitmentTraining: Kobo;
  leaveReliever: Kobo;
  outsourcingLeaveAllowance: Kobo;
  businessCosts: Kobo;
  netAmount: Kobo;
}

const ZERO = 0 as Kobo;
const rateOf = (pct: number): Rate => pctToRate(String(pct));
const sumExact = (xs: Exact[]) => xs.reduce((a, b) => a.add(b), Exact.int(0));

export function calculateEmployeePayroll(input: EngineInput): EngineResult {
  const overrides = input.overrides ?? [];
  const days = [...input.days].sort((a, b) => a.date.getTime() - b.date.getTime());
  const paidDaysList = days.filter((x) => PAID_STATUSES.includes(x.status));
  const daysAbsent = days.filter((x) => x.status === "ABSENT").length;
  const suspensionDays = days.filter((x) => x.status === "SUSPENDED").length;
  const overtimeHours = round2((input.overtime ?? []).reduce((a, o) => a + o.hours, 0));
  const employeeRate = rateOf(input.pension.employeeRate);
  const employerRate = rateOf(input.pension.employerRate);
  const cost = input.employerCostRule
    ? {
        itf: rateOf(input.employerCostRule.itfPct),
        nsitf: rateOf(input.employerCostRule.nsitfPct),
        nhfMedical: input.employerCostRule.nhfMedicalPct ? rateOf(input.employerCostRule.nhfMedicalPct) : null,
        insurance: rateOf(input.employerCostRule.insurancePct),
        uniformKits: rateOf(input.employerCostRule.uniformKitsPct),
        recruitmentTraining: rateOf(input.employerCostRule.recruitmentTrainingPct),
        leaveReliever: rateOf(input.employerCostRule.leaveRelieverPct),
        outsourcingLeaveAllowance: rateOf(input.employerCostRule.outsourcingLeaveAllowancePct),
      }
    : null;

  // ── 1. Build segments from actual work records (beat × rate) ──
  const segMap = new Map<string, Segment>();
  const unratedDays: WorkDay[] = [];
  for (const day of days) {
    const rate = input.resolveRate(day);
    if (!rate) {
      if (PAID_STATUSES.includes(day.status)) unratedDays.push(day);
      continue;
    }
    const key = `${day.beatId ?? "NONE"}|${rate.key}`;
    let seg = segMap.get(key);
    if (!seg) {
      seg = {
        key,
        clientId: day.clientId,
        clientName: day.clientName,
        contractId: day.contractId,
        beatId: day.beatId,
        beatName: day.beatName,
        paidDays: 0,
        recordedDays: 0,
        from: iso(day.date),
        to: iso(day.date),
        factor: 0,
        rate,
        components: [],
        gross: 0,
        pensionable: 0,
        clientBilling: 0,
        managementShare: 0,
        businessLine: null,
        itf: 0,
        nsitf: 0,
        nhfMedical: 0,
        insurance: 0,
        uniformKits: 0,
        recruitmentTraining: 0,
        leaveReliever: 0,
        outsourcingLeaveAllowance: 0,
      };
      segMap.set(key, seg);
    }
    seg.recordedDays += 1;
    seg.to = iso(day.date);
    if (PAID_STATUSES.includes(day.status)) seg.paidDays += 1;
  }
  const segments = [...segMap.values()];
  const totalPaid = segments.reduce((a, s) => a + s.paidDays, 0);
  const divisor = Math.max(input.basisDays, totalPaid); // never pay more than one full month

  // ── 2. Components per segment (prorated) ──
  // Components are carried as exact fractions and only rounded once the sites are added (step 3), as they always have been.
  let billedRaw = Exact.int(0);
  let billedGrossRaw = Exact.int(0);
  const works: SegmentWork[] = [];
  for (const seg of segments) {
    seg.factor = input.adjustmentsOnly ? 0 : seg.paidDays / divisor; // for display only
    const factor = input.adjustmentsOnly || divisor === 0 ? Exact.int(0) : Exact.ratio(seg.paidDays, divisor);
    const comps = computeComponentsExact(seg.rate.structure, kobo(seg.rate.monthlyGross, "The monthly gross"), factor, overrides, {});
    const rawGross = sumExact(comps.map((c) => c.amount));
    const w: SegmentWork = {
      seg,
      comps,
      rawGross,
      gross: rawGross.round(),
      pensionable: sumExact(comps.filter((c) => c.pensionable).map((c) => c.amount)).round(),
      clientBilling: ZERO,
      managementShare: ZERO,
      itf: ZERO,
      nsitf: ZERO,
      nhfMedical: ZERO,
      insurance: ZERO,
      uniformKits: ZERO,
      recruitmentTraining: ZERO,
      leaveReliever: ZERO,
      outsourcingLeaveAllowance: ZERO,
    };
    if (seg.rate.agreedRate !== null) {
      const rawBilling = Exact.int(kobo(seg.rate.agreedRate, "The agreed rate")).mul(factor);
      w.clientBilling = rawBilling.round();
      w.managementShare = rawBilling.sub(rawGross).round();
      billedRaw = billedRaw.add(rawBilling);
      billedGrossRaw = billedGrossRaw.add(rawGross);
    }
    // ── Guarding / outsourcing employer add-on costs (ITF, NSITF, insurance, …) ──
    // ITF and NSITF-ECA are % of gross salary; the rest are % of (management fee less pension
    // employer, ITF, NSITF and NHF/medical if configured). Uniform & Kits is GUARDING only;
    // Outsourcing Leave Allowance (% of Basic) is OUTSOURCING only. See EmployerCostRule.
    // No contract (pay-rate / back-office pay) never carries these costs, regardless of what a
    // misconfigured resolver might return.
    seg.businessLine = seg.contractId ? (input.businessLineFor?.(seg.contractId) ?? null) : null;
    if (seg.businessLine && cost) {
      const segEmployerPension = mulPct(w.pensionable, employerRate);
      w.itf = mulPct(w.gross, cost.itf);
      w.nsitf = mulPct(w.gross, cost.nsitf);
      w.nhfMedical = cost.nhfMedical ? mulPct(w.gross, cost.nhfMedical) : ZERO;
      const left = subKobo(subKobo(subKobo(subKobo(w.managementShare, segEmployerPension), w.itf), w.nsitf), w.nhfMedical);
      const statBase = left > 0 ? left : ZERO;
      w.insurance = mulPct(statBase, cost.insurance);
      w.recruitmentTraining = mulPct(statBase, cost.recruitmentTraining);
      w.leaveReliever = mulPct(statBase, cost.leaveReliever);
      if (seg.businessLine === "GUARDING") w.uniformKits = mulPct(statBase, cost.uniformKits);
      if (seg.businessLine === "OUTSOURCING") {
        // The leave allowance is a share of the site's Basic BEFORE it is rounded, as it always was.
        const segBasic = comps.find((c) => c.code === "BASIC")?.amount ?? Exact.int(0);
        w.outsourcingLeaveAllowance = segBasic.mul(Exact.ratio(BigInt(cost.outsourcingLeaveAllowance), RATE_SCALE)).round();
      }
    }
    works.push(w);
  }

  // ── 3. Aggregate components by code ──
  const compMap = new Map<string, ExactComponent>();
  for (const w of works) {
    for (const c of w.comps) {
      const prev = compMap.get(c.code);
      if (prev) compMap.set(c.code, { ...prev, amount: prev.amount.add(c.amount), overridden: prev.overridden || c.overridden });
      else compMap.set(c.code, { ...c });
    }
  }
  const compLines = [...compMap.values()].map((c) => ({ code: c.code, name: c.name, taxable: c.taxable, pensionable: c.pensionable, overridden: c.overridden, kobo: c.amount.round() }));
  const components: ComponentAmount[] = compLines.map((c) => ({
    code: c.code,
    name: c.name,
    amount: koboToNumber(c.kobo),
    taxable: c.taxable,
    pensionable: c.pensionable,
    overridden: c.overridden,
  }));
  const earnedGross = sumKobo(compLines.map((c) => c.kobo));
  const hasOverride = compLines.some((c) => c.overridden);

  // ── 4. Overtime, arrears, other earnings ──
  const overtimeAmount = sumKobo((input.overtime ?? []).map((o) => kobo(o.amount, "An overtime amount")));
  const arrearsAmount = sumKobo((input.arrears ?? []).map((x) => kobo(x.grossImpact, "An arrears amount")));
  const arrearsPensionable = sumKobo((input.arrears ?? []).map((x) => kobo(x.pensionableImpact, "An arrears pensionable amount")));
  const otherList = input.otherEarnings ?? [];
  const otherKobo = otherList.map((x) => ({ x, kobo: kobo(x.amount, `The ${x.name} amount`) }));
  const otherEarnings = sumKobo(otherKobo.map((o) => o.kobo));
  const otherTaxable = sumKobo(otherKobo.filter((o) => o.x.taxable).map((o) => o.kobo));
  const totalEarnings = sumKobo([earnedGross, overtimeAmount, arrearsAmount, otherEarnings]);

  // ── 5. Pension ──
  const pensionBase = sumKobo([...compLines.filter((c) => c.pensionable).map((c) => c.kobo), arrearsPensionable]);
  const employeePension = mulPct(pensionBase, employeeRate);
  const employerPension = mulPct(pensionBase, employerRate);

  // ── 6. PAYE ──
  const regularTaxable = sumKobo(compLines.filter((c) => c.taxable).map((c) => c.kobo));
  const irregularTaxable = sumKobo([overtimeAmount, arrearsAmount, otherTaxable]);
  const basic = compLines.find((c) => c.code === "BASIC")?.kobo ?? ZERO;
  const annualRent = kobo(input.annualRent ?? 0, "The annual rent");
  let payeK: PayeResultKobo;
  if (input.payeBase) {
    // Supplementary: tax only the increment over what the locked payroll already taxed.
    const b = input.payeBase;
    const common = {
      employeePension: kobo(b.employeePension, "The earlier pension"),
      basic: kobo(b.basic, "The earlier basic pay"),
      annualRent,
    };
    const earlier = kobo(b.regularTaxable, "The earlier taxable pay");
    const before = computePayeKobo({ ...common, regularTaxable: earlier, irregularTaxable: ZERO }, input.taxRule);
    const after = computePayeKobo({ ...common, regularTaxable: addKobo(earlier, regularTaxable), irregularTaxable }, input.taxRule);
    payeK = { ...after, paye: after.paye > before.paye ? subKobo(after.paye, before.paye) : ZERO };
  } else {
    payeK = computePayeKobo({ regularTaxable, irregularTaxable, employeePension, basic, annualRent }, input.taxRule);
  }
  const paye: PayeResult = payeResultToNaira(payeK);

  // ── 7. Approved deductions (documented authority required) ──
  const rejectedDeductions: EngineResult["rejectedDeductions"] = [];
  const accepted = (input.deductions ?? []).filter((x) => {
    if (!x.authorityReference || !x.authorityReference.trim()) {
      rejectedDeductions.push({ id: x.id, reason: DEDUCTION_AUTHORITY_ERROR });
      return false;
    }
    return true;
  });
  const acceptedKobo = accepted.map((x) => ({ x, kobo: kobo(x.amount, "A deduction amount") }));
  const otherDeductions = sumKobo(acceptedKobo.map((a) => a.kobo));
  const totalDeductions = sumKobo([payeK.paye, employeePension, otherDeductions]);
  const netPay = subKobo(totalEarnings, totalDeductions);

  const clientBilling = billedRaw.round();
  const managementShare = billedRaw.sub(billedGrossRaw).round();

  // ── 7b. Guarding / outsourcing employer add-on costs, summed from segments ──
  const sumSeg = (f: (w: SegmentWork) => Kobo) => sumKobo(works.map(f));
  const itfAmount = sumSeg((w) => w.itf);
  const nsitfAmount = sumSeg((w) => w.nsitf);
  const nhfMedicalAmount = sumSeg((w) => w.nhfMedical);
  const insuranceAmount = sumSeg((w) => w.insurance);
  const uniformKitsAmount = sumSeg((w) => w.uniformKits);
  const recruitmentTrainingAmount = sumSeg((w) => w.recruitmentTraining);
  const leaveRelieverAmount = sumSeg((w) => w.leaveReliever);
  const outsourcingLeaveAllowanceAmount = sumSeg((w) => w.outsourcingLeaveAllowance);
  const totalEmployerAddOns = sumKobo([
    itfAmount,
    nsitfAmount,
    nhfMedicalAmount,
    insuranceAmount,
    uniformKitsAmount,
    recruitmentTrainingAmount,
    leaveRelieverAmount,
    outsourcingLeaveAllowanceAmount,
  ]);
  const paidLines = segments.filter((s) => s.businessLine);
  const businessLine: RecordBusinessLine = !paidLines.length
    ? "BACK_OFFICE"
    : paidLines.every((s) => s.businessLine === paidLines[0].businessLine)
      ? paidLines[0].businessLine!
      : "MIXED";
  const employerCost = sumKobo([totalEarnings, employerPension, totalEmployerAddOns]);

  // ── 8. Payslip lines ──
  const lines: PayrollLine[] = [
    ...components.map((c) => ({ type: "EARNING" as const, code: c.code, name: c.name, amount: c.amount })),
  ];
  if (overtimeAmount)
    lines.push({ type: "EARNING", code: "OVERTIME", name: "Overtime", amount: koboToNumber(overtimeAmount) });
  if (arrearsAmount) lines.push({ type: "EARNING", code: "ARREARS", name: "Arrears", amount: koboToNumber(arrearsAmount) });
  for (const o of otherKobo)
    lines.push({ type: "EARNING", code: "OTHER", name: o.x.name, amount: koboToNumber(o.kobo) });
  lines.push({ type: "DEDUCTION", code: "PAYE", name: "PAYE", amount: paye.paye });
  lines.push({ type: "DEDUCTION", code: "PENSION_EE", name: "Employee Pension", amount: koboToNumber(employeePension) });
  for (const a of acceptedKobo)
    lines.push({
      type: "DEDUCTION",
      code: a.x.type,
      name: `${labelDeduction(a.x.type)} — ${a.x.reason}`,
      amount: koboToNumber(a.kobo),
    });
  lines.push({ type: "EMPLOYER", code: "PENSION_ER", name: "Employer Pension", amount: koboToNumber(employerPension) });
  if (itfAmount)
    lines.push({ type: "EMPLOYER", code: "ITF", name: "ITF (Industrial Training Fund)", amount: koboToNumber(itfAmount) });
  if (nsitfAmount) lines.push({ type: "EMPLOYER", code: "NSITF", name: "NSITF-ECA", amount: koboToNumber(nsitfAmount) });
  if (nhfMedicalAmount)
    lines.push({ type: "EMPLOYER", code: "NHF_MEDICAL", name: "NHF / Medical", amount: koboToNumber(nhfMedicalAmount) });
  if (insuranceAmount)
    lines.push({ type: "EMPLOYER", code: "INSURANCE", name: "Insurance", amount: koboToNumber(insuranceAmount) });
  if (uniformKitsAmount)
    lines.push({ type: "EMPLOYER", code: "UNIFORM_KITS", name: "Uniform & Kits", amount: koboToNumber(uniformKitsAmount) });
  if (recruitmentTrainingAmount)
    lines.push({
      type: "EMPLOYER",
      code: "RECRUITMENT_TRAINING",
      name: "Recruitment, Training & Vetting",
      amount: koboToNumber(recruitmentTrainingAmount),
    });
  if (leaveRelieverAmount)
    lines.push({
      type: "EMPLOYER",
      code: "LEAVE_RELIEVER",
      name: "Annual Leave Reliever",
      amount: koboToNumber(leaveRelieverAmount),
    });
  if (outsourcingLeaveAllowanceAmount)
    lines.push({
      type: "EMPLOYER",
      code: "OUTSOURCING_LEAVE_ALLOWANCE",
      name: "Outsourcing Leave Allowance",
      amount: koboToNumber(outsourcingLeaveAllowanceAmount),
    });

  // ── 9. Locations worked (for payslip) ──
  const locations = buildLocationRanges(days);

  // ── 10. Allocation by client / contract / beat ──
  const allocMap = new Map<string, AllocationWork>();
  const allocKey = (b: string | null) => b ?? "NONE";
  const newAllocation = (clientId: string | null, contractId: string | null, beatId: string | null): AllocationWork => ({
    clientId,
    contractId,
    beatId,
    days: 0,
    grossAmount: ZERO,
    overtimeAmount: ZERO,
    employerPension: ZERO,
    clientBilling: ZERO,
    managementShare: ZERO,
    itf: ZERO,
    nsitf: ZERO,
    nhfMedical: ZERO,
    insurance: ZERO,
    uniformKits: ZERO,
    recruitmentTraining: ZERO,
    leaveReliever: ZERO,
    outsourcingLeaveAllowance: ZERO,
    businessCosts: ZERO,
    netAmount: ZERO,
  });
  for (const w of works) {
    const s = w.seg;
    const k = allocKey(s.beatId);
    const a = allocMap.get(k) ?? newAllocation(s.clientId, s.contractId, s.beatId);
    a.days += s.paidDays;
    a.grossAmount = addKobo(a.grossAmount, w.gross);
    // The running employer pension is rounded after each site is added, as it always was.
    a.employerPension = Exact.int(a.employerPension).add(Exact.ratio(BigInt(w.pensionable) * BigInt(employerRate), RATE_SCALE)).round();
    a.clientBilling = addKobo(a.clientBilling, w.clientBilling);
    a.managementShare = addKobo(a.managementShare, w.managementShare);
    a.itf = addKobo(a.itf, w.itf);
    a.nsitf = addKobo(a.nsitf, w.nsitf);
    a.nhfMedical = addKobo(a.nhfMedical, w.nhfMedical);
    a.insurance = addKobo(a.insurance, w.insurance);
    a.uniformKits = addKobo(a.uniformKits, w.uniformKits);
    a.recruitmentTraining = addKobo(a.recruitmentTraining, w.recruitmentTraining);
    a.leaveReliever = addKobo(a.leaveReliever, w.leaveReliever);
    a.outsourcingLeaveAllowance = addKobo(a.outsourcingLeaveAllowance, w.outsourcingLeaveAllowance);
    a.businessCosts = sumKobo([a.itf, a.nsitf, a.nhfMedical, a.insurance, a.uniformKits, a.recruitmentTraining, a.leaveReliever, a.outsourcingLeaveAllowance]);
    allocMap.set(k, a);
  }
  for (const o of input.overtime ?? []) {
    const k = allocKey(o.beatId);
    const a = allocMap.get(k) ?? newAllocation(o.clientId, o.contractId, o.beatId);
    a.overtimeAmount = addKobo(a.overtimeAmount, kobo(o.amount, "An overtime amount"));
    allocMap.set(k, a);
  }
  const allocationWork = [...allocMap.values()];
  // Arrears / other earnings go to the primary (most days) allocation.
  const extra = addKobo(arrearsAmount, otherEarnings);
  if (extra && allocationWork.length) {
    const primary = allocationWork.reduce((p, c) => (c.days > p.days ? c : p));
    primary.grossAmount = addKobo(primary.grossAmount, extra);
    primary.employerPension = addKobo(primary.employerPension, mulPct(arrearsPensionable, employerRate));
  }
  // Net pay distributed pro-rata to (gross + overtime) so beat totals reconcile to the record.
  const weight = (a: AllocationWork) => addKobo(a.grossAmount, a.overtimeAmount);
  const allocBase = sumKobo(allocationWork.map(weight));
  let distributed: Kobo = ZERO;
  allocationWork.forEach((a, i) => {
    if (i === allocationWork.length - 1) a.netAmount = subKobo(netPay, distributed);
    else {
      a.netAmount = allocBase ? Exact.ratio(BigInt(netPay) * BigInt(weight(a)), BigInt(allocBase)).round() : ZERO;
      distributed = addKobo(distributed, a.netAmount);
    }
  });
  const allocations: Allocation[] = allocationWork.map((a) => ({
    clientId: a.clientId,
    contractId: a.contractId,
    beatId: a.beatId,
    days: a.days,
    grossAmount: koboToNumber(a.grossAmount),
    overtimeAmount: koboToNumber(a.overtimeAmount),
    employerPension: koboToNumber(a.employerPension),
    clientBilling: koboToNumber(a.clientBilling),
    managementShare: koboToNumber(a.managementShare),
    itf: koboToNumber(a.itf),
    nsitf: koboToNumber(a.nsitf),
    nhfMedical: koboToNumber(a.nhfMedical),
    insurance: koboToNumber(a.insurance),
    uniformKits: koboToNumber(a.uniformKits),
    recruitmentTraining: koboToNumber(a.recruitmentTraining),
    leaveReliever: koboToNumber(a.leaveReliever),
    outsourcingLeaveAllowance: koboToNumber(a.outsourcingLeaveAllowance),
    businessCosts: koboToNumber(a.businessCosts),
    netAmount: koboToNumber(a.netAmount),
  }));

  // The sites' amounts, as the naira numbers the result has always carried.
  for (const w of works) {
    const s = w.seg;
    s.components = w.comps.map((c) => ({
      code: c.code,
      name: c.name,
      amount: koboToNumber(c.amount.round()),
      taxable: c.taxable,
      pensionable: c.pensionable,
      overridden: c.overridden,
    }));
    s.gross = koboToNumber(w.gross);
    s.pensionable = koboToNumber(w.pensionable);
    s.clientBilling = koboToNumber(w.clientBilling);
    s.managementShare = koboToNumber(w.managementShare);
    s.itf = koboToNumber(w.itf);
    s.nsitf = koboToNumber(w.nsitf);
    s.nhfMedical = koboToNumber(w.nhfMedical);
    s.insurance = koboToNumber(w.insurance);
    s.uniformKits = koboToNumber(w.uniformKits);
    s.recruitmentTraining = koboToNumber(w.recruitmentTraining);
    s.leaveReliever = koboToNumber(w.leaveReliever);
    s.outsourcingLeaveAllowance = koboToNumber(w.outsourcingLeaveAllowance);
  }

  const primarySeg = segments.reduce<Segment | null>((p, c) => (!p || c.paidDays > p.paidDays ? c : p), null);

  return {
    basisDays: input.basisDays,
    daysWorked: paidDaysList.length,
    daysAbsent,
    suspensionDays,
    overtimeHours,
    monthlyGross: primarySeg?.rate.monthlyGross ?? 0,
    earnedGross: koboToNumber(earnedGross),
    components,
    overtimeAmount: koboToNumber(overtimeAmount),
    arrearsAmount: koboToNumber(arrearsAmount),
    otherEarnings: koboToNumber(otherEarnings),
    totalEarnings: koboToNumber(totalEarnings),
    pensionBase: koboToNumber(pensionBase),
    employeePension: koboToNumber(employeePension),
    employerPension: koboToNumber(employerPension),
    taxableIncome: koboToNumber(addKobo(regularTaxable, irregularTaxable)),
    paye,
    otherDeductions: koboToNumber(otherDeductions),
    rejectedDeductions,
    totalDeductions: koboToNumber(totalDeductions),
    netPay: koboToNumber(netPay),
    clientBilling: koboToNumber(clientBilling),
    managementShare: koboToNumber(managementShare),
    employerCost: koboToNumber(employerCost),
    businessLine,
    itfAmount: koboToNumber(itfAmount),
    nsitfAmount: koboToNumber(nsitfAmount),
    nhfMedicalAmount: koboToNumber(nhfMedicalAmount),
    insuranceAmount: koboToNumber(insuranceAmount),
    uniformKitsAmount: koboToNumber(uniformKitsAmount),
    recruitmentTrainingAmount: koboToNumber(recruitmentTrainingAmount),
    leaveRelieverAmount: koboToNumber(leaveRelieverAmount),
    outsourcingLeaveAllowanceAmount: koboToNumber(outsourcingLeaveAllowanceAmount),
    totalEmployerAddOns: koboToNumber(totalEmployerAddOns),
    hasOverride,
    lines,
    segments,
    locations,
    allocations,
    unratedDays,
  };
}

/** Consecutive-day ranges per beat, e.g. "01–10 Sep: ABC Bank — Victoria Island". */
export function buildLocationRanges(days: WorkDay[]): LocationWorked[] {
  const sorted = [...days].sort((a, b) => a.date.getTime() - b.date.getTime());
  const ranges: LocationWorked[] = [];
  for (const day of sorted) {
    const last = ranges[ranges.length - 1];
    const paid = PAID_STATUSES.includes(day.status) ? 1 : 0;
    if (last && last.beatName === day.beatName && last.clientName === day.clientName) {
      last.to = iso(day.date);
      last.days += paid;
    } else {
      ranges.push({
        clientName: day.clientName,
        beatName: day.beatName,
        days: paid,
        from: iso(day.date),
        to: iso(day.date),
      });
    }
  }
  return ranges;
}

function labelDeduction(t: string): string {
  return t
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Hourly overtime rate derived from the operative gross when a client schedule gives no rate: gross ÷ days ÷ hours × multiplier, worked exactly and
 * rounded once, half up, to the kobo. The multiplier can have at most four decimal places.
 */
export function overtimeHourlyRate(
  monthlyGross: number,
  basisDays: number,
  hoursPerDay: number,
  multiplier: number,
) {
  const m = Exact.fromNumber(multiplier);
  if (m.mul(Exact.int(10_000)).d !== 1n) throw new MoneyError("The overtime multiplier can have at most four decimal places.");
  const hourly = Exact.int(kobo(monthlyGross, "The monthly gross"))
    .div(Exact.fromNumber(basisDays))
    .div(Exact.fromNumber(hoursPerDay))
    .mul(m);
  return koboToNumber(hourly.round());
}
