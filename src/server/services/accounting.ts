/**
 * General-ledger posting for payroll.
 *
 * When a payroll run is LOCKED (or its period is CLOSED) one balanced journal is posted, built from
 * the payslip lines of every employee in the run, grouped by payroll head:
 *
 *   Dr  <expense account of each earning head>      (Basic, Housing, Overtime, Arrears, …)
 *   Dr  Employer pension expense
 *       Cr  <liability of each deduction head>      (PAYE, employee pension, penalties, loans, …)
 *       Cr  Employer pension payable
 *       Cr  Net salaries payable                    (sum of net pay)
 *
 * Posting is idempotent: a run has at most one journal (unique runId), so locking, closing and a
 * manual re-post can never double-post.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { round2, num } from "@/lib/money";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";

type Head = "EARNING" | "DEDUCTION" | "EMPLOYER" | "NET_PAY";
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

// ───────────────────────────── Default chart & mapping ─────────────────────────────

const DEFAULT_ACCOUNTS: Array<{ code: string; name: string; type: (typeof ACCOUNT_TYPES)[number] }> = [
  { code: "1210", name: "Staff Loans & Salary Advances", type: "ASSET" },
  { code: "2100", name: "Net Salaries Payable", type: "LIABILITY" },
  { code: "2110", name: "PAYE Tax Payable", type: "LIABILITY" },
  { code: "2120", name: "Employee Pension Payable", type: "LIABILITY" },
  { code: "2125", name: "Employer Pension Payable", type: "LIABILITY" },
  { code: "2130", name: "Penalties & Other Deductions Payable", type: "LIABILITY" },
  { code: "5100", name: "Basic Salary Expense", type: "EXPENSE" },
  { code: "5110", name: "Housing Allowance Expense", type: "EXPENSE" },
  { code: "5120", name: "Transport Allowance Expense", type: "EXPENSE" },
  { code: "5130", name: "Entertainment Allowance Expense", type: "EXPENSE" },
  { code: "5140", name: "Meal Allowance Expense", type: "EXPENSE" },
  { code: "5150", name: "Utility Allowance Expense", type: "EXPENSE" },
  { code: "5160", name: "Leave Allowance Expense", type: "EXPENSE" },
  { code: "5170", name: "Medical Allowance Expense", type: "EXPENSE" },
  { code: "5175", name: "Hazard Allowance Expense", type: "EXPENSE" },
  { code: "5176", name: "Risk Allowance Expense", type: "EXPENSE" },
  { code: "5180", name: "Clothing Allowance Expense", type: "EXPENSE" },
  { code: "5190", name: "Overtime Expense", type: "EXPENSE" },
  { code: "5195", name: "Arrears & Adjustments Expense", type: "EXPENSE" },
  { code: "5199", name: "Other Allowances & Bonuses Expense", type: "EXPENSE" },
  { code: "5200", name: "Employer Pension Expense", type: "EXPENSE" },
  // Guarding / outsourcing employer add-on costs (see EmployerCostRule) — expense + accrued payable
  // per head, so guarding, outsourcing and back-office cost can be told apart in the ledger.
  { code: "2140", name: "ITF Payable", type: "LIABILITY" },
  { code: "2145", name: "NSITF Payable", type: "LIABILITY" },
  { code: "2148", name: "NHF / Medical Payable", type: "LIABILITY" },
  { code: "2150", name: "Insurance Accrued", type: "LIABILITY" },
  { code: "2155", name: "Uniform & Kits Accrued", type: "LIABILITY" },
  { code: "2160", name: "Recruitment, Training & Vetting Accrued", type: "LIABILITY" },
  { code: "2165", name: "Annual Leave Reliever Accrued", type: "LIABILITY" },
  { code: "2170", name: "Outsourcing Leave Allowance Payable", type: "LIABILITY" },
  { code: "5300", name: "ITF Expense", type: "EXPENSE" },
  { code: "5310", name: "NSITF Expense", type: "EXPENSE" },
  { code: "5315", name: "NHF / Medical Expense", type: "EXPENSE" },
  { code: "5320", name: "Insurance Expense — Guarding/Outsourcing Staff", type: "EXPENSE" },
  { code: "5330", name: "Uniform & Kits Expense", type: "EXPENSE" },
  { code: "5340", name: "Recruitment, Training & Vetting Expense", type: "EXPENSE" },
  { code: "5350", name: "Annual Leave Reliever Expense", type: "EXPENSE" },
  { code: "5360", name: "Outsourcing Leave Allowance Expense", type: "EXPENSE" },
  { code: "5990", name: "Payroll Rounding Differences", type: "EXPENSE" },
  // Client billing (AR), vendor billing (AP) and fixed-asset depreciation — see gl-posting.ts.
  // Not payroll-head-mapped like the accounts above; posted directly by their own service.
  { code: "1200", name: "Accounts Receivable", type: "ASSET" },
  { code: "1220", name: "Withholding Tax Receivable", type: "ASSET" },
  { code: "1230", name: "Cash and Bank — Operating", type: "ASSET" },
  { code: "1240", name: "Fixed Assets — Cost", type: "ASSET" },
  { code: "1250", name: "Accumulated Depreciation", type: "ASSET" },
  { code: "2180", name: "Accounts Payable", type: "LIABILITY" },
  { code: "2190", name: "VAT Payable", type: "LIABILITY" },
  { code: "2195", name: "Withholding Tax Payable", type: "LIABILITY" },
  { code: "3100", name: "Opening Balance Equity", type: "EQUITY" },
  { code: "4100", name: "Client Billing Revenue", type: "INCOME" },
  { code: "4190", name: "Client Deductions (contra-revenue)", type: "INCOME" },
  { code: "4200", name: "Gain / (Loss) on Disposal of Fixed Assets", type: "INCOME" },
  { code: "5400", name: "Vendor Operating Expenses", type: "EXPENSE" },
  { code: "5410", name: "Depreciation Expense", type: "EXPENSE" },
];

// headCode, headName, type, debit account code, credit account code
const DEFAULT_MAPPINGS: Array<[string, string, Head, string | null, string | null]> = [
  ["BASIC", "Basic", "EARNING", "5100", null],
  ["HOUSING", "Housing", "EARNING", "5110", null],
  ["TRANSPORT", "Transport", "EARNING", "5120", null],
  ["ENTERTAINMENT", "Entertainment", "EARNING", "5130", null],
  ["MEAL", "Meal", "EARNING", "5140", null],
  ["UTILITY", "Utility", "EARNING", "5150", null],
  ["LEAVE", "Leave", "EARNING", "5160", null],
  ["MEDICAL", "Medical", "EARNING", "5170", null],
  ["CLOTHING", "Clothing", "EARNING", "5180", null],
  ["HAZARD", "Hazard allowance", "EARNING", "5175", null],
  ["RISK", "Risk allowance", "EARNING", "5176", null],
  ["OVERTIME", "Overtime", "EARNING", "5190", null],
  ["ARREARS", "Arrears", "EARNING", "5195", null],
  ["OTHER", "Other earnings", "EARNING", "5199", null],
  ["PAYE", "PAYE", "DEDUCTION", null, "2110"],
  ["PENSION_EE", "Employee Pension", "DEDUCTION", null, "2120"],
  ["PENALTY", "Penalty", "DEDUCTION", null, "2130"],
  ["RECOVERY", "Recovery", "DEDUCTION", null, "2130"],
  ["LOAN", "Loan repayment", "DEDUCTION", null, "1210"],
  ["SALARY_ADVANCE", "Salary advance recovery", "DEDUCTION", null, "1210"],
  ["OTHER_DEDUCTION", "Other deductions", "DEDUCTION", null, "2130"],
  ["PENSION_ER", "Employer Pension", "EMPLOYER", "5200", "2125"],
  ["ITF", "ITF (Industrial Training Fund)", "EMPLOYER", "5300", "2140"],
  ["NSITF", "NSITF-ECA", "EMPLOYER", "5310", "2145"],
  ["NHF_MEDICAL", "NHF / Medical", "EMPLOYER", "5315", "2148"],
  ["INSURANCE", "Insurance", "EMPLOYER", "5320", "2150"],
  ["UNIFORM_KITS", "Uniform & Kits", "EMPLOYER", "5330", "2155"],
  ["RECRUITMENT_TRAINING", "Recruitment, Training & Vetting", "EMPLOYER", "5340", "2160"],
  ["LEAVE_RELIEVER", "Annual Leave Reliever", "EMPLOYER", "5350", "2165"],
  ["OUTSOURCING_LEAVE_ALLOWANCE", "Outsourcing Leave Allowance", "EMPLOYER", "5360", "2170"],
  ["NET_PAY", "Net salaries payable", "NET_PAY", null, "2100"],
];

/** Where a head with no mapping of its own is posted. */
const FALLBACK: Record<"EARNING" | "DEDUCTION" | "EMPLOYER", string> = {
  EARNING: "OTHER",
  DEDUCTION: "OTHER_DEDUCTION",
  EMPLOYER: "PENSION_ER",
};

