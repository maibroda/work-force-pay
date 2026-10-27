import { describe, expect, it } from "vitest";
import { d } from "@/lib/dates";
import { Exact } from "@/lib/exact-fraction";
import { computeSettlementLines, settlementTotals, type EosInput, type EosPolicy } from "@/lib/eos";
import { MoneyError } from "@/lib/money-exact";

/**
 * Leaving-settlement money in exact arithmetic. Every rounding CHOICE is the one the code always made (leave days and years of service to two
 * decimals; the daily rate shown rounded but the amount worked from the unrounded rate; the basic part of the gross rounded to the kobo); only the
 * arithmetic is now exact. Expected figures are worked by hand. A "tie" ends in exactly half a kobo and goes UP.
 */
const policy: EosPolicy = {
  dailyRateDivisor: 30,
  leaveEncashmentEnabled: true,
  leaveEncashmentBasis: "GROSS",
  leaveEncashmentRespectsEligibility: true,
  leaveEncashmentMaxDays: null,
  leaveEncashmentTaxable: true,
  leaveEncashmentExitTypes: ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "DECEASED"],
  gratuityEnabled: true,
  gratuityBasis: "BASIC",
  gratuityMinYears: 1,
  gratuityDaysPerYear: 15,
  gratuityPartialYears: true,
  gratuityTaxable: true,
  gratuityExitTypes: ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "DECEASED"],
  severanceEnabled: true,
  severanceDaysPerYear: 15,
  severanceTaxable: true,
  noticePayEnabled: true,
  noticeRecoveryEnabled: true,
  noticePayTaxable: true,
};
const base: EosInput = {
  exitType: "RESIGNATION",
  reasonCategory: null,
  summaryDismissal: false,
  employmentDate: d("2020-01-01"),
  noticeDate: d("2026-06-25"), // 5 days' notice served of 30 required: 25 days short
  lastWorkingDate: d("2026-06-30"),
  noticeRequiredDays: 30,
  monthlyGross: 100_000,
  basicShare: 0.5,
  annualLeaveDays: 10,
  leaveEligibilityMonths: 12,
  approvedLeave: [],
};
const run = (over: Partial<EosInput> = {}, pol: Partial<EosPolicy> = {}) => computeSettlementLines({ ...base, ...over }, { ...policy, ...pol });
const line = (r: ReturnType<typeof run>, code: string) => r.lines.find((l) => l.code === code)!;

describe("settlement ties round half up (worked by hand)", () => {
  it("notice shortfall recovered: 25 days × (₦50,000.13 ÷ 30 = 1,666.671) = 41,666.775 → ₦41,666.78 (was ₦41,666.77); the shown daily rate is 1,666.67", () => {
    const l = line(run({ monthlyGross: 50000.13 }), "NOTICE_RECOVERY");
    expect(l.amount).toBe(41666.78);
    expect(l.rate).toBe(1666.67);
    expect(l.quantity).toBe(25);
  });
  it("pay in lieu of notice on dismissal is worked the same way: 25 days of ₦50,000.19 ÷ 30 = 41,666.825 → ₦41,666.83", () => {
    const l = line(run({ exitType: "TERMINATION", monthlyGross: 50000.19 }), "NOTICE_PAY");
    expect(l.amount).toBe(41666.83);
  });
  it("gratuity: 6.5 years × 15 days × (₦25,000.30 basic ÷ 30) = 81,250.975 → ₦81,250.98 (was ₦81,250.97)", () => {
    // gross 50,000.59 × ½ = 25,000.295 → the monthly basic is rounded to the kobo first: 25,000.30
    // 6 completed years + 181/365 of a year = 6.4959 → 6.50 years (rounded to two decimals first, as always); per year 15 × 25,000.30 ÷ 30 = 12,500.15
    const r = run({ monthlyGross: 50000.59 });
    expect(r.monthlyBasic).toBe(25000.3);
    const l = line(r, "GRATUITY");
    expect(l.quantity).toBe(6.5);
    expect(l.rate).toBe(12500.15);
    expect(l.amount).toBe(81250.98);
  });
  it("unused leave, capped at 2.5 days: 2.5 × (₦50,020.74 ÷ 30 = 1,667.358) = 4,168.395 → ₦4,168.40 (was ₦4,168.39)", () => {
    const l = line(run({ monthlyGross: 50020.74 }, { leaveEncashmentMaxDays: 2.5 }), "LEAVE_ENCASHMENT");
    expect(l.quantity).toBe(2.5);
    expect(l.rate).toBe(1667.36);
    expect(l.amount).toBe(4168.4);
  });
  it("redundancy severance: 5 completed years × 15 days × (₦50,000.01 ÷ 30) = 125,000.025 → ₦125,000.03", () => {
    const r = run(
      { exitType: "TERMINATION", reasonCategory: "REDUNDANCY", employmentDate: d("2021-01-01"), monthlyGross: 50000.01 },
      { gratuityEnabled: false },
    );
    const l = line(r, "SEVERANCE");
    expect(l.quantity).toBe(5);
    expect(l.amount).toBe(125000.03);
  });
  it("the basic part of the gross is rounded to the kobo once, from an exact share: ₦100,000.04 × 3/8 = 37,500.015 → ₦37,500.02", () => {
    expect(run({ monthlyGross: 100000.04, basicShare: Exact.ratio(3, 8) }).monthlyBasic).toBe(37500.02);
  });
  it("a basic share given as a fraction is exact where a decimal cannot be: ₦90,000.00 × 1/3 = 30,000.00 (not 29,999.99)", () => {
    expect(run({ monthlyGross: 90000, basicShare: Exact.ratio(1, 3) }).monthlyBasic).toBe(30000);
  });
});

