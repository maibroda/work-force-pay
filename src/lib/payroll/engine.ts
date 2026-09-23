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
import { round2 } from "../money";
import { iso } from "../dates";
import {
  computeComponents,
  type ComponentAmount,
  type ComponentOverride,
  type StructureDef,
} from "./structure";
import { computePaye, type PayeResult, type TaxRuleDef } from "./paye";

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

export function calculateEmployeePayroll(input: EngineInput): EngineResult {
  const overrides = input.overrides ?? [];
  const days = [...input.days].sort((a, b) => a.date.getTime() - b.date.getTime());
  const paidDaysList = days.filter((x) => PAID_STATUSES.includes(x.status));
  const daysAbsent = days.filter((x) => x.status === "ABSENT").length;
  const suspensionDays = days.filter((x) => x.status === "SUSPENDED").length;
  const overtimeHours = round2((input.overtime ?? []).reduce((a, o) => a + o.hours, 0));

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
  let billedRaw = 0;
  let billedGrossRaw = 0;
  for (const seg of segments) {
    seg.factor = input.adjustmentsOnly ? 0 : seg.paidDays / divisor;
    seg.components = computeComponents(
      seg.rate.structure,
      seg.rate.monthlyGross,
      seg.factor,
      overrides,
      {},
      false,
    );
    const rawGross = seg.components.reduce((a, c) => a + c.amount, 0);
    seg.gross = round2(rawGross);
    seg.pensionable = round2(seg.components.filter((c) => c.pensionable).reduce((a, c) => a + c.amount, 0));
    if (seg.rate.agreedRate !== null) {
      const rawBilling = seg.rate.agreedRate * seg.factor;
      seg.clientBilling = round2(rawBilling);
      seg.managementShare = round2(rawBilling - rawGross);
      billedRaw += rawBilling;
      billedGrossRaw += rawGross;
    }
    // ── Guarding / outsourcing employer add-on costs (ITF, NSITF, insurance, …) ──
    // ITF and NSITF-ECA are % of gross salary; the rest are % of (management fee less pension
    // employer, ITF, NSITF and NHF/medical if configured). Uniform & Kits is GUARDING only;
    // Outsourcing Leave Allowance (% of Basic) is OUTSOURCING only. See EmployerCostRule.
    // No contract (pay-rate / back-office pay) never carries these costs, regardless of what a
    // misconfigured resolver might return.
    seg.businessLine = seg.contractId ? (input.businessLineFor?.(seg.contractId) ?? null) : null;
    const ecr = input.employerCostRule;
    if (seg.businessLine && ecr) {
      const segEmployerPension = round2((seg.pensionable * input.pension.employerRate) / 100);
      seg.itf = round2((seg.gross * ecr.itfPct) / 100);
      seg.nsitf = round2((seg.gross * ecr.nsitfPct) / 100);
      seg.nhfMedical = ecr.nhfMedicalPct ? round2((seg.gross * ecr.nhfMedicalPct) / 100) : 0;
      const statBase = Math.max(
        0,
        round2(seg.managementShare - segEmployerPension - seg.itf - seg.nsitf - seg.nhfMedical),
      );
      seg.insurance = round2((statBase * ecr.insurancePct) / 100);
      seg.recruitmentTraining = round2((statBase * ecr.recruitmentTrainingPct) / 100);
      seg.leaveReliever = round2((statBase * ecr.leaveRelieverPct) / 100);
      if (seg.businessLine === "GUARDING") seg.uniformKits = round2((statBase * ecr.uniformKitsPct) / 100);
      if (seg.businessLine === "OUTSOURCING") {
        const segBasic = seg.components.find((c) => c.code === "BASIC")?.amount ?? 0;
        seg.outsourcingLeaveAllowance = round2((segBasic * ecr.outsourcingLeaveAllowancePct) / 100);
      }
    }
  }

  // ── 3. Aggregate components by code ──
  const compMap = new Map<string, ComponentAmount>();
  for (const seg of segments) {
    for (const c of seg.components) {
      const prev = compMap.get(c.code);
      if (prev) {
        prev.amount = prev.amount + c.amount;
        prev.overridden = prev.overridden || c.overridden;
      } else compMap.set(c.code, { ...c });
    }
  }
  const components = [...compMap.values()].map((c) => ({ ...c, amount: round2(c.amount) }));
  for (const seg of segments)
    seg.components = seg.components.map((c) => ({ ...c, amount: round2(c.amount) }));
  const earnedGross = round2(components.reduce((a, c) => a + c.amount, 0));
  const hasOverride = components.some((c) => c.overridden);

  // ── 4. Overtime, arrears, other earnings ──
  const overtimeAmount = round2((input.overtime ?? []).reduce((a, o) => a + o.amount, 0));
  const arrearsAmount = round2((input.arrears ?? []).reduce((a, x) => a + x.grossImpact, 0));
  const arrearsPensionable = round2((input.arrears ?? []).reduce((a, x) => a + x.pensionableImpact, 0));
  const otherList = input.otherEarnings ?? [];
  const otherEarnings = round2(otherList.reduce((a, x) => a + x.amount, 0));
  const otherTaxable = round2(otherList.filter((x) => x.taxable).reduce((a, x) => a + x.amount, 0));
  const totalEarnings = round2(earnedGross + overtimeAmount + arrearsAmount + otherEarnings);

  // ── 5. Pension ──
  const pensionBase = round2(
    components.filter((c) => c.pensionable).reduce((a, c) => a + c.amount, 0) + arrearsPensionable,
  );
  const employeePension = round2((pensionBase * input.pension.employeeRate) / 100);
  const employerPension = round2((pensionBase * input.pension.employerRate) / 100);

  // ── 6. PAYE ──
  const regularTaxable = round2(components.filter((c) => c.taxable).reduce((a, c) => a + c.amount, 0));
  const irregularTaxable = round2(overtimeAmount + arrearsAmount + otherTaxable);
  const basic = components.find((c) => c.code === "BASIC")?.amount ?? 0;
  let paye: PayeResult;
  if (input.payeBase) {
    // Supplementary: tax only the increment over what the locked payroll already taxed.
    const b = input.payeBase;
    const common = {
      monthlyEmployeePension: b.employeePension,
      monthlyBasic: b.basic,
      annualRent: input.annualRent ?? 0,
    };
    const before = computePaye(
      { ...common, monthlyRegularTaxable: b.regularTaxable, monthlyIrregularTaxable: 0 },
      input.taxRule,
    );
    const after = computePaye(
      {
        ...common,
        monthlyRegularTaxable: b.regularTaxable + regularTaxable,
        monthlyIrregularTaxable: irregularTaxable,
      },
      input.taxRule,
    );
    paye = { ...after, paye: round2(Math.max(0, after.paye - before.paye)) };
  } else {
    paye = computePaye(
      {
        monthlyRegularTaxable: regularTaxable,
        monthlyIrregularTaxable: irregularTaxable,
        monthlyEmployeePension: employeePension,
        monthlyBasic: basic,
        annualRent: input.annualRent ?? 0,
      },
      input.taxRule,
    );
  }

  // ── 7. Approved deductions (documented authority required) ──
  const rejectedDeductions: EngineResult["rejectedDeductions"] = [];
  const accepted = (input.deductions ?? []).filter((x) => {
    if (!x.authorityReference || !x.authorityReference.trim()) {
      rejectedDeductions.push({ id: x.id, reason: DEDUCTION_AUTHORITY_ERROR });
      return false;
    }
    return true;
  });
  const otherDeductions = round2(accepted.reduce((a, x) => a + x.amount, 0));
  const totalDeductions = round2(paye.paye + employeePension + otherDeductions);
  const netPay = round2(totalEarnings - totalDeductions);

  const clientBilling = round2(billedRaw);
  const managementShare = round2(billedRaw - billedGrossRaw);

  // ── 7b. Guarding / outsourcing employer add-on costs, summed from segments ──
  const sumSeg = (f: (s: Segment) => number) => round2(segments.reduce((a, s) => a + f(s), 0));
  const itfAmount = sumSeg((s) => s.itf);
  const nsitfAmount = sumSeg((s) => s.nsitf);
  const nhfMedicalAmount = sumSeg((s) => s.nhfMedical);
  const insuranceAmount = sumSeg((s) => s.insurance);
  const uniformKitsAmount = sumSeg((s) => s.uniformKits);
  const recruitmentTrainingAmount = sumSeg((s) => s.recruitmentTraining);
  const leaveRelieverAmount = sumSeg((s) => s.leaveReliever);
  const outsourcingLeaveAllowanceAmount = sumSeg((s) => s.outsourcingLeaveAllowance);
  const totalEmployerAddOns = round2(
    itfAmount +
      nsitfAmount +
      nhfMedicalAmount +
      insuranceAmount +
      uniformKitsAmount +
      recruitmentTrainingAmount +
      leaveRelieverAmount +
      outsourcingLeaveAllowanceAmount,
  );
  const paidLines = segments.filter((s) => s.businessLine);
  const businessLine: RecordBusinessLine = !paidLines.length
    ? "BACK_OFFICE"
    : paidLines.every((s) => s.businessLine === paidLines[0].businessLine)
      ? paidLines[0].businessLine!
      : "MIXED";
  const employerCost = round2(totalEarnings + employerPension + totalEmployerAddOns);

  // ── 8. Payslip lines ──
  const lines: PayrollLine[] = [
    ...components.map((c) => ({ type: "EARNING" as const, code: c.code, name: c.name, amount: c.amount })),
  ];
  if (overtimeAmount)
    lines.push({ type: "EARNING", code: "OVERTIME", name: "Overtime", amount: overtimeAmount });
  if (arrearsAmount) lines.push({ type: "EARNING", code: "ARREARS", name: "Arrears", amount: arrearsAmount });
  for (const o of otherList)
    lines.push({ type: "EARNING", code: "OTHER", name: o.name, amount: round2(o.amount) });
  lines.push({ type: "DEDUCTION", code: "PAYE", name: "PAYE", amount: paye.paye });
  lines.push({ type: "DEDUCTION", code: "PENSION_EE", name: "Employee Pension", amount: employeePension });
  for (const x of accepted)
    lines.push({
      type: "DEDUCTION",
      code: x.type,
      name: `${labelDeduction(x.type)} — ${x.reason}`,
      amount: round2(x.amount),
    });
  lines.push({ type: "EMPLOYER", code: "PENSION_ER", name: "Employer Pension", amount: employerPension });
  if (itfAmount)
    lines.push({ type: "EMPLOYER", code: "ITF", name: "ITF (Industrial Training Fund)", amount: itfAmount });
  if (nsitfAmount) lines.push({ type: "EMPLOYER", code: "NSITF", name: "NSITF-ECA", amount: nsitfAmount });
  if (nhfMedicalAmount)
    lines.push({ type: "EMPLOYER", code: "NHF_MEDICAL", name: "NHF / Medical", amount: nhfMedicalAmount });
  if (insuranceAmount)
    lines.push({ type: "EMPLOYER", code: "INSURANCE", name: "Insurance", amount: insuranceAmount });
  if (uniformKitsAmount)
    lines.push({ type: "EMPLOYER", code: "UNIFORM_KITS", name: "Uniform & Kits", amount: uniformKitsAmount });
  if (recruitmentTrainingAmount)
    lines.push({
      type: "EMPLOYER",
      code: "RECRUITMENT_TRAINING",
      name: "Recruitment, Training & Vetting",
      amount: recruitmentTrainingAmount,
    });
  if (leaveRelieverAmount)
    lines.push({
      type: "EMPLOYER",
      code: "LEAVE_RELIEVER",
      name: "Annual Leave Reliever",
      amount: leaveRelieverAmount,
    });
  if (outsourcingLeaveAllowanceAmount)
    lines.push({
      type: "EMPLOYER",
      code: "OUTSOURCING_LEAVE_ALLOWANCE",
      name: "Outsourcing Leave Allowance",
      amount: outsourcingLeaveAllowanceAmount,
    });

  // ── 9. Locations worked (for payslip) ──
  const locations = buildLocationRanges(days);

  // ── 10. Allocation by client / contract / beat ──
  const allocMap = new Map<string, Allocation>();
  const allocKey = (b: string | null) => b ?? "NONE";
  for (const s of segments) {
    const k = allocKey(s.beatId);
    const a = allocMap.get(k) ?? {
      clientId: s.clientId,
      contractId: s.contractId,
      beatId: s.beatId,
      days: 0,
      grossAmount: 0,
      overtimeAmount: 0,
      employerPension: 0,
      clientBilling: 0,
      managementShare: 0,
      itf: 0,
      nsitf: 0,
      nhfMedical: 0,
      insurance: 0,
      uniformKits: 0,
      recruitmentTraining: 0,
      leaveReliever: 0,
      outsourcingLeaveAllowance: 0,
      businessCosts: 0,
      netAmount: 0,
    };
    a.days += s.paidDays;
    a.grossAmount = round2(a.grossAmount + s.gross);
    a.employerPension = round2(a.employerPension + (s.pensionable * input.pension.employerRate) / 100);
    a.clientBilling = round2(a.clientBilling + s.clientBilling);
    a.managementShare = round2(a.managementShare + s.managementShare);
    a.itf = round2(a.itf + s.itf);
    a.nsitf = round2(a.nsitf + s.nsitf);
    a.nhfMedical = round2(a.nhfMedical + s.nhfMedical);
    a.insurance = round2(a.insurance + s.insurance);
    a.uniformKits = round2(a.uniformKits + s.uniformKits);
    a.recruitmentTraining = round2(a.recruitmentTraining + s.recruitmentTraining);
    a.leaveReliever = round2(a.leaveReliever + s.leaveReliever);
    a.outsourcingLeaveAllowance = round2(a.outsourcingLeaveAllowance + s.outsourcingLeaveAllowance);
    a.businessCosts = round2(
      a.itf +
        a.nsitf +
        a.nhfMedical +
        a.insurance +
        a.uniformKits +
        a.recruitmentTraining +
        a.leaveReliever +
        a.outsourcingLeaveAllowance,
    );
    allocMap.set(k, a);
  }
  for (const o of input.overtime ?? []) {
    const k = allocKey(o.beatId);
    const a = allocMap.get(k) ?? {
      clientId: o.clientId,
      contractId: o.contractId,
      beatId: o.beatId,
      days: 0,
      grossAmount: 0,
      overtimeAmount: 0,
      employerPension: 0,
      clientBilling: 0,
      managementShare: 0,
      itf: 0,
      nsitf: 0,
      nhfMedical: 0,
      insurance: 0,
      uniformKits: 0,
      recruitmentTraining: 0,
      leaveReliever: 0,
      outsourcingLeaveAllowance: 0,
      businessCosts: 0,
      netAmount: 0,
    };
    a.overtimeAmount = round2(a.overtimeAmount + o.amount);
    allocMap.set(k, a);
  }
  const allocations = [...allocMap.values()];
  // Arrears / other earnings go to the primary (most days) allocation.
  const extra = round2(arrearsAmount + otherEarnings);
  if (extra && allocations.length) {
    const primary = allocations.reduce((p, c) => (c.days > p.days ? c : p));
    primary.grossAmount = round2(primary.grossAmount + extra);
    const arrEr = round2((arrearsPensionable * input.pension.employerRate) / 100);
    primary.employerPension = round2(primary.employerPension + arrEr);
  }
  // Net pay distributed pro-rata to (gross + overtime) so beat totals reconcile to the record.
  const allocBase = allocations.reduce((a, x) => a + x.grossAmount + x.overtimeAmount, 0);
  let distributed = 0;
  allocations.forEach((a, i) => {
    if (i === allocations.length - 1) a.netAmount = round2(netPay - distributed);
    else {
      a.netAmount = allocBase ? round2((netPay * (a.grossAmount + a.overtimeAmount)) / allocBase) : 0;
      distributed = round2(distributed + a.netAmount);
    }
  });

  const primarySeg = segments.reduce<Segment | null>((p, c) => (!p || c.paidDays > p.paidDays ? c : p), null);

  return {
    basisDays: input.basisDays,
    daysWorked: paidDaysList.length,
    daysAbsent,
    suspensionDays,
    overtimeHours,
    monthlyGross: primarySeg?.rate.monthlyGross ?? 0,
    earnedGross,
    components,
    overtimeAmount,
    arrearsAmount,
    otherEarnings,
    totalEarnings,
    pensionBase,
    employeePension,
    employerPension,
    taxableIncome: round2(regularTaxable + irregularTaxable),
    paye,
    otherDeductions,
    rejectedDeductions,
    totalDeductions,
    netPay,
    clientBilling,
    managementShare,
    employerCost,
    businessLine,
    itfAmount,
    nsitfAmount,
    nhfMedicalAmount,
    insuranceAmount,
    uniformKitsAmount,
    recruitmentTrainingAmount,
    leaveRelieverAmount,
    outsourcingLeaveAllowanceAmount,
    totalEmployerAddOns,
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

/** Hourly overtime rate derived from the operative gross when a client schedule gives no rate. */
export function overtimeHourlyRate(
  monthlyGross: number,
  basisDays: number,
  hoursPerDay: number,
  multiplier: number,
) {
  return round2((monthlyGross / basisDays / hoursPerDay) * multiplier);
}
