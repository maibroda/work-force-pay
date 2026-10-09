/**
 * The standard chart of accounts: seven classes, each split into groups and categories, down to the accounts.
 *
 *   Class → Group → Category → Account → Sub-account
 *
 * It is installed on request (Chart of Accounts → Install the standard chart). Installing never renames, retypes or
 * recodes an account that already exists: an existing account is only placed in its category, and accounts that are
 * missing are added. The accounts payroll, billing, payables and depreciation already post to keep their codes.
 *
 * A class is a matter of the group an account sits in, not of its code: the codes the system already posts to were
 * chosen before this scheme (for example 5410 Depreciation Expense, which belongs to operating expenses) and stay as
 * they are, because changing a code on a posted account would rewrite history.
 */

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export const CLASS_NAMES: Record<number, string> = {
  1: "Assets",
  2: "Liabilities",
  3: "Equity",
  4: "Revenue",
  5: "Cost of services",
  6: "Operating expenses",
  7: "Finance and other income / expense",
};

/** The account types a class may hold. Class 7 holds both finance income and finance costs. */
export const CLASS_TYPES: Record<number, AccountType[]> = {
  1: ["ASSET"],
  2: ["LIABILITY"],
  3: ["EQUITY"],
  4: ["INCOME"],
  5: ["EXPENSE"],
  6: ["EXPENSE"],
  7: ["INCOME", "EXPENSE"],
};

/** The financial-statement lines a category can report under. */
export const STATEMENT_LINES: Record<string, string> = {
  CASH_AND_EQUIVALENTS: "Cash and cash equivalents",
  TRADE_RECEIVABLES: "Trade receivables",
  OTHER_RECEIVABLES: "Other receivables",
  PREPAYMENTS: "Prepayments and deposits",
  TAX_ASSETS: "Tax assets",
  INVENTORIES: "Inventories",
  PPE: "Property, plant and equipment",
  INTANGIBLES: "Intangible assets",
  OTHER_NONCURRENT_ASSETS: "Other non-current assets",
  TRADE_PAYABLES: "Trade and other payables",
  PAYROLL_LIABILITIES: "Payroll and statutory liabilities",
  TAX_LIABILITIES: "Tax liabilities",
  CLIENT_LIABILITIES: "Client deposits and deferred revenue",
  OTHER_CURRENT_LIABILITIES: "Other current liabilities",
  BORROWINGS: "Borrowings",
  LEASE_LIABILITIES: "Lease liabilities",
  PROVISIONS: "Provisions",
  LONG_TERM_LIABILITIES: "Long-term liabilities",
  SHARE_CAPITAL: "Share capital and premium",
  RESERVES_AND_EARNINGS: "Reserves and retained earnings",
  REVENUE: "Revenue",
  REVENUE_ADJUSTMENTS: "Discounts, rebates and adjustments",
  OTHER_OPERATING_INCOME: "Other operating income",
  COST_OF_SERVICES: "Cost of services",
  OPERATING_EXPENSES: "Operating expenses",
  DEPRECIATION_AMORTISATION: "Depreciation and amortisation",
  FINANCE_INCOME: "Finance income",
  FINANCE_COSTS: "Finance costs",
  OTHER_NON_OPERATING: "Other non-operating items",
};

export interface StdAccount {
  code: string;
  name: string;
  type: AccountType;
  taxMapping?: string;
}
export interface StdCategory {
  code: string;
  name: string;
  statementLine: keyof typeof STATEMENT_LINES;
  accounts: StdAccount[];
}
export interface StdGroup {
  code: string;
  classNumber: number;
  name: string;
  categories: StdCategory[];
}

const A = (code: string, name: string, type: AccountType, taxMapping?: string): StdAccount => ({ code, name, type, taxMapping });

