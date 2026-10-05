/**
 * Staff loan & advance maths (pure, framework-free, unit-testable).
 *
 * A loan's balance is never stored. It is worked out from its instalments: cash paid straight to the
 * company counts as repaid at once; a payroll deduction counts as *scheduled* while it waits to be
 * run and as *repaid* once its payroll is locked (the deduction becomes PROCESSED); a rejected or
 * cancelled deduction simply drops out, so that amount becomes unscheduled again.
 */

export interface InstallmentInput {
  kind: "PAYROLL" | "SETTLEMENT" | "CASH";
  amount: number;
  /** Status of the payroll Deduction behind the instalment (null for cash). */
  deductionStatus: string | null;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function loanPosition(principal: number, items: InstallmentInput[]) {
  let repaid = 0;
  let scheduled = 0;
  for (const i of items) {
    if (i.kind === "CASH" || i.deductionStatus === "PROCESSED") repaid += i.amount;
    else if (i.deductionStatus === "PENDING" || i.deductionStatus === "APPROVED") scheduled += i.amount;
  }
  repaid = r2(repaid);
  scheduled = r2(scheduled);
  const outstanding = r2(Math.max(0, principal - repaid));
  return { repaid, scheduled, outstanding, unscheduled: r2(Math.max(0, outstanding - scheduled)) };
}

/** Even instalment, rounded up to the kobo so the last one is never larger than the rest. */
export function installmentFor(principal: number, count: number) {
  return Math.ceil((principal / Math.max(1, count)) * 100 - 1e-9) / 100;
}

export const monthIndex = (year: number, month: number) => year * 12 + month;

/** Month after the given date, as a payroll year/month. */
export function nextMonth(date: Date) {
  const idx = monthIndex(date.getUTCFullYear(), date.getUTCMonth() + 1) + 1;
  return { year: Math.floor((idx - 1) / 12), month: ((idx - 1) % 12) + 1 };
}

export interface LoanLimits {
  loanMaxGrossMultiple: number;
  loanMaxDeductionPct: number;
  advanceMaxGrossPct: number;
}

/** The policy's affordability rules (0 = no limit). Returns the first breach, or null. */
export function checkLoanLimits(
  input: {
    type: "LOAN" | "SALARY_ADVANCE";
    principal: number;
    installment: number;
    monthlyGross: number;
    /** Balance and instalments of the employee's other live loans of the same type. */
    existingOutstanding: number;
    existingInstallments: number;
  },
  limits: LoanLimits,
): string | null {
  const { type, principal, installment, monthlyGross: gross } = input;
  const money = (n: number) => `₦${r2(n).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  if (type === "SALARY_ADVANCE") {
    const cap = (limits.advanceMaxGrossPct / 100) * gross;
    if (limits.advanceMaxGrossPct > 0 && principal + input.existingOutstanding > cap + 0.005)
      return `An advance can't exceed ${limits.advanceMaxGrossPct}% of monthly gross (${money(cap)}), including any advance still outstanding.`;
    return null;
  }
  const cap = limits.loanMaxGrossMultiple * gross;
  if (limits.loanMaxGrossMultiple > 0 && principal + input.existingOutstanding > cap + 0.005)
    return `Loans can't exceed ${limits.loanMaxGrossMultiple}× monthly gross (${money(cap)}), including any loan still outstanding.`;
  const deductionCap = (limits.loanMaxDeductionPct / 100) * gross;
  if (limits.loanMaxDeductionPct > 0 && installment + input.existingInstallments > deductionCap + 0.005)
    return `Monthly loan repayments can't exceed ${limits.loanMaxDeductionPct}% of monthly gross (${money(deductionCap)}) — lengthen the repayment period.`;
  return null;
}
