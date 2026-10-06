import { describe, expect, it } from "vitest";
import { employeePensionYtd } from "@/lib/pension-summary";

const slip = (year: number, employee: unknown, employer: unknown = 99999) => ({ employeePension: employee, employerPension: employer, run: { period: { year } } });

describe("employeePensionYtd", () => {
  it("adds up only what was deducted from the employee, never the employer's share", () => {
    const slips = [slip(2026, 10800, 13500), slip(2026, 10800, 13500), slip(2026, 5400, 6750)];
    expect(employeePensionYtd(slips, 2026)).toBe(27000);
  });

  it("counts only the year asked about", () => {
    expect(employeePensionYtd([slip(2025, 10000), slip(2026, 4000), slip(2027, 7000)], 2026)).toBe(4000);
    expect(employeePensionYtd([slip(2025, 10000)], 2026)).toBe(0);
    expect(employeePensionYtd([], 2026)).toBe(0);
  });

  it("copes with the decimal and string values the database returns, and rounds to kobo", () => {
    expect(employeePensionYtd([slip(2026, "1000.10"), slip(2026, "2000.205"), slip(2026, null)], 2026)).toBe(3000.31);
  });
});