describe("settlement: things that must not change", () => {
  it("the daily rate shown is the gross over the divisor, rounded: ₦300,000 ÷ 30 = ₦10,000", () => {
    expect(run({ monthlyGross: 300000 }).dailyRate).toBe(10000);
    expect(run({ monthlyGross: 100000 }).dailyRate).toBe(3333.33);
  });
  it("a basic share outside 0 to 1 is held to 0 or 1", () => {
    expect(run({ basicShare: 1.5 }).monthlyBasic).toBe(100000);
    expect(run({ basicShare: -0.2 }).monthlyBasic).toBe(0);
  });
  it("the totals add up exactly: earnings less deductions", () => {
    expect(settlementTotals([{ kind: "EARNING", amount: 0.1 }, { kind: "EARNING", amount: 0.2 }, { kind: "DEDUCTION", amount: 0.05 }])).toEqual({ grossEarnings: 0.3, totalDeductions: 0.05, netSettlement: 0.25 });
    expect(settlementTotals([])).toEqual({ grossEarnings: 0, totalDeductions: 0, netSettlement: 0 });
    expect(() => settlementTotals([{ kind: "EARNING", amount: 1.005 }])).toThrow(MoneyError);
  });
});

// ── An independent exact calculation of the AMOUNTS (BigInt kobo), given the days and years the settlement itself reports ──
const half = (n: bigint, den: bigint) => (n * 2n + den) / (den * 2n);
const kobo = (n: number) => BigInt(Math.round(n * 100));

describe("settlement agrees with an independent calculation of every amount", () => {
  it("2,000 random settlements: gross, divisor, basic share, bases, exit type, years of service", () => {
    let seed = 28102026;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const gross = 5_000_000 + rnd(30_000_000);
      const divisor = [30, 26, 22][rnd(3)];
      const num = 1 + rnd(7);
      const den = num + rnd(8); // share num/den in (0, 1]
      const exit = ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT"][rnd(3)];
      const pol: Partial<EosPolicy> = {
        dailyRateDivisor: divisor,
        leaveEncashmentBasis: rnd(2) ? "BASIC" : "GROSS",
        gratuityBasis: rnd(2) ? "BASIC" : "GROSS",
        gratuityPartialYears: rnd(2) === 0,
        gratuityDaysPerYear: [15, 22, 30][rnd(3)],
        severanceDaysPerYear: [15, 22][rnd(2)],
        leaveEncashmentMaxDays: rnd(3) === 0 ? 2.5 : null,
      };
      const input: Partial<EosInput> = {
        exitType: exit,
        reasonCategory: exit === "TERMINATION" ? "REDUNDANCY" : null,
        monthlyGross: gross / 100,
        basicShare: Exact.ratio(num, den),
        employmentDate: d(`20${18 + rnd(7)}-0${1 + rnd(9)}-1${rnd(9)}`),
        noticeDate: d(`2026-06-${10 + rnd(20)}`),
      };
      const r = run(input, pol);
      const G = BigInt(gross);
      const B = half(G * BigInt(num), BigInt(den));
      const where = `settlement ${i}`;
      expect(kobo(r.monthlyBasic), `${where} monthly basic`).toBe(B);
      expect(kobo(r.dailyRate), `${where} daily rate`).toBe(half(G, BigInt(divisor)));
      const div = BigInt(divisor);
      for (const l of r.lines) {
        const q100 = kobo(l.quantity);
        let want: bigint;
        let wantRate: bigint;
        if (l.code === "LEAVE_ENCASHMENT") {
          const base = pol.leaveEncashmentBasis === "BASIC" ? B : G;
          want = half(base * q100, div * 100n);
          wantRate = half(base, div);
        } else if (l.code === "NOTICE_RECOVERY" || l.code === "NOTICE_PAY") {
          want = half(G * BigInt(l.quantity), div);
          wantRate = half(G, div);
        } else if (l.code === "GRATUITY") {
          const base = pol.gratuityBasis === "BASIC" ? B : G;
          want = half(base * BigInt(pol.gratuityDaysPerYear!) * q100, div * 100n);
          wantRate = half(base * BigInt(pol.gratuityDaysPerYear!), div);
        } else {
          want = half(G * BigInt(pol.severanceDaysPerYear!) * BigInt(l.quantity), div);
          wantRate = half(G * BigInt(pol.severanceDaysPerYear!), div);
        }
        expect(kobo(l.amount), `${where} ${l.code} amount`).toBe(want);
        expect(kobo(l.rate), `${where} ${l.code} rate`).toBe(wantRate);
      }
    }
  });
});