export const STANDARD_CHART: StdGroup[] = [
  // ───────────── 1 Assets ─────────────
  {
    code: "G1000", classNumber: 1, name: "Cash and bank",
    categories: [
      { code: "C1010", name: "Cash", statementLine: "CASH_AND_EQUIVALENTS", accounts: [A("1011", "Cash on Hand", "ASSET"), A("1012", "Petty Cash", "ASSET"), A("1013", "Cash in Transit", "ASSET")] },
      { code: "C1020", name: "Bank accounts", statementLine: "CASH_AND_EQUIVALENTS", accounts: [A("1230", "Cash and Bank — Operating", "ASSET"), A("1021", "Bank — Collections Account", "ASSET"), A("1022", "Bank — Payroll Account", "ASSET"), A("1023", "Bank — Statutory Payments Account", "ASSET")] },
    ],
  },
  {
    code: "G1100", classNumber: 1, name: "Receivables",
    categories: [
      { code: "C1110", name: "Client receivables", statementLine: "TRADE_RECEIVABLES", accounts: [A("1200", "Accounts Receivable", "ASSET"), A("1201", "Accrued Income (Unbilled Revenue)", "ASSET")] },
      { code: "C1120", name: "Other receivables", statementLine: "OTHER_RECEIVABLES", accounts: [A("1210", "Staff Loans & Salary Advances", "ASSET"), A("1121", "Other Receivables", "ASSET"), A("1122", "Advances to Suppliers", "ASSET")] },
      { code: "C1130", name: "Prepayments and deposits", statementLine: "PREPAYMENTS", accounts: [A("1131", "Prepayments", "ASSET"), A("1132", "Deposits Paid", "ASSET")] },
    ],
  },
  {
    code: "G1300", classNumber: 1, name: "Tax recoverable",
    categories: [{ code: "C1310", name: "Tax assets", statementLine: "TAX_ASSETS", accounts: [A("1220", "Withholding Tax Receivable", "ASSET", "WHT_RECEIVABLE"), A("1311", "VAT Input (Recoverable)", "ASSET", "VAT_INPUT"), A("1312", "Other Tax Recoverable", "ASSET")] }],
  },
  {
    code: "G1400", classNumber: 1, name: "Inventory",
    categories: [{ code: "C1410", name: "Inventories", statementLine: "INVENTORIES", accounts: [A("1411", "Consumables", "ASSET"), A("1412", "Security Equipment Stock", "ASSET"), A("1413", "Uniforms & Kit Stock", "ASSET")] }],
  },
  {
    code: "G1500", classNumber: 1, name: "Property, plant and equipment",
    categories: [
      {
        code: "C1510", name: "Cost", statementLine: "PPE",
        accounts: [
          A("1240", "Fixed Assets — Cost", "ASSET"), A("1511", "Land", "ASSET"), A("1512", "Buildings", "ASSET"), A("1513", "Motor Vehicles", "ASSET"), A("1514", "Plant & Machinery", "ASSET"),
          A("1515", "Security Equipment", "ASSET"), A("1516", "IT Equipment", "ASSET"), A("1517", "Office Equipment", "ASSET"), A("1518", "Furniture & Fittings", "ASSET"), A("1519", "Right-of-Use Assets", "ASSET"),
        ],
      },
      {
        code: "C1520", name: "Accumulated depreciation", statementLine: "PPE",
        accounts: [
          A("1250", "Accumulated Depreciation", "ASSET"), A("1521", "Accumulated Depreciation — Buildings", "ASSET"), A("1522", "Accumulated Depreciation — Motor Vehicles", "ASSET"), A("1523", "Accumulated Depreciation — Plant & Machinery", "ASSET"),
          A("1524", "Accumulated Depreciation — Security Equipment", "ASSET"), A("1525", "Accumulated Depreciation — IT Equipment", "ASSET"), A("1526", "Accumulated Depreciation — Office Equipment", "ASSET"),
          A("1527", "Accumulated Depreciation — Furniture & Fittings", "ASSET"), A("1528", "Accumulated Depreciation — Right-of-Use Assets", "ASSET"),
        ],
      },
    ],
  },
  {
    code: "G1600", classNumber: 1, name: "Intangible assets",
    categories: [{ code: "C1610", name: "Intangibles", statementLine: "INTANGIBLES", accounts: [A("1611", "Software", "ASSET"), A("1612", "Licences", "ASSET"), A("1613", "Accumulated Amortisation", "ASSET")] }],
  },
  {
    code: "G1900", classNumber: 1, name: "Other non-current assets",
    categories: [{ code: "C1910", name: "Other non-current assets", statementLine: "OTHER_NONCURRENT_ASSETS", accounts: [A("1911", "Other Non-current Assets", "ASSET"), A("1912", "Long-term Deposits", "ASSET")] }],
  },

  // ───────────── 2 Liabilities ─────────────
  {
    code: "G2000", classNumber: 2, name: "Payables",
    categories: [{ code: "C2010", name: "Trade payables and accruals", statementLine: "TRADE_PAYABLES", accounts: [A("2180", "Accounts Payable", "LIABILITY"), A("2011", "Accrued Expenses", "LIABILITY")] }],
  },
  {
    code: "G2100", classNumber: 2, name: "Payroll liabilities",
    categories: [
      {
        code: "C2110", name: "Salaries and deductions", statementLine: "PAYROLL_LIABILITIES",
        accounts: [A("2100", "Net Salaries Payable", "LIABILITY"), A("2110", "PAYE Tax Payable", "LIABILITY", "PAYE"), A("2120", "Employee Pension Payable", "LIABILITY", "PENSION"), A("2125", "Employer Pension Payable", "LIABILITY", "PENSION"), A("2130", "Penalties & Other Deductions Payable", "LIABILITY")],
      },
      {
        code: "C2140", name: "Statutory and employer accruals", statementLine: "PAYROLL_LIABILITIES",
        accounts: [
          A("2140", "ITF Payable", "LIABILITY", "ITF"), A("2145", "NSITF Payable", "LIABILITY", "NSITF"), A("2148", "NHF / Medical Payable", "LIABILITY", "NHF"), A("2150", "Insurance Accrued", "LIABILITY"), A("2155", "Uniform & Kits Accrued", "LIABILITY"),
          A("2160", "Recruitment, Training & Vetting Accrued", "LIABILITY"), A("2165", "Annual Leave Reliever Accrued", "LIABILITY"), A("2170", "Outsourcing Leave Allowance Payable", "LIABILITY"),
        ],
      },
    ],
  },
  {
    code: "G2200", classNumber: 2, name: "Tax liabilities",
    categories: [{ code: "C2210", name: "Taxes payable", statementLine: "TAX_LIABILITIES", accounts: [A("2190", "VAT Payable", "LIABILITY", "VAT_OUTPUT"), A("2195", "Withholding Tax Payable", "LIABILITY", "WHT_PAYABLE"), A("2202", "Other Tax Payables", "LIABILITY"), A("2203", "Company Income Tax Payable", "LIABILITY", "CIT")] }],
  },
  {
    code: "G2300", classNumber: 2, name: "Staff and client balances",
    categories: [
      { code: "C2310", name: "Staff payables", statementLine: "OTHER_CURRENT_LIABILITIES", accounts: [A("2301", "Staff Payables", "LIABILITY")] },
      { code: "C2320", name: "Client deposits and deferred revenue", statementLine: "CLIENT_LIABILITIES", accounts: [A("2311", "Client Deposits", "LIABILITY"), A("2312", "Deferred Revenue", "LIABILITY")] },
    ],
  },
  {
    code: "G2400", classNumber: 2, name: "Borrowings, leases and provisions",
    categories: [
      { code: "C2410", name: "Loans and overdrafts", statementLine: "BORROWINGS", accounts: [A("2401", "Bank Loans (Current)", "LIABILITY"), A("2402", "Bank Overdrafts", "LIABILITY")] },
      { code: "C2420", name: "Leases", statementLine: "LEASE_LIABILITIES", accounts: [A("2411", "Lease Liabilities (Current)", "LIABILITY")] },
      { code: "C2430", name: "Provisions and other", statementLine: "PROVISIONS", accounts: [A("2421", "Provisions", "LIABILITY"), A("2422", "Other Current Liabilities", "LIABILITY")] },
    ],
  },
  {
    code: "G2500", classNumber: 2, name: "Long-term liabilities",
    categories: [{ code: "C2510", name: "Long-term liabilities", statementLine: "LONG_TERM_LIABILITIES", accounts: [A("2501", "Long-term Loans", "LIABILITY"), A("2502", "Long-term Lease Liabilities", "LIABILITY"), A("2509", "Other Long-term Liabilities", "LIABILITY")] }],
  },

  // ───────────── 3 Equity ─────────────
  {
    code: "G3000", classNumber: 3, name: "Capital",
    categories: [{ code: "C3010", name: "Share capital", statementLine: "SHARE_CAPITAL", accounts: [A("3001", "Share Capital", "EQUITY"), A("3002", "Share Premium", "EQUITY")] }],
  },
  {
    code: "G3100", classNumber: 3, name: "Reserves and earnings",
    categories: [{ code: "C3110", name: "Reserves and retained earnings", statementLine: "RESERVES_AND_EARNINGS", accounts: [A("3100", "Opening Balance Equity", "EQUITY"), A("3101", "Retained Earnings", "EQUITY"), A("3102", "Current Year Profit / (Loss)", "EQUITY"), A("3103", "Reserves", "EQUITY"), A("3109", "Other Equity", "EQUITY")] }],
  },

  // ───────────── 4 Revenue ─────────────
  {
    code: "G4000", classNumber: 4, name: "Service revenue",
    categories: [
      { code: "C4010", name: "Security guarding", statementLine: "REVENUE", accounts: [A("4100", "Client Billing Revenue", "INCOME"), A("4101", "Direct Guarding Charges", "INCOME"), A("4102", "Indirect Guarding (Management) Charges", "INCOME")] },
      {
        code: "C4020", name: "Other services", statementLine: "REVENUE",
        accounts: [A("4110", "Management Fees", "INCOME"), A("4111", "Consultancy Revenue", "INCOME"), A("4112", "Training Revenue", "INCOME"), A("4113", "Technology / Security Systems Revenue", "INCOME"), A("4114", "Other Service Revenue", "INCOME"), A("4115", "Contract Revenue", "INCOME")],
      },
    ],
  },
  {
    code: "G4900", classNumber: 4, name: "Adjustments and other income",
    categories: [
      { code: "C4910", name: "Discounts, rebates and adjustments", statementLine: "REVENUE_ADJUSTMENTS", accounts: [A("4190", "Client Deductions (contra-revenue)", "INCOME"), A("4191", "Discounts and Rebates", "INCOME"), A("4192", "Revenue Adjustments", "INCOME")] },
      { code: "C4920", name: "Other operating income", statementLine: "OTHER_OPERATING_INCOME", accounts: [A("4199", "Other Operating Income", "INCOME"), A("4200", "Gain / (Loss) on Disposal of Fixed Assets", "INCOME")] },
    ],
  },

  // ───────────── 5 Cost of services ─────────────
  {
    code: "G5100", classNumber: 5, name: "Direct labour",
    categories: [
      {
        code: "C5110", name: "Pay and allowances", statementLine: "COST_OF_SERVICES",
        accounts: [
          A("5100", "Basic Salary Expense", "EXPENSE"), A("5110", "Housing Allowance Expense", "EXPENSE"), A("5120", "Transport Allowance Expense", "EXPENSE"), A("5130", "Entertainment Allowance Expense", "EXPENSE"), A("5140", "Meal Allowance Expense", "EXPENSE"),
          A("5150", "Utility Allowance Expense", "EXPENSE"), A("5160", "Leave Allowance Expense", "EXPENSE"), A("5170", "Medical Allowance Expense", "EXPENSE"), A("5175", "Hazard Allowance Expense", "EXPENSE"), A("5176", "Risk Allowance Expense", "EXPENSE"), A("5180", "Clothing Allowance Expense", "EXPENSE"),
        ],
      },
      { code: "C5120", name: "Overtime and adjustments", statementLine: "COST_OF_SERVICES", accounts: [A("5190", "Overtime Expense", "EXPENSE"), A("5195", "Arrears & Adjustments Expense", "EXPENSE"), A("5199", "Other Allowances & Bonuses Expense", "EXPENSE"), A("5990", "Payroll Rounding Differences", "EXPENSE")] },
      { code: "C5130", name: "Other direct labour", statementLine: "COST_OF_SERVICES", accounts: [A("5510", "Relief Guard Costs", "EXPENSE"), A("5520", "Staff Benefits", "EXPENSE"), A("5580", "Other Direct Labour", "EXPENSE")] },
    ],
  },
  {
    code: "G5200", classNumber: 5, name: "Employer costs",
    categories: [
      { code: "C5210", name: "Employer pension", statementLine: "COST_OF_SERVICES", accounts: [A("5200", "Employer Pension Expense", "EXPENSE")] },
      {
        code: "C5220", name: "Employer add-on costs", statementLine: "COST_OF_SERVICES",
        accounts: [
          A("5300", "ITF Expense", "EXPENSE"), A("5310", "NSITF Expense", "EXPENSE"), A("5315", "NHF / Medical Expense", "EXPENSE"), A("5320", "Insurance Expense — Guarding/Outsourcing Staff", "EXPENSE"), A("5330", "Uniform & Kits Expense", "EXPENSE"),
          A("5340", "Recruitment, Training & Vetting Expense", "EXPENSE"), A("5350", "Annual Leave Reliever Expense", "EXPENSE"), A("5360", "Outsourcing Leave Allowance Expense", "EXPENSE"),
        ],
      },
    ],
  },
  {
    code: "G5500", classNumber: 5, name: "Other direct costs",
    categories: [{ code: "C5510", name: "Contract and operating costs", statementLine: "COST_OF_SERVICES", accounts: [A("5540", "Security Equipment Costs", "EXPENSE"), A("5550", "Training Costs (Direct)", "EXPENSE"), A("5560", "Deployment Costs", "EXPENSE"), A("5570", "Contract-specific Costs", "EXPENSE"), A("5590", "Other Direct Operating Costs", "EXPENSE")] }],
  },

  // ───────────── 6 Operating expenses ─────────────
  {
    code: "G6000", classNumber: 6, name: "Administrative",
    categories: [{ code: "C6010", name: "Administrative expenses", statementLine: "OPERATING_EXPENSES", accounts: [A("6001", "Administrative Expenses", "EXPENSE"), A("6002", "Office Expenses", "EXPENSE"), A("6003", "Rent", "EXPENSE"), A("6004", "Utilities", "EXPENSE"), A("6005", "Telecommunications", "EXPENSE"), A("6006", "Insurance", "EXPENSE")] }],
  },
  {
    code: "G6100", classNumber: 6, name: "Professional and IT",
    categories: [{ code: "C6110", name: "Professional fees and IT", statementLine: "OPERATING_EXPENSES", accounts: [A("6101", "Professional Fees", "EXPENSE"), A("6102", "Legal Fees", "EXPENSE"), A("6103", "Audit Fees", "EXPENSE"), A("6104", "IT Expenses", "EXPENSE"), A("6105", "Software Subscriptions", "EXPENSE")] }],
  },
  {
    code: "G6200", classNumber: 6, name: "Operations and staff",
    categories: [{ code: "C6210", name: "Operating costs", statementLine: "OPERATING_EXPENSES", accounts: [A("6201", "Repairs & Maintenance", "EXPENSE"), A("6202", "Transport", "EXPENSE"), A("6203", "Fuel", "EXPENSE"), A("6204", "Travel", "EXPENSE"), A("6205", "Marketing", "EXPENSE"), A("6206", "Recruitment", "EXPENSE"), A("6207", "Training", "EXPENSE"), A("6208", "Staff Welfare", "EXPENSE")] }],
  },
  {
    code: "G6300", classNumber: 6, name: "Charges and impairment",
    categories: [{ code: "C6310", name: "Bank charges and bad debts", statementLine: "OPERATING_EXPENSES", accounts: [A("6301", "Bank Charges", "EXPENSE"), A("6302", "Bad Debt Expense", "EXPENSE"), A("5420", "Staff Loan Write-off", "EXPENSE")] }],
  },
  {
    code: "G6400", classNumber: 6, name: "Depreciation and amortisation",
    categories: [{ code: "C6410", name: "Depreciation and amortisation", statementLine: "DEPRECIATION_AMORTISATION", accounts: [A("5410", "Depreciation Expense", "EXPENSE"), A("6402", "Amortisation Expense", "EXPENSE")] }],
  },
  {
    code: "G6900", classNumber: 6, name: "Other operating expenses",
    categories: [{ code: "C6910", name: "Other operating expenses", statementLine: "OPERATING_EXPENSES", accounts: [A("5400", "Vendor Operating Expenses", "EXPENSE"), A("6901", "Other Operating Expenses", "EXPENSE")] }],
  },

  // ───────────── 7 Finance and other ─────────────
  {
    code: "G7000", classNumber: 7, name: "Finance and other income",
    categories: [
      { code: "C7010", name: "Finance income", statementLine: "FINANCE_INCOME", accounts: [A("7001", "Interest Income", "INCOME"), A("7002", "Foreign Exchange Gain", "INCOME")] },
      { code: "C7020", name: "Other non-operating income", statementLine: "OTHER_NON_OPERATING", accounts: [A("7003", "Other Non-operating Income", "INCOME")] },
    ],
  },
  {
    code: "G7100", classNumber: 7, name: "Finance costs and other expense",
    categories: [
      { code: "C7110", name: "Finance costs", statementLine: "FINANCE_COSTS", accounts: [A("7101", "Interest Expense", "EXPENSE"), A("7102", "Loan Charges", "EXPENSE"), A("7103", "Foreign Exchange Loss", "EXPENSE")] },
      { code: "C7120", name: "Other non-operating expense", statementLine: "OTHER_NON_OPERATING", accounts: [A("7104", "Asset Disposal Loss", "EXPENSE"), A("7105", "Other Non-operating Expenses", "EXPENSE"), A("7106", "Income Tax Expense", "EXPENSE", "CIT")] },
    ],
  },
];