/** Payslip lines coded OTHER mean "other earnings" (bonus) or "other deductions" depending on side. */
const headCodeOf = (l: { type: string; code: string }) =>
  l.type === "DEDUCTION" && l.code === "OTHER" ? "OTHER_DEDUCTION" : l.code;

/**
 * Creates the standard Nigerian payroll chart and head mapping the first time an org needs it, and
 * tops up any DEFAULT_ACCOUNTS / DEFAULT_MAPPINGS entries added since (e.g. by an upgrade) that an
 * existing organization doesn't have yet. Never touches an account or mapping the org already has —
 * a code/name a Finance user renamed or remapped is left alone.
 */
export async function ensureDefaultChart(tx: Tx, orgId: string) {
  const existingAccounts = await tx.glAccount.findMany({ where: { organizationId: orgId } });
  const haveCode = new Set(existingAccounts.map((a) => a.code));
  const missingAccounts = DEFAULT_ACCOUNTS.filter((a) => !haveCode.has(a.code));
  if (missingAccounts.length)
    await tx.glAccount.createMany({ data: missingAccounts.map((a) => ({ organizationId: orgId, ...a })) });
  const accts = missingAccounts.length
    ? await tx.glAccount.findMany({ where: { organizationId: orgId } })
    : existingAccounts;
  const id = (code: string | null) => (code ? (accts.find((a) => a.code === code)?.id ?? null) : null);

  const existingMappings = await tx.payrollGlMapping.findMany({ where: { organizationId: orgId } });
  const haveHead = new Set(existingMappings.map((m) => m.headCode));
  const missingMappings = DEFAULT_MAPPINGS.filter(([headCode]) => !haveHead.has(headCode));
  if (missingMappings.length)
    await tx.payrollGlMapping.createMany({
      data: missingMappings.map(([headCode, headName, headType, dr, cr]) => ({
        organizationId: orgId,
        headCode,
        headName,
        headType,
        debitAccountId: id(dr),
        creditAccountId: id(cr),
      })),
    });
}

