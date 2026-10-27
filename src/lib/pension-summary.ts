import { koboOrZero, koboToNumber, sumKobo } from "./money-exact";

/**
 * What has been deducted from an employee's pay for pension so far in a calendar year, across regular and
 * supplementary runs. The employer's contribution is the company's cost, reported separately, so it is never
 * added in — the employee's full retirement balance, with the employer's money, is on their PFA statement.
 * Added up in whole kobo, so a year of slips is exact. A stored value that is not an amount, or has digits below a kobo, is refused.
 */
export function employeePensionYtd(slips: Array<{ employeePension: unknown; run: { period: { year: number } } }>, year: number): number {
  return koboToNumber(sumKobo(slips.filter((s) => s.run.period.year === year).map((s) => koboOrZero(s.employeePension))));
}
