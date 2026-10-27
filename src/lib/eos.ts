/**
 * End-of-service settlement rules (pure, framework-free, unit-testable).
 *
 * Everything here is driven by the organization's HrPolicy, so a buyer changes behaviour by
 * editing settings, not code. The final month's pro-rata salary is deliberately NOT computed here —
 * payroll already pays the days worked up to the exit date; this covers what comes on top:
 * unused leave, gratuity, severance, and notice pay / notice recovery.
 *
 * The arithmetic is exact (exact-fraction.ts, money-exact.ts). Every ROUNDING CHOICE is the one this module has always made, because they are
 * HR-policy rules and not arithmetic: leave days and years of service are taken to two decimals before they are multiplied; the daily rate shown
 * on a line is rounded but the amount is worked from the unrounded rate; the basic part of the gross is rounded to the kobo. Each amount is rounded
 * half up, once, at its line.
 */
import { addDays } from "./dates";
import { leaveEligibility, addMonths } from "./leave";
import { Exact } from "./exact-fraction";
import { koboFromNaira, koboToNumber, subKobo, sumKobo } from "./money-exact";

export interface EosPolicy {
  dailyRateDivisor: number;
  leaveEncashmentEnabled: boolean;
  leaveEncashmentBasis: "GROSS" | "BASIC";
  leaveEncashmentRespectsEligibility: boolean;
  leaveEncashmentMaxDays: number | null;
  leaveEncashmentTaxable: boolean;
  leaveEncashmentExitTypes: string[];
  gratuityEnabled: boolean;
  gratuityBasis: "GROSS" | "BASIC";
  gratuityMinYears: number;
  gratuityDaysPerYear: number;
  gratuityPartialYears: boolean;
  gratuityTaxable: boolean;
  gratuityExitTypes: string[];
  severanceEnabled: boolean;
  severanceDaysPerYear: number;
  severanceTaxable: boolean;
  noticePayEnabled: boolean;
  noticeRecoveryEnabled: boolean;
  noticePayTaxable: boolean;
}

export interface EosInput {
  exitType: string;
  reasonCategory?: string | null;
  /** Gross-misconduct dismissal — forfeits notice pay, gratuity and severance. */
  summaryDismissal: boolean;
  employmentDate: Date;
  noticeDate: Date;
  lastWorkingDate: Date;
  noticeRequiredDays: number;
  monthlyGross: number;
  /** BASIC as a fraction of gross pay (0–1); 1 when unknown. Pass an exact fraction (Exact.ratio) when it comes from two amounts. */
  basicShare: number | Exact;
  annualLeaveDays: number;
  leaveEligibilityMonths: number;
  /** Approved leave requests (any cycle) — only those charged to the current leave year count. */
  approvedLeave: Array<{ cycleStart: Date; workingDays: number }>;
}

export interface EosLine {
  kind: "EARNING" | "DEDUCTION";
  code: "LEAVE_ENCASHMENT" | "GRATUITY" | "SEVERANCE" | "NOTICE_PAY" | "NOTICE_RECOVERY";
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  taxable: boolean;
}

export interface EosResult {
  lines: EosLine[];
  serviceDays: number;
  completedYears: number;
  serviceYears: number;
  monthlyBasic: number;
  dailyRate: number;
  leaveAccruedDays: number;
  leaveTakenDays: number;
  leavePayableDays: number;
  noticeRequiredDays: number;
  noticeServedDays: number;
  noticeShortfallDays: number;
  /** Plain-language explanation of every rule that applied or didn't — shown on the settlement. */
  notes: string[];
}

const HUNDRED = Exact.int(100);
/** Taken to two decimals, half up (days and years are not money, but they feed it). */
const twoDecimals = (e: Exact): Exact => Exact.ratio(e.mul(HUNDRED).round(), 100);
const DAY_MS = 86400000;
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);
const EMPLOYEE_SIDE_EXITS = ["RESIGNATION", "ABSCONDMENT"];

/** Completed years of service plus a fractional figure, counting the last working day as worked. */
export function serviceTenure(employmentDate: Date, lastWorkingDate: Date) {
  const endExclusive = addDays(lastWorkingDate, 1);
  const serviceDays = Math.max(0, daysBetween(employmentDate, endExclusive));
  let completed = 0;
  while (addMonths(employmentDate, 12 * (completed + 1)) <= endExclusive) completed++;
  const anniversary = addMonths(employmentDate, 12 * completed);
  const nextAnniversary = addMonths(employmentDate, 12 * (completed + 1));
  const part = Exact.ratio(Math.max(0, daysBetween(anniversary, endExclusive)), daysBetween(anniversary, nextAnniversary));
  const years = Exact.int(completed).add(part);
  return {
    serviceDays,
    completedYears: completed,
    serviceYears: twoDecimals(years).toNumber(),
    /** Unrounded, for accrual maths that shouldn't lose a day to rounding. */
    exactYears: years.toNumber(),
    /** The same, exactly. */
    exactYearsFraction: years,
  };
}