// ───────────────────────────── Chart of accounts & mapping ─────────────────────────────

export async function listAccounts(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  await ensureDefaultChart(db, ctx.orgId);
  return db.glAccount.findMany({ where: { organizationId: ctx.orgId }, orderBy: { code: "asc" } });
}

export const accountSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  type: z.enum(ACCOUNT_TYPES),
});

export async function createAccount(ctx: Ctx, raw: z.input<typeof accountSchema>) {
  assertCan(ctx, "gl.manage");
  const v = accountSchema.parse(raw);
  await ensureDefaultChart(db, ctx.orgId);
  const a = await db.glAccount.create({ data: { organizationId: ctx.orgId, ...v } });
  await logAudit(ctx, { action: "GL_ACCOUNT_CREATE", entity: "GlAccount", entityId: a.id, newValue: a });
  return a;
}

export async function updateAccount(ctx: Ctx, id: string, raw: { name?: string; active?: boolean }) {
  assertCan(ctx, "gl.manage");
  const old = await db.glAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Account not found.");
  if (raw.active === false) {
    const inUse = await db.payrollGlMapping.count({
      where: { organizationId: ctx.orgId, OR: [{ debitAccountId: id }, { creditAccountId: id }] },
    });
    if (inUse)
      throw new BusinessError("This account is used by a payroll-head mapping — remap those heads first.");
  }
  const a = await db.glAccount.update({
    where: { id },
    data: {
      ...(raw.name ? { name: raw.name.trim() } : {}),
      ...(raw.active === undefined ? {} : { active: raw.active }),
    },
  });
  await logAudit(ctx, {
    action: "GL_ACCOUNT_UPDATE",
    entity: "GlAccount",
    entityId: id,
    oldValue: old,
    newValue: a,
  });
  return a;
}

