/**
 * Staff loan & advance maths (pure, framework-free, unit-testable).
 *
 * A loan's balance is never stored. It is worked out from its instalments: cash paid straight to the
 * company counts as repaid at once; a payroll deduction counts as *scheduled* while it waits to be
 * run and as *repaid* once its payroll is locked (the deduction becomes PROCESSED); a rejected or
 * cancelled deduction simply drops out, so that amount becomes unscheduled again.
 *
 * The arithmetic is exact (whole kobo, exact fractions). The one rounding rule that is not half up is the INSTALMENT, which rounds UP to the kobo
 * on purpose, so the last instalment is never larger than the rest; it is now exact (it used to tip over by a kobo when the division was exact).
 */
import { Exact } from "./exact-fraction";
import { koboFromNaira, koboToNumber, subKobo, sumKobo, type Kobo } from "./money-exact";

export interface InstallmentInput {
  kind: "PAYROLL" | "SETTLEMENT" | "CASH";
  amount: number;
  /** Status of the payroll Deduction behind the instalment (null for cash). */
  deductionStatus: string | null;
}

const HUNDRED = Exact.int(100);
const ZERO = 0 as Kobo;
/** A number a person TYPED, taken to the kobo, half up, once (it is stored to two decimals the same way). */
const typedKobo = (naira: number): Kobo => Exact.fromNumber(naira).mul(HUNDRED).round();
const atLeastZero = (k: Kobo): Kobo => (k > 0 ? k : ZERO);

export function loanPosition(principal: number, items: InstallmentInput[]) {
  const repaid = sumKobo(items.filter((i) => i.kind === "CASH" || i.deductionStatus === "PROCESSED").map((i) => koboFromNaira(i.amount, "A repayment")));
  const scheduled = sumKobo(
    items.filter((i) => !(i.kind === "CASH" || i.deductionStatus === "PROCESSED") && (i.deductionStatus === "PENDING" || i.deductionStatus === "APPROVED")).map((i) => koboFromNaira(i.amount, "A repayment")),
  );
  const outstanding = atLeastZero(subKobo(koboFromNaira(principal, "The principal"), repaid));
  return {
    repaid: koboToNumber(repaid),
    scheduled: koboToNumber(scheduled),
    outstanding: koboToNumber(outstanding),
    unscheduled: koboToNumber(atLeastZero(subKobo(outstanding, scheduled))),
  };
}

/** Even instalment, rounded up to the kobo so the last one is never larger than the rest. A principal typed with extra decimals is taken to the kobo, half up, first. */
export function installmentFor(principal: number, count: number) {
  return koboToNumber(Exact.ratio(typedKobo(principal), Math.max(1, count)).ceil());
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

/**
 * The policy's affordability rules (0 = no limit). Returns the first breach, or null. A limit is a share of the gross; it is taken to the kobo,
 * half up, and an amount may reach it exactly.
 */
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
  const gross = Exact.int(typedKobo(input.monthlyGross));
  const owed = sumKobo([typedKobo(input.principal), typedKobo(input.existingOutstanding)]);
  const instalments = sumKobo([typedKobo(input.installment), typedKobo(input.existingInstallments)]);
  const money = (k: Kobo) => `₦${koboToNumber(k).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  if (input.type === "SALARY_ADVANCE") {
    const cap = Exact.fromNumber(limits.advanceMaxGrossPct).div(HUNDRED).mul(gross).round();
    if (limits.advanceMaxGrossPct > 0 && owed > cap)
      return `An advance can't exceed ${limits.advanceMaxGrossPct}% of monthly gross (${money(cap)}), including any advance still outstanding.`;
    return null;
  }
  const cap = Exact.fromNumber(limits.loanMaxGrossMultiple).mul(gross).round();
  if (limits.loanMaxGrossMultiple > 0 && owed > cap)
    return `Loans can't exceed ${limits.loanMaxGrossMultiple}× monthly gross (${money(cap)}), including any loan still outstanding.`;
  const deductionCap = Exact.fromNumber(limits.loanMaxDeductionPct).div(HUNDRED).mul(gross).round();
  if (limits.loanMaxDeductionPct > 0 && instalments > deductionCap)
    return `Monthly loan repayments can't exceed ${limits.loanMaxDeductionPct}% of monthly gross (${money(deductionCap)}) — lengthen the repayment period.`;
  return null;
}
