# Golden dataset format

Three files belong together. Put all three in the repository, for example under `tests/golden/`.

| File | What it holds |
|---|---|
| `golden_cases.csv` | 11 synthetic workers: inputs and the expected results (the answer key) |
| `golden_parameters.csv` | The settings the answer key was calculated with |
| `golden_tax_bands.csv` | The PAYE bands the answer key was calculated with |

IMPORTANT: every worker and number is invented. Never replace these with real payroll data.
IMPORTANT: the parameters and tax bands are PLACEHOLDERS until your tax adviser fills `verified_by` and `verified_on` in `golden_parameters.csv`. The answer key is only a trusted standard after that, and after you have hand-calculated the cases yourself.

---

## 1. golden_cases.csv

One header row, then one row per case. UTF-8, comma separated, values with commas are in double quotes, decimal point is a full stop, no thousands separators, no currency symbols. All money is in naira with up to two decimals (kobo).

### Input columns (what the engine receives)

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `case` | integer | | Case number 1 to 11 |
| `scenario` | text | | Short description of the situation |
| `state_of_residence` | text | | State where the worker lives. PAYE is assigned to this state |
| `days_in_month` | integer | days | Days in the pay month (proration denominator) |
| `rate_1` | decimal | naira per month | Monthly rate for the first period |
| `days_at_rate_1` | integer | days | Days paid at `rate_1` |
| `rate_2` | decimal | naira per month | Monthly rate for the second period (0 if none) |
| `days_at_rate_2` | integer | days | Days paid at `rate_2` (0 if none) |
| `unpaid_absence_days` | integer | days | Days of unpaid absence |
| `overtime_hours` | decimal | hours | Overtime hours worked |
| `overtime_multiplier` | decimal | multiple | Contract multiplier for those hours (0 if no overtime) |
| `monthly_allowances` | decimal | naira per month | Fixed allowances for a full month |
| `allowance_days` | integer | days | Days the allowances are payable (prorates allowances) |
| `sanction_deduction` | decimal | naira | Disciplinary deduction |
| `loan_deduction` | decimal | naira | Loan or advance repayment due |
| `coop_deduction` | decimal | naira | Cooperative deduction due |

Validation rules for any new case:
- `days_at_rate_1 + days_at_rate_2` must not exceed `days_in_month`.
- `allowance_days` must not exceed `days_in_month`.
- If `days_at_rate_2` is 0 then `rate_2` is 0.
- `overtime_multiplier` is 0 when `overtime_hours` is 0.

### Expected-result columns (the answer key)

| Column | Type | Meaning |
|---|---|---|
| `expected_base_pay` | decimal | Earned base pay BEFORE absence deduction |
| `expected_absence_deduction` | decimal | Deduction for unpaid absence |
| `expected_overtime_pay` | decimal | Overtime pay |
| `expected_allowances_paid` | decimal | Allowances actually paid after proration |
| `expected_gross` | decimal | Gross pay |
| `expected_pension` | decimal | Employee pension contribution |
| `expected_nhf` | decimal | NHF contribution |
| `expected_annual_taxable` | decimal | Annualised taxable income |
| `expected_annual_paye` | decimal | Annual PAYE from the bands |
| `expected_monthly_paye` | decimal | Monthly PAYE (annual divided by 12) |
| `expected_loan_coop_allowed` | decimal | Loan plus cooperative deductions actually taken after the net-pay floor |
| `expected_net_pay` | decimal | Net pay |
| `expected_paye_state` | text | State whose PAYE schedule the worker must appear on |

---

## 2. Calculation order and rounding

Round each line to 2 decimals (kobo), half up, at the line where it is calculated. Do NOT use floating-point numbers: parse CSV values as decimals or convert to whole kobo (multiply by 100) before comparing.

