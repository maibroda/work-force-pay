/**
 * Pure rules for pricing a client and writing the proposal. No database here.
 *
 * The price a proposal quotes starts from the rate card (a fee per employee with a monthly minimum, plus add-ons), but headcount alone does not
 * decide whether the price is right. The calculator also works out what delivering the work costs the bureau (officer hours, software and
 * support, overhead) and the lowest monthly fee that still earns the target margin. A proposal priced below that is flagged and can't go out
 * without a recorded approval. The cost is for the monthly service; the onboarding fee is treated as a one-off and is left out of the margin.
 */

export const PROPOSAL_PACKAGES = ["PAYROLL_ESSENTIALS", "PAYROLL_COMPLIANCE", "MANAGED_PAYROLL_PLUS", "ENTERPRISE"] as const;
export type PackageKey = (typeof PROPOSAL_PACKAGES)[number];
export const PACKAGE_NAMES: Record<PackageKey, string> = {
  PAYROLL_ESSENTIALS: "Payroll Essentials",
  PAYROLL_COMPLIANCE: "Payroll & Compliance",
  MANAGED_PAYROLL_PLUS: "Managed Payroll Plus",
  ENTERPRISE: "Enterprise",
};
export const TERMS = [6, 12] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type RateCard = { hourlyCost: number; softwareFixed: number; softwarePerEmployee: number; overheadPct: number; targetMarginPct: number; vatRatePct: number };
export type PackageTerms = { key: string; name: string; perEmployeeRate: number; monthlyMinimum: number; onboardingFee: number; baseHours: number; minutesPerEmployee: number; scope: string; responsibilities: string };
export type AddOnTerms = { code: string; name: string; description?: string | null; monthlyFee: number; perEmployeeFee: number; onboardingFee: number; hours: number; minutesPerEmployee: number };

export type QuoteInput = { card: RateCard; pkg: PackageTerms; addOns: readonly AddOnTerms[]; headcount: number; termMonths: number; extraHours: number; discountPct: number };

export type Quote = {
  headcount: number;
  termMonths: number;
  package: { key: string; name: string; monthly: number; onboarding: number; basis: "MINIMUM" | "PER_EMPLOYEE" };
  addOns: { code: string; name: string; description: string | null; monthly: number; onboarding: number }[];
  listMonthly: number;
  discountPct: number;
  discount: number;
  monthlyFee: number;
  onboardingFee: number;
  cost: { hours: number; extraHours: number; labour: number; software: number; overhead: number; total: number };
  marginAmount: number;
  marginPct: number;
  /** The lowest monthly fee that still earns the target margin. */
  floorMonthly: number;
  targetMarginPct: number;
  belowTarget: boolean;
  belowCost: boolean;
  vatRatePct: number;
  vat: number;
  monthlyWithVat: number;
  onboardingVat: number;
  contractValue: number;
  scope: string[];
  responsibilities: string[];
};

/** Lines of text, one per non-empty line, trimmed. */
export const textLines = (s: string | null | undefined): string[] => (s ?? "").split(/\r?\n/).map((l) => l.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);

