import { num, round2 } from "./money";

/**
 * What has been deducted from an employee's pay for pension so far in a calendar year, across regular and
 * supplementary runs. The employer's contribution is the company's cost, reported separately, so it is never
 * added in — the employee's full retirement balance, with the employer's money, is on their PFA statement.
 */
export function employeePensionYtd(slips: Array<{ employeePension: unknown; run: { period: { year: number } } }>, year: number): number {
  return round2(slips.filter((s) => s.run.period.year === year).reduce((a, s) => a + num(s.employeePension), 0));
}