```
weighted_rate        = (rate_1 * days_at_rate_1 + rate_2 * days_at_rate_2) / (days_at_rate_1 + days_at_rate_2)
base_pay             = round2( (rate_1 * days_at_rate_1 + rate_2 * days_at_rate_2) / days_in_month )
absence_deduction    = round2( unpaid_absence_days * weighted_rate / days_in_month )
overtime_hourly_rate = weighted_rate / (days_in_month * hours_per_shift_day)        (not rounded)
overtime_pay         = round2( overtime_hours * overtime_hourly_rate * overtime_multiplier )
allowances_paid      = round2( monthly_allowances * allowance_days / days_in_month )
gross                = round2( base_pay - absence_deduction + overtime_pay + allowances_paid )
pension              = round2( gross * pensionable_share_of_gross * employee_pension_rate )
nhf                  = round2( gross * basic_share_of_gross * nhf_rate_on_basic )
annual_taxable       = max( 0, 12 * (gross - pension - nhf) - other_annual_relief )
annual_paye          = round2( sum over bands of max(0, annual_taxable - lower_limit) * incremental_rate )
monthly_paye         = round2( annual_paye / 12 )
loan_coop_allowed    = min( loan_deduction + coop_deduction,
                            max( 0, gross - pension - nhf - monthly_paye - min_takehome_share_of_gross * gross ) )
net_pay              = round2( gross - pension - nhf - monthly_paye - sanction_deduction - loan_coop_allowed )
paye_state           = state_of_residence
```

The `incremental_rate` in `golden_tax_bands.csv` is each band's rate minus the previous band's rate, so the sum above equals the usual stepped band calculation.

Known simplifications (deliberate, for the answer key only): rent relief is not modelled; pension and NHF bases use fixed shares of gross; PAYE is annualised by multiplying by 12; the net-pay floor applies only to loan and cooperative deductions; sanctions are deducted after statutory items. If your engine uses different rules, change the rule in one place and regenerate the key, do not tweak individual expected values.

---

## 3. Worked example: case 2 (mid-month transfer)

Inputs: rate_1 100,000 for 12 days; rate_2 120,000 for 18 days; allowances 10,000 for 30 days; 30-day month; Lagos.

1. Base pay = (100,000 x 12 + 120,000 x 18) / 30 = 3,360,000 / 30 = 112,000.00
2. Allowances = 10,000 x 30 / 30 = 10,000.00; no absence, no overtime
3. Gross = 112,000 + 10,000 = 122,000.00
4. Pension = 122,000 x 0.7 x 0.08 = 6,832.00
5. NHF = 122,000 x 0.5 x 0.025 = 1,525.00
6. Annual taxable = 12 x (122,000 - 6,832 - 1,525) = 1,363,716.00
7. Annual PAYE = (1,363,716 - 800,000) x 0.15 = 84,557.40
8. Monthly PAYE = 84,557.40 / 12 = 7,046.45
9. Net pay = 122,000 - 6,832 - 1,525 - 7,046.45 = 106,596.55

These match the expected values in the case 2 row.

## 4. How the tests should use the files

1. Load `golden_parameters.csv` and `golden_tax_bands.csv` into the settings the engine reads (effective-dated settings), for a pay date in the test.
2. For each row in `golden_cases.csv`, build the input, run the engine, and compare every `expected_*` field exactly to the kobo.
3. Fail the build on any difference. Never loosen a tolerance and never edit an expected value to make a test pass; if you believe the key is wrong, raise it with the founder and the tax adviser.
4. Block production payrolls when `verified_by` or `verified_on` is empty; test and parallel-run payrolls may proceed but must be labelled "unverified settings".

## 5. Adding a case

Add a row with the input columns, calculate the expected values by hand using Section 2, then check them against the workbook `09_Golden_Test_Datasets.xlsx` (Cases tab). Put the founder's hand calculation in the workbook's "Your hand-calculated net pay" column and confirm it shows MATCH. Cases worth adding: months with 28, 29 and 31 days; a worker with zero pay; two states in one payroll; a high earner crossing the upper bands; a negative-adjustment month.

## 6. Example TypeScript type (optional)

```ts
type GoldenCase = {
  case: number; scenario: string; state_of_residence: string; days_in_month: number;
  rate_1: string; days_at_rate_1: number; rate_2: string; days_at_rate_2: number;
  unpaid_absence_days: number; overtime_hours: string; overtime_multiplier: string;
  monthly_allowances: string; allowance_days: number;
  sanction_deduction: string; loan_deduction: string; coop_deduction: string;
  expected_base_pay: string; expected_absence_deduction: string; expected_overtime_pay: string;
  expected_allowances_paid: string; expected_gross: string; expected_pension: string; expected_nhf: string;
  expected_annual_taxable: string; expected_annual_paye: string; expected_monthly_paye: string;
  expected_loan_coop_allowed: string; expected_net_pay: string; expected_paye_state: string;
};
// Keep money as strings and parse to whole kobo (BigInt or integer), never to float.
```