export function quote(i: QuoteInput): Quote {
  const { card, pkg, headcount } = i;
  const perEmployee = headcount * pkg.perEmployeeRate;
  const pkgMonthly = round2(Math.max(pkg.monthlyMinimum, perEmployee));
  const addOns = i.addOns.map((a) => ({ code: a.code, name: a.name, description: a.description ?? null, monthly: round2(a.monthlyFee + a.perEmployeeFee * headcount), onboarding: round2(a.onboardingFee) }));
  const listMonthly = round2(pkgMonthly + addOns.reduce((s, a) => s + a.monthly, 0));
  const discount = round2((listMonthly * i.discountPct) / 100);
  const monthlyFee = round2(listMonthly - discount);
  const onboardingFee = round2(pkg.onboardingFee + addOns.reduce((s, a) => s + a.onboarding, 0));

  const hours = round2(pkg.baseHours + (headcount * pkg.minutesPerEmployee) / 60 + i.addOns.reduce((s, a) => s + a.hours + (headcount * a.minutesPerEmployee) / 60, 0) + i.extraHours);
  const labour = round2(hours * card.hourlyCost);
  const software = round2(card.softwareFixed + card.softwarePerEmployee * headcount);
  const overhead = round2(((labour + software) * card.overheadPct) / 100);
  const total = round2(labour + software + overhead);
  const marginAmount = round2(monthlyFee - total);
  const marginPct = monthlyFee > 0 ? round2((marginAmount / monthlyFee) * 100) : -100;
  const floorMonthly = round2(total / (1 - card.targetMarginPct / 100));
  const vat = round2((monthlyFee * card.vatRatePct) / 100);
  return {
    headcount,
    termMonths: i.termMonths,
    package: { key: pkg.key, name: pkg.name, monthly: pkgMonthly, onboarding: round2(pkg.onboardingFee), basis: perEmployee >= pkg.monthlyMinimum ? "PER_EMPLOYEE" : "MINIMUM" },
    addOns,
    listMonthly,
    discountPct: i.discountPct,
    discount,
    monthlyFee,
    onboardingFee,
    cost: { hours, extraHours: i.extraHours, labour, software, overhead, total },
    marginAmount,
    marginPct,
    floorMonthly,
    targetMarginPct: card.targetMarginPct,
    // a hair of tolerance so a price set exactly at the floor is not flagged by rounding
    belowTarget: marginPct < card.targetMarginPct - 0.005,
    belowCost: monthlyFee < total,
    vatRatePct: card.vatRatePct,
    vat,
    monthlyWithVat: round2(monthlyFee + vat),
    onboardingVat: round2((onboardingFee * card.vatRatePct) / 100),
    contractValue: round2(monthlyFee * i.termMonths + onboardingFee),
    scope: textLines(pkg.scope),
    responsibilities: textLines(pkg.responsibilities),
  };
}

// ─────────────────────────────── No guarantees ───────────────────────────────

