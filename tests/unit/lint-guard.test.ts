import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The guard that keeps money rounding in the one shared utility (docs/plans/exact-money-stage-5.md). It runs the project's real ESLint
 * configuration over small pieces of code, pretending they live in particular files, and checks what is flagged and what is not.
 */
const root = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, "eslint.config.mjs") });

async function flagged(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

const INLINE = "export const f = (n: number) => Math.round(n * 100) / 100;\n";
const INLINE_4 = "export const f = (n: number) => Math.round(n * 10000) / 10000;\n";
const ROUND2 = 'import { round2 } from "@/lib/money";\nexport const f = (n: number) => round2(n);\n';

describe("the inline two-decimal rounding pattern is refused in src", () => {
  it("Math.round(x * 100) / 100 is an error in a normal source file, with a message that points to the shared utility", async () => {
    const messages = await flagged(INLINE, "src/lib/example.ts");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/shared utility.*money-exact/i);
  });
  it("so is Math.round(x * 10000) / 10000", async () => {
    expect(await flagged(INLINE_4, "src/server/services/example.ts")).toHaveLength(1);
  });
  it("so is the variant with an epsilon, which is how a private copy of round2 was written", async () => {
    expect(await flagged("export const f = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;\n", "src/lib/example.ts")).toHaveLength(1);
  });
  it("integer cents, which is a different idiom, is not refused", async () => {
    expect(await flagged("export const cents = (n: number) => Math.round(n * 100);\n", "src/lib/example.ts")).toEqual([]);
  });
});

describe("the files on the written exceptions list are not refused (each is a sales, finance or non-money file not yet converted)", () => {
  it.each(["src/lib/crm.ts", "src/server/services/crm.ts", "src/lib/pricing.ts", "src/server/services/cost-centers.ts", "src/server/services/gl-posting.ts", "src/server/services/tax-engine.ts", "src/server/report-registry.ts", "src/lib/appraisal.ts", "src/server/services/appraisals.ts"])(
    "%s",
    async (file) => {
      expect(await flagged(INLINE, file)).toEqual([]);
    },
  );
});

describe("tests are not covered by the rule", () => {
  it("a test file may use the pattern for its expected values", async () => {
    expect(await flagged(INLINE, "tests/unit/example.test.ts")).toEqual([]);
  });
});

describe("round2 cannot come back into the pay path", () => {
  it.each([
    "src/lib/payroll/engine.ts",
    "src/lib/payroll/paye.ts",
    "src/lib/eos.ts",
    "src/lib/loans.ts",
    "src/lib/payment-file.ts",
    "src/lib/pension-summary.ts",
    "src/lib/client-inputs.ts",
    "src/server/services/payroll.ts",
    "src/server/services/payments.ts",
    "src/server/services/settlements.ts",
    "src/server/services/loans.ts",
    "src/server/services/inputs.ts",
    "src/server/services/quick-payslip.ts",
    "src/app/(app)/payroll/quick-payslip/quick-payslip-form.tsx",
  ])("importing round2 into %s is an error", async (file) => {
    const messages = await flagged(ROUND2, file);
    expect(messages.some((m) => /round2/.test(m))).toBe(true);
  });
  it("round2 is still allowed where it is not pay (finance, reports), until those are converted", async () => {
    expect(await flagged(ROUND2, "src/server/services/billing.ts")).toEqual([]);
    expect(await flagged(ROUND2, "src/lib/receipts.ts")).toEqual([]);
  });
  it("the shared utilities themselves are fine", async () => {
    expect(await flagged('import { roundPlaces } from "@/lib/money-exact";\nexport const f = (n: number) => roundPlaces(n, 2);\n', "src/lib/payroll/engine.ts")).toEqual([]);
  });
});
