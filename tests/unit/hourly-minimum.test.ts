import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asKobo } from "@/lib/money-exact";
import { minimumPayFinding } from "@/lib/payroll/hourly-minimum";

/**
 * Hourly pay, phase 4c (the founder's H13, answered 2026-11-19 and 2026-11-20): a configurable WARNING when what a person paid only by the hour earns in a month is below a figure the company (or its adviser) enters
 * in the payroll rules, effective-dated. No figure is built in; 0 (the default) means no check. It never blocks pay and never changes it. The figures in these tests are INVENTED.
 */
const base = { employeeId: "e1", label: "EMP-000007 Ada Okafor", periodName: "March 2040" };
const k = (n: number) => asKobo(n * 100);

describe("minimumPayFinding", () => {
  it("is nothing while no figure is set (0 is off), however little the person earned", () => {
    expect(minimumPayFinding({ ...base, hourlyGross: k(1_000), minimum: k(0) })).toBeNull();
  });

  it("is nothing when the pay is at or above the figure (equal is not below)", () => {
    expect(minimumPayFinding({ ...base, hourlyGross: k(70_000), minimum: k(70_000) })).toBeNull();
    expect(minimumPayFinding({ ...base, hourlyGross: asKobo(7_000_001), minimum: k(70_000) })).toBeNull();
  });

  it("is a WARNING (never critical, nothing to explain) when the pay is below the figure, naming both figures and the shortfall", () => {
    const f = minimumPayFinding({ ...base, hourlyGross: k(4_000), minimum: k(70_000) })!;
    expect(f.severity).toBe("WARNING");
    expect(f.code).toBe("HOURLY_BELOW_MINIMUM_PAY");
    expect(f.employeeId).toBe("e1");
    expect(f.message).toContain("EMP-000007 Ada Okafor");
    expect(f.message).toContain("March 2040");
    expect(f.message).toContain("4,000.00");
    expect(f.message).toContain("70,000.00");
    expect(f.message).toContain("66,000.00");
    expect(f.message).toMatch(/warning only/i);
    expect(f.message).toMatch(/not (blocked|changed)/i);
  });

  it("works to the kobo", () => {
    const f = minimumPayFinding({ ...base, hourlyGross: asKobo(6_999_999), minimum: asKobo(7_000_000) })!;
    expect(f.message).toContain("69,999.99");
    expect(f.message).toContain("0.01");
  });

  it("is nothing when the person earned nothing from hours (there is no hourly pay to warn about)", () => {
    expect(minimumPayFinding({ ...base, hourlyGross: k(0), minimum: k(70_000) })).toBeNull();
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-minimum.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