const FORBIDDEN: { re: RegExp; say: string }[] = [
  // a disclaimer ("not a guarantee", "no guarantee") is the honest wording; a promise is not
  { re: /(?<!\b(?:not\s+an?|no|without|isn't\s+a|is\s+not\s+a)\s)guarantee/i, say: "guarantee" },
  { re: /zero[\s-]+errors?/i, say: "zero errors" },
  { re: /error[\s-]+free/i, say: "error-free" },
  { re: /\bno\s+errors?\b/i, say: "no errors" },
  { re: /100\s*%\s*(accura|complian|correct)/i, say: "100% accuracy or compliance" },
  { re: /(fully|completely|always)\s+compliant/i, say: "fully compliant" },
  { re: /certif(y|ied|ies|ication)\b[^.]{0,30}complian/i, say: "certified compliance" },
  { re: /risk[\s-]+free/i, say: "risk-free" },
  { re: /\bnever\s+(late|wrong|miss)/i, say: "never late or wrong" },
];

/** The promises the product must not make ("process evidence, not 'zero errors' or 'certified compliance'"). Empty when the text is fine. */
export function findForbiddenClaims(text: string | null | undefined): string[] {
  const t = text ?? "";
  return FORBIDDEN.filter((f) => f.re.test(t)).map((f) => f.say);
}

// ─────────────────────────────── Status ───────────────────────────────

export type ProposalState = "DRAFT" | "APPROVED" | "SENT" | "ACCEPTED" | "DECLINED" | "SUPERSEDED" | "WITHDRAWN";
/** What the proposal is today: a sent proposal past its date is expired. */
export function effectiveStatus(p: { status: ProposalState; validUntil: Date | string | null }, today: string): ProposalState | "EXPIRED" {
  const until = p.validUntil ? (typeof p.validUntil === "string" ? p.validUntil : p.validUntil.toISOString().slice(0, 10)) : null;
  return p.status === "SENT" && until && until < today ? "EXPIRED" : p.status;
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ─────────────────────────────── Starting rate card ───────────────────────────────

/** Placeholder figures a new bureau starts from. They are illustrations, not advice; a manager must set and confirm real ones before any proposal goes out. */
export const STARTING_CARD: RateCard = { hourlyCost: 3000, softwareFixed: 20000, softwarePerEmployee: 150, overheadPct: 20, targetMarginPct: 40, vatRatePct: 7.5 };

const RESPONSIBILITIES = [
  "Send complete inputs (joiners, leavers, changes, overtime and deductions) by the agreed cut-off each month.",
  "Review and approve each payroll before it is paid.",
  "Fund salaries and make the payments from your own bank account. We prepare the payment file; we never hold or move your funds.",
  "Tell us of changes to employees' bank, tax and pension details in writing, and keep the records you give us accurate.",
].join("\n");

export const STARTING_PACKAGES: PackageTerms[] = [
  {
    key: "PAYROLL_ESSENTIALS", name: PACKAGE_NAMES.PAYROLL_ESSENTIALS, perEmployeeRate: 1500, monthlyMinimum: 50000, onboardingFee: 50000, baseHours: 6, minutesPerEmployee: 8,
    scope: ["Monthly payroll calculated from the inputs you send, using the PAYE and pension rates in force", "A payslip for every employee", "A payroll register for your records", "A payment file for you to upload to your own bank"].join("\n"),
    responsibilities: RESPONSIBILITIES,
  },
  {
    key: "PAYROLL_COMPLIANCE", name: PACKAGE_NAMES.PAYROLL_COMPLIANCE, perEmployeeRate: 2500, monthlyMinimum: 75000, onboardingFee: 100000, baseHours: 10, minutesPerEmployee: 12,
    scope: ["Everything in Payroll Essentials", "Statutory schedules for PAYE and pension, prepared each month for you to file and pay", "A deadline calendar for the month's inputs, approval and remittances, with reminders", "A second person reviews each payroll before it comes to you"].join("\n"),
    responsibilities: RESPONSIBILITIES,
  },
  {
    key: "MANAGED_PAYROLL_PLUS", name: PACKAGE_NAMES.MANAGED_PAYROLL_PLUS, perEmployeeRate: 3500, monthlyMinimum: 125000, onboardingFee: 150000, baseHours: 14, minutesPerEmployee: 15,
    scope: ["Everything in Payroll & Compliance", "Month-on-month variance review, with each large movement explained", "A reconciliation of the payroll to the previous month and to the ledger", "Your own portal to approve payrolls, send inputs, raise queries and download payslips", "A query desk with replies tracked"].join("\n"),
    responsibilities: RESPONSIBILITIES,
  },
  {
    key: "ENTERPRISE", name: PACKAGE_NAMES.ENTERPRISE, perEmployeeRate: 4500, monthlyMinimum: 250000, onboardingFee: 300000, baseHours: 24, minutesPerEmployee: 18,
    scope: ["Everything in Managed Payroll Plus", "A named payroll officer for your account", "Multiple sites, pay groups and shift allowances set up to your rules", "Management reports on payroll cost by site and department", "A review of your payroll set-up each quarter"].join("\n"),
    responsibilities: RESPONSIBILITIES,
  },
];

export const STARTING_ADDONS: AddOnTerms[] = [
  { code: "PAYSLIP_EMAIL", name: "Payslip delivery by email", description: "Each payslip emailed to the employee as a PDF.", monthlyFee: 10000, perEmployeeFee: 0, onboardingFee: 0, hours: 0.5, minutesPerEmployee: 0 },
  { code: "REPORTS", name: "Monthly management reports", description: "Payroll cost by department and site, and headcount movement.", monthlyFee: 25000, perEmployeeFee: 0, onboardingFee: 0, hours: 2, minutesPerEmployee: 0 },
  { code: "OFF_CYCLE", name: "Off-cycle payroll run", description: "An extra payroll in the month, for example for a leaver or a correction.", monthlyFee: 20000, perEmployeeFee: 0, onboardingFee: 0, hours: 2, minutesPerEmployee: 0 },
  { code: "NHF_NHIS", name: "NHF and NHIS schedules", description: "Schedules for housing fund and health insurance contributions.", monthlyFee: 15000, perEmployeeFee: 50, onboardingFee: 0, hours: 1, minutesPerEmployee: 1 },
];
