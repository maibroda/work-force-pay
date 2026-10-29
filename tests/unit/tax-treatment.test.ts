import { describe, expect, it } from "vitest";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";

describe("which pay is taxable (founder, 2026-10-29: all allowances are taxable except where stated otherwise)", () => {
  it("makes every component of the standard structure taxable unless it is explicitly marked otherwise", () => {
    expect(DEFAULT_EARNINGS.length).toBeGreaterThan(0);
    for (const c of DEFAULT_EARNINGS) expect(c.taxable, c.code).toBe(true);
  });
});