/** Every account of the standard chart with the class, group and category it sits in. */
export function standardAccounts() {
  return STANDARD_CHART.flatMap((g) => g.categories.flatMap((c) => c.accounts.map((a) => ({ ...a, classNumber: g.classNumber, group: g, category: c }))));
}

/** Problems with a chart definition, as plain sentences; empty when it is sound. Used by the tests and the installer. */
export function validateChart(chart: StdGroup[] = STANDARD_CHART): string[] {
  const problems: string[] = [];
  const seen = (label: string) => {
    const s = new Set<string>();
    return (code: string) => {
      if (s.has(code)) problems.push(`Duplicate ${label} code ${code}.`);
      s.add(code);
    };
  };
  const g = seen("group");
  const c = seen("category");
  const a = seen("account");
  for (const group of chart) {
    g(group.code);
    if (!CLASS_NAMES[group.classNumber]) problems.push(`Group ${group.code} is in an unknown class ${group.classNumber}.`);
    for (const cat of group.categories) {
      c(cat.code);
      if (!STATEMENT_LINES[cat.statementLine]) problems.push(`Category ${cat.code} reports under an unknown statement line ${cat.statementLine}.`);
      for (const acct of cat.accounts) {
        a(acct.code);
        if (!(CLASS_TYPES[group.classNumber] ?? []).includes(acct.type)) problems.push(`Account ${acct.code} is ${acct.type}, which class ${group.classNumber} (${CLASS_NAMES[group.classNumber]}) can't hold.`);
      }
    }
  }
  return problems;
}