export async function listMappings(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  await ensureDefaultChart(db, ctx.orgId);
  return db.payrollGlMapping.findMany({
    where: { organizationId: ctx.orgId },
    include: { debitAccount: true, creditAccount: true },
    orderBy: [{ headType: "asc" }, { headCode: "asc" }],
  });
}

/** Payroll heads present on real payslips that have no mapping yet (custom salary components). */
export async function unmappedHeads(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const [mapped, recent] = await Promise.all([
    db.payrollGlMapping.findMany({ where: { organizationId: ctx.orgId }, select: { headCode: true } }),
    db.payrollRecord.findMany({
      where: { organizationId: ctx.orgId },
      select: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
  ]);
  const known = new Set(mapped.map((m) => m.headCode));
  const found = new Map<string, { code: string; name: string; type: Head }>();
  for (const r of recent)
    for (const l of r.lines as unknown as PayslipLine[]) {
      const code = headCodeOf(l);
      if (!known.has(code) && !found.has(code)) found.set(code, { code, name: l.name, type: l.type });
    }
  return [...found.values()];
}

export const mappingSchema = z.object({
  headCode: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((s) => s.toUpperCase()),
  headName: z.string().trim().min(1).max(120),
  headType: z.enum(["EARNING", "DEDUCTION", "EMPLOYER", "NET_PAY"]),
  debitAccountId: z.string().optional(),
  creditAccountId: z.string().optional(),
});

export async function saveMapping(ctx: Ctx, raw: z.input<typeof mappingSchema>) {
  assertCan(ctx, "gl.manage");
  const v = mappingSchema.parse(raw);
  const needsDebit = v.headType === "EARNING" || v.headType === "EMPLOYER";
  const needsCredit = v.headType !== "EARNING";
  if (needsDebit && !v.debitAccountId) throw new BusinessError("Choose the account this head is debited to.");
  if (needsCredit && !v.creditAccountId)
    throw new BusinessError("Choose the account this head is credited to.");
  const ids = [v.debitAccountId, v.creditAccountId].filter(Boolean) as string[];
  const found = await db.glAccount.count({
    where: { organizationId: ctx.orgId, id: { in: ids }, active: true },
  });
  if (found !== new Set(ids).size)
    throw new BusinessError("Choose active accounts from your chart of accounts.");
  await ensureDefaultChart(db, ctx.orgId);
  const data = {
    headName: v.headName,
    headType: v.headType,
    debitAccountId: needsDebit ? v.debitAccountId! : null,
    creditAccountId: needsCredit ? v.creditAccountId! : null,
  };
  const old = await db.payrollGlMapping.findUnique({
    where: { organizationId_headCode: { organizationId: ctx.orgId, headCode: v.headCode } },
  });
  const m = await db.payrollGlMapping.upsert({
    where: { organizationId_headCode: { organizationId: ctx.orgId, headCode: v.headCode } },
    create: { organizationId: ctx.orgId, headCode: v.headCode, ...data },
    update: data,
  });
  await logAudit(ctx, {
    action: "GL_MAPPING_SAVE",
    entity: "PayrollGlMapping",
    entityId: m.id,
    oldValue: old,
    newValue: m,
  });
  return m;
}

// ───────────────────────────── Posting ─────────────────────────────

interface PayslipLine {
  type: "EARNING" | "DEDUCTION" | "EMPLOYER";
  code: string;
  name: string;
  amount: number;
}

interface DraftLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  headCode: string;
  description: string;
  debit: number;
  credit: number;
}

/**
 * Posts the journal for a LOCKED / PAID run. Safe to call repeatedly (returns the existing
 * journal). Runs inside the caller's transaction so a lock and its journal commit together.
 */
export async function postRunToGl(
  ctx: Ctx,
  runId: string,
  source: "PAYROLL_LOCK" | "PAYROLL_CLOSE" | "MANUAL_POST",
  tx: Tx = db,
) {
  const existing = await tx.journalEntry.findUnique({ where: { runId } });
  if (existing) return existing;

  const run = await tx.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) throw new BusinessError("Payroll run not found.");
  if (!["LOCKED", "PAID"].includes(run.status))
    throw new BusinessError("Only a locked payroll can be posted to the general ledger.");

  await ensureDefaultChart(tx, ctx.orgId);
  const [records, mappings] = await Promise.all([
    tx.payrollRecord.findMany({ where: { runId }, select: { lines: true, netPay: true } }),
    tx.payrollGlMapping.findMany({
      where: { organizationId: ctx.orgId },
      include: { debitAccount: true, creditAccount: true },
    }),
  ]);
  const mapByCode = new Map(mappings.map((m) => [m.headCode, m]));

  // Group payslip lines by head.
  const heads = new Map<string, { type: PayslipLine["type"]; code: string; name: string; amount: number }>();
  for (const r of records)
    for (const l of r.lines as unknown as PayslipLine[]) {
      const code = headCodeOf(l);
      const k = `${l.type}|${code}`;
      const h = heads.get(k) ?? {
        type: l.type,
        code,
        // OTHER lines carry a per-employee name (e.g. "Commendation Award") — use the head's name.
        name: code === "OTHER" ? "Other earnings" : code === "OTHER_DEDUCTION" ? "Other deductions" : l.name,
        amount: 0,
      };
      h.amount = round2(h.amount + num(l.amount));
      heads.set(k, h);
    }

  const lines: DraftLine[] = [];
  const unmapped: string[] = [];
  const add = (
    acct: { id: string; code: string; name: string } | null | undefined,
    head: string,
    description: string,
    side: "DR" | "CR",
    amount: number,
  ) => {
    if (!round2(amount)) return;
    if (!acct)
      throw new BusinessError(
        `The GL mapping for "${head}" has no account — fix it under Accounting → Payroll GL Mapping.`,
      );
    const flip = amount < 0; // a negative earning/deduction posts to the opposite side
    const drSide = (side === "DR") !== flip;
    const v = Math.abs(round2(amount));
    lines.push({
      accountId: acct.id,
      accountCode: acct.code,
      accountName: acct.name,
      headCode: head,
      description,
      debit: drSide ? v : 0,
      credit: drSide ? 0 : v,
    });
  };

  for (const h of heads.values()) {
    let m = mapByCode.get(h.code);
    if (!m) {
      unmapped.push(h.code);
      m = mapByCode.get(FALLBACK[h.type]);
    }
    if (!m) throw new BusinessError(`No GL mapping for payroll head ${h.code}.`);
    const desc = `${mapByCode.get(h.code)?.headName ?? h.name} — ${run.period.name}`;
    if (h.type === "EARNING") add(m.debitAccount, h.code, desc, "DR", h.amount);
    else if (h.type === "DEDUCTION") add(m.creditAccount, h.code, desc, "CR", h.amount);
    else {
      add(m.debitAccount, h.code, desc, "DR", h.amount);
      add(m.creditAccount, h.code, `${desc} (payable)`, "CR", h.amount);
    }
  }
  const net = mapByCode.get("NET_PAY");
  add(
    net?.creditAccount,
    "NET_PAY",
    `Net salaries payable — ${run.period.name}`,
    "CR",
    round2(records.reduce((a, r) => a + num(r.netPay), 0)),
  );

  // The journal must balance. Sub-naira rounding goes to the rounding account; anything larger is a
  // data problem that should stop the lock rather than post a wrong ledger.
  const sum = (k: "debit" | "credit") => round2(lines.reduce((a, l) => a + l[k], 0));
  const diff = round2(sum("debit") - sum("credit"));
  if (Math.abs(diff) >= 1)
    throw new BusinessError(
      `Payroll heads do not reconcile to net pay (difference ₦${diff.toFixed(2)}) — the general-ledger journal cannot be posted.`,
    );
  if (diff) {
    const rounding = await tx.glAccount.findFirst({ where: { organizationId: ctx.orgId, code: "5990" } });
    add(
      rounding,
      "ROUNDING",
      `Rounding difference — ${run.period.name}`,
      diff > 0 ? "CR" : "DR",
      Math.abs(diff),
    );
  }
  if (!lines.length) throw new BusinessError("There is nothing to post — the payroll has no amounts.");

  const totalDebit = sum("debit");
  const totalCredit = sum("credit");
  const entryNumber = await nextNumber(tx, ctx.orgId, "JOURNAL");
  const remarks = unmapped.length
    ? `Heads without their own mapping were posted to the default account: ${[...new Set(unmapped)].join(", ")}.`
    : null;
  const journal = await tx.journalEntry.create({
    data: {
      organizationId: ctx.orgId,
      entryNumber,
      runId,
      periodName: run.period.name,
      postingDate: run.period.endDate,
      description: `Payroll ${run.type === "SUPPLEMENTARY" ? `supplementary #${run.runNumber}` : "regular run"} — ${run.period.name}`,
      source,
      totalDebit,
      totalCredit,
      postedBy: ctx.name,
      remarks,
      lines: {
        create: lines.map((l, i) => ({ ...l, sortOrder: i })),
      },
    },
  });
  await logAudit(
    ctx,
    {
      action: "GL_POSTING",
      entity: "JournalEntry",
      entityId: journal.id,
      newValue: { entryNumber, period: run.period.name, source, totalDebit, lines: lines.length },
    },
    tx,
  );
  return journal;
}

