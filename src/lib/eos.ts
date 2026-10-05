/**
 * End-of-service settlement rules (pure, framework-free, unit-testable).
 *
 * Everything here is driven by the organization's HrPolicy, so a buyer changes behaviour by
 * editing settings, not code. The final month's pro-rata salary is deliberately NOT computed here —
 * payroll already pays the days worked up to the exit date; this covers what comes on top:
 * unused leave, gratuity, severance, and notice pay / notice recovery.
 */
import { addDays } from "./dates";
import { leaveEligibility, addMonths } from "./leave";
import { round2 } from "./money";

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
  /** BASIC as a fraction of gross pay (0–1); 1 when unknown. */
  basicShare: number;
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
  const part = Math.max(0, daysBetween(anniversary, endExclusive)) / daysBetween(anniversary, nextAnniversary);
  return {
    serviceDays,
    completedYears: completed,
    serviceYears: round2(completed + part),
    /** Unrounded, for accrual maths that shouldn't lose a day to rounding. */
    exactYears: completed + part,
  };
}

export function computeSettlementLines(input: EosInput, policy: EosPolicy): EosResult {
  const notes: string[] = [
    "Salary for days worked up to the last working date is paid through the normal payroll run, not here.",
  ];
  const { serviceDays, completedYears, serviceYears, exactYears } = serviceTenure(
    input.employmentDate,
    input.lastWorkingDate,
  );
  const divisor = Math.max(1, policy.dailyRateDivisor);
  const monthlyBasic = round2(input.monthlyGross * Math.min(1, Math.max(0, input.basicShare)));
  const perDay = (basis: "GROSS" | "BASIC") => (basis === "BASIC" ? monthlyBasic : input.monthlyGross) / divisor;
  const dailyRate = round2(input.monthlyGross / divisor);
  const lines: EosLine[] = [];

  // ── Leave encashment ──
  let leaveAccruedDays = 0;
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
      leaveTakenDays = input.approvedLeave
        .filter((r) => r.cycleStart.getTime() === cycle.start.getTime())
        .reduce((s, r) => s + r.workingDays, 0);
      const remaining = Math.max(0, input.annualLeaveDays - leaveTakenDays);
      const cycleLength = daysBetween(cycle.start, addDays(cycle.end, 1));
      const elapsed = Math.min(cycleLength, Math.max(0, daysBetween(cycle.start, addDays(input.lastWorkingDate, 1))));
      const accruingTowardNext = (input.annualLeaveDays * elapsed) / cycleLength;
      leaveAccruedDays = round2(remaining + accruingTowardNext);
    } else if (policy.leaveEncashmentRespectsEligibility) {
      notes.push(
        `No leave was due yet — the leave policy needs ${input.leaveEligibilityMonths} month(s) of service first.`,
      );
    } else {
      leaveAccruedDays = round2(input.annualLeaveDays * Math.min(1, exactYears));
    }
    leavePayableDays = leaveAccruedDays;
    if (policy.leaveEncashmentMaxDays !== null && leavePayableDays > policy.leaveEncashmentMaxDays) {
      notes.push(`Unused leave capped at ${policy.leaveEncashmentMaxDays} day(s) by the HR policy.`);
      leavePayableDays = policy.leaveEncashmentMaxDays;
    }
    leavePayableDays = round2(leavePayableDays);
    const rate = perDay(policy.leaveEncashmentBasis);
    const amount = round2(leavePayableDays * rate);
    if (amount > 0)
      lines.push({
        kind: "EARNING",
        code: "LEAVE_ENCASHMENT",
        description: `Unused annual leave — ${leavePayableDays} day(s)`,
        quantity: leavePayableDays,
        rate: round2(rate),
        amount,
        taxable: policy.leaveEncashmentTaxable,
      });
  }

  // ── Notice ──
  const noticeServedDays = Math.max(0, daysBetween(input.noticeDate, input.lastWorkingDate));
  const noticeShortfallDays = Math.max(0, input.noticeRequiredDays - noticeServedDays);
  if (noticeShortfallDays > 0) {
    const rate = input.monthlyGross / divisor;
    if (EMPLOYEE_SIDE_EXITS.includes(input.exitType)) {
      if (policy.noticeRecoveryEnabled)
        lines.push({
          kind: "DEDUCTION",
          code: "NOTICE_RECOVERY",
          description: `Notice shortfall — ${noticeShortfallDays} day(s) of ${input.noticeRequiredDays} required`,
          quantity: noticeShortfallDays,
          rate: round2(rate),
          amount: round2(noticeShortfallDays * rate),
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
          rate: round2(rate),
          amount: round2(noticeShortfallDays * rate),
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
    const perYear = policy.gratuityDaysPerYear * perDay(policy.gratuityBasis);
    const amount = round2(years * perYear);
    if (amount > 0)
      lines.push({
        kind: "EARNING",
        code: "GRATUITY",
        description: `Gratuity — ${years} year(s) × ${policy.gratuityDaysPerYear} day(s) ${policy.gratuityBasis.toLowerCase()} pay`,
        quantity: years,
        rate: round2(perYear),
        amount,
        taxable: policy.gratuityTaxable,
      });
  }

  // ── Severance (redundancy) ──
  if (policy.severanceEnabled && input.exitType === "TERMINATION" && input.reasonCategory === "REDUNDANCY") {
    if (input.summaryDismissal) notes.push("Summary dismissal — severance is not owed.");
    else if (completedYears < 1) notes.push("Severance needs at least one completed year of service.");
    else {
      const perYear = policy.severanceDaysPerYear * (input.monthlyGross / divisor);
      lines.push({
        kind: "EARNING",
        code: "SEVERANCE",
        description: `Redundancy severance — ${completedYears} year(s) × ${policy.severanceDaysPerYear} day(s) gross pay`,
        quantity: completedYears,
        rate: round2(perYear),
        amount: round2(completedYears * perYear),
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

/** Totals for a set of settlement lines (system + manual). */
export function settlementTotals(lines: Array<{ kind: string; amount: number }>) {
  const gross = round2(lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0));
  const deductions = round2(lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0));
  return { grossEarnings: gross, totalDeductions: deductions, netSettlement: round2(gross - deductions) };
}
