import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Money is rounded in ONE place (src/lib/money-exact.ts; plain numbers that are not money in roundPlaces there). See docs/plans/exact-money.md.
 * Two guards keep it that way:
 *   1. the inline patterns Math.round(x * 100) / 100 and Math.round(x * 10000) / 10000 are errors in src (tests may use them for expected values);
 *   2. the pay path may not import the legacy round2 from src/lib/money.
 */
const INLINE_ROUNDING = [
  {
    selector: "BinaryExpression[operator='/'][right.value=100] > CallExpression[callee.object.name='Math'][callee.property.name='round'] > BinaryExpression[operator='*'][right.value=100]",
    message: "Round money with the shared utility (src/lib/money-exact.ts), and a plain number that is not money with roundPlaces: not Math.round(x * 100) / 100.",
  },
  {
    selector: "BinaryExpression[operator='/'][right.value=10000] > CallExpression[callee.object.name='Math'][callee.property.name='round'] > BinaryExpression[operator='*'][right.value=10000]",
    message: "Round money with the shared utility (src/lib/money-exact.ts), and a plain number that is not money with roundPlaces: not Math.round(x * 10000) / 10000.",
  },
];

/**
 * THE WRITTEN EXCEPTIONS LIST. These files still round with the old inline pattern. Each is outside the pay path, which is exact:
 * sales and finance tools that have not been converted yet (docs/plans/exact-money-stage-5.md, "phase 6"), and appraisal scores, which are not money.
 * A file comes off this list when it is converted; nothing new goes on it without a reason written here.
 */
const NOT_YET_CONVERTED = [
  "src/lib/crm.ts", // sales commission
  "src/server/services/crm.ts", // sales dashboard figures
  "src/lib/pricing.ts", // proposal prices, discounts, margins, VAT
  "src/server/services/cost-centers.ts", // finance dimensions
  "src/server/services/gl-posting.ts", // general-ledger posting
  "src/server/services/tax-engine.ts", // finance tax codes (VAT etc.)
  "src/server/report-registry.ts", // finance reports
  "src/lib/appraisal.ts", // appraisal scores: not money
  "src/server/services/appraisals.ts", // appraisal scores: not money
];

/** Files on the pay path. They may not use the legacy round2 at all. */
const PAY_PATH = [
  "src/lib/payroll/**/*.{ts,tsx}",
  "src/lib/eos.ts",
  "src/lib/loans.ts",
  "src/lib/payment-file.ts",
  "src/lib/pension-summary.ts",
  "src/lib/client-inputs.ts",
  "src/server/services/{payroll,payroll-controls,payments,payment-file,payslips,settlements,loans,inputs,rates,quick-payslip,client-inputs}.ts",
  "src/app/(app)/payroll/quick-payslip/**/*.{ts,tsx}",
];

const config = [
  { ignores: [".next/**", ".next-smoke/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
  { files: ["src/**/*.{ts,tsx}"], ignores: NOT_YET_CONVERTED, rules: { "no-restricted-syntax": ["error", ...INLINE_ROUNDING] } },
  {
    files: PAY_PATH,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/money"],
              importNames: ["round2"],
              message: "The pay path is exact: use src/lib/money-exact.ts (roundPlaces for a number that is not money), not the legacy round2.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