/** Backfill / retry: post a locked run that has no journal yet (e.g. locked before GL existed). */
export async function postRunManually(ctx: Ctx, runId: string) {
  assertCan(ctx, "gl.manage");
  return db.$transaction((tx) => postRunToGl(ctx, runId, "MANUAL_POST", tx), { timeout: 60_000 });
}

/**
 * Closes a locked/paid payroll period. Any of its runs not yet posted to the GL are posted first,
 * so a period can never be closed with payroll missing from the ledger.
 */
export async function closePeriod(ctx: Ctx, periodId: string) {
  assertCan(ctx, "payroll.lock");
  const period = await db.payrollPeriod.findFirst({
    where: { id: periodId, organizationId: ctx.orgId },
    include: { runs: true },
  });
  if (!period) throw new BusinessError("Payroll period not found.");
  if (period.status === "CLOSED") throw new BusinessError(`${period.name} is already closed.`);
  if (!["LOCKED", "PAID"].includes(period.status))
    throw new BusinessError("Only a locked or paid payroll period can be closed.");
  const open = period.runs.filter((r) => !["LOCKED", "PAID", "SUPERSEDED"].includes(r.status));
  if (open.length)
    throw new BusinessError(
      `Run #${open[0].runNumber} is still ${open[0].status.toLowerCase().replace("_", " ")} — lock every run before closing the period.`,
    );
  return db.$transaction(
    async (tx) => {
      for (const r of period.runs.filter((x) => ["LOCKED", "PAID"].includes(x.status)))
        await postRunToGl(ctx, r.id, "PAYROLL_CLOSE", tx);
      const closed = await tx.payrollPeriod.update({ where: { id: periodId }, data: { status: "CLOSED" } });
      await logAudit(
        ctx,
        {
          action: "PAYROLL_PERIOD_CLOSE",
          entity: "PayrollPeriod",
          entityId: periodId,
          oldValue: { status: period.status },
        },
        tx,
      );
      return closed;
    },
    { timeout: 60_000 },
  );
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listJournals(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  return db.journalEntry.findMany({
    where: { organizationId: ctx.orgId },
    include: { run: { include: { period: true } } },
    orderBy: [{ postingDate: "desc" }, { entryNumber: "desc" }],
  });
}

export async function getJournal(ctx: Ctx, id: string) {
  assertCan(ctx, "gl.view");
  return db.journalEntry.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, run: { include: { period: true } } },
  });
}

/** Locked runs still waiting for a journal. */
export async function unpostedRuns(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  return db.payrollRun.findMany({
    where: { organizationId: ctx.orgId, status: { in: ["LOCKED", "PAID"] }, journalEntry: null },
    include: { period: true },
    orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }, { runNumber: "asc" }],
  });
}