export function computeSettlementLines(input: EosInput, policy: EosPolicy): EosResult {
  const notes: string[] = [
    "Salary for days worked up to the last working date is paid through the normal payroll run, not here.",
  ];
  const { serviceDays, completedYears, serviceYears, exactYearsFraction } = serviceTenure(
    input.employmentDate,
    input.lastWorkingDate,
  );
  const divisor = Exact.fromNumber(Math.max(1, policy.dailyRateDivisor));
  const gross = Exact.fromNumber(input.monthlyGross).mul(HUNDRED); // kobo, exactly as given
  const share = Exact.min(Exact.int(1), Exact.max(Exact.int(0), input.basicShare instanceof Exact ? input.basicShare : Exact.fromNumber(input.basicShare)));
  const monthlyBasicKobo = gross.mul(share).round();
  const monthlyBasic = koboToNumber(monthlyBasicKobo);
  /** Kobo per day, unrounded. */
  const perDay = (basis: "GROSS" | "BASIC"): Exact => (basis === "BASIC" ? Exact.int(monthlyBasicKobo) : gross).div(divisor);
  const dailyRate = koboToNumber(gross.div(divisor).round());
  const lines: EosLine[] = [];

  // ── Leave encashment ──
  let leaveAccruedDays = 0;
  let leaveAccrued = Exact.int(0);
  let leaveTakenDays = 0;
  let leavePayableDays = 0;
  if (!policy.leaveEncashmentEnabled) {
    notes.push("Leave encashment is switched off in the HR policy.");
  } else if (!policy.leaveEncashmentExitTypes.includes(input.exitType)) {
    notes.push(`Unused leave is not paid for this exit type (${input.exitType.replace(/_/g, " ").toLowerCase()}).`);
  } else {
    const { cycle } = leaveEligibility(input.employmentDate, input.lastWorkingDate, input.leaveEligibilityMonths);
    if (cycle) {
      // A full entitlement is in force: whatever is left of it is fully earned. On top of that the
      // employee has been earning the NEXT entitlement since this leave year began.
      const taken = input.approvedLeave
        .filter((r) => r.cycleStart.getTime() === cycle.start.getTime())
        .reduce((s, r) => s.add(Exact.fromNumber(r.workingDays)), Exact.int(0));
      leaveTakenDays = taken.toNumber();
      const annual = Exact.fromNumber(input.annualLeaveDays);
      const remaining = Exact.max(Exact.int(0), annual.sub(taken));
      const cycleLength = daysBetween(cycle.start, addDays(cycle.end, 1));
      const elapsed = Math.min(cycleLength, Math.max(0, daysBetween(cycle.start, addDays(input.lastWorkingDate, 1))));
      const accruingTowardNext = annual.mul(Exact.ratio(elapsed, cycleLength));
      leaveAccrued = twoDecimals(remaining.add(accruingTowardNext));
    } else if (policy.leaveEncashmentRespectsEligibility) {
      notes.push(
        `No leave was due yet — the leave policy needs ${input.leaveEligibilityMonths} month(s) of service first.`,
      );
    } else {
      leaveAccrued = twoDecimals(Exact.fromNumber(input.annualLeaveDays).mul(Exact.min(Exact.int(1), exactYearsFraction)));
    }
    leaveAccruedDays = leaveAccrued.toNumber();
    let payable = leaveAccrued;
    if (policy.leaveEncashmentMaxDays !== null && payable.cmp(Exact.fromNumber(policy.leaveEncashmentMaxDays)) > 0) {
      notes.push(`Unused leave capped at ${policy.leaveEncashmentMaxDays} day(s) by the HR policy.`);
      payable = Exact.fromNumber(policy.leaveEncashmentMaxDays);
    }
    payable = twoDecimals(payable);
    leavePayableDays = payable.toNumber();
    const rate = perDay(policy.leaveEncashmentBasis);
    const amount = payable.mul(rate).round();
    if (amount > 0)
      lines.push({
        kind: "EARNING",
        code: "LEAVE_ENCASHMENT",
        description: `Unused annual leave — ${leavePayableDays} day(s)`,
        quantity: leavePayableDays,
        rate: koboToNumber(rate.round()),
        amount: koboToNumber(amount),
        taxable: policy.leaveEncashmentTaxable,
      });
  }

  // ── Notice ──
  const noticeServedDays = Math.max(0, daysBetween(input.noticeDate, input.lastWorkingDate));
  const noticeShortfallDays = Math.max(0, input.noticeRequiredDays - noticeServedDays);
  if (noticeShortfallDays > 0) {
    const rate = gross.div(divisor); // kobo per day, from the gross, unrounded
    const amount = koboToNumber(Exact.int(noticeShortfallDays).mul(rate).round());
    if (EMPLOYEE_SIDE_EXITS.includes(input.exitType)) {
      if (policy.noticeRecoveryEnabled)
        lines.push({
          kind: "DEDUCTION",
          code: "NOTICE_RECOVERY",
          description: `Notice shortfall — ${noticeShortfallDays} day(s) of ${input.noticeRequiredDays} required`,
          quantity: noticeShortfallDays,
          rate: koboToNumber(rate.round()),
          amount,
          taxable: false,
        });
      else notes.push("Notice was short, but recovery of the shortfall is switched off in the HR policy.");
    } else if (input.exitType === "TERMINATION") {
      if (input.summaryDismissal) notes.push("Summary dismissal — no pay in lieu of notice is owed.");
      else if (policy.noticePayEnabled)
        lines.push({
          kind: "EARNING",
          code: "NOTICE_PAY",
          description: `Pay in lieu of notice — ${noticeShortfallDays} day(s) of ${input.noticeRequiredDays} required`,
          quantity: noticeShortfallDays,
          rate: koboToNumber(rate.round()),
          amount,
          taxable: policy.noticePayTaxable,
        });
      else notes.push("Notice was short, but pay in lieu of notice is switched off in the HR policy.");
    }
  }

  // ── Gratuity ──
  if (!policy.gratuityEnabled) {
    notes.push("Gratuity is switched off in the HR policy.");
  } else if (input.summaryDismissal) {
    notes.push("Summary dismissal — gratuity is forfeited.");
  } else if (!policy.gratuityExitTypes.includes(input.exitType)) {
    notes.push(`Gratuity is not paid for this exit type (${input.exitType.replace(/_/g, " ").toLowerCase()}).`);
  } else if (completedYears < policy.gratuityMinYears) {
    notes.push(
      `Gratuity needs ${policy.gratuityMinYears} completed year(s) of service — this employee has ${completedYears}.`,
    );
  } else {
    const years = policy.gratuityPartialYears ? serviceYears : completedYears;
    const perYear = Exact.fromNumber(policy.gratuityDaysPerYear).mul(perDay(policy.gratuityBasis));
    const amount = Exact.fromNumber(years).mul(perYear).round();
    if (amount > 0)
      lines.push({
        kind: "EARNING",
        code: "GRATUITY",
        description: `Gratuity — ${years} year(s) × ${policy.gratuityDaysPerYear} day(s) ${policy.gratuityBasis.toLowerCase()} pay`,
        quantity: years,
        rate: koboToNumber(perYear.round()),
        amount: koboToNumber(amount),
        taxable: policy.gratuityTaxable,
      });
  }

  // ── Severance (redundancy) ──
  if (policy.severanceEnabled && input.exitType === "TERMINATION" && input.reasonCategory === "REDUNDANCY") {
    if (input.summaryDismissal) notes.push("Summary dismissal — severance is not owed.");
    else if (completedYears < 1) notes.push("Severance needs at least one completed year of service.");
    else {
      const perYear = Exact.fromNumber(policy.severanceDaysPerYear).mul(gross.div(divisor));
      lines.push({
        kind: "EARNING",
        code: "SEVERANCE",
        description: `Redundancy severance — ${completedYears} year(s) × ${policy.severanceDaysPerYear} day(s) gross pay`,
        quantity: completedYears,
        rate: koboToNumber(perYear.round()),
        amount: koboToNumber(Exact.int(completedYears).mul(perYear).round()),
        taxable: policy.severanceTaxable,
      });
    }
  }

  return {
    lines,
    serviceDays,
    completedYears,
    serviceYears,
    monthlyBasic,
    dailyRate,
    leaveAccruedDays,
    leaveTakenDays,
    leavePayableDays,
    noticeRequiredDays: input.noticeRequiredDays,
    noticeServedDays,
    noticeShortfallDays,
    notes,
  };
}

/** Totals for a set of settlement lines (system + manual), added in whole kobo. A line part-way through a kobo is refused. */
export function settlementTotals(lines: Array<{ kind: string; amount: number }>) {
  const amounts = (kind: string) => sumKobo(lines.filter((l) => l.kind === kind).map((l) => koboFromNaira(l.amount, "A settlement line")));
  const gross = amounts("EARNING");
  const deductions = amounts("DEDUCTION");
  return { grossEarnings: koboToNumber(gross), totalDeductions: koboToNumber(deductions), netSettlement: koboToNumber(subKobo(gross, deductions)) };
}
