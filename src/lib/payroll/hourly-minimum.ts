/**
 * Hourly pay, phase 4c (the founder's H13): the minimum-pay warning for a person paid only by the hour. Pure: no database, no framework.
 *
 * A WARNING when what the person earned from hours in the pay month is below the figure the company (or its adviser) enters in the payroll rules, effective-dated. No figure is built in: 0, the default, means no check.
 * It only warns: the pay is not changed and not blocked, the finding needs no explanation. The comparison and the shortfall are whole kobo.
 */
import { koboToString, type Kobo } from "../money-exact";

export interface MinimumPayFinding {
  employeeId: string;
  category: string;
  severity: "WARNING";
  code: "HOURLY_BELOW_MINIMUM_PAY";
  message: string;
}

/** Whole kobo as naira with thousands separators: "70,000.00". */
export function naira(k: Kobo): string {
  const [whole, kobo] = koboToString(k).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${kobo}`;
}

export function minimumPayFinding(a: { employeeId: string; label: string; periodName: string; hourlyGross: Kobo; minimum: Kobo }): MinimumPayFinding | null {
  if (a.minimum <= 0 || a.hourlyGross <= 0 || a.hourlyGross >= a.minimum) return null;
  const short = (a.minimum - a.hourlyGross) as Kobo;
  return {
    employeeId: a.employeeId,
    category: "ATTENDANCE",
    severity: "WARNING",
    code: "HOURLY_BELOW_MINIMUM_PAY",
    message: `${a.label} earned NGN ${naira(a.hourlyGross)} from hours worked in ${a.periodName}, which is NGN ${naira(short)} below the minimum monthly pay of NGN ${naira(a.minimum)} set in the payroll rules. This is a warning only: the pay is not blocked and not changed. Check the hours and the hourly rate; a person who worked few hours is paid for those hours.`,
  };
}
