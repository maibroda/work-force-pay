import { describe, expect, it } from "vitest";
import {
  compactMoney,
  compactNaira,
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  formatMoney,
  naira,
  round2,
} from "@/lib/money";

describe("formatMoney / naira", () => {
  it("naira() and formatMoney(v, 'NGN') are identical, and default to NGN", () => {
    expect(DEFAULT_CURRENCY).toBe("NGN");
    expect(naira(1234.5)).toBe(formatMoney(1234.5, "NGN"));
    expect(naira(1234.5)).toBe("₦1,234.50");
  });

  it("formats other registered currencies with their own symbol, not NGN's", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "GBP")).toBe("£1,234.50");
    expect(formatMoney(0, "NGN")).toBe("₦0.00");
  });

  it("every registered currency code round-trips through formatMoney without throwing", () => {
    for (const code of CURRENCY_CODES) {
      const formatted = formatMoney(1000, code);
      expect(formatted).not.toContain(code); // the raw ISO code should never leak into display
      expect(typeof formatted).toBe("string");
    }
  });
});

describe("compactMoney / compactNaira", () => {
  it("compactNaira() and compactMoney(v, 'NGN') are identical", () => {
    expect(compactNaira(2_500_000)).toBe(compactMoney(2_500_000, "NGN"));
    expect(compactNaira(2_500_000)).toBe("₦2.50m");
  });

  it("uses the target currency's symbol", () => {
    expect(compactMoney(2_500_000, "USD")).toBe("$2.50m");
    expect(compactMoney(340_000, "GBP")).toBe("£340.0k");
  });
});

describe("round2", () => {
  it("rounds half away from zero to 2dp", () => {
    expect(round2(1.005)).toBeCloseTo(1.01, 2);
    expect(round2(-1.005)).toBeCloseTo(-1.01, 2);
  });
});
